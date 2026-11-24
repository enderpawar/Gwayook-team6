import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/server.js';

const png = new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1)], { type: 'image/png' });
const extraction = { shortName: '시연 상품' };

async function start(t, extract) {
  const app = createApp({ p1DbPath: '', extract });
  t.after(() => new Promise((resolve, reject) => {
    app.close((error) => error ? reject(error) : resolve());
  }));
  await once(app.listen(0, '127.0.0.1'), 'listening');
  return `http://127.0.0.1:${app.address().port}`;
}

function upload(url, { image = png, headers } = {}) {
  const form = new FormData();
  form.set('image', image, 'capture.png');
  return fetch(`${url}/api/products/extract`, {
    method: 'POST', body: form, headers, signal: AbortSignal.timeout(5_000),
  });
}

async function assertLimited(response, code) {
  assert.equal(response.status, 429);
  const retryAfter = response.headers.get('Retry-After');
  assert.match(retryAfter ?? '', /^[1-9]\d*$/);
  assert.deepEqual(await response.json(), { code, retryable: true });
  return Number(retryAfter);
}

test('blocks a concurrent duplicate over HTTP without sharing the provider result', async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const url = await start(t, () => {
    calls++;
    started.resolve();
    return release.promise;
  });
  const first = upload(url);
  try {
    await Promise.race([started.promise, first.then(({ status }) => assert.fail(`unexpected HTTP ${status} before provider call`))]);
    assert.equal(await assertLimited(await upload(url), 'EXTRACTION_IN_PROGRESS'), 1);
    assert.equal(calls, 1);
  } finally {
    release.resolve({ status: 200, extraction });
  }
  const response = await first;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Retry-After'), null);
  assert.deepEqual(await response.json(), { extraction });
});

test('uses one quota per socket peer after validation, independent of headers and server instances', async (t) => {
  let calls = 0;
  const url = await start(t, () => {
    calls++;
    return { status: 200, extraction };
  });
  const invalid = await upload(url, { image: new Blob(['not an image'], { type: 'image/png' }) });
  assert.equal(invalid.status, 415);
  assert.equal((await invalid.json()).code, 'UNSUPPORTED_IMAGE');
  const oversized = await upload(url, { image: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'BODY_TOO_LARGE');

  for (let count = 0; count < 6; count++) {
    const response = await upload(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { extraction });
  }
  assert.ok((await assertLimited(await upload(url), 'EXTRACTION_RATE_LIMITED')) <= 60);
  const spoofed = await upload(url, { headers: {
    'X-Forwarded-For': '192.0.2.1',
    Forwarded: 'for=192.0.2.2',
    Authorization: 'Bearer invalid-test-token',
  } });
  assert.ok((await assertLimited(spoofed, 'EXTRACTION_RATE_LIMITED')) <= 60);
  assert.equal(calls, 6);

  const response = await fetch(`${url}/api/analyses`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      people: 2,
      product: {
        shortName: '물', fullTitle: '생수 6병', bulkTotalQty: 6, unitName: '병', allocationStep: 1, uniformUnits: true,
        payment: { productAmount: 9000, shippingFee: 0, discountAmount: 0, includesShipping: false, includesDiscount: false },
      },
    }),
  });
  assert.equal(response.status, 200);
  const analysis = await response.json();
  assert.equal(analysis.comparison.status, 'PENDING');
  assert.deepEqual(analysis.settlements.map(({ amount }) => amount), [4500, 4500]);

  const correction = { code: 'MANUAL_CORRECTION_REQUIRED', extraction };
  const otherUrl = await start(t, () => ({ status: 422, ...correction }));
  const other = await upload(otherUrl);
  assert.equal(other.status, 422);
  assert.equal(other.headers.get('Retry-After'), null);
  assert.deepEqual(await other.json(), correction);
});
