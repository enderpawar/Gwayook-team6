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
  /** 서버가 정한 승인 순서. 로컬 저장소에는 없다. */
  order?: number
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

export type IssueKind = 'soldOut' | 'orderCancelled' | 'partialRefund' | 'noShow' | 'other' | 'orderIssue' | 'returnRequired' | 'correction'

export interface Balance {
  due: number
  received: number
  refunded: number
  reported: number
  /** 양수면 더 받아야 하고, 음수면 돌려줘야 한다. */
  remaining: number
}

/** 서버에서 읽은 공구에만 있는 값 */
export interface ServerInfo {
  revision: number
  inviteToken: string | null
  /** 참여자 재확인과 방장 확정을 기다리는 정산 */
  pending: SettlementVersion | null
  balances: Record<ShareKey, Balance>
  /** 기록한 판매처 환불이 아직 정산에 반영되지 않았는지 */
  refundUnapplied: boolean
}

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
  server?: ServerInfo
}

export interface GigConditions {
  headcount?: number
  place?: string | null
  deadline?: string | null
  applyMethod?: string
  pickupCandidates?: string[]
  displayedPrice?: number
}

export interface PickupPlan {
  place: string
  at: string | null
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
  | { type: 'confirmOrder'; order: OrderInput; pickup?: PickupPlan }
  | { type: 'revise'; order: OrderInput; removeParticipantIds: string[]; reason: string; pickup?: PickupPlan }
  | { type: 'confirmPending'; version: number }
  | { type: 'merchantRefund'; commandId: string; amount: number }
  | { type: 'rotateInvite' }
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
  orderIssue: '주문 문제',
  returnRequired: '반납 필요',
  correction: '정정',
}

export class GigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GigError'
    this.code = code
  }
}
