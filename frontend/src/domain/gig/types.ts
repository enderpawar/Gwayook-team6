import type { PlanDraft, ProductDraft, ReferenceDraft } from '../types'

export type GigStatus = 'draft' | 'recruiting' | 'closed' | 'settling' | 'pickup' | 'done' | 'cancelled'

export type ParticipantStatus = 'applied' | 'approved' | 'excluded' | 'withdrawn'

export interface Participant {
  id: string
  userId: string
  alias: string
  status: ParticipantStatus
  appliedAt: string
  approvedAt: string | null
}

export interface OrderInput {
  itemAmount: number
  shippingFee: number
  discountAmount: number
  totalUnits: number
  orderedAt: string
}

/** 정산 행의 주인. 방장은 'host', 참여자는 참여 id. */
export type ShareKey = 'host' | string

export interface ShareRow {
  key: ShareKey
  alias: string
  units: number
  amount: number
  /** 비교 기준이 확인된 경우의 절약액. 없으면 null */
  saved: number | null
}

/** 확정 이후에는 고치지 않고 새 버전을 쌓는다. 계산에 쓴 값은 모두 스냅샷으로 남긴다. */
export interface SettlementVersion {
  version: number
  createdAt: string
  reason: string
  order: OrderInput
  total: number
  shares: ShareRow[]
  comparison: { savingsRate: number; reference: ReferenceDraft } | null
  /** 금액이나 수량이 달라져 다시 확인받아야 하는 참여 id */
  needsConfirm: string[]
  confirmed: Record<string, string>
}

export type PaymentKind = 'reported' | 'received' | 'refunded'

export interface PaymentEvent {
  id: string
  key: ShareKey
  kind: PaymentKind
  amount: number
  at: string
}

export type IssueKind = 'soldOut' | 'orderCancelled' | 'partialRefund' | 'noShow' | 'other'

export interface Issue {
  id: string
  kind: IssueKind
  key: ShareKey | null
  reason: string
  followUp: string
  createdAt: string
  resolvedAt: string | null
}

export interface LogEntry {
  at: string
  by: string
  text: string
}

export interface Gig {
  id: string
  inviteCode: string
  hostId: string
  hostAlias: string
  status: GigStatus
  step: number
  product: ProductDraft
  reference: ReferenceDraft
  plan: PlanDraft
  pickupCandidates: string[]
  participants: Participant[]
  settlements: SettlementVersion[]
  payments: PaymentEvent[]
  pickup: { place: string; at: string | null } | null
  pickedUp: Record<ShareKey, string>
  issues: Issue[]
  log: LogEntry[]
  cancelReason: string | null
  conditionsEditedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GigConditions {
  headcount?: number
  place?: string | null
  deadline?: string | null
  applyMethod?: string
  pickupCandidates?: string[]
  displayedPrice?: number
}

export type Command =
  | { type: 'publish'; hostAlias: string }
  | { type: 'apply'; alias: string }
  | { type: 'withdraw' }
  | { type: 'approve'; participantId: string }
  | { type: 'exclude'; participantId: string }
  | { type: 'editConditions'; conditions: GigConditions }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'confirmOrder'; order: OrderInput }
  | { type: 'revise'; order: OrderInput; removeParticipantIds: string[]; reason: string }
  | { type: 'confirmShare'; version: number }
  | { type: 'reportPayment'; commandId: string; amount: number }
  | { type: 'confirmPayment'; commandId: string; participantId: string; amount: number }
  | { type: 'refund'; commandId: string; participantId: string; amount: number }
  | { type: 'startPickup'; place: string; at: string | null }
  | { type: 'setPickedUp'; participantId: string; done: boolean }
  | { type: 'openIssue'; kind: IssueKind; key: ShareKey | null; reason: string }
  | { type: 'resolveIssue'; issueId: string; followUp: string }
  | { type: 'complete' }
  | { type: 'cancel'; reason: string }

export const STATUS_LABEL: Record<GigStatus, string> = {
  draft: '초안',
  recruiting: '모집 중',
  closed: '모집 마감',
  settling: '정산 중',
  pickup: '수령 중',
  done: '완료',
  cancelled: '취소',
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  soldOut: '품절',
  orderCancelled: '주문 취소',
  partialRefund: '부분 환불',
  noShow: '노쇼',
  other: '기타',
}

export class GigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GigError'
    this.code = code
  }
}
