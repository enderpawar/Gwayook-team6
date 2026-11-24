import { isPositiveInt, paymentTotal, totalUnits } from './product'
import type { Measure, ProductDraft, ReferenceDraft } from './types'

export type HoldReason =
  | 'missingProduct'
  | 'missingReference'
  | 'missingSpec'
  | 'incompatible'
  | 'specUnconfirmed'

export interface UnitPrice {
  /** 표시 기준량(예: 100ml)당 가격. 표시용 근사값이다. */
  perBasis: number
}

export type Comparison =
  | {
      ok: true
      basisLabel: string
      bulk: UnitPrice
      reference: UnitPrice
      savingsRate: number
      /** 받은 수량을 소용량 단가로 환산한 값에서 부담금을 뺀 원 단위 금액. 음수면 손해다. */
      savedFor: (units: number, amount: number) => number
    }
  | { ok: false; reason: HoldReason; message: string }

const MESSAGES: Record<HoldReason, string> = {
  missingProduct: '대용량 상품의 수량과 결제 금액이 있어야 비교할 수 있어요.',
  missingReference: '소용량 상품의 가격과 수량을 입력하면 절감률을 보여드려요.',
  missingSpec: '두 상품의 한 개당 용량을 모두 입력해야 비교할 수 있어요.',
  incompatible: '두 상품의 비교 단위가 달라서 비교할 수 없어요. 단위를 맞춰 주세요.',
  specUnconfirmed: '개수로 비교하려면 두 상품의 규격이 같은지 확인해 주세요.',
}

const hold = (reason: HoldReason): Comparison => ({ ok: false, reason, message: MESSAGES[reason] })

/** 소수 셋째 자리까지의 규격을 정수로 바꿔 정확히 계산한다. */
const SCALE = 1000
const toScaled = (n: number) => BigInt(Math.round(n * SCALE))

const BASIS: Record<Measure, { size: number; label: string }> = {
  count: { size: 1, label: '1개' },
  ml: { size: 100, label: '100ml' },
  g: { size: 100, label: '100g' },
  m: { size: 10, label: '10m' },
}

function perUnitAmount(measure: Measure, net: number | null): bigint | null {
  if (measure === 'count') return BigInt(SCALE)
  if (net === null || !Number.isFinite(net)) return null
  const scaled = toScaled(net)
  return scaled > 0n ? scaled : null
}

/** 0.5 는 0 에서 먼 쪽으로 반올림한다. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n
  const abs = negative ? -numerator : numerator
  const rounded = (abs * 2n + denominator) / (denominator * 2n)
  return negative ? -rounded : rounded
}

export function compare(product: ProductDraft, reference: ReferenceDraft): Comparison {
  const { total } = paymentTotal(product)
  const units = totalUnits(product)
  if (total === null || units === null) return hold('missingProduct')
  if (!isPositiveInt(reference.price) || !isPositiveInt(reference.unitCount)) {
    return hold('missingReference')
  }
  if (product.measure !== reference.measure) return hold('incompatible')

  const bulkPer = perUnitAmount(product.measure, product.netAmountPerUnit)
  const refPer = perUnitAmount(reference.measure, reference.netAmountPerUnit)
  if (bulkPer === null || refPer === null) return hold('missingSpec')
  if (product.measure === 'count' && !reference.sameSpecConfirmed) return hold('specUnconfirmed')

  const bulkAmount = BigInt(units) * bulkPer
  const refAmount = BigInt(reference.unitCount) * refPer
  const P = BigInt(total)
  const S = BigInt(reference.price)
  const { size, label } = BASIS[product.measure]
  const perBasis = (price: bigint, amount: bigint) =>
    (Number(price) * size * SCALE) / Number(amount)

  return {
    ok: true,
    basisLabel: product.measure === 'count' ? `1${product.unitName || '개'}` : label,
    bulk: { perBasis: perBasis(P, bulkAmount) },
    reference: { perBasis: perBasis(S, refAmount) },
    savingsRate: (1 - Number(P * refAmount) / Number(S * bulkAmount)) * 100,
    savedFor: (u, amount) =>
      Number(roundDiv(S * BigInt(u) * bulkPer - BigInt(amount) * refAmount, refAmount)),
  }
}
