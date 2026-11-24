/** 비교 단위. count 는 규격이 같은 상품을 개수로 비교할 때만 쓴다. */
export type Measure = 'count' | 'ml' | 'g' | 'm'

/** included: 결제 금액에 이미 반영됨, separate: 따로 더하거나 빼야 함, none: 없음, unknown: 미확인 */
export type ShippingMode = 'included' | 'separate' | 'none' | 'unknown'
export type DiscountMode = 'included' | 'apply' | 'none' | 'unknown'

export type FieldName =
  | 'fullTitle'
  | 'packCount'
  | 'unitsPerPack'
  | 'unitName'
  | 'netAmountPerUnit'
  | 'displayedPrice'
  | 'shippingFee'
  | 'discountAmount'
  | 'selectedOption'

export type Source = 'preset' | 'capture' | 'manual'

export interface PriceCandidate {
  amount: number
  kind: string
  condition: string | null
  evidence: string | null
}

/** 사용자가 확인·수정하는 대용량 상품. 숫자 null 은 "미확인"을 뜻한다. */
export interface ProductDraft {
  source: Source
  fullTitle: string
  shortName: string
  selectedOption: string
  packCount: number | null
  unitsPerPack: number | null
  unitName: string
  netAmountPerUnit: number | null
  measure: Measure
  displayedPrice: number | null
  shippingMode: ShippingMode
  shippingFee: number | null
  discountMode: DiscountMode
  discountAmount: number | null
  priceConfirmed: boolean
  priceCandidates: PriceCandidate[]
  unresolvedFields: FieldName[]
}

export interface ReferenceDraft {
  name: string
  price: number | null
  unitCount: number | null
  netAmountPerUnit: number | null
  measure: Measure
  sameSpecConfirmed: boolean
  sourceKind: 'preset' | 'link' | 'manual'
  sourceUrl: string
  checkedOn: string
  purchasesPerYear: number | null
}

export interface PlanDraft {
  headcount: number
  place: string | null
  deadline: string | null
  applyMethod: string
}
