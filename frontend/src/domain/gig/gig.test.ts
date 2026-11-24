import { describe, expect, it } from 'vitest'
import { PRESETS } from '../presets'
import { execute } from './execute'
import { createGig } from './create'
import { balance, completionBlockers, latest, seatsLeft } from './select'
import { summarizeSavings } from './savings'
import { settlementShareText, statusShareText } from './shareText'
import type { Command, Gig, OrderInput } from './types'
import { inviteView } from './views'

let n = 0
let clock = Date.parse('2026-11-24T00:00:00Z')
const run = (g: Gig, userId: string, c: Command) => {
  clock += 1000
  return execute(g, c, { userId, now: new Date(clock), newId: () => `id${++n}` })
}
const code = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    return (e as { code: string }).code
  }
  return 'ok'
}
const order = (o: Partial<OrderInput> = {}): OrderInput => ({
  itemAmount: 17700, shippingFee: 0, discountAmount: 0, totalUnits: 30, orderedAt: '2026-11-25T10:00', ...o,
})

function draft(): Gig {
  const { product, reference } = PRESETS[0]!
  return createGig({
    id: 'g1', inviteCode: 'code1', hostId: 'H', now: new Date(clock),
    product: { ...product, priceConfirmed: true }, reference,
    plan: { headcount: 4, place: '학교 정문', deadline: null, applyMethod: '' }, step: 3,
  })
}
const recruiting = () => run(draft(), 'H', { type: 'publish', hostAlias: '방장이' })
const pid = (g: Gig, u: string) => g.participants.find((p) => p.userId === u)!.id
const join = (g: Gig, u: string) => {
  const a = run(g, u, { type: 'apply', alias: u })
  return run(a, 'H', { type: 'approve', participantId: pid(a, u) })
}
const full = () => ['A', 'B', 'C'].reduce(join, recruiting())
const settling = (o = order()) => run(run(full(), 'H', { type: 'close' }), 'H', { type: 'confirmOrder', order: o })
const pay = (g: Gig, u: string, amount: number, id = `pay-${++n}`) =>
  run(g, 'H', { type: 'confirmPayment', commandId: id, participantId: pid(g, u), amount })
const pickup = (g: Gig) => run(g, 'H', { type: 'startPickup', place: '학교 정문', at: null })
const doneGig = () => {
  let g = pickup(settling())
  for (const u of ['A', 'B', 'C']) g = run(pay(g, u, 4130), 'H', { type: 'setPickedUp', participantId: pid(g, u), done: true })
  return run(g, 'H', { type: 'complete' })
}

describe('모집 (F-15)', () => {
  it('중복 신청과 정원 초과 승인을 막는다', () => {
    const g = full()
    expect(seatsLeft(g)).toBe(0)
    expect(code(() => run(g, 'A', { type: 'apply', alias: 'A2' }))).toBe('duplicate')
    const more = run(g, 'D', { type: 'apply', alias: 'D' })
    expect(code(() => run(more, 'H', { type: 'approve', participantId: pid(more, 'D') }))).toBe('full')
  })
  it('방장이 아니면 관리할 수 없다', () => {
    const g = run(recruiting(), 'A', { type: 'apply', alias: 'A' })
    for (const c of [
      { type: 'approve', participantId: pid(g, 'A') }, { type: 'close' }, { type: 'cancel', reason: 'x' },
      { type: 'refund', commandId: 'r', participantId: pid(g, 'A'), amount: 1 },
    ] as Command[]) expect(code(() => run(g, 'A', c))).toBe('forbidden')
  })
  it('철회하면 자리가 비고 같은 행으로 다시 신청한다', () => {
    let g = run(full(), 'B', { type: 'withdraw' })
    expect(seatsLeft(g)).toBe(1)
    g = run(g, 'B', { type: 'apply', alias: 'B' })
    expect(g.participants.filter((p) => p.userId === 'B')).toHaveLength(1)
  })
  it('제외된 사람은 다시 신청할 수 없다', () => {
    let g = full()
    g = run(g, 'H', { type: 'exclude', participantId: pid(g, 'A') })
    expect(code(() => run(g, 'A', { type: 'apply', alias: 'A' }))).toBe('excluded')
  })
  it('마감이 지나면 신청할 수 없다', () => {
    const g = { ...recruiting(), plan: { headcount: 4, place: null, deadline: '2020-01-01T00:00', applyMethod: '' } }
    expect(code(() => run(g, 'A', { type: 'apply', alias: 'A' }))).toBe('deadline')
  })
  it('승인 인원보다 적게 줄일 수 없고, 바꾸면 수정 시각을 남긴다', () => {
    expect(code(() => run(full(), 'H', { type: 'editConditions', conditions: { headcount: 3 } }))).toBe('headcount')
    const g = run(join(recruiting(), 'A'), 'H', { type: 'editConditions', conditions: { headcount: 3 } })
    expect(g.conditionsEditedAt).not.toBeNull()
  })
  it('승인자가 없으면 마감할 수 없고, 마감 뒤 다시 모집할 수 있다', () => {
    expect(code(() => run(recruiting(), 'H', { type: 'close' }))).toBe('noMembers')
    const g = run(run(full(), 'H', { type: 'close' }), 'H', { type: 'reopen' })
    expect(g.status).toBe('recruiting')
  })
})

describe('주문·정산 버전 (F-16)', () => {
  it('예상과 같으면 재확인이 필요 없다', () => {
    const v = latest(settling())!
    expect(v.needsConfirm).toEqual([])
    expect(v.shares.map((s) => s.amount)).toEqual([5310, 4130, 4130, 4130])
    expect(v.shares.map((s) => s.saved)).toEqual([6390, 4970, 4970, 4970])
  })
  it('금액이 다르면 재확인 전까지 입금 확인과 수령을 막는다', () => {
    let g = settling(order({ shippingFee: 3000 }))
    expect(latest(g)!.needsConfirm).toHaveLength(3)
    expect(code(() => pay(g, 'A', 100))).toBe('needsConfirm')
    expect(code(() => pickup(g))).toBe('needsConfirm')
    expect(code(() => run(g, 'A', { type: 'confirmShare', version: 9 }))).toBe('stale')
    for (const u of ['A', 'B', 'C']) g = run(g, u, { type: 'confirmShare', version: 1 })
    expect(pickup(g).status).toBe('pickup')
  })
  it('목표보다 적은 인원으로 확정하면 모두 재확인받는다', () => {
    const g = run(run(['A', 'B'].reduce(join, recruiting()), 'H', { type: 'close' }), 'H', { type: 'confirmOrder', order: order() })
    expect(latest(g)!.shares.map((s) => s.units)).toEqual([10, 10, 10])
    expect(latest(g)!.needsConfirm).toHaveLength(2)
  })
  it('확정 뒤 변경은 이전 버전과 입금 이력을 보존한다', () => {
    let g = pay(settling(), 'A', 4130)
    const before = structuredClone(g.settlements[0])
    g = run(g, 'H', { type: 'revise', order: order({ itemAmount: 14700 }), removeParticipantIds: [], reason: '부분 환불' })
    expect(g.settlements[0]).toEqual(before)
    expect(latest(g)!.version).toBe(2)
    expect(g.payments).toHaveLength(1)
    expect(balance(g, pid(g, 'A')).remaining).toBe(latest(g)!.shares[1]!.amount - 4130)
  })
  it('참여자가 빠지면 받은 돈은 환불 대상이 된다', () => {
    let g = pay(settling(), 'A', 4130)
    const a = pid(g, 'A')
    g = run(g, 'H', { type: 'revise', order: order(), removeParticipantIds: [a], reason: 'A 취소' })
    expect(latest(g)!.shares).toHaveLength(3)
    expect(balance(g, a).remaining).toBe(-4130)
    expect(code(() => run(g, 'H', { type: 'refund', commandId: 'r1', participantId: a, amount: 5000 }))).toBe('tooMuch')
    g = run(g, 'H', { type: 'refund', commandId: 'r1', participantId: a, amount: 4130 })
    expect(balance(g, a).remaining).toBe(0)
  })
})

describe('송금 (F-17)', () => {
  it('같은 명령은 한 번만 기록한다', () => {
    let g = pay(settling(), 'A', 2000, 'same')
    g = pay(g, 'A', 2000, 'same')
    expect(g.payments).toHaveLength(1)
    expect(balance(g, pid(g, 'A')).remaining).toBe(2130)
  })
  it('다 받은 뒤 또 확인하면 막는다', () => {
    const g = pay(settling(), 'A', 4130)
    expect(code(() => pay(g, 'A', 4130))).toBe('alreadyPaid')
  })
  it('송금 표시는 입금으로 치지 않는다', () => {
    let g = settling()
    g = run(g, 'A', { type: 'reportPayment', commandId: 'x', amount: 4130 })
    expect(balance(g, pid(g, 'A'))).toMatchObject({ reported: 4130, received: 0, remaining: 4130 })
  })
})

describe('수령·완료·취소 (F-18)', () => {
  it('수령과 입금이 정리돼야 완료된다', () => {
    const g = pickup(settling())
    expect(completionBlockers(g).length).toBeGreaterThan(0)
    expect(code(() => run(g, 'H', { type: 'complete' }))).toBe('blocked')
    expect(doneGig().status).toBe('done')
  })
  it('해결하지 않은 문제가 있으면 완료할 수 없다', () => {
    let g = pickup(settling())
    for (const u of ['A', 'B', 'C']) g = run(pay(g, u, 4130), 'H', { type: 'setPickedUp', participantId: pid(g, u), done: true })
    g = run(g, 'H', { type: 'openIssue', kind: 'noShow', key: pid(g, 'A'), reason: '연락 없음' })
    expect(code(() => run(g, 'H', { type: 'complete' }))).toBe('blocked')
    g = run(g, 'H', { type: 'resolveIssue', issueId: g.issues[0]!.id, followUp: '다음 날 전달' })
    expect(run(g, 'H', { type: 'complete' }).status).toBe('done')
  })
  it('취소해도 받은 금액의 환불을 추적한다', () => {
    let g = pay(settling(), 'A', 4130)
    g = run(g, 'H', { type: 'cancel', reason: '품절' })
    expect(balance(g, pid(g, 'A')).remaining).toBe(-4130)
    g = run(g, 'H', { type: 'refund', commandId: 'r', participantId: pid(g, 'A'), amount: 4130 })
    expect(balance(g, pid(g, 'A')).remaining).toBe(0)
  })
  it('완료한 공구는 취소할 수 없다', () => {
    expect(code(() => run(doneGig(), 'H', { type: 'cancel', reason: 'x' }))).toBe('badStatus')
  })
})

describe('저금통 (F-08)', () => {
  it('본인 몫만, 공구마다 한 번 합산한다', () => {
    const g = doneGig()
    expect(summarizeSavings([g, g], 'H').total).toBe(6390)
    expect(summarizeSavings([g], 'A').total).toBe(4970)
    expect(summarizeSavings([g], 'Z').entries).toEqual([])
    expect(summarizeSavings([settling()], 'H').total).toBe(0)
  })
  it('정정하면 다시 더하지 않고 바뀐 값으로 계산한다', () => {
    let g = doneGig()
    g = run(g, 'H', { type: 'revise', order: order({ itemAmount: 14700 }), removeParticipantIds: [], reason: '부분 환불' })
    expect(summarizeSavings([g], 'H')).toMatchObject({ total: 0, entries: [{ pending: true }] })
    for (const u of ['A', 'B', 'C']) {
      g = run(g, u, { type: 'confirmShare', version: 2 })
      const back = -balance(g, pid(g, u)).remaining
      g = run(g, 'H', { type: 'refund', commandId: `rf-${u}`, participantId: pid(g, u), amount: back })
    }
    expect(summarizeSavings([g], 'H').total).toBe(9 * 1300 - 4410)
  })
})

describe('권한별 보기와 공유문', () => {
  it('초대 링크로는 다른 참여자 정보를 볼 수 없다', () => {
    const g = pickup(pay(settling(), 'B', 4130))
    const text = JSON.stringify(inviteView(g, 'A', new Date(clock)))
    expect(text).not.toContain('"B"')
    expect(text).not.toContain(pid(g, 'B'))
    const outsider = inviteView(g, 'Z', new Date(clock))
    expect(outsider.me).toBeNull()
    expect(JSON.stringify(outsider)).not.toMatch(/"pickup":|"balance":|"share":/)
    expect(inviteView(g, 'A', new Date(clock)).me).toMatchObject({ share: { amount: 4130 }, pickup: { place: '학교 정문' } })
  })
  it('확정 뒤에는 실제 금액으로 절감률을 보여준다', () => {
    const g = settling(order({ shippingFee: 3000 }))
    expect(inviteView(g, 'A', new Date(clock)).savingsRate?.toFixed(1)).toBe('46.9')
  })
  it('정산 공유문에는 별칭만 담긴다', () => {
    const t = settlementShareText(settling())!
    for (const s of ['17,700원', '방장이(방장): 9롤, 5,310원', 'A: 7롤, 4,130원', '수령 장소: 학교 정문']) expect(t).toContain(s)
  })
  it('닫힌 공구는 상태를 알린다', () => {
    expect(statusShareText(run(full(), 'H', { type: 'close' }), 'L')).toContain('모집을 마감')
    expect(statusShareText(run(full(), 'H', { type: 'cancel', reason: '품절' }), 'L')).toContain('취소')
  })
})
