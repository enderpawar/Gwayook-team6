import { createHash } from 'node:crypto';
import { isIP, SocketAddress } from 'node:net';

function peerKey(address) {
  if (typeof address !== 'string') return null;
  switch (isIP(address)) {
    case 4: return address;
    case 6: {
      const canonical = new SocketAddress({ address, family: 'ipv6' }).address;
      return canonical.startsWith('::ffff:') ? canonical.slice(7) : canonical;
    }
    default: return null;
  }
}

function limited(code, retryAfter) {
  return { status: 429, code, retryable: true, retryAfter };
}

/**
 * Create once per server. Pass only the verified socket peer (normally
 * request.socket.remoteAddress), never a client-supplied forwarding header.
 * Run after multipart validation; `data` is the validated image Buffer.
 * On 429 expose `retryAfter` as the integer Retry-After HTTP header, not JSON.
 * A fixed per-peer window counts requests that reach the hash check (including
 * duplicates). Busy requests do not consume quota. Pending images are tracked
 * by digest only; results are never shared across requests or kept by the guard.
 */
export function createExtractionGuard({
  extract,
  now = () => performance.now(),
  windowMs = 60_000,
  maxPerCaller = 6,
  maxConcurrent = 4,
  maxCallers = 1_024,
}) {
  if (typeof extract !== 'function' || typeof now !== 'function') {
    throw new TypeError('Extraction guard requires extract and a clock function');
  }
  if (![windowMs, maxPerCaller, maxConcurrent, maxCallers].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  ) || windowMs > 2_147_483_647) throw new RangeError('Invalid extraction guard limits');

  // A fixed window and monotonic clock keep the first entry the earliest expiry.
  const buckets = new Map();
  const inFlight = new Map();
  let active = 0;
  let expiryTimer;

  function expire(time) {
    for (const [peer, bucket] of buckets) {
      if (bucket.expiresAt > time) break;
      buckets.delete(peer);
    }
  }

  function scheduleExpiry(time) {
    if (expiryTimer) return;
    const next = buckets.values().next().value;
    if (!next) return;
    expiryTimer = setTimeout(() => {
      expiryTimer = undefined;
      const time = now();
      expire(time);
      scheduleExpiry(time);
    }, Math.ceil(next.expiresAt - time)).unref();
  }

  const secondsUntil = (expiresAt, time) => Math.max(1, Math.ceil((expiresAt - time) / 1_000));

  async function run({ callerId, mimeType, data }) {
    const peer = peerKey(callerId);
    if (!peer) return { status: 503, code: 'EXTRACTION_CALLER_UNAVAILABLE', retryable: false };

    const time = now();
    expire(time);
    let bucket = buckets.get(peer);
    if (bucket?.requests >= maxPerCaller) {
      return limited('EXTRACTION_RATE_LIMITED', secondsUntil(bucket.expiresAt, time));
    }
    if (active >= maxConcurrent) return limited('EXTRACTION_BUSY', 1);
    if (!bucket) {
      if (buckets.size >= maxCallers) {
        return limited('EXTRACTION_BUSY', secondsUntil(buckets.values().next().value.expiresAt, time));
      }
      bucket = { expiresAt: time + windowMs, requests: 0 };
      buckets.set(peer, bucket);
      scheduleExpiry(time);
    }
    bucket.requests++;

    const digest = createHash('sha256').update(mimeType).update('\0').update(data).digest('base64url');
    let pending = inFlight.get(peer);
    if (pending?.has(digest)) return limited('EXTRACTION_IN_PROGRESS', 1);
    if (!pending) {
      pending = new Set();
      inFlight.set(peer, pending);
    }
    pending.add(digest);
    active++;
    try {
      return await extract({ mimeType, data });
    } finally {
      active--;
      pending.delete(digest);
      if (!pending.size) inFlight.delete(peer);
    }
  }

  return { run };
}
