import type { FieldName, ProductDraft, ReferenceDraft, Source } from './types'

const MAX_PRICE = 100_000_000
const MAX_UNITS = 10_000

export function blankProduct(source: Source): ProductDraft {
  return {
    source,
    fullTitle: '',
    shortName: '',
    selectedOption: '',
    packCount: null,
    unitsPerPack: null,
    unitName: '',
    netAmountPerUnit: null,
    measure: 'count',
    displayedPrice: null,
    shippingMode: 'unknown',
    shippingFee: null,
    discountMode: 'unknown',
    discountAmount: null,
    priceConfirmed: false,
    priceCandidates: [],
    unresolvedFields: [],
  }
}

export function blankReference(): ReferenceDraft {
  return {
    name: '',
    price: null,
    unitCount: null,
    netAmountPerUnit: null,
    measure: 'count',
    sameSpecConfirmed: false,
    sourceKind: 'manual',
    sourceUrl: '',
    checkedOn: '',
    purchasesPerYear: null,
  }
}

export const isPositiveInt = (n: number | null): n is number =>
  n !== null && Number.isSafeInteger(n) && n > 0

export function totalUnits(p: Pick<ProductDraft, 'packCount' | 'unitsPerPack'>): number | null {
  if (!isPositiveInt(p.packCount) || !isPositiveInt(p.unitsPerPack)) return null
  const units = p.packCount * p.unitsPerPack
  return units <= MAX_UNITS ? units : null
}

export interface PaymentTotal {
  total: number | null
  estimated: boolean
}

export function paymentTotal(p: ProductDraft): PaymentTotal {
  const estimated =
    !p.priceConfirmed || p.shippingMode === 'unknown' || p.discountMode === 'unknown'
  if (!isPositiveInt(p.displayedPrice)) return { total: null, estimated }
  let total = p.displayedPrice
  if (p.shippingMode === 'separate') {
    if (p.shippingFee === null || p.shippingFee < 0) return { total: null, estimated }
    total += p.shippingFee
  }
  if (p.discountMode === 'apply') {
    if (p.discountAmount === null || p.discountAmount < 0) return { total: null, estimated }
    total -= p.discountAmount
  }
  return { total: total > 0 ? total : null, estimated }
}

/** 다음 단계로 갈 수 없게 막는 문제만 담는다. 값은 화면에 그대로 보여줄 안내문이다. */
export function draftProblems(p: ProductDraft): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {}
  if (!p.fullTitle.trim()) out.fullTitle = '상품명을 입력하세요.'
  if (!p.unitName.trim()) out.unitName = '나누는 단위를 입력하세요. 예: 롤, 병, 개'
  if (!isPositiveInt(p.packCount)) out.packCount = '1 이상의 정수를 입력하세요.'
  if (!isPositiveInt(p.unitsPerPack)) out.unitsPerPack = '1 이상의 정수를 입력하세요.'
  if (!out.packCount && !out.unitsPerPack && totalUnits(p) === null) {
    out.unitsPerPack = `전체 수량은 ${MAX_UNITS.toLocaleString('ko-KR')}개 이하로 입력하세요.`
  }
  if (!isPositiveInt(p.displayedPrice)) {
    out.displayedPrice = '이 상품만의 결제 금액을 입력하세요. 장바구니 합계라면 상품 금액만 적으세요.'
  } else if (p.displayedPrice > MAX_PRICE) {
    out.displayedPrice = '1억 원 이하로 입력하세요.'
  }
  if (p.shippingMode === 'separate' && (p.shippingFee === null || p.shippingFee < 0)) {
    out.shippingFee = '더할 배송비를 입력하세요.'
  }
  if (p.discountMode === 'apply') {
    if (p.discountAmount === null || p.discountAmount < 0) {
      out.discountAmount = '뺄 할인 금액을 입력하세요.'
    } else if (isPositiveInt(p.displayedPrice) && !out.shippingFee && paymentTotal(p).total === null) {
      out.discountAmount = '할인 금액이 결제 금액보다 큽니다.'
    }
  }
  return out
}

export const displayName = (p: ProductDraft) => p.shortName.trim() || p.fullTitle.trim()
