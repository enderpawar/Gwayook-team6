import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractProduct } from '../src/gemini.js';

const image = { mimeType: 'image/png', data: Buffer.from('image fixture') };
const product = {
  fullTitle: '제주 삼다수 2L × 24병', shortName: '  삼다수  2L ', packCount: 4, unitsPerPack: 6,
  unitName: '병', netAmountPerUnit: { amount: 2, unit: 'L' }, mixedCart: false,
};

function mockProvider(context, fetch, { key = 'test-only', model } = {}) {
  const previous = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL };
  for (const [name, value] of Object.entries({ GEMINI_API_KEY: key, GEMINI_MODEL: model })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  context.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return context.mock.method(globalThis, 'fetch', fetch);
}

function modelText(text) {
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
}

function modelResult(value) {
  return modelText(JSON.stringify(value));
}

function quote(amount, type, evidence, fields = {}) {
  return { amount, type, evidence, scope: 'PRODUCT', option: null, condition: null, ...fields };
}

test('여러 옵션·가격 후보를 확정하지 않고 반환하며 공급자에는 이미지와 규칙만 보낸다', async (context) => {
  const optionCandidates = ['2L × 24병', '2L × 12병'];
  const priceCandidates = [
    quote(25920, 'SALE_PRICE', '판매가 25,920원', { option: '2L × 24병' }),
    quote(22920, 'COUPON_PRICE', '앱 쿠폰 적용가 22,920원', { option: '2L × 24병', condition: '앱 쿠폰 사용 시' }),
    quote(13900, 'MEMBER_PRICE', '회원가 13,900원', { option: '2L × 12병', condition: '회원 전용' }),
  ];
  const privateInputs = { people: 3, location: 'privatePickup', name: 'privateName', phone: 'privatePhone', payment: 'privatePayment' };
  mockProvider(context, async (url, { body }) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    const request = JSON.parse(body);
    assert.deepEqual(request.contents, [{ parts: [{ inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } }] }]);
    for (const value of Object.values(privateInputs).filter((item) => typeof item === 'string')) {
      assert.ok(!body.includes(value));
    }
    return modelResult({
      ...product, optionCandidates, displayedTotalPrice: null, selectedOption: null,
      shippingFee: 3000, discountAmount: 3000, priceCandidates, evidence: ['2L × 24병', '배송비 3,000원'],
    });
  });

  const result = await extractProduct({ ...image, ...privateInputs });
  assert.deepEqual(result, {
    status: 200,
    extraction: {
      ...product, shortName: '삼다수 2L', optionCandidates, selectedOption: null, displayedTotalPrice: null,
      shippingFee: 3000, discountAmount: 3000, evidence: ['2L × 24병', '배송비 3,000원'],
      priceCandidates: priceCandidates.map(({ scope, ...candidate }) => candidate),
      unresolvedFields: ['selectedOption', 'displayedTotalPrice'],
    },
  });
});

test('혼합 장바구니 합계와 범위 밖 값을 보류하고 유효 판독은 보존한다', async (context) => {
  mockProvider(context, async () => modelResult({
    ...product, mixedCart: true, displayedTotalPrice: 100000, selectedOption: '2L × 24병',
    unitsPerPack: 0, netAmountPerUnit: { amount: 2, unit: 'unknown' }, shippingFee: -1, discountAmount: '3000',
    unresolvedFields: ['selectedOption', 'smallPackPrice'], evidence: ['삼다수 2L', 0, ''],
    priceCandidates: [
      quote(100000, 'CHECKOUT_TOTAL', '여러 상품의 결제 합계 100,000원', { scope: 'CART' }),
      quote(Number.MAX_SAFE_INTEGER + 1, 'SALE_PRICE', '잘못된 금액'),
      quote(13900, 'UNKNOWN', '잘못된 유형'),
    ],
    comparisonPresetId: 'bottled-water', smallPackQty: 6, smallPackPrice: 7800,
  }));

  assert.deepEqual(await extractProduct(image), {
    status: 422, code: 'MANUAL_CORRECTION_REQUIRED',
    extraction: {
      ...product, shortName: '삼다수 2L', mixedCart: true, unitsPerPack: null, netAmountPerUnit: null,
      displayedTotalPrice: null, selectedOption: null, optionCandidates: [], shippingFee: null, discountAmount: null,
      priceCandidates: [], evidence: ['삼다수 2L'],
      unresolvedFields: [
        'selectedOption', 'optionCandidates', 'unitsPerPack', 'netAmountPerUnit', 'displayedTotalPrice',
        'shippingFee', 'discountAmount', 'priceCandidates',
      ],
    },
  });
});

test('혼합 장바구니에서도 근거가 있는 대상 상품 소계만 보존한다', async (context) => {
  mockProvider(context, async () => modelResult({
    ...product, mixedCart: true, displayedTotalPrice: 25920, shippingFee: 0,
    priceCandidates: [
      quote(30000, 'CHECKOUT_TOTAL', '장바구니 합계 30,000원', { scope: 'CART' }),
      quote(25920, 'DISPLAYED_TOTAL', '삼다수 상품 소계 25,920원'),
    ],
  }));
  const { status, extraction } = await extractProduct(image);
  assert.equal(status, 200);
  assert.equal(extraction.displayedTotalPrice, 25920);
  assert.equal(extraction.shippingFee, 0);
  assert.deepEqual(extraction.priceCandidates.map(({ amount, evidence }) => [amount, evidence]), [[25920, '삼다수 상품 소계 25,920원']]);
});

test('모델 결과와 공급자 JSON이 깨졌을 때 재호출하지 않고 수동 보정으로 보낸다', async (context) => {
  for (const [name, reply] of [
    ['모델의 JSON', () => modelText('{broken')],
    ['공급자의 JSON', () => new Response('<html>', { headers: { 'content-type': 'application/json' } })],
  ]) {
    await context.test(name, async (subtest) => {
      const fetch = mockProvider(subtest, async () => reply());
      const { status, code, extraction } = await extractProduct(image);
      assert.equal(status, 422);
      assert.equal(code, 'MANUAL_CORRECTION_REQUIRED');
      assert.equal(extraction.fullTitle, null);
      assert.deepEqual(extraction.priceCandidates, []);
      assert.ok(extraction.unresolvedFields.includes('displayedTotalPrice'));
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('키 미설정은 공급자 요청 없이 수동 경로로 전환할 수 있게 알린다', async (context) => {
  const fetch = mockProvider(context, async () => assert.fail('configured key required'), { key: ' ' });
  assert.deepEqual(await extractProduct(image), { status: 503, code: 'GEMINI_NOT_CONFIGURED', retryable: false });
  assert.equal(fetch.mock.callCount(), 0);
});

test('5xx 및 네트워크 오류 뒤 한 번만 재시도하며 모델 재정의를 유지한다', async (context) => {
  for (const [name, reply] of [
    ['공급자 일시 오류', () => new Response(null, { status: 503 })],
    ['네트워크 오류', () => { throw new TypeError('fetch failed'); }],
  ]) {
    await context.test(name, async (subtest) => {
      let attempts = 0;
      const fetch = mockProvider(subtest, async (url) => {
        assert.match(url, /\/models\/custom-flash:generateContent$/);
        return ++attempts === 1 ? reply() : modelResult({ ...product, displayedTotalPrice: 25920 });
      }, { model: ' custom-flash ' });
      const { status, extraction } = await extractProduct(image);
      assert.equal(status, 200);
      assert.equal(extraction.displayedTotalPrice, 25920);
      assert.equal(fetch.mock.callCount(), 2);
    });
  }
});

test('비일시 오류나 시간 예산 밖 Retry-After에는 재호출하지 않는다', async (context) => {
  for (const [httpStatus, headers, retryable] of [[401, {}, false], [429, { 'Retry-After': '60' }, true]]) {
    await context.test(`HTTP ${httpStatus}`, async (subtest) => {
      const fetch = mockProvider(subtest, async () => new Response(null, { status: httpStatus, headers }));
      assert.deepEqual(await extractProduct(image), { status: 502, code: 'GEMINI_UNAVAILABLE', retryable });
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('일시 오류가 계속되면 두 번째 호출 뒤 공급자 오류를 반환한다', async (context) => {
  const fetch = mockProvider(context, async () => new Response(null, { status: 503 }));
  assert.deepEqual(await extractProduct(image), { status: 502, code: 'GEMINI_UNAVAILABLE', retryable: true });
  assert.equal(fetch.mock.callCount(), 2);
});

test('초기 호출과 재시도가 3.5초 제한을 공유하고 시간 초과는 504를 반환한다', async (context) => {
  let firstSignal;
  const fetch = mockProvider(context, async (_url, { signal }) => {
    if (!firstSignal) {
      firstSignal = signal;
      return new Response(null, { status: 503 });
    }
    assert.equal(signal, firstSignal);
    await sleep(10_000, undefined, { signal });
    return modelResult({ ...product, displayedTotalPrice: 25920 });
  });
  assert.deepEqual(await extractProduct(image), { status: 504, code: 'GEMINI_TIMEOUT', retryable: true });
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(firstSignal.reason.name, 'TimeoutError');
});
