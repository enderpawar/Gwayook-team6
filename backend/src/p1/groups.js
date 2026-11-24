import { randomUUID } from 'node:crypto';
import { analyze, validateOptions, validateProduct } from '../analysis.js';
import { presets } from '../presets.js';
import { hashToken, newToken } from './auth.js';
import { P1Error } from './db.js';

const inviteTtl = 7 * 24 * 60 * 60 * 1000;
const applicationMethod = '초대 링크에서 로그인 후 신청';
const comparisonFactors = new Map([['ml', 1], ['L', 1000], ['m', 1000], ['cm', 10], ['g', 1], ['kg', 1000], ['개', 1]]);
const own = (object, key) => Object.hasOwn(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bool = (value) => typeof value === 'boolean';
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value) => nonnegativeInteger(value) && value > 0;
const oneOf = (...values) => (value) => values.includes(value);
const text = (limit) => (value) => typeof value === 'string' && value.length <= limit && !/[\p{Cc}\p{Cf}]/u.test(value);
const bounded = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const people = oneOf(2, 3, 4);
const iso = (value) => value == null ? null : new Date(value).toISOString();
const invalid = (fields, code = 'INVALID_GROUP_INPUT') => new P1Error(422, code, fields);
const missing = () => new P1Error(404, 'GROUP_NOT_FOUND');
const badState = () => new P1Error(409, 'INVALID_GROUP_STATE');

const specShape = { compatibilityKey: text(100), unit: text(8), amountPerUnit: bounded };
const unit = oneOf('롤', '병', '개', 'ml', 'g');
const settingsShape = {
  people, publicLocation: text(100), applicationDeadline: text(24),
  pickupCandidates: (value) => Array.isArray(value) && value.length <= 8 && value.every(text(24)),
};
const draftShape = {
  ...settingsShape,
  inputOrigin: oneOf('MANUAL', 'CAPTURE', 'SAMPLE'), presetId: text(80),
  allocationMode: oneOf('SEALED_PACKAGE', 'DIRECT'), priceConfirmed: bool,
  product: {
    shortName: text(80), fullTitle: text(200), bulkTotalQty: positiveInteger, unitName: unit,
    allocationStep: positiveInteger, uniformUnits: bool, annualPurchaseCount: positiveInteger,
    selectedOption: text(200), packCount: positiveInteger, unitsPerPack: positiveInteger,
    netAmountPerUnit: positiveInteger, netUnitName: oneOf('ml', 'g'),
    payment: {
      productAmount: nonnegativeInteger, shippingFee: nonnegativeInteger, discountAmount: nonnegativeInteger,
      includesShipping: bool, includesDiscount: bool, isEstimate: bool,
    },
    comparisonSpec: specShape,
    comparisonBaseline: {
      quantity: positiveInteger, unitName: unit, price: positiveInteger, spec: specShape,
      source: { kind: oneOf('USER_INPUT', 'SAMPLE'), presetId: text(80), checkedOn: text(10), reference: { kind: oneOf('LINK'), value: text(1000) } },
    },
  },
};

// Drop unknown fields, including uploaded images, extractor evidence and model responses.
function copyInput(input, shape, prefix = '') {
  if (!isObject(input)) throw invalid([prefix || 'body']);
  const output = {};
  for (const [key, check] of Object.entries(shape)) {
    if (!own(input, key)) continue;
    const value = input[key];
    if (value === null) { output[key] = null; continue; }
    if (typeof check !== 'function') output[key] = copyInput(value, check, `${prefix}${key}.`);
    else if (check(value)) output[key] = value;
    else throw invalid([prefix + key]);
  }
  return output;
}

function draftInput(body) {
  const draft = copyInput(body?.input, draftShape);
  const source = draft.product?.comparisonBaseline?.source;
  if (source?.reference && (source.reference.kind !== 'LINK'
      || !['http:', 'https:'].includes(URL.parse(source.reference.value)?.protocol))) {
    throw invalid(['product.comparisonBaseline.source.reference']);
  }
  return draft;
}

function instant(input, field) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(input)) throw invalid([field]);
  const value = Date.parse(input);
  if (!Number.isFinite(value) || (input.length === 20 ? iso(value).replace('.000Z', 'Z') : iso(value)) !== input) {
    throw invalid([field]);
  }
  return value;
}

function recruitmentSettings(input, now) {
  if (!people(input.people)) throw invalid(['people']);
  const applicationDeadline = instant(input.applicationDeadline, 'applicationDeadline');
  if (applicationDeadline <= now) throw invalid(['applicationDeadline'], 'DEADLINE_NOT_FUTURE');
  if (!input.pickupCandidates?.length) throw invalid(['pickupCandidates']);
  const pickupCandidates = input.pickupCandidates.map((value) => instant(value, 'pickupCandidates'));
  if (new Set(pickupCandidates).size !== pickupCandidates.length || pickupCandidates.some((value) => value < applicationDeadline)) {
    throw invalid(['pickupCandidates']);
  }
  pickupCandidates.sort((left, right) => left - right);
  return { headcount: input.people, publicLocation: input.publicLocation?.trim() || null, applicationDeadline, pickupCandidates };
}

function group(db, id) {
  return db.prepare('SELECT * FROM group_buy WHERE id = ?').get(id);
}

export function getOwnedGroup(db, groupId, userId) {
  const row = db.prepare('SELECT * FROM group_buy WHERE id = ? AND host_id = ?').get(groupId, userId);
  if (!row) throw missing();
  return row;
}

export function getAnalysis(db, analysisId) {
  const row = db.prepare('SELECT * FROM product_analysis WHERE id = ?').get(analysisId);
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, confirmedAt: iso(row.confirmed_at),
    inputOrigin: row.input_origin, presetId: row.preset_id, allocationMode: row.allocation_mode,
    comparisonStatus: row.comparison_status, comparisonPendingReason: row.comparison_pending_reason,
    bulkSpecBaseAmount: row.bulk_spec_base_amount, baselineSpecBaseAmount: row.baseline_spec_base_amount,
    product: JSON.parse(row.product_json),
  };
}

// Every group write obtains the SQLite writer lock before reading any row, then reads the group before its children.
function ownedWrite(store, groupId, userId, operation) {
  return store.transaction((db) => operation(db, getOwnedGroup(db, groupId, userId), Date.now()));
}

function checkRevision(row, revision) {
  if (!positiveInteger(revision)) throw invalid(['revision']);
  if (row.revision !== revision) throw new P1Error(409, 'REVISION_CONFLICT');
}

function event(db, groupId, actorId, kind, now, subjectId = null, detail = null) {
  db.prepare(`INSERT INTO group_buy_event (group_buy_id, actor_id, subject_id, kind, happened_at, detail_json)
    VALUES (?, ?, ?, ?, ?, ?)`).run(groupId, actorId, subjectId, kind, now, detail === null ? null : JSON.stringify(detail));
}

function draftView(row) {
  return {
    id: row.id, status: row.status, revision: row.revision, role: 'ORGANIZER',
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), input: JSON.parse(row.draft_input),
  };
}

export function createDraft(store, userId, body) {
  const input = JSON.stringify(draftInput(body));
  return store.transaction((db) => {
    const id = randomUUID();
    const now = Date.now();
    const row = db.prepare(`INSERT INTO group_buy (id, host_id, status, draft_input, created_at, updated_at)
      VALUES (?, ?, 'DRAFT', ?, ?, ?) RETURNING *`).get(id, userId, input, now, now);
    return draftView(row);
  });
}

export function listGroups(db, userId) {
  return db.prepare(`SELECT g.id, g.status, g.revision, g.updated_at, g.headcount,
    CASE WHEN g.status = 'DRAFT' THEN json_extract(g.draft_input, '$.product.shortName')
      ELSE json_extract(a.product_json, '$.shortName') END AS short_name
    FROM group_buy g LEFT JOIN product_analysis a ON g.analysis_id = a.id WHERE g.host_id = ?
    ORDER BY g.updated_at DESC, g.id`).all(userId).map((row) => ({
    id: row.id, role: 'ORGANIZER', status: row.status, revision: row.revision, updatedAt: iso(row.updated_at),
    shortName: row.short_name, people: row.headcount,
  }));
}

export function saveDraft(store, groupId, userId, body) {
  return ownedWrite(store, groupId, userId, (db, row, now) => {
    if (row.status !== 'DRAFT') throw badState();
    checkRevision(row, body?.revision);
    return draftView(db.prepare(`UPDATE group_buy SET draft_input = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? RETURNING *`).get(JSON.stringify(draftInput(body)), now, groupId));
  });
}

export function deleteDraft(store, groupId, userId, revision) {
  ownedWrite(store, groupId, userId, (db, row) => {
    if (row.status !== 'DRAFT') throw badState();
    checkRevision(row, revision);
    db.prepare('DELETE FROM group_buy WHERE id = ?').run(groupId);
  });
}

function validateAnalysis(input, headcount) {
  if (input.allocationMode !== 'SEALED_PACKAGE' || !['롤', '병', '개'].includes(input.product?.unitName)
    || input.product?.allocationStep !== 1) throw invalid(['allocationMode'], 'SEALED_PACKAGES_ONLY');
  if (input.priceConfirmed !== true || input.product?.payment?.isEstimate !== false) {
    throw invalid(['priceConfirmed', 'product.payment.isEstimate'], 'VERIFIED_PRICE_REQUIRED');
  }
  const inputOrigin = input.inputOrigin ?? 'MANUAL';
  const presetId = inputOrigin === 'SAMPLE' && presets.some(({ id }) => id === input.presetId) ? input.presetId : null;
  if (inputOrigin === 'SAMPLE' && !presetId) throw invalid(['presetId']);
  const raw = input.product;
  const { product, fields } = validateProduct(raw);
  if (fields.length) throw invalid(fields, 'INVALID_ANALYSIS_INPUT');
  if (product.bulkTotalQty / product.allocationStep < headcount) {
    throw invalid(['product.bulkTotalQty'], 'INSUFFICIENT_ALLOCATION_UNITS');
  }
  if (raw.packCount != null && raw.unitsPerPack != null
    && BigInt(raw.packCount) * BigInt(raw.unitsPerPack) !== BigInt(product.bulkTotalQty)) {
    throw invalid(['product.packCount', 'product.unitsPerPack'], 'PACK_COUNT_MISMATCH');
  }
  // A sample baseline can be previewed in P0, but never represents an operational comparison price.
  const rawProduct = raw.comparisonBaseline?.source?.kind === 'SAMPLE' ? { ...raw, comparisonBaseline: null } : raw;
  const result = analyze(product, rawProduct, validateOptions({ people: headcount }));
  for (const field of ['selectedOption', 'packCount', 'unitsPerPack', 'netAmountPerUnit', 'netUnitName']) {
    if (raw[field] != null) result.product[field] = raw[field];
  }
  // Keep the validated input unit for reanalysis; canonical metre decimals may lose precision near the safe limit.
  const bulkSpecBaseAmount = preserveInputUnit(result.product.comparisonSpec, raw.comparisonSpec);
  const baselineSpecBaseAmount = preserveInputUnit(result.product.comparisonBaseline?.spec, raw.comparisonBaseline?.spec);
  return { inputOrigin, presetId, product: result.product, comparison: result.comparison, bulkSpecBaseAmount, baselineSpecBaseAmount };
}

function preserveInputUnit(validated, raw) {
  if (!validated) return null;
  validated.unit = raw.unit;
  validated.amountPerUnit = raw.amountPerUnit;
  return Math.round(raw.amountPerUnit * comparisonFactors.get(raw.unit));
}

function writeAnalysis(db, userId, now, { inputOrigin, presetId, product, comparison, bulkSpecBaseAmount, baselineSpecBaseAmount }) {
  const id = randomUUID();
  const { payment } = product;
  db.prepare(`INSERT INTO product_analysis (id, user_id, created_at, confirmed_at, input_origin, preset_id, allocation_mode,
      bulk_qty, unit_name, allocation_step, uniform_units, product_amount, shipping_fee, discount_amount,
      includes_shipping, includes_discount, is_estimate, total_amount, comparison_status, comparison_pending_reason,
      bulk_spec_base_amount, baseline_spec_base_amount, product_json)
    VALUES (?, ?, ?, ?, ?, ?, 'SEALED_PACKAGE', ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, now, now, inputOrigin, presetId, product.bulkTotalQty, product.unitName, product.allocationStep,
      payment.productAmount, payment.shippingFee, payment.discountAmount, Number(payment.includesShipping),
      Number(payment.includesDiscount), payment.totalAmount, comparison.status, comparison.reason ?? null,
      bulkSpecBaseAmount, baselineSpecBaseAmount, JSON.stringify(product));
  return id;
}

function issueInvite(db, groupId, now) {
  const inviteToken = newToken();
  db.prepare('UPDATE group_invite SET revoked_at = ? WHERE group_buy_id = ? AND revoked_at IS NULL').run(now, groupId);
  db.prepare('INSERT INTO group_invite (id, group_buy_id, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), groupId, hashToken(inviteToken), now, now + inviteTtl);
  return { inviteToken, inviteExpiresAt: iso(now + inviteTtl) };
}

export function publishGroup(store, groupId, userId, body) {
  return ownedWrite(store, groupId, userId, (db, row, now) => {
    if (row.status !== 'DRAFT') throw badState();
    checkRevision(row, body?.revision);
    const input = JSON.parse(row.draft_input);
    const { headcount, publicLocation, applicationDeadline, pickupCandidates } = recruitmentSettings(input, now);
    const analysisId = writeAnalysis(db, userId, now, validateAnalysis(input, headcount));
    const published = db.prepare(`UPDATE group_buy SET status = 'OPEN', analysis_id = ?, draft_input = NULL,
      headcount = ?, public_location = ?, application_deadline = ?, pickup_candidates = ?,
      published_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? RETURNING *`)
      .get(analysisId, headcount, publicLocation, applicationDeadline, JSON.stringify(pickupCandidates), now, now, groupId);
    const insert = db.prepare('INSERT INTO group_seat (group_buy_id, seat_no, user_id, assigned_at) VALUES (?, ?, ?, ?)');
    insert.run(groupId, 0, userId, now);
    for (let seat = 1; seat < headcount; seat++) insert.run(groupId, seat, null, null);
    event(db, groupId, userId, 'PUBLISHED', now);
    return { ...ownerView(db, published, now), ...issueInvite(db, groupId, now) };
  });
}

function seats(db, groupId) {
  return db.prepare(`SELECT s.seat_no, s.user_id, s.role, s.assigned_at, p.approval_seq
    FROM group_seat s LEFT JOIN group_participation p ON s.group_buy_id = p.group_buy_id AND s.user_id = p.user_id
    WHERE s.group_buy_id = ? ORDER BY s.seat_no`).all(groupId);
}

function participation(db, groupId, userId) {
  return db.prepare('SELECT * FROM group_participation WHERE group_buy_id = ? AND user_id = ?').get(groupId, userId);
}

function applicantView(row, seat = null) {
  return { userId: row.user_id, role: 'MEMBER', alias: row.alias, status: row.status,
    requestedAt: iso(row.requested_at), approvalSeq: row.approval_seq, seatNo: seat?.seat_no ?? null };
}

function isOpen(row, now) {
  return row.status === 'OPEN' && row.application_deadline > now;
}

function publicView(row, snapshot, seatRows, now) {
  const remainingSeats = seatRows.filter((seat) => seat.user_id === null).length;
  const deadline = iso(row.application_deadline);
  const product = snapshot.product;
  const estimate = analyze({ ...product, payment: { ...product.payment, isEstimate: true } }, product, {
    people: row.headcount, location: row.public_location, deadline, applicationMethod,
  });
  const acceptingApplications = isOpen(row, now) && remainingSeats > 0;
  const pickupCandidates = JSON.parse(row.pickup_candidates).map(iso);
  const availability = acceptingApplications ? `남은 자리: ${remainingSeats}` : isOpen(row, now) ? '정원 도달' : '신청 종료';
  return {
    id: row.id, status: row.status, updatedAt: iso(row.updated_at), people: row.headcount, remainingSeats,
    acceptingApplications,
    publicLocation: row.public_location, applicationDeadline: deadline,
    pickupCandidates,
    shortName: product.shortName, fullTitle: product.fullTitle, unitName: product.unitName,
    priceStatus: 'ESTIMATED', estimatedTotalAmount: product.payment.totalAmount,
    estimatedShares: estimate.settlements.map(({ member, role, quantity, amount }) => ({ member, role, quantity, amount })),
    recruitment: {
      title: acceptingApplications ? `[공구] ${product.shortName} 같이 살 ${remainingSeats}명 구해요` : `[공구] ${product.shortName} · ${availability}`,
      body: `${estimate.recruitment.body}\n수령 후보(UTC): ${pickupCandidates.join(', ')}\n${availability}`,
    },
  };
}

function ownerView(db, row, now) {
  if (row.status === 'DRAFT') return draftView(row);
  const snapshot = getAnalysis(db, row.analysis_id);
  const seatRows = seats(db, row.id);
  return {
    ...publicView(row, snapshot, seatRows, now), role: 'ORGANIZER', revision: row.revision, analysis: snapshot,
    seats: seatRows.map((seat) => ({ seatNo: seat.seat_no, userId: seat.user_id, role: seat.role, approvalSeq: seat.approval_seq })),
    applications: db.prepare('SELECT * FROM group_participation WHERE group_buy_id = ? ORDER BY requested_at, user_id').all(row.id)
      .map((entry) => applicantView(entry, seatRows.find((seat) => seat.user_id === entry.user_id))),
  };
}

export function readGroup(store, groupId, userId) {
  return store.transaction((db) => {
    const row = group(db, groupId);
    if (!row) throw missing();
    if (row.host_id === userId) return ownerView(db, row, Date.now());
    if (row.status === 'DRAFT') throw missing();
    const entry = participation(db, groupId, userId);
    if (!entry) throw missing();
    const seatRows = seats(db, groupId);
    const snapshot = getAnalysis(db, row.analysis_id);
    const view = publicView(row, snapshot, seatRows, Date.now());
    const seat = seatRows.find((current) => current.user_id === userId);
    const approved = seatRows.filter((current) => current.approval_seq !== null)
      .sort((a, b) => a.approval_seq - b.approval_seq);
    return { ...view, role: 'MEMBER', application: applicantView(entry, seat),
      estimatedShare: seat ? view.estimatedShares[1 + approved.indexOf(seat)] : null };
  }, { readOnly: true });
}

function inviteGroup(db, token, now) {
  const hash = hashToken(token);
  const row = hash && db.prepare(`SELECT g.*, i.id AS invite_id FROM group_buy g
    JOIN group_invite i ON g.id = i.group_buy_id
    WHERE i.token_hash = ? AND i.expires_at > ? AND i.revoked_at IS NULL`).get(hash, now);
  if (!row) throw new P1Error(404, 'INVITE_NOT_FOUND');
  return row;
}

export function readInvite(store, token) {
  return store.transaction((db) => {
    const now = Date.now();
    const row = inviteGroup(db, token, now);
    return publicView(row, getAnalysis(db, row.analysis_id), seats(db, row.id), now);
  }, { readOnly: true });
}

export function rotateInvite(store, groupId, userId) {
  return ownedWrite(store, groupId, userId, (db, row, now) => {
    if (!['OPEN', 'CLOSED'].includes(row.status)) throw badState();
    const invite = issueInvite(db, groupId, now);
    event(db, groupId, userId, 'INVITE_ROTATED', now);
    return invite;
  });
}

export function applyToGroup(store, inviteToken, userId, body) {
  return store.transaction((db) => {
    const now = Date.now();
    const row = inviteGroup(db, inviteToken, now);
    if (row.host_id === userId) throw new P1Error(403, 'ORGANIZER_CANNOT_APPLY');
    if (participation(db, row.id, userId)) throw new P1Error(409, 'ALREADY_APPLIED');
    if (!isOpen(row, now)) throw new P1Error(409, 'APPLICATIONS_CLOSED');
    if (!db.prepare('SELECT 1 FROM group_seat WHERE group_buy_id = ? AND user_id IS NULL LIMIT 1').get(row.id)) {
      throw new P1Error(409, 'GROUP_FULL');
    }
    const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
    if (!alias || !text(40)(alias)) throw invalid(['alias']);
    const entry = db.prepare(`INSERT INTO group_participation (group_buy_id, user_id, invite_id, alias, status, requested_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?) RETURNING *`).get(row.id, userId, row.invite_id, alias, now);
    event(db, row.id, userId, 'APPLICATION_REQUESTED', now, userId);
    return applicantView(entry);
  });
}

function decide(db, groupId, userId, actorId, status, now) {
  return db.prepare(`UPDATE group_participation SET status = ?, decided_at = ?, decided_by = ?
    WHERE group_buy_id = ? AND user_id = ? RETURNING *`).get(status, now, actorId, groupId, userId);
}

function releaseSeat(db, groupId, userId) {
  db.prepare('UPDATE group_seat SET user_id = NULL, assigned_at = NULL WHERE group_buy_id = ? AND user_id = ?')
    .run(groupId, userId);
}

export function withdraw(store, groupId, userId) {
  return store.transaction((db) => {
    const row = group(db, groupId);
    const entry = row && participation(db, groupId, userId);
    if (!entry) throw missing();
    if (entry.status === 'WITHDRAWN') return applicantView(entry);
    if (!['OPEN', 'CLOSED'].includes(row.status) || !['PENDING', 'APPROVED'].includes(entry.status)) throw badState();
    const now = Date.now();
    if (entry.status === 'APPROVED') releaseSeat(db, groupId, userId);
    const updated = decide(db, groupId, userId, userId, 'WITHDRAWN', now);
    event(db, groupId, userId, 'APPLICATION_WITHDRAWN', now, userId);
    return applicantView(updated);
  });
}

export function approve(store, groupId, hostId, applicantId) {
  return ownedWrite(store, groupId, hostId, (db, row, now) => {
    const entry = participation(db, groupId, applicantId);
    if (!entry) throw new P1Error(404, 'APPLICATION_NOT_FOUND');
    if (entry.status === 'APPROVED') return applicantView(entry, seats(db, groupId).find((seat) => seat.user_id === applicantId));
    if (entry.status !== 'PENDING' || !isOpen(row, now)) throw badState();
    const seat = db.prepare(`SELECT seat_no FROM group_seat WHERE group_buy_id = ? AND user_id IS NULL
      ORDER BY seat_no LIMIT 1`).get(groupId);
    if (!seat) throw new P1Error(409, 'GROUP_FULL');
    const updated = db.prepare(`UPDATE group_participation
      SET status = 'APPROVED', decided_at = ?, decided_by = ?, approval_seq = (
        SELECT COALESCE(MAX(approval_seq), 0) + 1 FROM group_participation WHERE group_buy_id = ?)
      WHERE group_buy_id = ? AND user_id = ? RETURNING *`).get(now, hostId, groupId, groupId, applicantId);
    db.prepare('UPDATE group_seat SET user_id = ?, assigned_at = ? WHERE group_buy_id = ? AND seat_no = ?')
      .run(applicantId, now, groupId, seat.seat_no);
    event(db, groupId, hostId, 'APPLICATION_APPROVED', now, applicantId, { seatNo: seat.seat_no, approvalSeq: updated.approval_seq });
    return applicantView(updated, seat);
  });
}

export function exclude(store, groupId, hostId, applicantId) {
  return ownedWrite(store, groupId, hostId, (db, row, now) => {
    const entry = participation(db, groupId, applicantId);
    if (!entry) throw new P1Error(404, 'APPLICATION_NOT_FOUND');
    if (!['OPEN', 'CLOSED'].includes(row.status) || !['PENDING', 'APPROVED'].includes(entry.status)) throw badState();
    const status = entry.status === 'APPROVED' ? 'EXCLUDED' : 'REJECTED';
    if (status === 'EXCLUDED') releaseSeat(db, groupId, applicantId);
    const updated = decide(db, groupId, applicantId, hostId, status, now);
    event(db, groupId, hostId, status === 'EXCLUDED' ? 'MEMBER_EXCLUDED' : 'APPLICATION_REJECTED', now, applicantId);
    return applicantView(updated);
  });
}

export function editRecruitment(store, groupId, userId, body) {
  return ownedWrite(store, groupId, userId, (db, row, now) => {
    if (!['OPEN', 'CLOSED'].includes(row.status)) throw badState();
    checkRevision(row, body?.revision);
    const input = copyInput(body, settingsShape);
    const settings = recruitmentSettings({ people: row.headcount, publicLocation: row.public_location,
      applicationDeadline: iso(row.application_deadline), pickupCandidates: JSON.parse(row.pickup_candidates).map(iso), ...input }, now);
    const { headcount, publicLocation, applicationDeadline, pickupCandidates } = settings;
    if (getAnalysis(db, row.analysis_id).product.bulkTotalQty < headcount) {
      throw invalid(['people'], 'INSUFFICIENT_ALLOCATION_UNITS');
    }
    if (row.headcount !== headcount) resizeSeats(db, row, headcount);
    const updated = db.prepare(`UPDATE group_buy SET headcount = ?, public_location = ?, application_deadline = ?,
      pickup_candidates = ?, updated_at = ?, revision = revision + 1 WHERE id = ? RETURNING *`)
      .get(headcount, publicLocation, applicationDeadline, JSON.stringify(pickupCandidates), now, groupId);
    event(db, groupId, userId, 'RECRUITMENT_EDITED', now, null, settings);
    return ownerView(db, updated, now);
  });
}

function resizeSeats(db, row, headcount) {
  const insert = db.prepare('INSERT INTO group_seat (group_buy_id, seat_no, user_id, assigned_at) VALUES (?, ?, ?, ?)');
  if (headcount > row.headcount) {
    for (let seat = row.headcount; seat < headcount; seat++) insert.run(row.id, seat, null, null);
    return;
  }
  const approved = seats(db, row.id).filter((seat) => seat.approval_seq !== null)
    .sort((a, b) => a.approval_seq - b.approval_seq);
  if (approved.length >= headcount) throw new P1Error(409, 'HEADCOUNT_BELOW_OCCUPIED');
  db.prepare('DELETE FROM group_seat WHERE group_buy_id = ? AND seat_no > 0').run(row.id);
  for (let seat = 1; seat < headcount; seat++) {
    insert.run(row.id, seat, approved[seat - 1]?.user_id ?? null, approved[seat - 1]?.assigned_at ?? null);
  }
}

export function setRecruitmentOpen(store, groupId, userId, revision, open) {
  return ownedWrite(store, groupId, userId, (db, row, now) => {
    if (row.status !== (open ? 'CLOSED' : 'OPEN')) throw badState();
    checkRevision(row, revision);
    if (open && row.application_deadline <= now) throw invalid(['applicationDeadline'], 'DEADLINE_NOT_FUTURE');
    const updated = db.prepare(`UPDATE group_buy SET status = ?, closed_at = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? RETURNING *`).get(open ? 'OPEN' : 'CLOSED', open ? null : now, now, groupId);
    event(db, groupId, userId, open ? 'RECRUITMENT_REOPENED' : 'RECRUITMENT_CLOSED', now);
    return ownerView(db, updated, now);
  });
}
