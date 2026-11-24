import type { Gig } from '@/domain/gig/types'
import { formatUnits } from '@/domain/product'
import { formatDeadline, won } from '@/lib/format'

const time = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function HistorySection({ gig }: { gig: Gig }) {
  const old = gig.settlements.slice(0, -1).reverse()
  if (gig.server && old.length === 0) return null
  return (
    <section aria-labelledby="history-title" className="rounded-panel bg-surface p-5">
      <h2 id="history-title" className="text-lg font-bold">
        기록
      </h2>
      {old.map((v) => (
        <details key={v.version} className="mt-2 rounded-control bg-paper px-4">
          <summary className="cursor-pointer py-3 font-semibold">
            이전 정산 {v.version}차 ({won(v.total)})
          </summary>
          <p className="text-sm text-ink-soft">
            {v.reason}, 주문 {formatDeadline(v.order.orderedAt) ?? '시각 미입력'}
          </p>
          <ul className="py-2 text-sm">
            {v.shares.map((s) => (
              <li key={s.key} className="flex justify-between py-1 tabular-nums">
                <span>
                  {s.alias} {formatUnits(gig.product, s.units)}
                </span>
                <span>{won(s.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {!gig.server && <details className="mt-2">
        <summary className="cursor-pointer py-3 text-sm font-semibold">모든 활동 {gig.log.length}건</summary>
        <ol className="border-l-2 border-line pl-4 text-sm">
          {[...gig.log].reverse().map((l, i) => (
            <li key={i} className="py-1.5">
              <span className="text-ink-soft tabular-nums">{time(l.at)}</span> <strong className="font-semibold">{l.by}</strong> {l.text}
            </li>
          ))}
        </ol>
      </details>}
    </section>
  )
}
