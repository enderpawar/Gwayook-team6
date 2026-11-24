import { formatDeadline, percent, won } from '@/lib/format'
import type { Comparison } from './comparison'
import { displayName } from './product'
import type { Settlement } from './settlement'
import type { PlanDraft, ProductDraft } from './types'

export interface PostInput {
  product: ProductDraft
  plan: PlanDraft
  settlement: Extract<Settlement, { ok: true }>
  estimated: boolean
  comparison: Comparison
  referenceName: string
}

export interface Post {
  title: string
  body: string
}

const range = (values: number[], format: (n: number) => string) => {
  const min = Math.min(...values)
  const max = Math.max(...values)
  return min === max ? format(min) : `${format(min)}~${format(max)}`
}

export function buildPost(input: PostInput): Post {
  const { product, plan, settlement, estimated, comparison, referenceName } = input
  const name = displayName(product)
  const unit = product.unitName.trim()
  const host = settlement.shares[0]!
  const guests = settlement.shares.slice(1)
  const tag = estimated ? ' (예상)' : ''
  const units = (n: number) => `${n}${unit}`

  const lines = [
    `📦 상품: ${product.fullTitle.trim()}${product.selectedOption.trim() ? ` / ${product.selectedOption.trim()}` : ''}`,
    `👥 모집: ${guests.length}자리 (방장 포함 ${settlement.shares.length}명)`,
    `✂️ 1인당: ${range(guests.map((g) => g.units), units)}, ${range(guests.map((g) => g.amount), won)}${tag}`,
  ]
  if (host.units !== guests[0]!.units || host.amount !== guests[0]!.amount) {
    lines.push(`   방장: ${units(host.units)}, ${won(host.amount)}${tag}`)
  }
  lines.push(`💰 총 결제 금액: ${won(settlement.total)}${tag}`)
  if (comparison.ok && comparison.savingsRate > 0) {
    const against = referenceName.trim() || '소용량'
    lines.push(`📉 ${against}보다 ${comparison.basisLabel}당 ${percent(comparison.savingsRate)} 저렴해요${tag}`)
  }
  lines.push(
    '',
    `📍 수령 장소: ${plan.place?.trim() || '미정'}`,
    `⏰ 마감: ${formatDeadline(plan.deadline) ?? '미정'}`,
    `🙋 신청: ${plan.applyMethod.trim() || '댓글이나 쪽지로 알려 주세요'}`,
  )
  if (estimated) lines.push('', '※ 금액은 주문 시점에 달라질 수 있고, 확정되면 다시 알려 드릴게요.')

  return { title: `[공구] ${name} 같이 나눌 ${guests.length}명 구해요`, body: lines.join('\n') }
}
