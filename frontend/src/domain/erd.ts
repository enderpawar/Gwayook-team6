import { displayName } from './product'
import type { Post } from './post'
import type { Settlement } from './settlement'
import type { PlanDraft, ProductDraft, ReferenceDraft } from './types'

/**
 * docs/ERD.md 의 product_analysis, group_buy, settlement_share 컬럼에 맞춘 값.
 * ERD 에서 NOT NULL 이지만 PRD v1.1 이 미입력을 허용하는 값은 null 로 남긴다.
 * 금액은 PRD v1.1 4장(수량 비례)으로 계산한 값이라 ERD 의 균등 분할과 다를 수 있다.
 */
export function toErdRows(input: {
  product: ProductDraft
  reference: ReferenceDraft
  plan: PlanDraft
  settlement: Extract<Settlement, { ok: true }>
  post: Post
}) {
  const { product, reference, plan, settlement, post } = input
  return {
    productAnalysis: {
      source: product.source === 'preset' ? ('PRESET' as const) : ('UPLOAD' as const),
      engine: product.source === 'capture' ? ('GEMINI' as const) : ('FALLBACK' as const),
      short_name: displayName(product),
      full_title: product.fullTitle.trim(),
      unit_name: product.unitName.trim(),
      bulk_total_qty: settlement.totalUnits,
      bulk_total_price: settlement.total,
      small_pack_qty: reference.unitCount,
      small_pack_price: reference.price,
      annual_purchase_count: reference.purchasesPerYear,
    },
    groupBuy: {
      headcount: plan.headcount,
      pickup_location: plan.place,
      title: post.title,
      content: post.body,
      status: 'OPEN' as const,
    },
    settlementShares: settlement.shares.map((s) => ({
      seat_no: s.seat,
      qty: s.units,
      amount: s.amount,
    })),
  }
}
