import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  confirmSettlement, createSettlementCandidate, evaluateSettlement, formatKakaoSettlement, resolveAllocation,
} from '../src/p1/settlement.js';
import { presets } from '../src/presets.js';

const orderAt = '2026-05-10T18:00:00+09:00';
const confirmedAt = '2026-05-10T18:30:00+09:00';
const pickup = { at: '2026-05-11T18:00:00+09:00', publicHub: '도서관 정문' };
const itemKey = 'paper:30m:three-ply';
const spec = { compatibilityKey: '같은 폭의 3겹 롤휴지', unit: 'm', amountPerUnit: 30 };
const baseline = { price: 7800, quantity: 6, unitName: '롤', spec, source: { kind: 'USER_INPUT' } };
const product = {
  shortName: '3겹 롤휴지', fullTitle: '3겹 롤휴지 30롤', bulkTotalQty: 30, unitName: '롤',
  allocationStep: 1, uniformUnits: true, comparisonSpec: spec, comparisonBaseline: baseline,
  payment: { productAmount: 17701, shippingFee: 1000, discountAmount: 2000,
    includesShipping: true, includesDiscount: true, isEstimate: false },
};
const host = { userId: 'host-uuid', alias: '방울' };
const approvedMembers = [
  { userId: 'first-uuid', alias: '하나', approvalSeq: 3 },
  { userId: 'second-uuid', alias: '둘', approvalSeq: 7 },
  { userId: 'third-uuid', alias: '셋', approvalSeq: 12 },
];
const expected = { totalAmount: 17701, quantity: 30, unitName: '롤', allocationStep: 1, itemKey, pickup };
const event = (id, type, userId, fields = {}) => ({ id, type, versionNo: 1, userId, ...fields });
const confirm = (candidate) => confirmSettlement({ candidate, confirmedAt,
  confirmedUserIds: candidate.requiredConfirmationUserIds });
const create = (fields = {}) => createSettlementCandidate({
  groupBuyId: 'paper-group', versionNo: 1, itemKey, product, orderAt, headcount: 4,
  host, approvedMembers, expected, pickup, ...fields,
});
const rows = ({ lines }) => lines.map(({ quantity, amount }) => [quantity, amount]);
const cashFor = ({ lines }) => lines.slice(1).map(({ userId, amount }) => event(`paid:${userId}`, 'TRANSFER_CONFIRMED', userId, { amount }));
const receiptsFor = ({ lines, versionNo }) => lines.map(({ userId, quantity, unitName }) =>
  event(`received:${userId}`, 'RECEIVED', userId, { versionNo, quantity, unitName }));
const evaluate = (snapshot, fields = {}) => evaluateSettlement({ snapshot, cashEvents: cashFor(snapshot),
  receiptEvents: receiptsFor(snapshot), openActionIds: [], ...fields });

const exactRows = (result) => result.savingRecords.map(({ actualQuantity, actualNetCost, numerator, denominator }) =>
  [actualQuantity, actualNetCost, numerator, denominator]);

test('실제 주문과 명단 차이를 보인 뒤 해당 후보의 재확인을 요구한다', () => {
  const original = structuredClone(product);
  const members = structuredClone(approvedMembers);
  const candidate = create({ product: original, approvedMembers: members, expected: { ...expected, totalAmount: 18000 } });
  original.payment.productAmount = 1;
  original.comparisonBaseline.spec.amountPerUnit = 99;
  members[0].alias = '변경';
  assert.equal(candidate.priceDifference, -299);
  assert.deepEqual(candidate.changes, { totalAmount: { from: 18000, to: 17701 } });
  assert.deepEqual(candidate.requiredConfirmationUserIds, approvedMembers.map(({ userId }) => userId));
  assert.throws(() => confirmSettlement({ candidate, confirmedAt, confirmedUserIds: [members[0].userId] }),
    { code: 'RECONFIRMATION_REQUIRED' });
  assert.equal(candidate.lines[1].alias, '하나');
  assert.equal(candidate.comparison.baseline.spec.amountPerUnit, 30);
  assert.throws(() => { candidate.lines[0].amount = 1; }, TypeError);
  const snapshot = confirm(JSON.parse(JSON.stringify(candidate)));
  assert.equal(candidate.confirmedAt, null);
  assert.equal(snapshot.confirmedAt, '2026-05-10T09:30:00.000Z');
  assert.deepEqual(snapshot.lines.map(({ lineNo, userId, approvalSeq }) => [lineNo, userId, approvalSeq]),
    [[0, host.userId, null], ...approvedMembers.map(({ userId, approvalSeq }, i) => [i + 1, userId, approvalSeq])]);
  assert.deepEqual(rows(snapshot), [[9, 5311], [7, 4130], [7, 4130], [7, 4130]]);
  assert.throws(() => create({ approvedMembers: members.toReversed() }), { field: 'approvedMembers.approvalSeq' });
  assert.throws(() => create({ approvedMembers: members.slice(0, 2) }), { field: 'headcount' });
  assert.throws(() => create({ product: { ...product, payment: { ...product.payment, isEstimate: true } } }),
    { code: 'ACTUAL_PRICE_REQUIRED' });
});

test('판매처 부분 환불은 새 버전에서 한 번만 공제하고 정산과 저금통을 같은 키에서 교체한다', () => {
  const first = confirm(create());
  const original = JSON.stringify(first);
  const firstResult = evaluate(first);
  assert.equal(firstResult.canComplete, true);
  assert.deepEqual(exactRows(firstResult), [[9, 5311, '6389', '1'], ...Array(3).fill([7, 4130, '4970', '1'])]);

  const credit = event('merchant-credit', 'MERCHANT_REFUND_CONFIRMED', host.userId, { amount: 1000 });
  const unsettled = evaluate(first, { cashEvents: [...cashFor(first), credit] });
  assert.equal(unsettled.merchantNetCost, 16701);
  assert.equal(unsettled.balances[0].actualNetCost, 4311);
  assert.equal(unsettled.canComplete, false);
  assert.equal(unsettled.savingRecords, null);
  const correction = create({ versionNo: 2, previous: first, merchantRefunds: unsettled.merchantRefunds });
  assert.equal(correction.priceDifference, -1000);
  assert.equal(correction.orderTotal, 17701);
  assert.equal(correction.finalTotal, 16701);
  assert.throws(() => confirmSettlement({ candidate: correction, confirmedAt }), { code: 'RECONFIRMATION_REQUIRED' });
  const revised = confirm(correction);
  assert.deepEqual(rows(revised), [[9, 5010], [7, 3897], [7, 3897], [7, 3897]]);
  assert.equal(revised.lines.reduce((sum, { amount }) => sum + amount, 0), revised.finalTotal);
  assert.equal(revised.lines.reduce((sum, { quantity }) => sum + quantity, 0), revised.terms.quantity);
  assert.equal(JSON.stringify(first), original);

  const history = { priorSnapshots: [first], receiptEvents: receiptsFor(first) };
  assert.throws(() => evaluate(revised), { code: 'MISSING_PRIOR_SETTLEMENT' });
  const cashEvents = [...cashFor(first), credit];
  const refundsDue = evaluate(revised, { ...history, cashEvents });
  assert.deepEqual(refundsDue.balances.slice(1).map(({ paymentStatus, due }) => [paymentStatus, due]),
    Array(3).fill(['REFUND_DUE', -233]));
  const refunds = approvedMembers.map(({ userId }) => event(`refund:${userId}`, 'REFUND_CONFIRMED', userId,
    { amount: 233, versionNo: 2 }));
  const complete = evaluate(revised, { ...history, cashEvents: [...cashEvents, ...refunds] });
  assert.equal(complete.canComplete, true);
  assert.deepEqual(exactRows(complete), [[9, 5010, '6690', '1'], ...Array(3).fill([7, 3897, '5203', '1'])]);
  assert.deepEqual(complete.savingRecords.map(({ groupBuyId, userId }) => [groupBuyId, userId]),
    firstResult.savingRecords.map(({ groupBuyId, userId }) => [groupBuyId, userId]));
  assert.ok(complete.savingRecords.every(({ sourceVersionNo }) => sourceVersionNo === 2));
  const unlinked = evaluate(revised, { ...history, cashEvents: [...cashFor(first), { ...credit, id: 'other-credit' }, ...refunds] });
  assert.equal(unlinked.canComplete, false, 'same refund amount from a different event does not match the evidence');
});

test('신고만·부분입금·원기록 반전·추가금은 별도로 표시하고 완료를 막는다', () => {
  const snapshot = confirm(create());
  const [firstPaid, ...othersPaid] = cashFor(snapshot);
  const userId = firstPaid.userId;
  const report = event('report-1', 'TRANSFER_REPORTED', userId, { amount: 4130 });
  const pending = evaluate(snapshot, { cashEvents: [...othersPaid, report] });
  assert.deepEqual([pending.balances[1].paymentStatus, pending.balances[1].reportedAmount, pending.balances[1].netPaid, pending.canComplete],
    ['UNPAID', 4130, 0, false]);
  const part = { ...firstPaid, amount: 2000, relatedEventId: report.id };
  const partial = evaluate(snapshot, { cashEvents: [...othersPaid, report, part] });
  assert.deepEqual([partial.balances[1].paymentStatus, partial.balances[1].due, partial.canComplete], ['PARTIALLY_PAID', 2130, false]);
  const reversed = event('reversal-1', 'REVERSAL', userId, { relatedEventId: part.id });
  const history = [...othersPaid, report, part, reversed];
  assert.equal(evaluate(snapshot, { cashEvents: history }).balances[1].netPaid, 0);
  assert.equal(evaluate(snapshot, { cashEvents: history }).canComplete, false);
  assert.throws(() => evaluate(snapshot, { cashEvents: [...history, { ...reversed, id: 'reversal-2' }] }),
    { code: 'INVALID_EVENT_REVERSAL' });
  assert.throws(() => evaluate(snapshot, { cashEvents: [...history, { ...part, id: 'confirmation-2' }] }),
    { code: 'INVALID_TRANSFER_REPORT_LINK' });
  const replacementCash = [...history, { ...firstPaid, id: 'corrected-payment' }];
  assert.equal(evaluate(snapshot, { cashEvents: replacementCash }).canComplete, true);
  const revised = confirm(create({ versionNo: 2, previous: snapshot,
    product: { ...product, payment: { ...product.payment, productAmount: 18701 } } }));
  const additional = evaluate(revised, { priorSnapshots: [snapshot], cashEvents: replacementCash, receiptEvents: receiptsFor(snapshot) });
  assert.deepEqual([additional.balances[1].paymentStatus, additional.balances[1].due, additional.canComplete], ['ADDITIONAL_DUE', 234, false]);
});

test('제외자의 미환불과 기수령품 및 수령 정정·미해결 조치·취소를 보존한다', () => {
  const first = confirm(create());
  const excluded = approvedMembers[2].userId;
  const candidate = create({ versionNo: 2, previous: first, headcount: 3, approvedMembers: approvedMembers.slice(0, 2) });
  assert.deepEqual(candidate.changes.roster, { from: [host.userId, ...approvedMembers.map(({ userId }) => userId)],
    to: [host.userId, ...approvedMembers.slice(0, 2).map(({ userId }) => userId)] });
  const replacement = confirm(candidate);
  const revisedCash = cashFor(replacement).map((record) => ({ ...record, versionNo: 2 }));
  const oldCash = cashFor(first).find(({ userId }) => userId === excluded);
  const oldReceipt = receiptsFor(first).find(({ userId }) => userId === excluded);
  const receipts = [...receiptsFor(replacement), oldReceipt];
  const history = { priorSnapshots: [first], cashEvents: [...revisedCash, oldCash], receiptEvents: receipts };
  const removed = evaluate(replacement, history).balances.find(({ userId }) => userId === excluded);
  assert.deepEqual([removed.active, removed.targetAmount, removed.netPaid, removed.due, removed.actualQuantity], [false, 0, 4130, -4130, 7]);
  const settledHistory = { ...history, cashEvents: [...history.cashEvents, event('member-refund', 'REFUND_CONFIRMED', excluded, { amount: 4130 })] };
  assert.equal(evaluate(replacement, history).canComplete, false);
  assert.equal(evaluate(replacement, settledHistory).canComplete, false, 'refund alone does not return goods');
  const returned = event('returned', 'RECEIVED', excluded, { quantity: 0, unitName: '롤' });
  assert.equal(evaluate(replacement, { ...history, receiptEvents: [...receipts, returned] }).canComplete, false,
    'returning goods does not clear the excluded member refund');
  settledHistory.receiptEvents = [...receipts, returned];
  assert.equal(evaluate(replacement, settledHistory).canComplete, true);
  assert.ok(!evaluate(replacement, settledHistory).savingRecords.some(({ userId }) => userId === excluded));
  assert.equal(evaluate(replacement, { ...settledHistory, openActionIds: ['no-show'] }).canComplete, false);
  const cancelled = evaluate(replacement, { ...settledHistory, cancelled: true });
  assert.equal(cancelled.savingRecords, null);
  assert.equal(cancelled.balances[1].due, -replacement.lines[1].amount);

  const [hostReceipt, ...otherReceipts] = receiptsFor(first);
  assert.throws(() => evaluate(first, { receiptEvents: [...otherReceipts, { ...hostReceipt, unitName: '병' }] }),
    { code: 'INVALID_LEDGER_EVENT' });
  const incorrect = { ...hostReceipt, quantity: 8 };
  assert.equal(evaluate(first, { receiptEvents: [...otherReceipts, incorrect] }).balances[0].receiptStatus, 'QUANTITY_MISMATCH');
  const undo = event('reverse-receipt', 'REVERSED', host.userId, { relatedEventId: hostReceipt.id });
  assert.equal(evaluate(first, { receiptEvents: [...otherReceipts, incorrect, undo] }).canComplete, false);
  assert.equal(evaluate(first, { receiptEvents: [...otherReceipts, incorrect, undo, { ...hostReceipt, id: 'correct-receipt' }] }).canComplete, true);
});

test('등록된 수령량이 같아도 정정된 다른 규격의 수령으로 간주하지 않는다', () => {
  const first = confirm(create());
  const second = confirm(create({ versionNo: 2, previous: first, itemKey: 'paper:33m:three-ply' }));
  const olderReceipts = receiptsFor(first);
  const newerReceipts = receiptsFor(second).map((record) => ({ ...record, id: `v2:${record.id}` }));
  const history = { priorSnapshots: [first], cashEvents: cashFor(first), receiptEvents: [...olderReceipts, ...newerReceipts] };
  const pending = evaluate(second, history);
  assert.equal(pending.balances[0].receiptStatus, 'LEGACY_ITEM_HELD');
  assert.equal(pending.canComplete, false);
  const returns = olderReceipts.map((record) => ({ ...record, id: `return:${record.id}`, quantity: 0 }));
  assert.equal(evaluate(second, { ...history, receiptEvents: [...history.receiptEvents, ...returns] }).canComplete, true);
});

test('비교는 정확한 분수 원화(음수·큰 곱·환산)를 반환하며 배제 출처는 행을 만들지 않는다', () => {
  const smallSpec = { ...spec, unit: 'cm', amountPerUnit: 3300 };
  const small = { ...baseline, price: 1001, spec: smallSpec };
  const lengthComparison = evaluate(confirm(create({ product: { ...product, comparisonBaseline: small } })));
  assert.deepEqual(exactRows(lengthComparison).slice(0, 2), [[9, 5311, '-3946', '1'], [7, 4130, '-9205', '3']]);
  const large = evaluate(confirm(create({ product: { ...product,
    comparisonBaseline: { ...baseline, price: Number.MAX_SAFE_INTEGER, quantity: 7 } } })));
  assert.deepEqual(exactRows(large)[0], [9, 5311, String(9n * 9007199254740991n - 7n * 5311n), '7']);
  const sample = presets.find(({ product: entry }) => entry.unitName === '롤').product;
  const sampleSnapshot = confirm(create({ product: { ...sample, payment: product.payment } }));
  assert.equal(sampleSnapshot.comparison.status, 'READY');
  assert.deepEqual(evaluate(sampleSnapshot).savingRecords, []);
  const pending = evaluate(confirm(create({ product: { ...product, comparisonBaseline: undefined } })));
  assert.equal(pending.canComplete, true);
  assert.deepEqual(pending.savingRecords, []);
});

test('공유 문구는 해당 확정본 공개 필드에만 의존하고 별칭의 줄바꿈을 거절한다', () => {
  const candidate = create({ host: { ...host, account: '111-222', phone: '010-1234-5678' },
    pickup: { ...pickup, address: '비공개 주소' } });
  assert.throws(() => formatKakaoSettlement(candidate), { code: 'SETTLEMENT_NOT_CONFIRMED' });
  const snapshot = confirm(candidate);
  const message = formatKakaoSettlement(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(message.split('\n').slice(0, 5), ['공구 정산 · 총 17,701원', '방울: 9롤 · 5,311원', '하나: 7롤 · 4,130원', '둘: 7롤 · 4,130원', '셋: 7롤 · 4,130원']);
  assert.match(message, /수령 일정: 2026년 5월 11일.*\(KST\)\n공개 수령 거점: 도서관 정문$/u);
  assert.doesNotMatch(message, /uuid|111-222|010-1234-5678|비공개 주소|입금|환불|30롤/u);
  assert.match(formatKakaoSettlement(confirm(create({ pickup: null }))), /수령 일정: 미정\n공개 수령 거점: 미정$/u);
  assert.throws(() => create({ host: { ...host, alias: '방울\n가짜 행' } }), { field: 'members.alias' });
});

test('직접 소분은 서버 정책과 세 가지 확인이 함께 있어야 하며 P0 시연은 밀봉으로 돌아간다', () => {
  const sample = presets.find(({ product: entry }) => entry.unitName === 'ml').product;
  const directProduct = { ...sample, payment: product.payment };
  const key = 'confirmed:liquid:4000';
  const packaging = { mode: 'DIRECT', packCount: 1, sealedUnitName: '병',
    directChecks: { label: true, measurement: true, container: true, checkedBy: host.userId, checkedAt: orderAt } };
  const approvedPolicy = { id: 'approved-policy', status: 'APPROVED', itemKey: key, unitName: 'ml', allocationStep: 100 };
  const resolve = (input = {}) => resolveAllocation({ itemKey: key, product: directProduct, packaging, ...input });
  assert.equal(resolveAllocation({ itemKey, product }).mode, 'SEALED_PACKAGE');
  assert.deepEqual(resolve(), { mode: 'SEALED_PACKAGE', packCount: 1, sealedUnitName: '병', allocationStep: 1,
    quantity: 1, unitName: '병', fallbackReason: 'DIRECT_POLICY_NOT_APPROVED' });
  assert.equal(resolve({ approvedPolicy: { ...approvedPolicy, itemKey: 'different-product' } }).mode, 'SEALED_PACKAGE');
  assert.equal(resolve({ approvedPolicy, packaging: { ...packaging, directChecks: { ...packaging.directChecks, container: false } } }).fallbackReason,
    'DIRECT_CHECKS_MISSING');
  assert.throws(() => create({ itemKey: key, product: directProduct, packaging }), { code: 'INSUFFICIENT_ALLOCATION' });
  const allowed = confirm(create({ itemKey: key, product: directProduct, packaging, approvedPolicy }));
  assert.equal(allowed.allocation.directPolicyId, approvedPolicy.id);
  assert.equal(allowed.allocation.directChecks.measurement, true);
  assert.deepEqual(allowed.lines.map(({ unitName, quantity }) => [unitName, quantity]), Array(4).fill(['ml', 1000]));
});
