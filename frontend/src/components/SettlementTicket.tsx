import { CircleCheck } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Comparison } from '@/domain/comparison'
import type { Settlement } from '@/domain/settlement'
import { cn } from '@/lib/cn'
import { won } from '@/lib/format'
import { AnimatedNumber } from './AnimatedNumber'
import { SEAT_BG, seatName } from './seats'

interface Props {
  settlement: Extract<Settlement, { ok: true }>
  comparison: Comparison
  unitName: string
  estimated: boolean
  title: string
}

const HEAD = 4.75

export function SettlementTicket({ settlement, comparison, unitName, estimated, title }: Props) {
  const sum = settlement.shares.reduce((a, s) => a + s.amount, 0)
  return (
    <section aria-label="정산표" className="ticket" style={{ '--notch': `${HEAD}rem` } as CSSProperties}>
      <header className="flex items-center justify-between gap-3 px-5" style={{ height: `${HEAD}rem` }}>
        <div className="min-w-0">
          <h2 className="truncate font-bold">{title}</h2>
          <p className="text-sm text-ink-soft">{estimated ? '예상 정산표' : '확정 금액 정산표'}</p>
        </div>
        <p className="shrink-0 font-display text-2xl tabular-nums">
          <AnimatedNumber value={settlement.total} suffix="원" />
        </p>
      </header>
      <div className="mx-5 border-t-2 border-dashed border-line" />
      <table className="w-full text-left">
        <thead>
          <tr className="text-sm text-ink-soft">
            <th scope="col" className="py-2 pl-5 font-medium">받는 사람</th>
            <th scope="col" className="py-2 text-right font-medium">수량</th>
            <th scope="col" className="py-2 pr-5 text-right font-medium">부담금</th>
          </tr>
        </thead>
        <tbody>
          {settlement.shares.map((s) => {
            const saved = comparison.ok ? comparison.savedFor(s.units, s.amount) : null
            return (
              <tr key={s.seat} className="border-t border-line/60 align-top">
                <th scope="row" className="py-3 pl-5 font-semibold">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cn('size-3 shrink-0 rounded-full', SEAT_BG[s.seat])} />
                    {seatName(s.seat)}
                  </span>
                </th>
                <td className="py-3 text-right tabular-nums">
                  <AnimatedNumber value={s.units} suffix={unitName} />
                </td>
                <td className="py-3 pr-5 text-right">
                  <span className="text-lg font-bold tabular-nums">
                    <AnimatedNumber value={s.amount} suffix="원" />
                  </span>
                  {saved !== null && (
                    <span className="block text-sm text-ink-soft tabular-nums">
                      {saved >= 0 ? `${won(saved)} 절약` : `${won(-saved)} 더 냄`}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink text-sm font-semibold">
            <th scope="row" className="py-3 pl-5">합계</th>
            <td className="py-3 text-right tabular-nums">
              {settlement.totalUnits}
              {unitName}
            </td>
            <td className="py-3 pr-5 text-right tabular-nums">{won(sum)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="flex items-center gap-1.5 px-5 pb-4 text-sm text-ink-soft">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        부담금 합계가 결제 금액과 같아요.
      </p>
    </section>
  )
}
