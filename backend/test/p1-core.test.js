import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/server.js';

const serverUrl = new URL('../src/server.js', import.meta.url);
const fixture = () => ({
  people: 3, publicLocation: '학생회관 로비',
  applicationDeadline: new Date(Date.now() + 86_400_000).toISOString(),
  pickupCandidates: [new Date(Date.now() + 172_800_000).toISOString()],
  inputOrigin: 'CAPTURE', allocationMode: 'SEALED_PACKAGE', priceConfirmed: true,
  product: { shortName: '롤휴지', fullTitle: '3겹 롤휴지 30롤', bulkTotalQty: 30, unitName: '롤', allocationStep: 1,
    uniformUnits: true, payment: { productAmount: 17701, shippingFee: 0, discountAmount: 0,
      includesShipping: false, includesDiscount: false, isEstimate: false } },
});

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gigsplitter-p1-'));
  if (t) t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function start(path) {
  const app = createApp({ p1DbPath: path });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return { url: `http://127.0.0.1:${app.address().port}`, close: () => new Promise((resolve, reject) =>
    app.close((error) => error ? reject(error) : resolve())) };
}

async function startProcess(t, dir, path) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { createApp } from ${JSON.stringify(serverUrl.href)};
    const app = createApp(); app.listen(0, '127.0.0.1', () => process.send(app.address().port));
    process.on('disconnect', () => app.close());`], {
    cwd: dir, env: { ...process.env, P1_DB_PATH: path ?? '' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.connected) child.disconnect(); await exited; });
  const port = await Promise.race([once(child, 'message').then(([value]) => value), exited.then(() => { throw new Error('child exited early'); })]);
  return `http://127.0.0.1:${port}`;
}

async function request(url, method, path, { token, body, headers } = {}) {
  const response = await fetch(url + '/api/' + path, { method, headers: {
    ...headers, ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }),
  }, body: body && JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

const p1 = (url, method, path, args) => request(url, method, `p1/${path}`, args);
async function expect(result, status, code) {
  const reply = await result;
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  if (code) assert.equal(reply.body.code, code);
  return reply.body;
}

async function signup(url, name) {
  const body = { email: `${name}@example.test`, password: 'local-test-passphrase', displayName: name };
  await expect(p1(url, 'POST', 'auth/register', { body }), 201);
  return expect(p1(url, 'POST', 'auth/login', { body }), 200);
}

async function openGroup(url, token, input = fixture()) {
  const draft = await expect(p1(url, 'POST', 'groups', { token, body: { input } }), 201);
  return expect(p1(url, 'POST', `groups/${draft.id}/publish`, { token, body: { revision: draft.revision } }), 200);
}

const apply = (url, invite, user) => p1(url, 'POST', `invites/${invite}/applications`, { token: user.token, body: { alias: user.user.displayName } });
const decide = (url, group, host, user, action) => p1(url, 'POST', `groups/${group}/applications/${user.user.id}/${action}`, { token: host.token });

test('P1 미설정 프로세스에서 P0 분석·프리셋은 동작하고 DB는 생기지 않는다', async (t) => {
  const dir = await directory();
  const url = await startProcess(t, dir);
  t.after(() => rm(dir, { recursive: true, force: true }));
  await expect(p1(url, 'GET', 'groups'), 404);
  await expect(request(url, 'GET', 'presets'), 200);
  const input = fixture();
  const result = await expect(request(url, 'POST', 'analyses', { body: input }), 200);
  assert.equal(result.settlements.reduce((sum, row) => sum + row.amount, 0), 17701);
  assert.deepEqual(await readdir(dir), []);
});

test('SQLite 재개: 소유자만 조회/목록/삭제, 이전 revision은 거절, P0 입력만 저장', async (t) => {
  const dir = await directory(t);
  const path = join(dir, 'p1.sqlite');
  const first = await start(path);
  const { host, stranger, saved } = await (async () => {
    try {
      const host = await signup(first.url, 'host');
      const stranger = await signup(first.url, 'stranger');
      const draft = await expect(p1(first.url, 'POST', 'groups', { token: host.token, body: { input: {} } }), 201);
      const saved = await expect(p1(first.url, 'PUT', `groups/${draft.id}`, { token: host.token,
        body: { revision: 1, input: { ...fixture(), image: 'raw-image', modelResponse: 'raw-model' } } }), 200);
      assert.equal(saved.revision, 2);
      assert.equal(saved.input.image, undefined);
      assert.equal(saved.input.modelResponse, undefined);
      await expect(p1(first.url, 'PUT', `groups/${draft.id}`, { token: host.token, body: { revision: 1, input: {} } }), 409, 'REVISION_CONFLICT');
      return { host, stranger, saved };
    } finally { await first.close(); }
  })();
  const { url, close } = await start(path);
  try {
    await expect(p1(url, 'GET', `groups/${saved.id}`, { headers: { 'X-User-Id': host.user.id } }), 401, 'AUTH_REQUIRED');
    await expect(p1(url, 'GET', `groups/${saved.id}`, { token: stranger.token }), 404);
    await expect(p1(url, 'DELETE', `groups/${saved.id}`, { token: stranger.token, body: { revision: 2 } }), 404);
    assert.deepEqual((await expect(p1(url, 'GET', 'groups', { token: stranger.token }), 200)).groups, []);
    assert.equal((await expect(p1(url, 'GET', 'groups', { token: host.token }), 200)).groups[0].id, saved.id);
    assert.deepEqual(await expect(p1(url, 'GET', `groups/${saved.id}`, { token: host.token }), 200), saved);
    await expect(p1(url, 'DELETE', `groups/${saved.id}`, { token: host.token, body: { revision: 1 } }), 409, 'REVISION_CONFLICT');
    await expect(p1(url, 'DELETE', `groups/${saved.id}`, { token: host.token, body: { revision: 2 } }), 204);
    await expect(p1(url, 'GET', `groups/${saved.id}`, { token: host.token }), 404);
  } finally { await close(); }
});

test('밀봉과 실제 확인 가격만 게시하며 모집 견적과 P0 계산을 분리한다', async (t) => {
  const path = join(await directory(t), 'p1.sqlite');
  const { url, close } = await start(path);
  try {
    const host = await signup(url, 'host');
    const input = fixture();
    const draft = await expect(p1(url, 'POST', 'groups', { token: host.token, body: { input: { ...input, allocationMode: 'DIRECT' } } }), 201);
    const command = (method, path, body) => p1(url, method, `groups/${draft.id}${path}`, { token: host.token, body });
    await expect(command('POST', '/publish', { revision: 1 }), 422, 'SEALED_PACKAGES_ONLY');
    await expect(command('PUT', '', { revision: 1, input: { ...input, priceConfirmed: false } }), 200);
    await expect(command('POST', '/publish', { revision: 2 }), 422, 'VERIFIED_PRICE_REQUIRED');
    input.people = 4;
    input.product.comparisonSpec = { compatibilityKey: '동일 규격', unit: 'cm', amountPerUnit: 3000 };
    input.product.comparisonBaseline = { quantity: 6, unitName: '롤', price: 7800, spec: input.product.comparisonSpec,
      source: { kind: 'USER_INPUT', reference: { kind: 'LINK', value: 'https://example.test/private-reference' } } };
    await expect(command('PUT', '', { revision: 2, input }), 200);
    const published = await expect(command('POST', '/publish', { revision: 3 }), 200);
    assert.equal(published.analysis.product.payment.isEstimate, false);
    assert.equal(published.analysis.bulkSpecBaseAmount, 30000);
    assert.equal(published.analysis.comparisonStatus, 'READY');
    assert.equal(published.priceStatus, 'ESTIMATED');
    const p0 = await expect(request(url, 'POST', 'analyses', { body: input }), 200);
    assert.deepEqual(published.estimatedShares.map(({ amount }) => amount), p0.settlements.map(({ amount }) => amount));
    assert.deepEqual(published.estimatedShares.map(({ amount }) => amount), [5311, 4130, 4130, 4130]);
    const publicView = await expect(p1(url, 'GET', `invites/${published.inviteToken}`), 200);
    assert.equal(publicView.analysis, undefined);
    assert.equal(publicView.publicLocation, '학생회관 로비');
    assert.ok(!JSON.stringify(publicView).includes('private-reference'));
    await expect(command('PUT', '', { revision: 4, input: {} }), 409, 'INVALID_GROUP_STATE');
    await expect(command('DELETE', '', { revision: 4 }), 409, 'INVALID_GROUP_STATE');
  } finally { await close(); }
});

test('두 서버 프로세스의 마지막 자리 승인, 중복, 타인 접근, 마감 및 빈자리 재배정', async (t) => {
  const dir = await directory();
  const path = join(dir, 'p1.sqlite');
  const url = await startProcess(t, dir, path);
  const other = await startProcess(t, dir, path);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [host, a, b, c] = await Promise.all(['host', 'a', 'b', 'c'].map((name) => signup(url, name)));
  const group = await openGroup(url, host.token);
  const invite = group.inviteToken;
  await expect(p1(url, 'POST', `invites/${invite}/applications`, { body: { alias: 'anon' } }), 401);
  for (const user of [a, b, c]) await expect(apply(url, invite, user), 201);
  await expect(apply(other, invite, a), 409, 'ALREADY_APPLIED');
  const first = await expect(decide(url, group.id, host, a, 'approve'), 200);
  assert.equal(first.seatNo, 1);
  await expect(decide(url, group.id, a, b, 'approve'), 404);
  const results = await Promise.all([decide(url, group.id, host, b, 'approve'), decide(other, group.id, host, c, 'approve')]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? b : c;
  const loser = winner === b ? c : b;
  const [success, denied] = [results.find(({ status }) => status === 200), results.find(({ status }) => status === 409)];
  assert.equal(success.body.seatNo, 2);
  assert.equal(success.body.approvalSeq, 2);
  assert.equal(denied.body.code, 'GROUP_FULL');
  assert.deepEqual(await expect(decide(other, group.id, host, winner, 'approve'), 200), success.body);
  const privateView = await expect(p1(url, 'GET', `groups/${group.id}`, { token: winner.token }), 200);
  assert.equal(privateView.application.userId, winner.user.id);
  assert.equal(privateView.seats, undefined);
  assert.equal(privateView.applications, undefined);
  assert.equal(privateView.remainingSeats, 0);
  const resize = (revision, people) => p1(url, 'PATCH', `groups/${group.id}/recruitment`, { token: host.token, body: { revision, people } });
  await expect(resize(group.revision, 2), 409, 'HEADCOUNT_BELOW_OCCUPIED');
  const closed = await expect(p1(url, 'POST', `groups/${group.id}/close`, { token: host.token, body: { revision: group.revision } }), 200);
  await expect(decide(url, group.id, host, loser, 'approve'), 409, 'INVALID_GROUP_STATE');
  await expect(decide(url, group.id, host, a, 'exclude'), 200);
  const resized = await expect(resize(closed.revision, 2), 200);
  assert.equal(resized.seats[1].userId, winner.user.id);
  assert.equal(resized.seats[1].approvalSeq, 2);
  const expanded = await expect(resize(resized.revision, 4), 200);
  await expect(p1(url, 'POST', `groups/${group.id}/reopen`, { token: host.token, body: { revision: expanded.revision } }), 200);
  const next = await expect(decide(other, group.id, host, loser, 'approve'), 200);
  assert.equal(next.seatNo, 2);
  assert.equal(next.approvalSeq, 3);
  await expect(p1(other, 'POST', `groups/${group.id}/withdraw`, { token: loser.token }), 200);
  await expect(apply(url, invite, loser), 409, 'ALREADY_APPLIED');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_seat WHERE group_buy_id = ? AND user_id IS NOT NULL').get(group.id).n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM group_buy_event WHERE kind = 'APPLICATION_APPROVED'").get().n, 3);
  } finally { db.close(); }
});

test('v1 파일 업그레이드와 HTTP 정산 확정·원장·재완료·과거 링크·취소 환불', async (t) => {
  const path = join(await directory(t), 'p1.sqlite');
  const initial = await readFile(new URL('../src/p1/001-initial.sql', import.meta.url), 'utf8');
  const old = new DatabaseSync(path);
  try {
    old.exec(`${initial}\nPRAGMA user_version = 1;`);
    old.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), 'legacy@example.test', 'legacy', Buffer.alloc(16), Buffer.alloc(64), Date.now());
  } finally { old.close(); }
  const { url, close } = await start(path);
  try {
    const [host, a, b, stranger] = await Promise.all(['host', 'a', 'b', 'stranger'].map((name) => signup(url, name)));
    const spec = { compatibilityKey: '같은 규격 3겹', unit: 'm', amountPerUnit: 30 };
    const input = fixture();
    input.product.payment.productAmount = 17700;
    input.product.comparisonSpec = spec;
    input.product.comparisonBaseline = { quantity: 6, unitName: '롤', price: 7800, spec,
      source: { kind: 'USER_INPUT', reference: { kind: 'LINK', value: 'https://example.test/private-comparison' } } };
    const published = await openGroup(url, host.token, input);
    const group = `groups/${published.id}`;
    const post = (path, body = {}, user = host) => p1(url, 'POST', `${group}/${path}`, { token: user.token, body });
    const get = (path, user = host) => p1(url, 'GET', `${group}${path ? `/${path}` : ''}`, { token: user.token });
    const savings = (user) => expect(p1(url, 'GET', 'savings', { token: user.token }), 200);
    const sendEvent = (type, user, data, versionNo = 1) => ({
      type, requestKey: randomUUID(), versionNo, userId: user.user.id, ...data,
    });
    const append = (event, actor = host) => post('settlement/events', event, actor);
    const pay = (user, amount, versionNo = 1) => append(sendEvent('TRANSFER_CONFIRMED', user, { amount }, versionNo));
    const refund = (user, amount, versionNo = 1) => append(sendEvent('REFUND_CONFIRMED', user, { amount }, versionNo));
    const receive = (user, quantity, versionNo = 1) => append(sendEvent('RECEIVED', user, { quantity, unitName: '롤' }, versionNo));
    for (const result of await Promise.all([apply(url, published.inviteToken, a), apply(url, published.inviteToken, b)])) {
      await expect(result, 201);
    }
    for (const member of [b, a]) await expect(decide(url, published.id, host, member, 'approve'), 200);
    const closed = await expect(post('close', { revision: published.revision }), 200);
    const terms = { revision: closed.revision, priceConfirmed: true, quantity: 30, hostAlias: '방울',
      orderAt: new Date(Date.now() - 1000).toISOString(), pickupAt: input.pickupCandidates[0],
      payment: { ...input.product.payment, productAmount: 17701 }, account: 'private-bank-payload' };
    await expect(post('settlement/candidate', { ...terms, allocationMode: 'DIRECT' }), 422, 'SEALED_PACKAGES_ONLY');
    await expect(post('settlement/candidate', terms, stranger), 404);
    const candidate = await expect(post('settlement/candidate', terms), 200);
    assert.equal(candidate.priceDifference, 1);
    assert.deepEqual(candidate.lines.map(({ userId, amount }) => [userId, amount]),
      [[host.user.id, 5901], [b.user.id, 5900], [a.user.id, 5900]]);
    const proposal = await expect(get('settlement/1', a), 200);
    assert.equal(proposal.priceDifference, 1);
    assert.equal(proposal.line.userId, a.user.id);
    assert.ok(!JSON.stringify(proposal).includes(b.user.id));
    await expect(get('settlement/1', stranger), 404);
    await expect(p1(url, 'GET', `${group}/settlement/1`), 401);
    await expect(post('settlement/1/confirm'), 409, 'RECONFIRMATION_REQUIRED');
    await expect(pay(a, 5900), 409);
    await expect(post('settlement/1/reconfirm', {}, a), 200);
    await expect(post('settlement/1/reconfirm', {}, a), 200);
    await expect(post('settlement/1/confirm'), 409, 'RECONFIRMATION_REQUIRED');
    await expect(post('settlement/1/reconfirm', {}, b), 200);
    const v1 = await expect(post('settlement/1/confirm'), 200);
    assert.ok(v1.confirmedAt);
    const share = await expect(get('settlement/1/kakao'), 200);
    assert.match(share.text, /총 17,701원[\s\S]+방울: 10롤 · 5,901원[\s\S]+학생회관 로비/u);
    assert.doesNotMatch(share.text, /private-|email|입금|환불/u);
    await expect(get('settlement/1/kakao', a), 404);

    const reported = await expect(append(sendEvent('TRANSFER_REPORTED', b, { amount: 2000 }), a), 200);
    assert.equal(reported.userId, a.user.id, 'a report cannot target a different member');
    const own = await expect(get('settlement/1', a), 200);
    assert.equal(own.balance.netPaid, 0);
    await expect(append(sendEvent('TRANSFER_CONFIRMED', a, { amount: 2000 }), b), 404);
    const partial = sendEvent('TRANSFER_CONFIRMED', a, { amount: 2000, relatedEventId: reported.id });
    const paid = await expect(append(partial), 200);
    assert.deepEqual(await expect(append(partial), 200), paid);
    await expect(append({ ...partial, amount: 2001 }), 409, 'REQUEST_KEY_CONFLICT');
    await expect(append({ ...partial, requestKey: randomUUID() }), 422, 'INVALID_TRANSFER_REPORT_LINK');
    const reversal = sendEvent('REVERSAL', a, { relatedEventId: paid.id });
    await expect(append(reversal), 200);
    await expect(append({ ...reversal, requestKey: randomUUID() }), 422, 'INVALID_EVENT_REVERSAL');
    await expect(pay(a, 2000), 200);
    assert.equal((await expect(get('settlement/1', a), 200)).balance.paymentStatus, 'PARTIALLY_PAID');
    await expect(pay(b, 5900), 200);
    await expect(post('settlement/pickup'), 200);
    for (const member of [host, b]) await expect(receive(member, 10), 200);
    const incorrect = await expect(receive(a, 9), 200);
    await expect(post('settlement/complete'), 409, 'SETTLEMENT_INCOMPLETE');
    await expect(pay(a, 3900), 200);
    await expect(post('settlement/complete'), 409, 'SETTLEMENT_INCOMPLETE');
    await expect(append(sendEvent('REVERSED', a, { relatedEventId: incorrect.id })), 200);
    await expect(receive(a, 10), 200);
    await expect(post('settlement/complete'), 200);
    assert.deepEqual((await savings(a)).records.map(({ sourceVersionNo, numerator, denominator }) =>
      [sourceVersionNo, numerator, denominator]), [[1, '7100', '1']]);
    assert.equal((await savings(host)).numerator, '7099');
    assert.deepEqual(await savings(stranger), { records: [], numerator: '0', denominator: '1' });
    await expect(p1(url, 'GET', `savings/${a.user.id}`, { token: stranger.token }), 404);

    const credit = sendEvent('MERCHANT_REFUND_CONFIRMED', host, { amount: 1000 });
    await expect(append(credit), 200);
    assert.deepEqual((await savings(a)).records, []);
    const revise = async (more = {}) => expect(post('settlement/candidate', {
      ...terms, revision: (await expect(get(), 200)).revision, reason: 'CORRECTION', ...more,
    }), 200);
    const correction = await revise();
    assert.equal(correction.finalTotal, 16701);
    await expect(post('settlement/2/confirm'), 409, 'RECONFIRMATION_REQUIRED');
    for (const member of [a, b]) await expect(post('settlement/2/reconfirm', {}, member), 200);
    await expect(post('settlement/2/confirm'), 200);
    const history = await expect(get('settlement/1', a), 200);
    assert.equal(history.line.amount, 5900);
    assert.equal(history.readOnly, true);
    assert.equal(history.latestPath, `/api/p1/${group}/settlement/2`);
    assert.equal(history.balance, undefined);
    assert.deepEqual((await expect(get('settlement/1'), 200)).snapshot, v1);
    assert.deepEqual(await expect(get('settlement/1/kakao'), 200), share);
    await expect(get('settlement/2', stranger), 404);
    for (const member of [a, b]) await expect(refund(member, 333, 2), 200);
    const action = await expect(post('settlement/action', { kind: 'NO_SHOW', userId: b.user.id }), 200);
    await expect(post('settlement/pickup'), 200);
    await expect(post('settlement/complete'), 409, 'SETTLEMENT_INCOMPLETE');
    await expect(post('settlement/resolve', { id: action.id }, a), 404);
    await expect(post('settlement/resolve', { id: action.id }), 200);
    await expect(post('settlement/complete'), 200);
    assert.deepEqual((await savings(a)).records.map(({ sourceVersionNo, actualNetCost, numerator }) =>
      [sourceVersionNo, actualNetCost, numerator]), [[2, 5567, '7433']]);

    const exclusion = await revise({ excludeUserIds: [b.user.id] });
    assert.equal(exclusion.versionNo, 3);
    await expect(get('settlement/3', b), 404);
    await expect(post('settlement/3/reconfirm', {}, b), 404);
    await expect(post('settlement/3/reconfirm', {}, a), 200);
    await expect(post('settlement/3/confirm'), 200);
    const added = (await expect(get('settlement/3', a), 200)).balance;
    assert.deepEqual([added.due, added.paymentStatus], [2783, 'ADDITIONAL_DUE']);
    const excluded = await expect(get('settlement/2', b), 200);
    assert.equal(excluded.latestPath, null);
    assert.equal(excluded.balance.due, -5567);
    assert.ok(excluded.events.every(({ userId }) => userId === b.user.id));
    await expect(post('settlement/cancel', { reason: 'ORDER_CANCELLED' }), 200);
    await expect(pay(a, 2783, 3), 409);
    await expect(refund(b, 5567, 2), 200);
    await expect(refund(a, 5567, 3), 200);
    assert.equal((await expect(get('settlement/2', b), 200)).balance.due, 0);
    await expect(post('settlement/complete'), 409);
    assert.deepEqual((await savings(a)).records, []);
    assert.equal((await expect(p1(url, 'GET', `invites/${published.inviteToken}`), 200)).status, 'CANCELLED');

    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
      assert.ok(db.prepare('SELECT 1 FROM users WHERE email = ?').get('legacy@example.test'));
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM saving_record WHERE group_buy_id=?').get(published.id).n, 3);
      assert.throws(() => db.prepare('DELETE FROM settlement_version WHERE group_buy_id=? AND version_no=1')
        .run(published.id), /immutable settlement version/u);
      assert.throws(() => db.prepare('UPDATE settlement_event SET data_json=? WHERE event_id=?')
        .run('{}', paid.id), /immutable settlement event/u);
      assert.ok(!db.prepare('SELECT candidate_json FROM settlement_version WHERE group_buy_id=? AND version_no=1')
        .get(published.id).candidate_json.includes('private-bank-payload'));
    } finally { db.close(); }
  } finally { await close(); }
});
