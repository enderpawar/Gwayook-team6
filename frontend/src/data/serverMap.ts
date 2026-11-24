import { compare } from '@/domain/comparison'
import { blankProduct, blankReference, isDirectSplit, isPositiveInt, paymentTotal, totalUnits } from '@/domain/product'
import { GigError, type Balance, type GigStatus, type IssueKind, type OrderInput, type ParticipantStatus, type SettlementVersion } from '@/domain/gig/types'
import type { Measure, PlanDraft, ProductDraft, ReferenceDraft } from '@/domain/types'

/** 서버는 UTC ISO, 화면은 YYYY-MM-DDTHH:mm(현지 시각)을 쓴다. */
export const toIso = (local: string) => new Date(local).toISOString()

export function toLocal(iso: string): string
export function toLocal(iso: string | null | undefined): string | null
export function toLocal(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export const STATUS: Record<string, GigStatus> = {
  DRAFT: 'draft', OPEN: 'recruiting', CLOSED: 'closed', SETTLING: 'settling', PICKUP: 'pickup', COMPLETED: 'done', CANCELLED: 'cancelled',
}
export const PARTICIPANT: Record<string, ParticipantStatus> = {
  PENDING: 'applied', APPROVED: 'approved', WITHDRAWN: 'withdrawn', REJECTED: 'excluded', EXCLUDED: 'excluded',
}
export const ISSUE: Record<string, IssueKind> = {
  NO_SHOW: 'noShow', RETURN_REQUIRED: 'returnRequired', ORDER_ISSUE: 'orderIssue', CORRECTION: 'correction',
}
export const SERVER_ISSUES: { kind: IssueKind; code: string; label: string }[] = [
  { kind: 'orderIssue', code: 'ORDER_ISSUE', label: '주문 문제' },
  { kind: 'noShow', code: 'NO_SHOW', label: '노쇼' },
  { kind: 'returnRequired', code: 'RETURN_REQUIRED', label: '반납 필요' },
  { kind: 'correction', code: 'CORRECTION', label: '정정' },
]
export const CANCEL_REASONS = [
  { code: 'SOLD_OUT', label: '품절' },
  { code: 'ORDER_CANCELLED', label: '주문 취소' },
  { code: 'ORDER_ISSUE', label: '주문 문제' },
  { code: 'NO_SHOW', label: '노쇼' },
  { code: 'CORRECTION', label: '정정' },
]

export interface ServerSpec {
  compatibilityKey: string
  unit: string
  amountPerUnit: number
}
export interface ServerPayment {
  productAmount: number
  shippingFee: number
  discountAmount: number
  includesShipping: boolean
  includesDiscount: boolean
  isEstimate?: boolean
  totalAmount?: number
}
export interface ServerProduct {
  shortName: string
  fullTitle: string
  bulkTotalQty: number
  unitName: string
  selectedOption?: string | null
  annualPurchaseCount?: number | null
  payment: ServerPayment
  comparisonSpec?: ServerSpec | null
  comparisonBaseline?: {
    quantity: number
    unitName: string
    price: number
    spec: ServerSpec
    source: { kind: string; checkedOn?: string; reference?: { value: string } }
  } | null
}

const UNITS = ['롤', '병', '개']

/** 서버가 받지 않는 초안을 미리 알려준다. 빈 배열이면 공개할 수 있다. */
export function publishProblems(product: ProductDraft, plan: PlanDraft, pickupCandidates: string[]): string[] {
  const out: string[] = []
  if (!plan.deadline) out.push('모집 마감을 정해 주세요.')
  if (pickupCandidates.length === 0) out.push('수령 후보 일시를 하나 이상 골라 주세요.')
  else if (plan.deadline && pickupCandidates.some((c) => c < plan.deadline!)) out.push('수령 후보는 모집 마감보다 늦어야 해요.')
  if (paymentTotal(product).estimated) out.push('확인 단계에서 배송비·할인을 확인하고 ‘실제로 결제할 금액이 맞아요’에 체크해 주세요.')
  if (isDirectSplit(product) || product.splitMode === 'direct') out.push('서버에서는 포장 그대로 나누는 공구만 열 수 있어요.')
  if (!UNITS.includes(product.unitName.trim())) out.push('나눌 단위는 롤, 병, 개 중 하나여야 해요. 확인 단계에서 바꿔 주세요.')
  return out
}

/** 서버는 롤은 길이(m), 병은 용량(ml)으로만 비교한다. 맞지 않으면 비교를 보내지 않는다. */
function spec(unitName: string, measure: Measure, net: number | null): ServerSpec | null {
  const key = { compatibilityKey: `사용자 확인 규격 ${measure}` }
  if (measure === 'count') return unitName === '개' ? { ...key, unit: '개', amountPerUnit: 1 } : null
  if (net === null || net <= 0) return null
  if (unitName === '롤' && measure !== 'm') return null
  if (unitName === '병' && measure !== 'ml') return null
  return { ...key, unit: measure, amountPerUnit: net }
}

export function toServerProduct(p: ProductDraft, r: ReferenceDraft) {
  const unitName = p.unitName.trim()
  const bulk = spec(unitName, p.measure, p.netAmountPerUnit)
  const small = p.measure === r.measure && (r.measure !== 'count' || r.sameSpecConfirmed) ? spec(unitName, r.measure, r.netAmountPerUnit) : null
  const own = r.sourceKind === 'manual' || r.sourceKind === 'link'
  const url = r.sourceUrl.trim()
  return {
    shortName: (p.shortName.trim() || p.fullTitle.trim()).slice(0, 80),
    fullTitle: p.fullTitle.trim(),
    ...(p.selectedOption.trim() ? { selectedOption: p.selectedOption.trim() } : {}),
    bulkTotalQty: totalUnits(p)!,
    unitName,
    allocationStep: 1,
    uniformUnits: true,
    packCount: p.packCount!,
    unitsPerPack: p.unitsPerPack!,
    ...(r.purchasesPerYear ? { annualPurchaseCount: r.purchasesPerYear } : {}),
    payment: {
      productAmount: p.displayedPrice!,
      shippingFee: p.shippingMode === 'separate' ? p.shippingFee! : 0,
      discountAmount: p.discountMode === 'apply' ? p.discountAmount! : 0,
      includesShipping: p.shippingMode === 'included',
      includesDiscount: p.discountMode === 'included',
      isEstimate: false,
    },
    ...(bulk ? { comparisonSpec: bulk } : {}),
    ...(bulk && small && own && isPositiveInt(r.price) && isPositiveInt(r.unitCount)
      ? {
          comparisonBaseline: {
            quantity: r.unitCount,
            unitName,
            price: r.price,
            spec: small,
            source: {
              kind: 'USER_INPUT',
              ...(r.checkedOn ? { checkedOn: r.checkedOn } : {}),
              ...(/^https?:\/\//.test(url) ? { reference: { kind: 'LINK', value: url } } : {}),
            },
          },
        }
      : {}),
  }
}

export function toServerInput(p: ProductDraft, r: ReferenceDraft, plan: PlanDraft, pickupCandidates: string[]) {
  return {
    people: plan.headcount,
    ...(plan.place?.trim() ? { publicLocation: plan.place.trim() } : {}),
    applicationDeadline: toIso(plan.deadline!),
    pickupCandidates: pickupCandidates.map(toIso),
    inputOrigin: p.source === 'capture' ? 'CAPTURE' : 'MANUAL',
    allocationMode: 'SEALED_PACKAGE',
    priceConfirmed: true,
    product: toServerProduct(p, r),
  }
}

const measureOf = (s: ServerSpec | null | undefined): Measure =>
  s?.unit === 'ml' || s?.unit === 'L' ? 'ml' : s?.unit === 'g' || s?.unit === 'kg' ? 'g' : s?.unit === 'm' || s?.unit === 'cm' ? 'm' : 'count'

const FACTOR: Record<string, number> = { ml: 1, L: 1000, g: 1, kg: 1000, m: 1, cm: 0.01, 개: 1 }

const netOf = (s: ServerSpec | null | undefined) =>
  s && measureOf(s) !== 'count' ? s.amountPerUnit * (FACTOR[s.unit] ?? 1) : null

export function fromServerProduct(s: ServerProduct): { product: ProductDraft; reference: ReferenceDraft } {
  const pay = s.payment
  const b = s.comparisonBaseline
  return {
    product: {
      ...blankProduct('manual'),
      fullTitle: s.fullTitle,
      shortName: s.shortName,
      selectedOption: s.selectedOption ?? '',
      packCount: 1,
      unitsPerPack: s.bulkTotalQty,
      unitName: s.unitName,
      measure: measureOf(s.comparisonSpec),
      netAmountPerUnit: netOf(s.comparisonSpec),
      displayedPrice: pay.productAmount,
      shippingMode: pay.includesShipping ? 'included' : pay.shippingFee > 0 ? 'separate' : 'none',
      shippingFee: pay.shippingFee,
      discountMode: pay.includesDiscount ? 'included' : pay.discountAmount > 0 ? 'apply' : 'none',
      discountAmount: pay.discountAmount,
      priceConfirmed: true,
    },
    reference: {
      ...blankReference(),
      ...(b
        ? {
            price: b.price,
            unitCount: b.quantity,
            measure: measureOf(b.spec),
            netAmountPerUnit: netOf(b.spec),
            sameSpecConfirmed: true,
            checkedOn: b.source.checkedOn ?? '',
            sourceUrl: b.source.reference?.value ?? '',
            sourceKind: b.source.reference ? ('link' as const) : ('manual' as const),
          }
        : {}),
      purchasesPerYear: s.annualPurchaseCount ?? null,
    },
  }
}

export interface ServerSnapshot {
  versionNo: number
  confirmedAt: string | null
  orderAt: string
  orderTotal: number
  finalTotal: number
  product: ServerProduct
  terms: { quantity: number; unitName: string; pickup: { at: string | null; publicHub: string | null } }
  requiredConfirmationUserIds: string[]
  lines: { lineNo: number; userId: string; alias: string; quantity: number; unitName: string; amount: number }[]
}

export const orderFromSnapshot = (s: ServerSnapshot): OrderInput => ({
  itemAmount: s.product.payment.productAmount,
  shippingFee: s.product.payment.includesShipping ? 0 : s.product.payment.shippingFee,
  discountAmount: s.product.payment.includesDiscount ? 0 : s.product.payment.discountAmount,
  totalUnits: s.terms.quantity,
  orderedAt: toLocal(s.orderAt),
})

export function fromSnapshot(s: ServerSnapshot, product: ProductDraft, reference: ReferenceDraft): SettlementVersion {
  const actual: ProductDraft = {
    ...product, packCount: 1, unitsPerPack: s.terms.quantity, displayedPrice: s.finalTotal,
    shippingMode: 'included', discountMode: 'included',
  }
  const c = compare(actual, reference)
  return {
    version: s.versionNo,
    createdAt: s.confirmedAt ?? '',
    reason: s.versionNo === 1 ? '주문 확정' : '정산 변경',
    order: orderFromSnapshot(s),
    total: s.finalTotal,
    shares: s.lines.map((l) => ({
      key: l.lineNo === 0 ? 'host' : l.userId,
      alias: l.alias,
      units: l.quantity,
      amount: l.amount,
      saved: c.ok ? c.savedFor(l.quantity, l.amount) : null,
    })),
    comparison: c.ok ? { savingsRate: c.savingsRate, reference } : null,
    needsConfirm: s.confirmedAt ? [] : s.requiredConfirmationUserIds,
    confirmed: {},
  }
}

export interface ServerBalance {
  userId: string
  active: boolean
  targetAmount: number
  targetQuantity: number
  actualQuantity: number
  reportedAmount: number
  confirmedIn: number
  refunded: number
  netPaid: number
  due: number
  receiptStatus: string
}

export const fromBalance = (b: ServerBalance): Balance => ({
  due: b.targetAmount,
  received: b.confirmedIn,
  refunded: b.refunded,
  reported: b.reportedAmount + b.netPaid,
  remaining: b.due,
})

/** 기약분수로 온 절약액을 원 단위로 반올림한다. 0.5 는 0 에서 먼 쪽으로. */
export function ratioToWon(numerator: string, denominator: string): number {
  const n = BigInt(numerator)
  const d = BigInt(denominator)
  const abs = n < 0n ? -n : n
  const rounded = (abs * 2n + d) / (d * 2n)
  return Number(n < 0n ? -rounded : rounded)
}

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '로그인이 필요해요.',
  INVALID_CREDENTIALS: '이메일이나 비밀번호가 맞지 않아요.',
  EMAIL_ALREADY_REGISTERED: '이미 가입한 이메일이에요. 로그인해 주세요.',
  INVALID_CREDENTIAL_INPUT: '이메일 형식을 확인하고, 비밀번호는 12자 이상 입력해 주세요.',
  INVALID_DISPLAY_NAME: '별칭은 1~40자로 입력해 주세요.',
  LOCAL_P1_ONLY: '이 서버는 같은 컴퓨터에서만 쓸 수 있어요.',
  P1_DATABASE_BUSY: '서버가 바빠요. 잠시 뒤 다시 시도해 주세요.',
  GROUP_NOT_FOUND: '공구를 찾을 수 없거나 볼 권한이 없어요.',
  NOT_FOUND: '공구를 찾을 수 없거나 볼 권한이 없어요.',
  INVITE_NOT_FOUND: '초대 링크가 만료됐거나 새 링크로 바뀌었어요.',
  ORGANIZER_CANNOT_APPLY: '방장은 이미 포함되어 있어요.',
  ALREADY_APPLIED: '이미 신청한 기록이 있어 다시 신청할 수 없어요.',
  APPLICATIONS_CLOSED: '신청 마감이 지났거나 모집이 끝났어요.',
  GROUP_FULL: '자리가 모두 찼어요.',
  HEADCOUNT_BELOW_OCCUPIED: '이미 승인한 참여자보다 적은 인원으로 바꿀 수 없어요.',
  REVISION_CONFLICT: '다른 곳에서 내용이 바뀌었어요. 새로 불러온 내용을 확인하고 다시 시도해 주세요.',
  INVALID_GROUP_STATE: '지금 상태에서는 할 수 없어요. 화면을 새로 확인해 주세요.',
  INVALID_SETTLEMENT_STATE: '지금 상태에서는 할 수 없어요. 빈자리나 대기 중인 정산이 있는지 확인해 주세요.',
  DEADLINE_NOT_FUTURE: '모집 마감을 지금보다 늦게 정해 주세요.',
  SEALED_PACKAGES_ONLY: '포장 그대로(롤, 병, 개) 나누는 공구만 열 수 있어요.',
  VERIFIED_PRICE_REQUIRED: '실제로 결제할 금액을 먼저 확인해 주세요.',
  INSUFFICIENT_ALLOCATION_UNITS: '수량이 부족해 한 명이 하나씩 받을 수 없어요.',
  INSUFFICIENT_ALLOCATION: '수량이 부족해 한 명이 하나씩 받을 수 없어요.',
  RECONFIRMATION_REQUIRED: '아직 바뀐 내용을 확인하지 않은 참여자가 있어요.',
  PICKUP_DETAILS_REQUIRED: '수령 일시와 장소가 확정된 정산이 있어야 해요. 정산 바꾸기에서 정해 주세요.',
  SETTLEMENT_INCOMPLETE: '아직 정리되지 않은 입금이나 수령이 있어요.',
  REQUEST_KEY_CONFLICT: '이미 기록했을 수 있어요. 화면을 확인해 주세요.',
  MERCHANT_REFUND_EXCEEDS_ORDER: '판매처 환불이 주문 금액보다 커요.',
  INVALID_GROUP_INPUT: '입력한 값을 다시 확인해 주세요.',
  INVALID_SETTLEMENT_INPUT: '입력한 값을 다시 확인해 주세요. 주문 시각과 수령 일시도 확인해 주세요.',
  INVALID_LEDGER_EVENT: '기록할 수 없는 금액이나 수량이에요.',
}

export function serverError(status: number, code: string | null): GigError {
  if (status === 401 && code !== 'INVALID_CREDENTIALS') return new GigError('auth', MESSAGES.AUTH_REQUIRED!)
  const kind = status === 404 ? 'notFound' : status === 403 ? 'forbidden' : (code ?? 'server')
  return new GigError(kind, (code && MESSAGES[code]) || '서버가 처리하지 못했어요. 다시 시도해 주세요.')
}
