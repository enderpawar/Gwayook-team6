import { randomUUID } from 'node:crypto';
import { P1Error } from './db.js';
import { getAnalysis } from './groups.js';
import { confirmSettlement, createSettlementCandidate, evaluateSettlement, formatKakaoSettlement } from './settlement.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const receiptKinds = new Set(['RECEIVED', 'REVERSED']);
const actionKinds = new Set(['NO_SHOW', 'RETURN_REQUIRED', 'ORDER_ISSUE', 'CORRECTION']);
const cancellationReasons = new Set(['SOLD_OUT', 'ORDER_CANCELLED', 'ORDER_ISSUE', 'NO_SHOW', 'CORRECTION']);
const cashKinds = new Set(['TRANSFER_REPORTED', 'TRANSFER_CONFIRMED', 'REFUND_CONFIRMED', 'MERCHANT_REFUND_CONFIRMED', 'REVERSAL']);
const positive = (number) => Number.isSafeInteger(number) && number > 0;
const isUuid = (value) => typeof value === 'string' && uuid.test(value);
const versionPath = (id, number) => number == null ? null : `/api/p1/groups/${id}/settlement/${number}`;
function check(condition, status, code) {
  if (!condition) throw new P1Error(status, code);
}
function exists(condition) { check(condition, 404, 'NOT_FOUND'); }
function permitted(condition) { check(condition, 409, 'INVALID_SETTLEMENT_STATE'); }
function input(condition) { check(condition, 422, 'INVALID_SETTLEMENT_INPUT'); }
function state(db, id) {
  return db.prepare('SELECT * FROM settlement_state WHERE group_buy_id = ?').get(id) ?? {};
}
function version(db, id, number) {
  if (!positive(number)) return null;
  const row = db.prepare('SELECT * FROM settlement_version WHERE group_buy_id = ? AND version_no = ?').get(id, number);
  return row && { ...JSON.parse(row.candidate_json), confirmedAt: row.confirmed_at };
}
function move(db, row, status, actor, kind, detail = null) {
  const now = Date.now();
  if (row.status === 'COMPLETED' && status !== 'COMPLETED') {
    db.prepare('UPDATE saving_record SET eligible = 0 WHERE group_buy_id = ?').run(row.id);
  }
  db.prepare('UPDATE group_buy SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(status, now, row.id);
  db.prepare('INSERT INTO group_buy_event(group_buy_id,actor_id,kind,happened_at,detail_json) VALUES (?,?,?,?,?)')
    .run(row.id, actor, kind, now, detail === null ? null : JSON.stringify(detail));
}
function loadLedger(db, row, snapshot) {
  const priorSnapshots = db.prepare('SELECT candidate_json,confirmed_at FROM settlement_version WHERE group_buy_id = ? AND version_no < ? AND confirmed_at IS NOT NULL')
    .all(row.id, snapshot.versionNo).map((record) => ({ ...JSON.parse(record.candidate_json), confirmedAt: record.confirmed_at }));
  const records = db.prepare(`SELECT data_json, happened_at FROM settlement_event
    WHERE group_buy_id = ? ORDER BY event_no`).all(row.id);
  const cashEvents = [];
  const receiptEvents = [];
  const events = [];
  for (const record of records) {
    const event = JSON.parse(record.data_json);
    (receiptKinds.has(event.type) ? receiptEvents : cashEvents).push(event);
    events.push({ ...event, recordedAt: new Date(record.happened_at).toISOString() });
  }
  const openActionIds = db.prepare('SELECT id FROM settlement_action WHERE group_buy_id = ? AND resolved_at IS NULL ORDER BY opened_at,id')
    .all(row.id).map(({ id }) => id);
  return { snapshot, priorSnapshots, cashEvents, receiptEvents, events, openActionIds, cancelled: row.status === 'CANCELLED' };
}
function present(db, row, userId, snapshot, info, current) {
  const host = row.host_id === userId;
  const line = snapshot.lines.find((item) => item.userId === userId);
  exists(host || line);
  const hasCurrentLine = current?.lines.some((item) => item.userId === userId);
  const latestVersionNo = hasCurrentLine ? current.versionNo : null;
  const pending = version(db, row.id, info.pending_version);
  const pendingVersionNo = pending?.lines.some((item) => item.userId === userId) ? pending.versionNo : null;
  const common = { status: row.status, versionNo: snapshot.versionNo, confirmedAt: snapshot.confirmedAt,
    pickup: snapshot.terms.pickup, latestVersionNo, latestPath: versionPath(row.id, latestVersionNo), pendingVersionNo,
    pendingPath: versionPath(row.id, pendingVersionNo), readOnly: Boolean(snapshot.confirmedAt && snapshot.versionNo !== latestVersionNo),
    revision: row.revision };
  const hasLedger = current && (snapshot.versionNo === current.versionNo || !host && !hasCurrentLine && snapshot.confirmedAt);
  const ledger = hasLedger ? loadLedger(db, row, current) : null;
  const effective = ledger ? evaluateSettlement(ledger) : null;
  if (host) {
    const actions = ledger ? db.prepare(`SELECT id,kind,user_id AS userId,version_no AS versionNo,opened_at AS openedAt,resolved_at AS resolvedAt
      FROM settlement_action WHERE group_buy_id = ? ORDER BY opened_at,id`).all(row.id) : undefined;
    return { ...common, snapshot, ledger: effective ?? undefined, events: ledger?.events, actions };
  }
  const reconfirmed = !snapshot.confirmedAt && Boolean(db.prepare(`SELECT 1 FROM settlement_confirmation
    WHERE group_buy_id = ? AND version_no = ? AND user_id = ?`).get(row.id, snapshot.versionNo, userId));
  const previousLine = current?.lines.find((item) => item.userId === userId);
  return { ...common, line, balance: effective?.balances.find((item) => item.userId === userId),
    events: ledger?.events.filter((event) => event.userId === userId),
    ...(snapshot.confirmedAt ? {} : { priceDifference: snapshot.priceDifference, previousAmount: previousLine?.amount ?? null,
      reconfirmed, reconfirmationRequired: snapshot.requiredConfirmationUserIds.includes(userId) }) };
}

function buildCandidate(db, row, userId, info, body) {
  permitted(['CLOSED', 'SETTLING', 'PICKUP', 'COMPLETED'].includes(row.status));
  check(body?.revision === row.revision, 409, 'REVISION_CONFLICT');
  input(body?.priceConfirmed === true);
  check(body.allocationMode == null || body.allocationMode === 'SEALED_PACKAGE', 422, 'SEALED_PACKAGES_ONLY');
  const analysis = getAnalysis(db, row.analysis_id);
  const previous = version(db, row.id, info.current_version);
  const product = analysis.product;
  const itemKey = analysis.id;
  const members = db.prepare(`SELECT p.user_id AS userId,p.alias,p.approval_seq AS approvalSeq FROM group_participation p
    JOIN group_seat s ON s.group_buy_id = p.group_buy_id AND s.user_id = p.user_id
    WHERE p.group_buy_id = ? AND p.status = 'APPROVED' ORDER BY p.approval_seq`).all(row.id);
  const exclusions = body.excludeUserIds ?? [];
  input(Array.isArray(exclusions) && exclusions.length <= 2 && new Set(exclusions).size === exclusions.length
    && exclusions.every((id) => members.some((member) => member.userId === id)) && (!exclusions.length || previous));
  if (previous) input(actionKinds.has(body.reason));
  const approvedMembers = members.filter((member) => !exclusions.includes(member.userId));
  permitted(members.length + 1 === row.headcount && approvedMembers.length >= 1);
  const next = db.prepare('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM settlement_version WHERE group_buy_id = ?').get(row.id).next;
  const buy = body.payment;
  input(buy && ['productAmount', 'shippingFee', 'discountAmount', 'includesShipping', 'includesDiscount'].every((key) => Object.hasOwn(buy, key)));
  const merchantRefunds = previous ? evaluateSettlement(loadLedger(db, row, previous)).merchantRefunds : [];
  const pickup = { at: Object.hasOwn(body, 'pickupAt') ? body.pickupAt : previous?.terms.pickup.at,
    publicHub: Object.hasOwn(body, 'publicHub') ? body.publicHub : previous ? previous.terms.pickup.publicHub : row.public_location };
  const candidate = createSettlementCandidate({ groupBuyId: row.id, versionNo: next, itemKey,
    product: { ...product, bulkTotalQty: body.quantity, payment: { ...buy, isEstimate: false } },
    orderAt: previous?.orderAt ?? body.orderAt, headcount: approvedMembers.length + 1,
    host: { userId, alias: body.hostAlias ?? previous?.lines[0].alias ?? '방장' }, approvedMembers,
    expected: { itemKey, quantity: product.bulkTotalQty, unitName: product.unitName, allocationStep: product.allocationStep,
      totalAmount: product.payment.totalAmount, pickup: { publicHub: row.public_location } },
    previous, merchantRefunds, pickup });
  input(Date.parse(candidate.orderAt) <= Date.now() && (!candidate.terms.pickup.at || candidate.terms.pickup.at >= candidate.orderAt));
  db.prepare('INSERT INTO settlement_version VALUES (?,?,?,NULL)').run(row.id, next, JSON.stringify(candidate));
  const add = db.prepare('INSERT INTO settlement_line VALUES (?,?,?,?)');
  for (const line of candidate.lines) add.run(row.id, next, line.userId, line.lineNo);
  db.prepare(`INSERT INTO settlement_state(group_buy_id,pending_version) VALUES (?,?)
    ON CONFLICT(group_buy_id) DO UPDATE SET pending_version = excluded.pending_version`).run(row.id, next);
  move(db, row, 'SETTLING', userId, 'SETTLEMENT_CANDIDATE', { versionNo: next, reason: previous ? body.reason : null });
  return { ...candidate, revision: row.revision + 1 };
}

function commitVersion(db, row, info, candidate, userId) {
  permitted(row.status === 'SETTLING' && info.pending_version === candidate.versionNo);
  const confirmedUserIds = db.prepare('SELECT user_id FROM settlement_confirmation WHERE group_buy_id = ? AND version_no = ?')
    .all(row.id, candidate.versionNo).map(({ user_id }) => user_id);
  const snapshot = confirmSettlement({ candidate, confirmedUserIds, confirmedAt: new Date().toISOString() });
  const current = version(db, row.id, info.current_version);
  if (current) {
    const effective = evaluateSettlement(loadLedger(db, row, current)).merchantRefunds;
    permitted(JSON.stringify(effective) === JSON.stringify(snapshot.merchantRefunds));
    for (const line of current.lines.slice(1)) {
      if (!snapshot.lines.some(({ userId: id }) => id === line.userId)) {
        db.prepare('UPDATE group_participation SET status = ?, decided_by = ?, decided_at = ? WHERE group_buy_id = ? AND user_id = ?')
          .run('EXCLUDED', userId, Date.now(), row.id, line.userId);
      }
    }
    if (current.lines.length !== snapshot.lines.length) {
      db.prepare('DELETE FROM group_seat WHERE group_buy_id = ? AND seat_no > 0').run(row.id);
      const insert = db.prepare('INSERT INTO group_seat(group_buy_id,seat_no,user_id,assigned_at) VALUES (?,?,?,?)');
      for (const line of snapshot.lines.slice(1)) insert.run(row.id, line.lineNo, line.userId, Date.now());
      db.prepare('UPDATE group_buy SET headcount = ? WHERE id = ?').run(snapshot.lines.length, row.id);
    }
  }
  db.prepare('UPDATE settlement_version SET confirmed_at = ? WHERE group_buy_id = ? AND version_no = ?')
    .run(snapshot.confirmedAt, row.id, snapshot.versionNo);
  db.prepare('UPDATE settlement_state SET pending_version = NULL,current_version = ? WHERE group_buy_id = ?').run(snapshot.versionNo, row.id);
  move(db, row, 'SETTLING', userId, 'SETTLEMENT_CONFIRMED', { versionNo: snapshot.versionNo });
  return snapshot;
}

function applyEvent(db, row, userId, current, body) {
  const { type, requestKey } = body ?? {};
  const host = row.host_id === userId;
  input((cashKinds.has(type) || receiptKinds.has(type)) && isUuid(requestKey));
  const report = type === 'TRANSFER_REPORTED';
  exists(report ? !host : host);
  const replay = db.prepare('SELECT data_json FROM settlement_event WHERE group_buy_id = ? AND actor_id = ? AND request_key = ?')
    .get(row.id, userId, requestKey);
  input(positive(body.versionNo) && (report || isUuid(body.userId)));
  const effective = { type, versionNo: body.versionNo, userId: report ? userId : body.userId };
  if (type === 'RECEIVED') Object.assign(effective, { quantity: body.quantity, unitName: body.unitName });
  if (cashKinds.has(type) && type !== 'REVERSAL') effective.amount = body.amount;
  if (body.relatedEventId != null) {
    input(isUuid(body.relatedEventId));
    effective.relatedEventId = body.relatedEventId;
  }
  if (body.occurredAt != null) {
    input(typeof body.occurredAt === 'string' && Number.isFinite(Date.parse(body.occurredAt))
      && new Date(body.occurredAt).toISOString() === body.occurredAt && Date.parse(body.occurredAt) <= Date.now());
    effective.occurredAt = body.occurredAt;
  }
  if (replay) {
    const { id, ...saved } = JSON.parse(replay.data_json);
    check(JSON.stringify(effective) === JSON.stringify(saved), 409, 'REQUEST_KEY_CONFLICT');
    return { id, ...saved };
  }
  permitted(current?.confirmedAt);
  if (report || type === 'TRANSFER_CONFIRMED') {
    permitted(['SETTLING', 'PICKUP'].includes(row.status) && !state(db, row.id).pending_version && body.versionNo === current.versionNo);
  } else permitted(['SETTLING', 'PICKUP', 'COMPLETED', 'CANCELLED'].includes(row.status));
  const record = { id: randomUUID(), ...effective };
  const ledger = loadLedger(db, row, current);
  (receiptKinds.has(type) ? ledger.receiptEvents : ledger.cashEvents).push(record);
  const result = evaluateSettlement(ledger);
  input(result.merchantNetCost >= 0);
  db.prepare(`INSERT INTO settlement_event(group_buy_id,version_no,user_id,actor_id,request_key,event_id,kind,data_json,related_event_id,happened_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(row.id, record.versionNo, record.userId, userId, requestKey, record.id, type,
    JSON.stringify(record), record.relatedEventId ?? null, Date.now());
  if (!report) move(db, row, row.status === 'COMPLETED' ? 'SETTLING' : row.status, userId, 'SETTLEMENT_LEDGER_UPDATED', { eventId: record.id });
  return record;
}

function operate(db, row, actor, info, current, kind, body) {
  if (kind === 'cancel') {
    permitted(['OPEN', 'CLOSED', 'SETTLING', 'PICKUP'].includes(row.status));
    input(cancellationReasons.has(body?.reason));
    db.prepare('UPDATE settlement_state SET pending_version = NULL WHERE group_buy_id = ?').run(row.id);
    move(db, row, 'CANCELLED', actor, 'GROUP_CANCELLED', { reason: body.reason });
    return { status: 'CANCELLED' };
  }
  permitted(current?.confirmedAt && !info.pending_version);
  if (kind === 'pickup') {
    permitted(row.status === 'SETTLING');
    check(current.terms.pickup.at && current.terms.pickup.publicHub, 409, 'PICKUP_DETAILS_REQUIRED');
    move(db, row, 'PICKUP', actor, 'PICKUP_READY');
    return { status: 'PICKUP' };
  }
  if (kind === 'complete') {
    permitted(row.status === 'PICKUP');
    const result = evaluateSettlement(loadLedger(db, row, current));
    check(result.canComplete, 409, 'SETTLEMENT_INCOMPLETE');
    db.prepare('UPDATE saving_record SET eligible = 0 WHERE group_buy_id = ?').run(row.id);
    const save = db.prepare(`INSERT INTO saving_record(group_buy_id,user_id,version_no,actual_quantity,actual_net_cost,numerator,denominator,eligible)
      VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(group_buy_id,user_id) DO UPDATE SET version_no=excluded.version_no,
      actual_quantity=excluded.actual_quantity,actual_net_cost=excluded.actual_net_cost,numerator=excluded.numerator,denominator=excluded.denominator,eligible=1`);
    for (const record of result.savingRecords) save.run(row.id, record.userId, record.sourceVersionNo, record.actualQuantity,
      record.actualNetCost, record.numerator, record.denominator);
    move(db, row, 'COMPLETED', actor, 'GROUP_COMPLETED');
    return result;
  }
  permitted(['SETTLING', 'PICKUP', 'COMPLETED', 'CANCELLED'].includes(row.status));
  if (kind === 'action') {
    input(actionKinds.has(body?.kind));
    const userId = body.userId ?? null;
    input((userId === null && !['NO_SHOW', 'RETURN_REQUIRED'].includes(body.kind))
      || (isUuid(userId) && current.lines.some((line) => line.userId === userId && line.lineNo > 0)));
    const id = randomUUID();
    db.prepare(`INSERT INTO settlement_action (group_buy_id,id,kind,version_no,user_id,opened_at)
      VALUES (?,?,?,?,?,?)`).run(row.id, id, body.kind, current.versionNo, userId, Date.now());
    move(db, row, row.status === 'COMPLETED' ? 'SETTLING' : row.status, actor, 'SETTLEMENT_ACTION_OPENED', { id, kind: body.kind });
    return { id };
  }
  input(isUuid(body?.id));
  exists(db.prepare('UPDATE settlement_action SET resolved_at = ? WHERE group_buy_id = ? AND id = ? AND resolved_at IS NULL')
    .run(Date.now(), row.id, body.id).changes);
  move(db, row, row.status, actor, 'SETTLEMENT_ACTION_RESOLVED', { id: body.id });
  return { id: body.id };
}

export function readSavings(db, userId) {
  const records = db.prepare(`SELECT s.group_buy_id AS groupBuyId,s.version_no AS sourceVersionNo,s.actual_quantity AS actualQuantity,
    s.actual_net_cost AS actualNetCost,s.numerator,s.denominator FROM saving_record s JOIN group_buy g ON g.id=s.group_buy_id
    JOIN settlement_state t ON t.group_buy_id=g.id AND t.current_version=s.version_no
    WHERE s.user_id=? AND s.eligible=1 AND g.status='COMPLETED' ORDER BY g.updated_at DESC,g.id`).all(userId);
  let numerator = 0n;
  let denominator = 1n;
  for (const record of records) {
    const d = BigInt(record.denominator);
    numerator = numerator * d + BigInt(record.numerator) * denominator;
    denominator *= d;
    let a = numerator < 0n ? -numerator : numerator;
    let b = denominator;
    while (b) [a, b] = [b, a % b];
    numerator /= a;
    denominator /= a;
  }
  return { records, numerator: String(numerator), denominator: String(denominator) };
}

export async function settlementRequest(store, { id, userId, method, target, action, readBody }) {
  const get = method === 'GET';
  if (!get && method !== 'POST') return null;
  const number = /^[1-9]\d{0,15}$/u.test(target ?? '') ? Number(target) : 0;
  const command = !action && ['candidate', 'events', 'cancel', 'pickup', 'complete', 'action', 'resolve'].includes(target);
  if (get ? !(positive(number) && (action == null || action === 'kakao') || target == null && action == null)
    : !(command || positive(number) && ['confirm', 'reconfirm'].includes(action))) return null;
  const body = get ? null : await readBody();
  if (!get) input(body !== null && typeof body === 'object' && !Array.isArray(body));
  try {
    return store.transaction((db) => {
      const row = db.prepare('SELECT * FROM group_buy WHERE id = ?').get(id);
      exists(row);
      const info = state(db, id);
      const current = version(db, id, info.current_version);
      if (get) {
        const snapshot = number ? version(db, id, number) : current ?? version(db, id, info.pending_version);
        exists(snapshot);
        if (action === 'kakao') {
          exists(row.host_id === userId && snapshot.confirmedAt);
          return { text: formatKakaoSettlement(snapshot) };
        }
        if (!snapshot.confirmedAt) exists(snapshot.versionNo === info.pending_version);
        return present(db, row, userId, snapshot, info, current);
      }
      if (target === 'events' && body?.type === 'TRANSFER_REPORTED') {
        exists(current?.lines.some((line) => line.userId === userId && line.lineNo > 0));
        return applyEvent(db, row, userId, current, body);
      }
      if (action === 'reconfirm') {
        const candidate = version(db, id, number);
        exists(candidate?.lines.slice(1).some((line) => line.userId === userId));
        permitted(info.pending_version === number);
        db.prepare('INSERT INTO settlement_confirmation VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(id, number, userId, new Date().toISOString());
        return { versionNo: number, reconfirmed: true };
      }
      exists(row.host_id === userId);
      if (target === 'candidate') return buildCandidate(db, row, userId, info, body);
      if (target === 'events') return applyEvent(db, row, userId, current, body);
      if (action === 'confirm') {
        const candidate = version(db, id, number);
        exists(candidate);
        return commitVersion(db, row, info, candidate, userId);
      }
      return operate(db, row, userId, info, current, target, body);
    }, { readOnly: get });
  } catch (error) {
    if (error instanceof RangeError && error.code) throw new P1Error(error.code === 'RECONFIRMATION_REQUIRED' ? 409 : 422, error.code, [error.field]);
    throw error;
  }
}
