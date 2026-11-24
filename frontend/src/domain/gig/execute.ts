import { compare } from '../comparison'
import { draftProblems, isPositiveInt, paymentTotal, totalUnits } from '../product'
import { allocateUnits, MAX_HEADCOUNT, MIN_HEADCOUNT, splitAmount } from '../settlement'
import type { ProductDraft } from '../types'
import { aliasOf, approved, balance, completionBlockers, deadlinePassed, estimate, latest, orderTotal, seatsLeft, unconfirmed } from './select'
import { GigError, ISSUE_LABEL, type Command, type Gig, type GigStatus, type OrderInput, type SettlementVersion, type ShareRow } from './types'

export interface Context {
  userId: string
  now: Date
  newId: () => string
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const fail = (code: string, message: string): never => {
  throw new GigError(code, message)
}

function requireStatus(g: Gig, ...allowed: GigStatus[]) {
  if (!allowed.includes(g.status)) fail('badStatus', '지금 상태에서는 할 수 없어요. 화면을 새로 확인해 주세요.')
}

const HOST_ONLY = new Set<Command['type']>([
  'publish', 'approve', 'exclude', 'editConditions', 'close', 'reopen', 'confirmOrder', 'revise',
  'confirmPayment', 'refund', 'startPickup', 'setPickedUp', 'openIssue', 'resolveIssue', 'complete', 'cancel',
])

/**
 * 공구 한 건에 명령을 적용해 새 상태를 돌려준다. 규칙에 어긋나면 GigError 를 던지고 아무것도 바꾸지 않는다.
 * 같은 commandId 의 입금·환불은 한 번만 기록한다.
 */
export function execute(gig: Gig, command: Command, ctx: Context): Gig {
  if (HOST_ONLY.has(command.type) && gig.hostId !== ctx.userId) {
    fail('forbidden', '방장만 할 수 있어요.')
  }
  const g: Gig = structuredClone(gig)
  const at = ctx.now.toISOString()
  const isHost = g.hostId === ctx.userId
  const mine = g.participants.find((p) => p.userId === ctx.userId)
  const by = isHost ? g.hostAlias : (mine?.alias ?? '참여자')
  const log = (text: string, who = by) => g.log.push({ at, by: who, text })
  const participant = (id: string) =>
    g.participants.find((p) => p.id === id) ?? fail('notFound', '참여자를 찾을 수 없어요.')
  const amountOk = (n: number) => {
    if (!isPositiveInt(n)) fail('badAmount', '금액은 1원 이상의 정수로 입력하세요.')
  }

  switch (command.type) {
    case 'publish': {
      requireStatus(g, 'draft')
      if (!command.hostAlias.trim()) fail('alias', '참여자에게 보일 별칭을 입력하세요.')
      if (Object.keys(draftProblems(g.product)).length) fail('incomplete', '상품 값을 먼저 확인해 주세요.')
      if (!estimate(g).ok) fail('incomplete', '지금 인원으로는 나눌 수 없어요. 인원이나 수량을 확인해 주세요.')
      if (deadlinePassed(g, ctx.now)) fail('deadline', '모집 마감이 이미 지났어요. 마감을 다시 정해 주세요.')
      g.hostAlias = command.hostAlias.trim()
      g.status = 'recruiting'
      log('모집을 시작했어요.', g.hostAlias)
      break
    }
    case 'apply': {
      if (g.status !== 'recruiting') fail('notRecruiting', '모집이 끝난 공구예요.')
      if (isHost) fail('host', '방장은 이미 포함되어 있어요.')
      if (deadlinePassed(g, ctx.now)) fail('deadline', '신청 마감이 지났어요.')
      const alias = command.alias.trim()
      if (!alias) fail('alias', '별칭을 입력하세요.')
      if (alias.length > 20) fail('alias', '별칭은 20자 이하로 입력하세요.')
      if (mine?.status === 'applied' || mine?.status === 'approved') fail('duplicate', '이미 신청했어요.')
      if (mine?.status === 'excluded') fail('excluded', '방장이 제외한 공구에는 다시 신청할 수 없어요.')
      if (mine) Object.assign(mine, { alias, status: 'applied', appliedAt: at, approvedAt: null })
      else g.participants.push({ id: ctx.newId(), userId: ctx.userId, alias, status: 'applied', appliedAt: at, approvedAt: null })
      log('참여를 신청했어요.', alias)
      break
    }
    case 'withdraw': {
      requireStatus(g, 'recruiting', 'closed')
      if (!mine || (mine.status !== 'applied' && mine.status !== 'approved')) return fail('notApplied', '신청한 기록이 없어요.')
      mine.status = 'withdrawn'
      mine.approvedAt = null
      log('신청을 철회했어요.')
      break
    }
    case 'approve': {
      requireStatus(g, 'recruiting')
      const p = participant(command.participantId)
      if (p.status !== 'applied') fail('notApplied', '승인을 기다리는 신청이 아니에요.')
      if (seatsLeft(g) === 0) fail('full', '자리가 모두 찼어요. 인원을 바꾸거나 다른 참여자를 제외해 주세요.')
      p.status = 'approved'
      p.approvedAt = at
      log(`${p.alias} 참여를 승인했어요.`)
      break
    }
    case 'exclude': {
      requireStatus(g, 'recruiting', 'closed')
      const p = participant(command.participantId)
      if (p.status !== 'applied' && p.status !== 'approved') fail('notApplied', '제외할 수 있는 상태가 아니에요.')
      p.status = 'excluded'
      p.approvedAt = null
      log(`${p.alias} 참여를 제외했어요.`)
      break
    }
    case 'editConditions': {
      requireStatus(g, 'recruiting', 'closed')
      editConditions(g, command.conditions, ctx.now)
      g.conditionsEditedAt = at
      log('모집 조건을 바꿨어요.')
      break
    }
    case 'close': {
      requireStatus(g, 'recruiting')
      if (approved(g).length === 0) fail('noMembers', '승인한 참여자가 한 명 이상 있어야 마감할 수 있어요.')
      g.status = 'closed'
      log(`모집을 마감했어요. 방장 포함 ${approved(g).length + 1}명`)
      break
    }
    case 'reopen': {
      requireStatus(g, 'closed')
      g.status = 'recruiting'
      log('다시 모집해요.')
      break
    }
    case 'confirmOrder': {
      requireStatus(g, 'closed')
      const members = approved(g)
      if (members.length === 0) fail('noMembers', '승인한 참여자가 있어야 주문을 확정할 수 있어요.')
      const next = buildVersion(g, command.order, members.map((m) => ({ key: m.id, alias: m.alias })), '주문 확정', at)
      const est = estimate(g)
      const sameSize = members.length + 1 === g.plan.headcount
      next.needsConfirm = next.shares
        .slice(1)
        .filter((row, i) => {
          const shown = est.ok && sameSize ? est.shares[i + 1] : undefined
          return !shown || shown.amount !== row.amount || shown.units !== row.units
        })
        .map((row) => row.key)
      g.settlements.push(next)
      g.status = 'settling'
      log(`주문을 확정했어요. 정산 1차, 총 ${won(next.total)}`)
      break
    }
    case 'revise': {
      requireStatus(g, 'settling', 'pickup', 'done')
      const prev = latest(g)!
      if (!command.reason.trim()) fail('reason', '바꾸는 이유를 입력하세요.')
      const removed = new Set(command.removeParticipantIds)
      const keep = prev.shares.filter((s) => s.key !== 'host' && !removed.has(s.key))
      if (keep.length === 0) fail('noMembers', '참여자가 모두 빠지면 정산 대신 공구를 취소해 주세요.')
      const next = buildVersion(g, command.order, keep, command.reason.trim(), at)
      const changed = (key: string) => {
        const a = prev.shares.find((s) => s.key === key)
        const b = next.shares.find((s) => s.key === key)
        return a?.amount !== b?.amount || a?.units !== b?.units
      }
      next.needsConfirm = keep
        .filter((s) => changed(s.key) || (prev.needsConfirm.includes(s.key) && !prev.confirmed[s.key]))
        .map((s) => s.key)
      g.settlements.push(next)
      for (const key of removed) {
        const p = g.participants.find((x) => x.id === key)
        if (p) p.status = 'excluded'
        delete g.pickedUp[key]
      }
      log(`정산을 ${next.version}차로 바꿨어요. 이유: ${next.reason}`)
      break
    }
    case 'confirmShare': {
      requireStatus(g, 'settling', 'pickup', 'done')
      const v = latest(g)!
      if (!mine || !v.shares.some((s) => s.key === mine.id)) return fail('forbidden', '정산에 포함된 참여자만 확인할 수 있어요.')
      if (command.version !== v.version) fail('stale', '정산이 새로 바뀌었어요. 최신 내용을 확인해 주세요.')
      if (v.confirmed[mine.id]) return gig
      v.confirmed[mine.id] = at
      log(`정산 ${v.version}차를 확인했어요.`)
      break
    }
    case 'reportPayment': {
      requireStatus(g, 'settling', 'pickup', 'done')
      if (g.payments.some((p) => p.id === command.commandId)) return gig
      amountOk(command.amount)
      if (!mine || mine.status !== 'approved') return fail('forbidden', '승인된 참여자만 할 수 있어요.')
      if (unconfirmed(g).includes(mine.id)) fail('needsConfirm', '바뀐 금액을 먼저 확인해 주세요.')
      g.payments.push({ id: command.commandId, key: mine.id, kind: 'reported', amount: command.amount, at })
      log(`${won(command.amount)}을 보냈다고 표시했어요.`)
      break
    }
    case 'confirmPayment': {
      requireStatus(g, 'settling', 'pickup', 'done')
      if (g.payments.some((p) => p.id === command.commandId)) return gig
      amountOk(command.amount)
      const p = participant(command.participantId)
      if (unconfirmed(g).includes(p.id)) fail('needsConfirm', `${p.alias}이(가) 바뀐 금액을 먼저 확인해야 해요.`)
      const { remaining } = balance(g, p.id)
      if (remaining <= 0) fail('alreadyPaid', '이미 모두 받았어요.')
      g.payments.push({ id: command.commandId, key: p.id, kind: 'received', amount: command.amount, at })
      log(`${p.alias} 입금 ${won(command.amount)}을 확인했어요.`)
      break
    }
    case 'refund': {
      requireStatus(g, 'settling', 'pickup', 'done', 'cancelled')
      if (g.payments.some((p) => p.id === command.commandId)) return gig
      amountOk(command.amount)
      const p = participant(command.participantId)
      const { remaining } = balance(g, p.id)
      if (remaining >= 0) fail('nothingToRefund', '돌려줄 금액이 없어요.')
      if (command.amount > -remaining) fail('tooMuch', `돌려줄 금액은 ${won(-remaining)}까지예요.`)
      g.payments.push({ id: command.commandId, key: p.id, kind: 'refunded', amount: command.amount, at })
      log(`${p.alias}에게 ${won(command.amount)} 환불을 기록했어요.`)
      break
    }
    case 'startPickup': {
      requireStatus(g, 'settling', 'pickup')
      const pending = unconfirmed(g)
      if (pending.length) fail('needsConfirm', `아직 바뀐 정산을 확인하지 않은 참여자가 있어요: ${pending.map((k) => aliasOf(g, k)).join(', ')}`)
      if (!command.place.trim()) fail('place', '수령 장소를 입력하세요.')
      const first = g.status === 'settling'
      g.pickup = { place: command.place.trim(), at: command.at }
      g.status = 'pickup'
      log(first ? '수령을 안내했어요.' : '수령 안내를 바꿨어요.')
      break
    }
    case 'setPickedUp': {
      requireStatus(g, 'pickup')
      const p = participant(command.participantId)
      if (!latest(g)!.shares.some((s) => s.key === p.id)) fail('notFound', '정산에 포함된 참여자가 아니에요.')
      if (command.done === Boolean(g.pickedUp[p.id])) return gig
      if (command.done) g.pickedUp[p.id] = at
      else delete g.pickedUp[p.id]
      log(command.done ? `${p.alias} 수령을 확인했어요.` : `${p.alias} 수령 확인을 취소했어요.`)
      break
    }
    case 'openIssue': {
      requireStatus(g, 'closed', 'settling', 'pickup', 'done')
      if (!command.reason.trim()) fail('reason', '무슨 일이 있었는지 입력하세요.')
      g.issues.push({
        id: ctx.newId(), kind: command.kind, key: command.key, reason: command.reason.trim(),
        followUp: '', createdAt: at, resolvedAt: null,
      })
      log(`문제를 기록했어요: ${ISSUE_LABEL[command.kind]}`)
      break
    }
    case 'resolveIssue': {
      const issue = g.issues.find((i) => i.id === command.issueId) ?? fail('notFound', '기록을 찾을 수 없어요.')
      if (issue.resolvedAt) return gig
      if (!command.followUp.trim()) fail('followUp', '어떻게 해결했는지 입력하세요.')
      issue.followUp = command.followUp.trim()
      issue.resolvedAt = at
      log(`${ISSUE_LABEL[issue.kind]} 문제를 해결했어요.`)
      break
    }
    case 'complete': {
      requireStatus(g, 'pickup')
      const blockers = completionBlockers(g)
      if (blockers.length) fail('blocked', blockers.join(' '))
      g.status = 'done'
      log('공구를 완료했어요.')
      break
    }
    case 'confirmPending':
    case 'merchantRefund':
    case 'rotateInvite':
      return fail('unsupported', '서버에 연결했을 때만 할 수 있어요.')
    case 'cancel': {
      requireStatus(g, 'recruiting', 'closed', 'settling', 'pickup')
      if (!command.reason.trim()) fail('reason', '취소하는 이유를 입력하세요.')
      g.status = 'cancelled'
      g.cancelReason = command.reason.trim()
      log(`공구를 취소했어요. 이유: ${g.cancelReason}`)
      break
    }
  }
  g.updatedAt = at
  return g
}

function editConditions(g: Gig, c: Extract<Command, { type: 'editConditions' }>['conditions'], now: Date) {
  if (c.headcount !== undefined) {
    const min = Math.max(MIN_HEADCOUNT, approved(g).length + 1)
    if (!Number.isInteger(c.headcount) || c.headcount < min || c.headcount > MAX_HEADCOUNT) {
      fail('headcount', `인원은 ${min}~${MAX_HEADCOUNT}명으로 정할 수 있어요.`)
    }
    g.plan.headcount = c.headcount
  }
  if (c.displayedPrice !== undefined) {
    g.product.displayedPrice = c.displayedPrice
    if (paymentTotal(g.product).total === null) fail('price', '금액을 다시 확인해 주세요.')
  }
  if (c.place !== undefined) g.plan.place = c.place?.trim() || null
  if (c.deadline !== undefined) {
    g.plan.deadline = c.deadline
    if (c.deadline && deadlinePassed(g, now)) fail('deadline', '지금보다 늦은 마감을 골라 주세요.')
  }
  if (c.applyMethod !== undefined) g.plan.applyMethod = c.applyMethod
  if (c.pickupCandidates !== undefined) g.pickupCandidates = c.pickupCandidates.filter(Boolean).slice(0, 5)
  if (!estimate(g).ok) fail('headcount', '이 인원으로는 한 명이 하나씩 받을 수 없어요.')
}

/** 실제 주문 금액을 비교 계산에 쓸 수 있는 상품 값으로 바꾼다. */
export function actualProduct(p: ProductDraft, total: number): ProductDraft {
  return { ...p, displayedPrice: total, shippingMode: 'included', discountMode: 'included', priceConfirmed: true }
}

function buildVersion(
  g: Gig,
  order: OrderInput,
  members: { key: string; alias: string }[],
  reason: string,
  at: string,
): SettlementVersion {
  const amounts = [order.itemAmount, order.shippingFee, order.discountAmount]
  if (amounts.some((n) => !Number.isSafeInteger(n) || n < 0)) fail('badAmount', '금액을 0 이상의 정수로 입력하세요.')
  const total = orderTotal(order)
  if (total < 1) fail('badAmount', '결제 금액은 1원 이상이어야 해요.')
  if (!isPositiveInt(order.totalUnits)) fail('badUnits', '최종 수량은 1 이상의 정수로 입력하세요.')
  const units = allocateUnits(order.totalUnits, members.length + 1)
  if (!units) return fail('tooFewUnits', `수량이 부족해 ${members.length + 1}명이 하나씩 받을 수 없어요.`)
  const split = splitAmount(total, units)
  const rows = [{ key: 'host', alias: g.hostAlias }, ...members]

  // 절약액은 실제 금액과 실제 수량으로 계산한다. 수량이 바뀌면 포장 구성 대신 전체 수량만 맞춘다.
  const base = actualProduct(g.product, total)
  const planned = totalUnits(g.product)
  const comparable = planned === order.totalUnits ? base : scaleUnits(base, order.totalUnits)
  const result = comparable ? compare(comparable, g.reference) : null

  const shares: ShareRow[] = rows.map((r, i) => ({
    key: r.key,
    alias: r.alias,
    units: units[i]!,
    amount: split[i]!,
    saved: result?.ok ? result.savedFor(units[i]!, split[i]!) : null,
  }))
  return {
    version: g.settlements.length + 1,
    createdAt: at,
    reason,
    order: { ...order },
    total,
    shares,
    comparison: result?.ok ? { savingsRate: result.savingsRate, reference: structuredClone(g.reference) } : null,
    needsConfirm: [],
    confirmed: {},
  }
}

/** 최종 수량에 맞춰 묶음 구성을 바꾼다. 직접 소분에서 용기 수로 환산되지 않으면 null. */
function scaleUnits(p: ProductDraft, units: number): ProductDraft | null {
  if (p.splitMode === 'sealed') return { ...p, packCount: 1, unitsPerPack: units }
  const packs = (units * (p.directStep ?? 0)) / (p.netAmountPerUnit ?? 0)
  return Number.isInteger(packs) && packs > 0 ? { ...p, packCount: 1, unitsPerPack: packs } : null
}
