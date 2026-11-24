import { motion } from 'motion/react'
import type { Comparison } from '@/domain/comparison'
import { cn } from '@/lib/cn'
import { percent, unitWon } from '@/lib/format'

interface Props {
  comparison: Extract<Comparison, { ok: true }>
  bulkName: string
  referenceName: string
  bulkNote: string
  referenceNote: string
}

export function PriceBars({ comparison, bulkName, referenceName, bulkNote, referenceNote }: Props) {
  const { bulk, reference, basisLabel, savingsRate } = comparison
  const max = Math.max(bulk.perBasis, reference.perBasis)
  const rows = [
    { key: 'bulk', name: bulkName, value: bulk.perBasis, note: bulkNote, color: 'bg-cobalt' },
    { key: 'ref', name: referenceName, value: reference.perBasis, note: referenceNote, color: 'bg-neutral-bar' },
  ]
  return (
    <figure>
      <figcaption className="text-sm text-ink-soft">{basisLabel}당 가격</figcaption>
      <div className="mt-3 space-y-4">
        {rows.map((r) => (
          <div key={r.key} className="group" title={`${r.name}: ${r.note}`}>
            <p className="text-sm font-semibold">{r.name}</p>
            <div className="mt-1 flex items-center gap-2">
              <motion.div
                className={cn('h-6 min-w-1 origin-left rounded-r', r.color)}
                style={{ width: `calc((100% - 6.5rem) * ${r.value / max})` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              />
              <span className="shrink-0 font-display text-xl tabular-nums">{unitWon(r.value)}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft tabular-nums">{r.note}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold">
        {savingsRate > 0
          ? `함께 사면 ${basisLabel}당 ${unitWon(reference.perBasis - bulk.perBasis)}(${percent(savingsRate)}) 더 싸요.`
          : savingsRate < 0
            ? `함께 사면 ${basisLabel}당 ${unitWon(bulk.perBasis - reference.perBasis)}(${percent(savingsRate)}) 더 비싸요. 소용량을 사는 편이 나아요.`
            : '두 상품의 단가가 같아요.'}
      </p>
    </figure>
  )
}
