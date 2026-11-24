import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.js';

const app = createApp();
const httpFetch = globalThis.fetch;
let baseUrl;
const example = {
  shortName: '3겹 롤휴지', fullTitle: '3겹 롤휴지 30롤', bulkTotalQty: 30, bulkTotalPrice: 17701,
  unitName: '롤', smallPackQty: 6, smallPackPrice: 7800,
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));

function analyze(input) {
  return httpFetch(`${baseUrl}/api/analyses`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

function extract() {
  const body = new FormData();
  body.set('image', new Blob([png], { type: 'image/png' }), 'capture.png');
  body.set('people', '4');
  return httpFetch(`${baseUrl}/api/products/extract`, { method: 'POST', body });
}

function respondWithGeminiProduct(context, product) {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only';
  context.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
  context.mock.method(globalThis, 'fetch', async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(product) }] } }],
  }));
}

test('2~4명 정산은 수량과 1원 잔액을 보존하고 공구원 몫을 모집글에 표시한다', async () => {
  const cases = [
    [2, [[15, 8851], [15, 8850]]],
    [3, [[10, 5901], [10, 5900], [10, 5900]]],
    [4, [[9, 4426], [7, 4425], [7, 4425], [7, 4425]]],
  ];
  for (const [people, expected] of cases) {
    const response = await analyze({ product: example, people, location: '정문 편의점' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.settlements.map(({ quantity, amount }) => [quantity, amount]), expected);
    const [[organizerQty, organizerAmount], [memberQty, memberAmount]] = expected;
    assert.equal(result.comparison.instantSavings, organizerQty * 1300 - organizerAmount);
    assert.equal(result.comparison.annualSavings, (organizerQty * 1300 - organizerAmount) * 12);
    assert.match(result.recruitment.body, new RegExp(`공구원 1명당 ${memberQty}롤 · ${memberAmount.toLocaleString('ko-KR')}원`));
    assert.match(result.recruitment.body, /수령 장소: 정문 편의점/);
  }
});

test('부피는 100ml당 비교하되 1ml 단위로 정산하고 비싼 상품을 할인이라고 표시하지 않는다', async () => {
  const product = { ...example, bulkTotalQty: 4000, bulkTotalPrice: 5000, smallPackQty: 1000, smallPackPrice: 1000, unitName: 'ml' };
  const response = await analyze({ product, people: 3 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.settlements.map(({ quantity }) => quantity), [1334, 1333, 1333]);
  assert.equal(result.comparison.displayUnitQuantity, 100);
  assert.equal(result.comparison.bulkUnitPrice, 125);
  assert.equal(result.comparison.smallUnitPrice, 100);
  assert.equal(result.comparison.discountPercent, -25);
  assert.match(result.recruitment.body, /소용량 대비 단가가 25% 높아요/);
  assert.match(result.recruitment.body, /수령 장소: 행복기숙사 1동 로비/);
});

test('공구원에게 나눌 수 없는 수량과 0인 비교 분모를 거절한다', async () => {
  const response = await analyze({ product: { ...example, bulkTotalQty: 2, smallPackQty: 0 }, people: 4 });
  assert.equal(response.status, 422);
  const error = await response.json();
  assert.equal(error.code, 'INVALID_ANALYSIS_INPUT');
  assert.deepEqual(new Set(error.fields), new Set(['bulkTotalQty', 'smallPackQty']));
});

test('확인할 수 없는 비교가는 부분 결과를 보존하고 수동 보정으로 분석을 완료한다', async (context) => {
  const { smallPackQty, smallPackPrice, ...readable } = example;
  respondWithGeminiProduct(context, { ...readable, smallPackQty });
  const extracted = await extract();
  assert.equal(extracted.status, 422);
  const { code, fields, product, comparisonSource } = await extracted.json();
  assert.equal(code, 'MANUAL_CORRECTION_REQUIRED');
  assert.deepEqual(fields, ['smallPackPrice']);
  assert.equal(product.bulkTotalPrice, 17701);
  assert.equal(product.smallPackPrice, undefined);
  assert.equal(comparisonSource, null);
  const response = await analyze({ product: { ...product, smallPackPrice }, people: 4 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settlements[0].amount, 4426);
});

test('일치하는 프리셋 비교가 없으면 비슷해 보여도 단위가 다른 비교값을 연결하지 않는다', async (context) => {
  const { smallPackQty, smallPackPrice, ...readable } = example;
  respondWithGeminiProduct(context, { ...readable, comparisonPresetId: 'fabric-softener' });
  const response = await extract();
  assert.equal(response.status, 422);
  assert.deepEqual((await response.json()).fields, ['smallPackQty', 'smallPackPrice']);
});
