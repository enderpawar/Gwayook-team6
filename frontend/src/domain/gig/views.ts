import { compare } from '../comparison'
import { displayName, formatUnits, paymentTotal } from '../product'
import { balance, deadlinePassed, estimate, latest, seatsLeft, type Balance } from './select'
import type { Gig, GigStatus, ParticipantStatus } from './types'

export interface Amounts {
  units: string
  amount: number
}

/** 초대 링크로 볼 수 있는 정보. 다른 참여자의 별칭, 입금 상태, 확정 수령 정보는 담지 않는다. */
export interface InviteView {
  code: string
  status: GigStatus
  productName: string
  option: string
  hostAlias: string
  headcount: number
  seatsLeft: number
  applyOpen: boolean
  deadline: string | null
  place: string | null
  pickupCandidates: string[]
  conditionsEditedAt: string | null
  cancelReason: string | null
  estimated: boolean
  estimate: { units: string; min: number; max: number } | null
  savingsRate: number | null
  isHost: boolean
  hostGigId: string | null
  me: MyView | null
}

export interface MyView {
  participantId: string
  alias: string
  status: ParticipantStatus
  latestVersion: number | null
  share: {
    version: number
    reason: string
    units: string
    amount: number
    saved: number | null
    needsConfirm: boolean
    before: Amounts | null
  } | null
  balance: Balance | null
  pickup: { place: string; at: string | null } | null
  pickedUp: boolean
}

export function inviteView(g: Gig, userId: string, now: Date): InviteView {
  const est = estimate(g)
  const guests = est.ok ? est.shares.slice(1) : []
  const comparison = compare(g.product, g.reference)
  const isHost = g.hostId === userId
  const settled = latest(g)
  return {
    code: g.inviteCode,
    status: g.status,
    productName: displayName(g.product),
    option: g.product.selectedOption.trim(),
    hostAlias: g.hostAlias,
    headcount: g.plan.headcount,
    seatsLeft: seatsLeft(g),
    applyOpen: g.status === 'recruiting' && !deadlinePassed(g, now),
    deadline: g.plan.deadline,
    place: g.plan.place,
    pickupCandidates: g.pickupCandidates,
    conditionsEditedAt: g.conditionsEditedAt,
    cancelReason: g.cancelReason,
    estimated: paymentTotal(g.product).estimated,
    estimate: guests.length
      ? {
          units: formatUnits(g.product, guests[0]!.units),
          min: Math.min(...guests.map((s) => s.amount)),
          max: Math.max(...guests.map((s) => s.amount)),
        }
      : null,
    // 주문을 확정했으면 실제 금액 기준, 아니면 모집 때 보여준 값
    savingsRate: settled ? (settled.comparison?.savingsRate ?? null) : comparison.ok ? comparison.savingsRate : null,
    isHost,
    hostGigId: isHost ? g.id : null,
    me: myView(g, userId),
  }
}

function myView(g: Gig, userId: string): MyView | null {
  const p = g.participants.find((x) => x.userId === userId)
  if (!p) return null
  const v = latest(g)
  const row = v?.shares.find((s) => s.key === p.id)
  const prev = g.settlements.at(-2)?.shares.find((s) => s.key === p.id)
  const est = estimate(g)
  const shown = prev ?? (v?.version === 1 && est.ok ? est.shares[(v.shares.findIndex((s) => s.key === p.id))] : undefined)
  const b = balance(g, p.id)
  const involved = row !== undefined || b.received > 0
  return {
    participantId: p.id,
    alias: p.alias,
    status: p.status,
    latestVersion: v?.version ?? null,
    share:
      v && row
        ? {
            version: v.version,
            reason: v.reason,
            units: formatUnits(g.product, row.units),
            amount: row.amount,
            saved: row.saved,
            needsConfirm: v.needsConfirm.includes(p.id) && !v.confirmed[p.id],
            before: shown ? { units: formatUnits(g.product, shown.units), amount: shown.amount } : null,
          }
        : null,
    balance: involved ? b : null,
    pickup: p.status === 'approved' && g.status === 'pickup' ? g.pickup : null,
    pickedUp: Boolean(g.pickedUp[p.id]),
  }
}
