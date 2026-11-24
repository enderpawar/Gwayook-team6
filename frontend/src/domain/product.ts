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
    splitMode: 'sealed',
    directStep: null,
    directChecks: { label: false, measuring: false, container: false },
    displayedPrice: null,
    shippingMode: 'unknown',
    shippingFee: null,
    discountMode: 'unknown',
    discountAmount: null,
    priceConfirmed: false,
    priceCandidates: [],
    optionCandidates: [],
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

/** 직접 소분 조건을 모두 확인했을 때만 true. 하나라도 빠지면 포장 단위로 나눈다. */
export function isDirectSplit(p: ProductDraft): boolean {
  return (
    p.splitMode === 'direct' &&
    (p.measure === 'ml' || p.measure === 'g') &&
    p.directChecks.label &&
    p.directChecks.measuring &&
    p.directChecks.container
  )
}

/** 나누는 최소 단위의 총 개수. 직접 소분이면 덜어 나누는 횟수다. */
export function totalUnits(p: ProductDraft): number | null {
  if (!isPositiveInt(p.packCount) || !isPositiveInt(p.unitsPerPack)) return null
  const packs = p.packCount * p.unitsPerPack
  if (!isDirectSplit(p)) return packs <= MAX_UNITS ? packs : null
  if (!isPositiveInt(p.netAmountPerUnit) || !isPositiveInt(p.directStep)) return null
  const steps = (packs * p.netAmountPerUnit) / p.directStep
  return Number.isInteger(steps) && steps <= MAX_UNITS ? steps : null
}

/** 움직이는 숫자에 쓰는 값과 단위 */
export function unitParts(p: ProductDraft, units: number): { value: number; suffix: string } {
  return isDirectSplit(p) && p.directStep
    ? { value: units * p.directStep, suffix: p.measure }
    : { value: units, suffix: p.unitName.trim() }
}

/** 수량을 화면에 쓰는 문구. 직접 소분이면 ml·g 로 바꿔 보여준다. */
export function formatUnits(p: ProductDraft, units: number): string {
  return isDirectSplit(p) && p.directStep
    ? `${(units * p.directStep).toLocaleString('ko-KR')}${p.measure}`
    : `${units.toLocaleString('ko-KR')}${p.unitName.trim()}`
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
  if (isDirectSplit(p)) {
    if (!isPositiveInt(p.netAmountPerUnit)) {
      out.netAmountPerUnit = '한 용기의 양을 정수로 입력하세요.'
    } else if (!isPositiveInt(p.directStep)) {
      out.directStep = '한 번에 덜어 나눌 양을 입력하세요.'
    } else if (!out.packCount && !out.unitsPerPack && totalUnits(p) === null) {
      out.directStep = '전체 양이 딱 나누어떨어지는 값으로 입력하세요.'
    }
  } else if (p.splitMode === 'direct') {
    out.directStep = '아래 세 가지를 모두 확인해야 덜어 나눌 수 있어요. 아니면 포장 단위로 나누세요.'
  }
  if (!out.packCount && !out.unitsPerPack && !isDirectSplit(p) && totalUnits(p) === null) {
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
