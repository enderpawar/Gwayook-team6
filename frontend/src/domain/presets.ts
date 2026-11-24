import { blankProduct, blankReference } from './product'
import type { ProductDraft, ReferenceDraft } from './types'

export interface Preset {
  id: 'roll' | 'water' | 'softener'
  label: string
  detail: string
  product: ProductDraft
  reference: ReferenceDraft
}

const product = (p: Partial<ProductDraft>): ProductDraft => ({
  ...blankProduct('preset'),
  packCount: 1,
  shippingMode: 'included',
  discountMode: 'none',
  ...p,
})

const reference = (r: Partial<ReferenceDraft>): ReferenceDraft => ({
  ...blankReference(),
  sourceKind: 'preset',
  ...r,
})

/** 시연용 예시 값이다. 실제 판매 가격이 아니다. */
export const PRESETS: Preset[] = [
  {
    id: 'roll',
    label: '롤휴지',
    detail: '30롤',
    product: product({
      fullTitle: '3겹 롤휴지 30m 30롤',
      shortName: '롤휴지 30롤',
      unitName: '롤',
      unitsPerPack: 30,
      displayedPrice: 17700,
    }),
    reference: reference({
      name: '같은 롤휴지 6롤',
      price: 7800,
      unitCount: 6,
      sameSpecConfirmed: true,
      purchasesPerYear: 4,
    }),
  },
  {
    id: 'water',
    label: '생수',
    detail: '2L 24병',
    product: product({
      fullTitle: '무라벨 생수 2L 24병',
      shortName: '생수 2L 24병',
      unitName: '병',
      packCount: 4,
      unitsPerPack: 6,
      netAmountPerUnit: 2000,
      measure: 'ml',
      displayedPrice: 16800,
    }),
    reference: reference({
      name: '생수 500ml 6병',
      price: 2700,
      unitCount: 6,
      netAmountPerUnit: 500,
      measure: 'ml',
      purchasesPerYear: 6,
    }),
  },
  {
    id: 'softener',
    label: '섬유유연제',
    detail: '4L, 1L 리필 4팩',
    product: product({
      fullTitle: '섬유유연제 리필 1L 4팩',
      shortName: '섬유유연제 4L',
      unitName: '팩',
      unitsPerPack: 4,
      netAmountPerUnit: 1000,
      measure: 'ml',
      displayedPrice: 13900,
    }),
    reference: reference({
      name: '섬유유연제 본품 500ml',
      price: 3900,
      unitCount: 1,
      netAmountPerUnit: 500,
      measure: 'ml',
      purchasesPerYear: 3,
    }),
  },
]
