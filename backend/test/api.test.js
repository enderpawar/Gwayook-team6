import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.js';

const app = createApp();
let baseUrl;
const paperSpec = { compatibilityKey: '같은 폭의 3겹 롤휴지', unit: 'm', amountPerUnit: 30 };
const example = {
  shortName: '3겹 롤휴지',
  fullTitle: '3겹 롤휴지 30롤',
  bulkTotalQty: 30,
  unitName: '롤',
  allocationStep: 1,
  uniformUnits: true,
  payment: {
    productAmount: 17701, shippingFee: 0, discountAmount: 0,
    includesShipping: false, includesDiscount: false, isEstimate: false,
  },
  comparisonSpec: paperSpec,
  comparisonBaseline: {
    quantity: 6, unitName: '롤', price: 7800, spec: paperSpec,
    source: { kind: 'USER_INPUT' },
  },
};

before(async () => {
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));

function analyze(input) {
  return fetch(`${baseUrl}/api/analyses`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

async function analyzed(product, options) {
  const response = await analyze({ product, ...options });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

test('2~4명 정산은 수량과 금액 합계를 보존하고 1원 동률이면 방장을 우선한다', async () => {
  const cases = [
    [2, [[15, 8851], [15, 8850]]],
    [3, [[10, 5901], [10, 5900], [10, 5900]]],
    [4, [[9, 5311], [7, 4130], [7, 4130], [7, 4130]]],
  ];
  for (const [people, expected] of cases) {
    const result = await analyzed(example, { people, location: '정문 편의점' });
    assert.deepEqual(result.settlements.map(({ quantity, amount }) => [quantity, amount]), expected);
    assert.equal(result.settlements.reduce((sum, row) => sum + row.quantity, 0), 30);
    assert.equal(result.settlements.reduce((sum, row) => sum + row.amount, 0), 17701);
    assert.equal(result.comparison.status, 'READY');
    assert.deepEqual(result.settlements.map(({ instantSavings }) => instantSavings),
      expected.map(([quantity, amount]) => quantity * 1300 - amount));
    assert.ok(result.settlements.every((row) => !Object.hasOwn(row, 'annualSavings')));
    const [memberQty, memberAmount] = expected[1];
    if (people === 4) {
      assert.match(result.recruitment.body, /방장: 9롤 · 5,311원/);
      assert.match(result.recruitment.body, new RegExp(`공구원 1명당 ${memberQty}롤 · ${memberAmount.toLocaleString('ko-KR')}원`));
    }
    assert.match(result.recruitment.body, /수령 장소: 정문 편의점/);
  }
});

test('잔여가 큰 공구원이 방장보다 우선하고 공구원 동률은 참여 순서로 깨진다', async () => {
  const product = {
    ...example, bulkTotalQty: 5, fullTitle: '3겹 롤휴지 5롤', comparisonBaseline: undefined,
    payment: { ...example.payment, productAmount: 3, isEstimate: undefined },
  };
  const result = await analyzed(product, { people: 4, location: '  ' });
  assert.deepEqual(result.settlements.map(({ quantity, amount }) => [quantity, amount]),
    [[2, 1], [1, 1], [1, 1], [1, 0]]);
  assert.equal(result.location, null);
  assert.equal(result.deadline, null);
  assert.match(result.recruitment.body, /모집: 3자리/);
  assert.match(result.recruitment.body, /방장: 2롤 · 예상 1원/);
  assert.match(result.recruitment.body, /공구원 1: 1롤 · 예상 1원/);
  assert.match(result.recruitment.body, /공구원 3: 1롤 · 예상 0원/);
  assert.match(result.recruitment.body, /수령 장소: 미정\n신청 마감: 미정\n신청 방법: 댓글 또는 쪽지/);
});

test('배송과 할인은 포함 여부를 각각 반영하고 같은 결제 총액으로 단가와 모집 금액을 계산한다', async () => {
  for (const includesShipping of [false, true]) {
    for (const includesDiscount of [false, true]) {
      const payment = {
        productAmount: 10000 + (includesShipping ? 3000 : 0) - (includesDiscount ? 1500 : 0),
        shippingFee: 3000, discountAmount: 1500, includesShipping, includesDiscount, isEstimate: false,
      };
      const result = await analyzed({ ...example, payment }, {
        people: 2, location: '기숙사 로비', deadline: '금요일 오후 8시', applicationMethod: '쪽지로 신청',
      });
      assert.equal(result.product.payment.totalAmount, 11500);
      assert.deepEqual(result.settlements.map(({ amount }) => amount), [5750, 5750]);
      assert.ok(Math.abs(result.comparison.bulkUnitPrice - 11500 / 900) < 1e-10);
      assert.match(result.recruitment.body, /공구원 1명당 15롤 · 5,750원/);
      assert.match(result.recruitment.body, /신청 마감: 금요일 오후 8시\n신청 방법: 쪽지로 신청/);
    }
  }
});

test('배분 불가 수량·혼합 단위·범위 밖 인원·미확정 결제 내역을 구분해 거절한다', async () => {
  const cases = [
    [{ bulkTotalQty: 6, allocationStep: 2 }, 4, 'product.bulkTotalQty', 'INSUFFICIENT_ALLOCATION_UNITS'],
    [{ allocationStep: 4 }, 4, 'product.allocationStep'],
    [{ uniformUnits: false }, 4, 'product.uniformUnits'],
    [{}, 1, 'people'],
    [{}, 5, 'people'],
    [{ payment: { ...example.payment, shippingFee: null } }, 4, 'product.payment.shippingFee'],
    [{ payment: { ...example.payment, includesDiscount: undefined } }, 4, 'product.payment.includesDiscount'],
  ];
  for (const [patch, people, field, reason] of cases) {
    const response = await analyze({ product: { ...example, ...patch }, people });
    assert.equal(response.status, 422);
    const error = await response.json();
    assert.equal(error.code, 'INVALID_ANALYSIS_INPUT');
    assert.deepEqual(error.fields, [field]);
    assert.equal(error.reason, reason);
  }
});

test('기준가·출처·길이·호환 규격이 확인되지 않으면 비교만 보류하고 모집글에 절감 수치를 넣지 않는다', async () => {
  const cases = [
    [{ ...example.comparisonBaseline, price: 0 }, 'MISSING_BASELINE_PRICE'],
    [{ ...example.comparisonBaseline, source: undefined }, 'UNCONFIRMED_SOURCE'],
    [{ ...example.comparisonBaseline, spec: { ...paperSpec, unit: '롤' } }, 'UNCONFIRMED_SPEC'],
    [{ ...example.comparisonBaseline, spec: { ...paperSpec, compatibilityKey: '폭이 다른 제품' } }, 'INCOMPATIBLE_SPEC'],
  ];
  for (const [comparisonBaseline, reason] of cases) {
    const result = await analyzed({ ...example, comparisonBaseline }, { people: 4 });
    assert.deepEqual(result.comparison, { status: 'PENDING', reason });
    assert.equal(result.settlements[0].amount, 5311);
    assert.ok(result.settlements.every((row) => !Object.hasOwn(row, 'instantSavings')));
    assert.doesNotMatch(result.recruitment.body, /소용량|%/);
  }
});

test('확인된 30m·33m 롤은 m 단가로 비교하고 사용자 확인일과 링크를 보존한다', async () => {
  const source = {
    kind: 'USER_INPUT', checkedOn: '2026-11-20',
    reference: { kind: 'LINK', value: 'https://example.test/rolls' },
  };
  const product = {
    ...example,
    payment: { ...example.payment, productAmount: 18000 },
    comparisonBaseline: {
      ...example.comparisonBaseline, spec: { ...paperSpec, amountPerUnit: 33 }, price: 9900, source,
    },
  };
  const result = await analyzed(product, { people: 4 });
  assert.deepEqual(result.comparison, {
    status: 'READY', source, displayUnit: 'm', displayUnitQuantity: 1,
    bulkUnitPrice: 20, smallUnitPrice: 50, discountPercent: 60,
  });
  assert.deepEqual(result.settlements.map(({ instantSavings }) => instantSavings), [8100, 6300, 6300, 6300]);
});

test('시연 프리셋은 그대로 분석되지만 500ml 24병에 2L 비교가를 연결하지 않는다', async () => {
  const response = await fetch(`${baseUrl}/api/presets`);
  assert.equal(response.status, 200);
  const { presets } = await response.json();
  assert.deepEqual(presets.map(({ id }) => id), ['toilet-paper', 'bottled-water', 'fabric-softener']);
  for (const { id, demo, product } of presets) {
    assert.equal(demo, true);
    const result = await analyzed(product, { people: 3 });
    assert.equal(result.comparison.status, 'READY');
    assert.equal(result.comparison.source.kind, 'SAMPLE');
    assert.equal(result.comparison.source.presetId, id);
    assert.equal(result.comparison.source.checkedOn, undefined);
    assert.match(result.recruitment.body, /예상/);
    assert.doesNotMatch(result.recruitment.body, /소용량|%/);
    if (id === 'fabric-softener') {
      assert.deepEqual(result.settlements.map(({ quantity }) => quantity), [1400, 1300, 1300]);
      assert.equal(result.comparison.displayUnitQuantity, 100);
    }
  }
  const { product } = presets[1];
  const water = {
    ...product, fullTitle: '생수 500ml × 24병',
    comparisonSpec: { ...product.comparisonSpec, unit: 'ml', amountPerUnit: 500 },
  };
  const withoutBaseline = await analyzed({ ...water, comparisonBaseline: undefined }, { people: 3 });
  assert.deepEqual(withoutBaseline.comparison, { status: 'PENDING', reason: 'MISSING_BASELINE_PRICE' });
  const staleSample = await analyzed(water, { people: 3 });
  assert.deepEqual(staleSample.comparison, { status: 'PENDING', reason: 'SAMPLE_MISMATCH' });
  assert.deepEqual(staleSample.settlements.map(({ quantity }) => quantity), [8, 8, 8]);
});

test('사용자가 확인한 500ml와 2L는 ml로 환산하고 개인별 음수 절감액과 선택한 연간 횟수를 유지한다', async () => {
  const compatibilityKey = '같은 종류의 생수';
  const source = { kind: 'USER_INPUT', reference: { kind: 'SCREENSHOT', value: 'capture-1' } };
  const product = {
    shortName: '생수', fullTitle: '생수 500ml × 24병', bulkTotalQty: 24, unitName: '병',
    uniformUnits: true, allocationStep: 1, annualPurchaseCount: 5,
    payment: { ...example.payment, productAmount: 12000 },
    comparisonSpec: { compatibilityKey, unit: 'ml', amountPerUnit: 500 },
    comparisonBaseline: {
      quantity: 6, unitName: '병', price: 6000, spec: { compatibilityKey, unit: 'L', amountPerUnit: 2 }, source,
    },
  };
  const result = await analyzed(product, { people: 4 });
  assert.deepEqual(result.comparison, {
    status: 'READY', source, displayUnit: 'ml', displayUnitQuantity: 100,
    bulkUnitPrice: 100, smallUnitPrice: 50, discountPercent: -100,
  });
  assert.deepEqual(result.settlements.map(({ quantity, instantSavings, annualSavings }) => [quantity, instantSavings, annualSavings]),
    Array(4).fill([6, -1500, -7500]));
  assert.match(result.recruitment.body, /소용량 대비 단가가 100% 높아요/);
});
