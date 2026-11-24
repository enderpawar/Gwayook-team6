import { paymentTotal, totalUnits } from '../product'
import { settle, type Settlement } from '../settlement'
import type { Gig, Participant, SettlementVersion, ShareKey } from './types'

/** 승인 순서대로 정렬한 확정 참여자 */
export const approved = (g: Gig): Participant[] =>
  g.participants
    .filter((p) => p.status === 'approved')
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''))

export const applicants = (g: Gig) => g.participants.filter((p) => p.status === 'applied')

export const seatsLeft = (g: Gig) => Math.max(0, g.plan.headcount - 1 - approved(g).length)

export const latest = (g: Gig): SettlementVersion | null => g.settlements.at(-1) ?? null

export const orderTotal = (o: { itemAmount: number; shippingFee: number; discountAmount: number }) =>
  o.itemAmount + o.shippingFee - o.discountAmount

/** 모집할 때 보여준 예상 정산. 목표 인원 기준이다. */
export const estimate = (g: Gig): Settlement =>
  settle(paymentTotal(g.product).total, totalUnits(g.product), g.plan.headcount)

export const deadlinePassed = (g: Gig, now: Date) =>
  g.plan.deadline !== null && new Date(g.plan.deadline).getTime() <= now.getTime()

export interface Balance {
  due: number
  received: number
  refunded: number
  reported: number
  /** 양수면 더 받아야 하고, 음수면 돌려줘야 한다. */
  remaining: number
}

/** 한 참여자의 금액 상태. 취소되었거나 명단에서 빠졌으면 받을 금액은 0 이다. */
export function balance(g: Gig, key: ShareKey): Balance {
  const row = latest(g)?.shares.find((s) => s.key === key)
  const due = g.status === 'cancelled' ? 0 : (row?.amount ?? 0)
  const sum = (kind: string) =>
    g.payments.filter((p) => p.key === key && p.kind === kind).reduce((a, p) => a + p.amount, 0)
  const received = sum('received')
  const refunded = sum('refunded')
  return { due, received, refunded, reported: sum('reported'), remaining: due - received + refunded }
}

/** 정산에 들어 있거나 돈이 오간 적이 있는 참여자 */
export function moneyKeys(g: Gig): string[] {
  const keys = new Set<string>()
  for (const s of latest(g)?.shares ?? []) if (s.key !== 'host') keys.add(s.key)
  for (const p of g.payments) if (p.kind !== 'reported') keys.add(p.key)
  return [...keys]
}

export const aliasOf = (g: Gig, key: ShareKey) =>
  key === 'host' ? g.hostAlias : (g.participants.find((p) => p.id === key)?.alias ?? '참여자')

export const unconfirmed = (g: Gig): string[] => {
  const v = latest(g)
  return v ? v.needsConfirm.filter((id) => !v.confirmed[id]) : []
}

/** 완료를 막는 이유. 비어 있으면 완료할 수 있다. */
export function completionBlockers(g: Gig): string[] {
  const out: string[] = []
  const rows = (latest(g)?.shares ?? []).filter((s) => s.key !== 'host')
  const waiting = rows.filter((s) => !g.pickedUp[s.key])
  if (waiting.length) out.push(`수령 확인이 남았어요: ${waiting.map((s) => s.alias).join(', ')}`)
  const pending = unconfirmed(g)
  if (pending.length) out.push(`정산 재확인이 남았어요: ${pending.map((k) => aliasOf(g, k)).join(', ')}`)
  for (const key of moneyKeys(g)) {
    const { remaining } = balance(g, key)
    if (remaining > 0) out.push(`${aliasOf(g, key)}에게 받을 금액이 ${remaining.toLocaleString('ko-KR')}원 남았어요`)
    if (remaining < 0) out.push(`${aliasOf(g, key)}에게 돌려줄 금액이 ${(-remaining).toLocaleString('ko-KR')}원 남았어요`)
  }
  const open = g.issues.filter((i) => !i.resolvedAt)
  if (open.length) out.push(`해결하지 않은 문제가 ${open.length}건 있어요`)
  return out
}

export const hasOpenMoney = (g: Gig) => moneyKeys(g).some((k) => balance(g, k).remaining !== 0)
