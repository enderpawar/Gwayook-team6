import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtractionGuard } from '../src/extraction-guard.js';

const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const input = { callerId: '192.0.2.1', mimeType: 'image/png', data: image };
const success = { status: 200, extraction: { productName: '시연 상품' } };

function expectLimited(result, code, retryAfter) {
  assert.deepEqual(result, { status: 429, code, retryable: true, retryAfter });
}

test('blocks a duplicate from the same verified peer without sharing the result or caching a completed image', async () => {
  const first = Promise.withResolvers();
  const calls = [];
  const guard = createExtractionGuard({ extract: (payload) => {
    calls.push(payload);
    return calls.length === 1 ? first.promise : success;
  } });

  const original = guard.run({ ...input, headers: { 'x-forwarded-for': '192.0.2.9' } });
  const duplicate = await guard.run({ ...input, callerId: '0:0:0:0:0:ffff:c000:201', data: Buffer.from(image) });
  expectLimited(duplicate, 'EXTRACTION_IN_PROGRESS', 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { mimeType: 'image/png', data: image });
  assert.strictEqual(calls[0].data, image);

  assert.deepEqual(await guard.run({ ...input, callerId: '192.0.2.2' }), success);
  assert.deepEqual(await guard.run({ ...input, data: Buffer.concat([image, Buffer.from([2])]) }), success);
  first.resolve({ status: 422, code: 'MANUAL_CORRECTION_REQUIRED', extraction: { productName: '부분 판독' } });
  assert.equal((await original).status, 422);
  assert.deepEqual(await guard.run(input), success);
  assert.equal(calls.length, 4);
});

test('shares a finite fixed-window quota across canonical peer addresses, not across peers, and recovers at expiry', async () => {
  let time = 0;
  const guard = createExtractionGuard({ extract: () => success, now: () => time, windowMs: 2_500, maxPerCaller: 1 });
  const ipv6 = { ...input, callerId: '2001:0db8:0:0:0:0:0:1' };
  const samePeer = { ...input, callerId: '2001:db8::1' };

  assert.deepEqual(await guard.run(ipv6), success);
  expectLimited(await guard.run(samePeer), 'EXTRACTION_RATE_LIMITED', 3);
  assert.deepEqual(await guard.run({ ...input, callerId: '2001:db8::2' }), success);
  time = 2_499;
  expectLimited(await guard.run(samePeer), 'EXTRACTION_RATE_LIMITED', 1);
  time = 2_500;
  assert.deepEqual(await guard.run(samePeer), success);
});

test('counts duplicate attempts against the local quota without incurring another provider call', async () => {
  const first = Promise.withResolvers();
  let calls = 0;
  const guard = createExtractionGuard({ maxPerCaller: 2, extract: () => {
    calls++;
    return first.promise;
  } });

  const original = guard.run(input);
  expectLimited(await guard.run(input), 'EXTRACTION_IN_PROGRESS', 1);
  assert.equal((await guard.run(input)).code, 'EXTRACTION_RATE_LIMITED');
  first.resolve(success);
  assert.deepEqual(await original, success);
  assert.equal(calls, 1);
});

test('caps the number of remembered peers and admits a new peer when the earliest window expires', async () => {
  let time = 0;
  const guard = createExtractionGuard({ extract: () => success, now: () => time, windowMs: 3_000, maxCallers: 2 });

  assert.deepEqual(await guard.run(input), success);
  time = 500;
  assert.deepEqual(await guard.run({ ...input, callerId: '192.0.2.2' }), success);
  for (const callerId of ['192.0.2.3', '192.0.2.4', '192.0.2.5']) {
    expectLimited(await guard.run({ ...input, callerId }), 'EXTRACTION_BUSY', 3);
  }
  time = 3_000;
  assert.deepEqual(await guard.run({ ...input, callerId: '192.0.2.5' }), success);
  expectLimited(await guard.run(input), 'EXTRACTION_BUSY', 1);
});

test('caps active provider calls globally, releases on rejection, and forwards retryable provider results unchanged', async () => {
  const first = Promise.withResolvers();
  const unavailable = { status: 502, code: 'GEMINI_UNAVAILABLE', retryable: true };
  const notConfigured = { status: 503, code: 'GEMINI_NOT_CONFIGURED', retryable: false };
  let calls = 0;
  let time = 0;
  const guard = createExtractionGuard({ maxConcurrent: 1, maxPerCaller: 1, now: () => time,
    extract: () => [first.promise, unavailable, notConfigured][calls++],
  });
  const other = { ...input, callerId: '192.0.2.2' };

  const blockedUntilFirstFinishes = assert.rejects(guard.run(input), /provider error/);
  expectLimited(await guard.run(other), 'EXTRACTION_BUSY', 1);
  assert.equal(calls, 1);
  first.reject(new Error('provider error'));
  await blockedUntilFirstFinishes;
  assert.deepEqual(await guard.run(other), unavailable);
  time = 60_000;
  assert.deepEqual(await guard.run(input), notConfigured);
  assert.equal(calls, 3);
});

test('an absent or invalid peer cannot evade throttling using forwarding headers', async () => {
  const guard = createExtractionGuard({ extract: () => success });
  for (const callerId of [undefined, '192.0.2.1, 192.0.2.2', 'visitor']) {
    assert.deepEqual(await guard.run({ ...input, callerId, headers: { 'x-forwarded-for': '192.0.2.1' } }), {
      status: 503, code: 'EXTRACTION_CALLER_UNAVAILABLE', retryable: false,
    });
  }
});
