import { analyze, validateProduct } from '../analysis.js';

const sealedUnits = new Set(['롤', '병', '개']);
const directUnits = new Set(['ml', 'g']);
const comparisonFactors = new Map([['ml', 1], ['L', 1000], ['m', 1000], ['cm', 10], ['g', 1], ['kg', 1000], ['개', 1]]);
// Called only after P0 validates compatibility/precision. Read the original unit to avoid
// round-tripping canonical metre decimals near the safe-integer limit.
const exactComparisonUnit = ({ unit, amountPerUnit }) => Math.round(amountPerUnit * comparisonFactors.get(unit));
const integer = new Intl.NumberFormat('ko-KR');
const pickupDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short',
});

/** Bad domain input is a RangeError with stable `code` and offending `field`. A valid but incomplete ledger never throws. */
function requireInput(condition, field, code = 'INVALID_SETTLEMENT_INPUT') {
  if (!condition) throw Object.assign(new RangeError(`Invalid settlement input: ${field}`), { code, field });
}

const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const positive = (value) => nonnegative(value) && value > 0;
const isId = (value) => typeof value === 'string' && value.length > 0 && value.trim() === value;

function text(value, field, maxLength) {
  requireInput(typeof value === 'string' && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
    && value.trim().length > 0 && value.trim().length <= maxLength, field);
  return value.trim();
}

function timestamp(value, field) {
  requireInput(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && new Date(`${value.slice(0, 10)}T00:00:00Z`).toJSON()?.slice(0, 10) === value.slice(0, 10)
    && Number.isFinite(Date.parse(value)), field);
  return new Date(value).toISOString();
}

function pickupFields(pickup) {
  return {
    at: pickup?.at == null ? null : timestamp(pickup.at, 'pickup.at'),
    publicHub: pickup?.publicHub == null ? null : text(pickup.publicHub, 'pickup.publicHub', 100),
  };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * @typedef {{mode?: 'SEALED_PACKAGE'|'DIRECT', packCount?: number, sealedUnitName?: string,
 * directChecks?: {label: boolean, measurement: boolean, container: boolean, checkedBy: string, checkedAt: string}}} Packaging
 * @typedef {{id: string, status: 'APPROVED', itemKey: string, unitName: 'ml'|'g', allocationStep: number}} ApprovedDirectPolicy
 * @typedef {{totalAmount: number, quantity: number, unitName: string, allocationStep: number,
 * itemKey: string, pickup?: {at?: string, publicHub?: string}}} OfferTerms
 * @typedef {{userId: string, alias: string}} Person
 */

/**
 * Returns effective allocation fields plus audit evidence. `approvedPolicy` comes ONLY from the server's
 * approved item policy lookup (none by default), never a request or a P0 preset. `itemKey` identifies
 * the confirmed SKU/option/spec, changing when the physical item or its contents change. For DIRECT,
 * `packCount` and `sealedUnitName` describe the sealed alternative; failed checks fall back to it.
 * Sealed counts/units may be inferred only from an already sealed product. The caller must then check
 * the effective allocation against headcount (a one-container fallback cannot be split among 2–4).
 * @param {{itemKey: string, product: object, packaging?: Packaging, approvedPolicy?: ApprovedDirectPolicy}} input
 */
export function resolveAllocation({ itemKey, product, packaging = {}, approvedPolicy }) {
  requireInput(isId(itemKey), 'itemKey');
  const mode = packaging.mode ?? 'SEALED_PACKAGE';
  requireInput(mode === 'SEALED_PACKAGE' || mode === 'DIRECT', 'packaging.mode');
  const productIsSealed = sealedUnits.has(product?.unitName);
  const packCount = packaging.packCount ?? (productIsSealed ? product.bulkTotalQty : undefined);
  const sealedUnitName = packaging.sealedUnitName ?? (productIsSealed ? product.unitName : undefined);
  requireInput(positive(packCount) && sealedUnits.has(sealedUnitName), 'packaging', 'INVALID_SEALED_PACKAGING');
  let fallbackReason = null;
  if (mode === 'DIRECT') {
    const checks = packaging.directChecks;
    if (packCount !== 1 || !directUnits.has(product?.unitName)) fallbackReason = 'NOT_SINGLE_BULK_CONTAINER';
    else if (approvedPolicy?.status !== 'APPROVED' || !isId(approvedPolicy.id) || approvedPolicy.itemKey !== itemKey
      || approvedPolicy.unitName !== product.unitName || approvedPolicy.allocationStep !== product.allocationStep) {
      fallbackReason = 'DIRECT_POLICY_NOT_APPROVED';
    } else if (checks?.label !== true || checks.measurement !== true || checks.container !== true
      || !isId(checks.checkedBy) || checks.checkedAt == null) {
      fallbackReason = 'DIRECT_CHECKS_MISSING';
    } else {
      requireInput(positive(product.bulkTotalQty) && positive(product.allocationStep)
        && product.bulkTotalQty % product.allocationStep === 0, 'product.allocationStep');
      return {
        mode, packCount, sealedUnitName, quantity: product.bulkTotalQty, unitName: product.unitName,
        allocationStep: product.allocationStep, directPolicyId: approvedPolicy.id,
        directChecks: { label: true, measurement: true, container: true, checkedBy: checks.checkedBy,
          checkedAt: timestamp(checks.checkedAt, 'packaging.directChecks.checkedAt') },
      };
    }
  }
  const matchesSealed = productIsSealed && product.bulkTotalQty === packCount && product.unitName === sealedUnitName;
  requireInput(mode === 'DIRECT' || matchesSealed, 'packaging', 'INVALID_SEALED_PACKAGING');
  return { mode: 'SEALED_PACKAGE', packCount, sealedUnitName, quantity: packCount, unitName: sealedUnitName,
    allocationStep: matchesSealed ? product.allocationStep : 1, ...(fallbackReason && { fallbackReason }) };
}

function member(person, index) {
  requireInput(isId(person?.userId), 'members.userId');
  return { lineNo: index, userId: person.userId, alias: text(person.alias, 'members.alias', 80),
    role: index === 0 ? 'ORGANIZER' : 'MEMBER', approvalSeq: index === 0 ? null : person.approvalSeq };
}

function refundEvidence(refunds) {
  requireInput(Array.isArray(refunds), 'merchantRefunds');
  const seen = new Set();
  let total = 0n;
  const entries = refunds.map(({ id, amount }) => {
    requireInput(isId(id) && !seen.has(id) && positive(amount), 'merchantRefunds');
    seen.add(id);
    total += BigInt(amount);
    return { id, amount };
  });
  return { entries, total };
}

function requireConfirmed(snapshot) {
  requireInput(snapshot?.schemaVersion === 1 && typeof snapshot.confirmedAt === 'string', 'snapshot', 'SETTLEMENT_NOT_CONFIRMED');
}

/**
 * Builds detached, frozen, JSON-safe candidate + lines from actual confirmed purchase input, not a P0
 * response. First version requires `expected` (approved offer); corrections require the previous confirmed
 * snapshot and compare with that version instead. `merchantRefunds` contains the *effective* confirmed
 * merchant event IDs and amounts for this purchase, not refunds to members. Pass the original order
 * prices before those refunds. The route validates owner, actual evidence, policy lookup and roster.
 * @param {{groupBuyId: string, versionNo: number, itemKey: string, product: object, orderAt: string,
 * headcount: number, host: Person, approvedMembers: (Person & {approvalSeq: number})[],
 * expected?: OfferTerms, previous?: object, merchantRefunds?: {id: string, amount: number}[],
 * packaging?: Packaging, approvedPolicy?: ApprovedDirectPolicy, pickup?: {at?: string, publicHub?: string}}} input
 */
export function createSettlementCandidate({ groupBuyId, versionNo, itemKey, product, orderAt, headcount,
  host, approvedMembers, expected, previous, merchantRefunds = [], packaging, approvedPolicy, pickup }) {
  requireInput(isId(groupBuyId) && positive(versionNo), 'version');
  requireInput(product !== null && typeof product === 'object', 'product');
  requireInput(positive(headcount) && headcount >= 2 && headcount <= 4
    && Array.isArray(approvedMembers) && approvedMembers.length === headcount - 1, 'headcount');
  const roster = [member(host, 0), ...approvedMembers.map((person, i) => member(person, i + 1))];
  for (let i = 1; i < roster.length; i++) {
    requireInput(positive(roster[i].approvalSeq) && (i === 1 || roster[i - 1].approvalSeq < roster[i].approvalSeq), 'approvedMembers.approvalSeq');
  }
  requireInput(new Set(roster.map(({ userId }) => userId)).size === headcount, 'members.userId');
  const allocation = resolveAllocation({ itemKey, product, packaging, approvedPolicy });
  const { quantity, unitName, allocationStep } = allocation;
  const rawProduct = { ...product, bulkTotalQty: quantity, unitName, allocationStep };
  if (quantity !== product.bulkTotalQty || unitName !== product.unitName) delete rawProduct.comparisonSpec;
  delete rawProduct.annualPurchaseCount;
  const { product: actual, fields } = validateProduct(rawProduct);
  requireInput(fields.length === 0, fields.join(', '));
  requireInput(!actual.payment.isEstimate, 'product.payment.isEstimate', 'ACTUAL_PRICE_REQUIRED');
  requireInput(quantity / allocationStep >= headcount, 'product.bulkTotalQty', 'INSUFFICIENT_ALLOCATION');
  const orderTotal = actual.payment.totalAmount;
  const refunds = refundEvidence(merchantRefunds);
  requireInput(refunds.total <= BigInt(orderTotal), 'merchantRefunds', 'MERCHANT_REFUND_EXCEEDS_ORDER');
  const finalTotal = orderTotal - Number(refunds.total);
  // The exported P0 entry point owns distribution, integer remainders, and compatibility validation.
  // Only retain validated comparison inputs; its Number display outputs never enter this snapshot.
  const analyzed = analyze({ ...actual, payment: { ...actual.payment, totalAmount: finalTotal } }, rawProduct, { people: headcount });
  const { comparisonSpec, comparisonBaseline } = analyzed.product;
  const comparison = analyzed.comparison.status === 'READY'
    ? { status: 'READY', spec: comparisonSpec, baseline: structuredClone(comparisonBaseline),
      bulkPerUnit: exactComparisonUnit(rawProduct.comparisonSpec),
      baselinePerUnit: exactComparisonUnit(rawProduct.comparisonBaseline.spec) }
    : { status: 'PENDING', reason: analyzed.comparison.reason };
  const terms = { totalAmount: finalTotal, quantity, unitName, allocationStep, itemKey, pickup: pickupFields(pickup) };
  if (previous) {
    requireConfirmed(previous);
    requireInput(previous.groupBuyId === groupBuyId && previous.versionNo < versionNo
      && previous.lines[0].userId === host.userId, 'previous');
    expected = previous.terms;
  } else {
    requireInput(nonnegative(expected?.totalAmount) && positive(expected.quantity) && positive(expected.allocationStep)
      && expected.quantity % expected.allocationStep === 0 && isId(expected.itemKey)
      && (sealedUnits.has(expected.unitName) || directUnits.has(expected.unitName)), 'expected');
  }
  const expectedPickup = pickupFields(expected.pickup);
  const changes = {};
  for (const key of ['totalAmount', 'quantity', 'unitName', 'allocationStep', 'itemKey']) {
    if (expected[key] !== terms[key]) changes[key] = { from: expected[key], to: terms[key] };
  }
  if (expectedPickup.at !== terms.pickup.at || expectedPickup.publicHub !== terms.pickup.publicHub) {
    changes.pickup = { from: expectedPickup, to: terms.pickup };
  }
  const userIds = roster.map(({ userId }) => userId);
  const oldIds = previous?.lines.map(({ userId }) => userId);
  if (oldIds && (oldIds.length !== userIds.length || oldIds.some((id, i) => id !== userIds[i]))) {
    changes.roster = { from: oldIds, to: userIds };
  }
  return freeze({
    schemaVersion: 1, groupBuyId, versionNo, previousVersionNo: previous?.versionNo ?? null,
    confirmedAt: null, orderAt: timestamp(orderAt, 'orderAt'),
    product: actual, allocation, terms, orderTotal, finalTotal, merchantRefunds: refunds.entries, comparison,
    priceDifference: finalTotal - expected.totalAmount, changes,
    requiredConfirmationUserIds: Object.keys(changes).length ? userIds.slice(1) : [],
    lines: roster.map((row, i) => ({ ...row, unitName,
      quantity: analyzed.settlements[i].quantity, amount: analyzed.settlements[i].amount })),
  });
}

/** Confirms a domain-created/DB-rehydrated candidate. Only persisted confirmations of THIS candidate
 * may supply `confirmedUserIds`; the route owns authorisation, current candidate pointer, and first-write metadata. */
export function confirmSettlement({ candidate, confirmedAt, confirmedUserIds = [] }) {
  requireInput(candidate?.schemaVersion === 1 && candidate.confirmedAt === null, 'candidate');
  requireInput(Array.isArray(confirmedUserIds), 'confirmedUserIds');
  const ids = new Set(confirmedUserIds);
  requireInput(ids.size === confirmedUserIds.length && confirmedUserIds.every((id) => candidate.lines.slice(1).some((row) => row.userId === id)), 'confirmedUserIds');
  requireInput(candidate.requiredConfirmationUserIds.every((id) => ids.has(id)), 'confirmedUserIds', 'RECONFIRMATION_REQUIRED');
  return freeze({ ...structuredClone(candidate), confirmedAt: timestamp(confirmedAt, 'confirmedAt') });
}

/**
 * @typedef {{id: string, versionNo: number, userId: string, type: 'TRANSFER_REPORTED'|'TRANSFER_CONFIRMED'|
 * 'REFUND_CONFIRMED'|'MERCHANT_REFUND_CONFIRMED'|'REVERSAL', amount?: number, relatedEventId?: string}} CashEvent
 * @typedef {{id: string, versionNo: number, userId: string, type: 'RECEIVED'|'REVERSED',
 * quantity?: number, unitName?: string, relatedEventId?: string}} ReceiptEvent
 */

// Domain replay order is the DB's append order, not client-supplied occurrence timestamps.
function ledger(events, versions, reversalType, originalTypes, validate) {
  requireInput(Array.isArray(events), reversalType === 'REVERSAL' ? 'cashEvents' : 'receiptEvents');
  const originals = new Map();
  const ids = new Set();
  const reversed = new Set();
  for (const event of events) {
    const { id, type, versionNo, userId, relatedEventId } = event;
    const version = versions.get(versionNo);
    const line = version?.lines.find((row) => row.userId === userId);
    requireInput(isId(id) && !ids.has(id) && line, 'event.id/versionNo/userId', 'INVALID_LEDGER_EVENT');
    ids.add(id);
    if (type === reversalType) {
      const original = originals.get(relatedEventId)?.event;
      requireInput(original && original.type !== 'TRANSFER_REPORTED' && original.userId === userId
        && original.versionNo === versionNo && !reversed.has(relatedEventId), 'event.relatedEventId', 'INVALID_EVENT_REVERSAL');
      reversed.add(relatedEventId);
    } else {
      requireInput(originalTypes.has(type), 'event.type', 'INVALID_LEDGER_EVENT');
      validate(event, version, line, originals);
      originals.set(id, { event, version });
    }
  }
  return [...originals.values()].filter(({ event }) => !reversed.has(event.id));
}

const cashTypes = new Set(['TRANSFER_REPORTED', 'TRANSFER_CONFIRMED', 'REFUND_CONFIRMED', 'MERCHANT_REFUND_CONFIRMED']);
const receiptTypes = new Set(['RECEIVED']);

function money(value) {
  requireInput(value >= -BigInt(Number.MAX_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER), 'ledger.amount', 'LEDGER_AMOUNT_OUT_OF_RANGE');
  return Number(value);
}

function holdingKey(snapshot) {
  return JSON.stringify([snapshot.terms.itemKey, snapshot.terms.unitName, snapshot.allocation.mode]);
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function savings(snapshot, balances) {
  const { status, baseline, baselinePerUnit, bulkPerUnit } = snapshot.comparison;
  if (status !== 'READY' || baseline.source.kind !== 'USER_INPUT') return [];
  const baselineQty = BigInt(baseline.quantity) * BigInt(baselinePerUnit);
  const baselinePrice = BigInt(baseline.price);
  const actualPerUnit = BigInt(bulkPerUnit);
  return balances.filter(({ active }) => active).map(({ userId, actualQuantity, actualNetCost }) => {
    const delta = BigInt(actualQuantity) * actualPerUnit * baselinePrice - BigInt(actualNetCost) * baselineQty;
    const divisor = gcd(delta, baselineQty);
    return { groupBuyId: snapshot.groupBuyId, userId, sourceVersionNo: snapshot.versionNo,
      actualQuantity, actualNetCost, numerator: String(delta / divisor), denominator: String(baselineQty / divisor) };
  });
}

/**
 * Replays one locked aggregate: current confirmed snapshot, all earlier confirmed snapshots referenced by
 * events / excluded people, complete append-ordered cash/receipt streams, and unresolved durable action IDs.
 * Each event has a unique ID within its stream and references an existing (versionNo, userId) line.
 * Amounts are positive safe integer won. Reports don't pay; confirmation optionally links one same-user
 * report once (or no link for direct external evidence). A REVERSAL references an earlier confirmed
 * cash event, not a report/reversal; REVERSED references an earlier receipt. Use the original line for
 * reversals, at most once even if the corrected event has already been added. A RECEIVED event states
 * the latest observed *total* on hand in the referenced item's allocation unit (zero after a confirmed
 * return); it does not increment earlier observations. Append counts to reflect real moves, reverse
 * records only to correct erroneous facts. A single user can still hold a previous item after a correction.
 * Deduplication of commands/real events, confirmation authority, ordering, historical reads, state transitions
 * and freeze/reopen/invalidation of DB records are route/transaction duties, not inferred from event payloads.
 * `savingRecords` is null until completable, otherwise a full replacement set (possibly empty); the DB
 * upserts by groupBuyId/userId and marks missing old rows ineligible in the same completion transaction.
 * @param {{snapshot: object, priorSnapshots?: object[], cashEvents: CashEvent[], receiptEvents: ReceiptEvent[],
 * openActionIds: string[], cancelled?: boolean}} input
 */
export function evaluateSettlement({ snapshot, priorSnapshots = [], cashEvents, receiptEvents, openActionIds, cancelled = false }) {
  requireConfirmed(snapshot);
  requireInput(Array.isArray(priorSnapshots) && Array.isArray(openActionIds) && openActionIds.every(isId)
    && typeof cancelled === 'boolean', 'settlementHistory');
  const hostId = snapshot.lines[0].userId;
  const versions = new Map([[snapshot.versionNo, snapshot]]);
  const people = new Map(snapshot.lines.map((line) => [line.userId, { line, priorLine: null }]));
  for (const prior of [...priorSnapshots].sort((a, b) => b.versionNo - a.versionNo)) {
    requireConfirmed(prior);
    requireInput(prior.groupBuyId === snapshot.groupBuyId && prior.versionNo < snapshot.versionNo
      && !versions.has(prior.versionNo) && prior.lines[0].userId === hostId, 'priorSnapshots');
    versions.set(prior.versionNo, prior);
    for (const line of prior.lines) {
      if (!people.has(line.userId)) people.set(line.userId, { line: null, priorLine: line });
      else people.get(line.userId).priorLine ??= line;
    }
  }
  for (const { previousVersionNo } of versions.values()) {
    requireInput(previousVersionNo === null || versions.has(previousVersionNo), 'priorSnapshots', 'MISSING_PRIOR_SETTLEMENT');
  }

  const linkedReports = new Set();
  const cash = ledger(cashEvents, versions, 'REVERSAL', cashTypes, (event, version, line, originals) => {
    const merchant = event.type === 'MERCHANT_REFUND_CONFIRMED';
    requireInput(positive(event.amount) && merchant === (line.userId === hostId), 'cashEvent.amount/userId', 'INVALID_LEDGER_EVENT');
    if (event.relatedEventId != null) {
      const report = originals.get(event.relatedEventId)?.event;
      requireInput(event.type === 'TRANSFER_CONFIRMED' && report?.type === 'TRANSFER_REPORTED'
        && report.userId === line.userId && !linkedReports.has(report.id), 'cashEvent.relatedEventId', 'INVALID_TRANSFER_REPORT_LINK');
      linkedReports.add(report.id);
    }
  });
  const receipts = ledger(receiptEvents, versions, 'REVERSED', receiptTypes, (event, version, line) => {
    requireInput(nonnegative(event.quantity) && event.unitName === line.unitName && event.relatedEventId == null,
      'receiptEvent.quantity/unitName', 'INVALID_LEDGER_EVENT');
  });
  const merchantCredits = new Map();
  for (const { event } of cash) {
    if (event.type === 'MERCHANT_REFUND_CONFIRMED') {
      merchantCredits.set(event.id, event.amount);
      continue;
    }
    const person = people.get(event.userId);
    const amount = BigInt(event.amount);
    if (event.type === 'TRANSFER_CONFIRMED') person.paid = (person.paid ?? 0n) + amount;
    else if (event.type === 'REFUND_CONFIRMED') person.refunded = (person.refunded ?? 0n) + amount;
    else if (!linkedReports.has(event.id)) person.reported = (person.reported ?? 0n) + amount;
  }
  for (const { event, version } of receipts) {
    const person = people.get(event.userId);
    person.holdings ??= new Map();
    person.holdings.set(holdingKey(version), event.quantity);
  }
  const merchantRefunds = [...merchantCredits].map(([id, amount]) => ({ id, amount }));
  const refundTotal = merchantRefunds.reduce((sum, { amount }) => sum + BigInt(amount), 0n);
  const merchantRefundsApplied = snapshot.merchantRefunds.length === merchantRefunds.length
    && snapshot.merchantRefunds.every(({ id, amount }) => merchantCredits.get(id) === amount);
  const merchantNetCost = BigInt(snapshot.orderTotal) - refundTotal;
  const othersNetPaid = [...people].reduce((sum, [id, { paid = 0n, refunded = 0n }]) => id === hostId ? sum : sum + paid - refunded, 0n);
  const currentItem = holdingKey(snapshot);
  const balances = [...people].map(([userId, { line, priorLine, paid = 0n, refunded = 0n, reported = 0n, holdings }]) => {
    const active = !cancelled && line !== null;
    const netPaid = paid - refunded;
    const targetAmount = active ? line.amount : 0;
    const targetQuantity = active ? line.quantity : 0;
    const host = userId === hostId;
    const due = host ? 0 : money(BigInt(targetAmount) - netPaid);
    const paymentStatus = due === 0 ? 'SETTLED' : due < 0 ? 'REFUND_DUE'
      : priorLine?.amount > 0 && priorLine.amount < targetAmount && netPaid >= BigInt(priorLine.amount) ? 'ADDITIONAL_DUE'
        : netPaid > 0n ? 'PARTIALLY_PAID' : 'UNPAID';
    const actualQuantity = holdings?.get(currentItem) ?? 0;
    const legacyItemHeld = holdings && [...holdings].some(([key, qty]) => key !== currentItem && qty > 0);
    const receiptStatus = legacyItemHeld ? 'LEGACY_ITEM_HELD'
      : actualQuantity === targetQuantity ? (active ? 'RECEIVED' : 'NOT_REQUIRED')
        : actualQuantity === 0 ? 'MISSING' : 'QUANTITY_MISMATCH';
    return { userId, active, targetAmount, targetQuantity, actualQuantity, reportedAmount: money(reported),
      confirmedIn: money(paid), refunded: money(refunded), netPaid: money(netPaid), due, paymentStatus, receiptStatus,
      actualNetCost: money(host ? merchantNetCost - othersNetPaid : netPaid) };
  });
  const canComplete = !cancelled && merchantRefundsApplied && openActionIds.length === 0
    && balances.every(({ due, receiptStatus }) => due === 0 && (receiptStatus === 'RECEIVED' || receiptStatus === 'NOT_REQUIRED'));
  return { balances, merchantRefunds, merchantRefundsApplied, merchantNetCost: money(merchantNetCost),
    cancelled, openActionIds: [...openActionIds], canComplete, savingRecords: canComplete ? savings(snapshot, balances) : null };
}

/** Share only approved display aliases and a vetted public hub, as persisted in this confirmed version.
 * Passing a snapshot is not access control: no cash ledger, account details or raw private input belongs here. */
export function formatKakaoSettlement(snapshot) {
  requireConfirmed(snapshot);
  const { at, publicHub } = snapshot.terms.pickup;
  return [
    `공구 정산 · 총 ${integer.format(snapshot.finalTotal)}원`,
    ...snapshot.lines.map(({ alias, quantity, unitName, amount }) => `${alias}: ${integer.format(quantity)}${unitName} · ${integer.format(amount)}원`),
    `수령 일정: ${at ? `${pickupDate.format(new Date(at))} (KST)` : '미정'}`,
    `공개 수령 거점: ${publicHub ?? '미정'}`,
  ].join('\n');
}
