import { CircleCheck } from 'lucide-react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { won } from '@/lib/format'
import { AnimatedNumber } from './AnimatedNumber'
import { SEAT_BG } from './seats'

export interface TicketRow {
  id: string
  name: string
  units: { value: number; suffix: string }
  amount: number
  saved: number | null
  /** 바뀌기 전 금액. 같으면 생략한다. */
  before?: number
}

interface Props {
  title: string
  caption: string
  total: number
  totalUnits: string
  rows: TicketRow[]
}

const HEAD = 4.75

export function SettlementTicket({ title, caption, total, totalUnits, rows }: Props) {
  const sum = rows.reduce((a, s) => a + s.amount, 0)
  return (
    <section aria-label="정산표" className="ticket" style={{ '--notch': `${HEAD}rem` } as CSSProperties}>
      <header className="flex items-center justify-between gap-3 px-5" style={{ height: `${HEAD}rem` }}>
        <div className="min-w-0">
          <h2 className="truncate font-bold">{title}</h2>
          <p className="truncate text-sm text-ink-soft">{caption}</p>
        </div>
        <p className="shrink-0 font-display text-2xl tabular-nums">
          <AnimatedNumber value={total} suffix="원" />
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
          {rows.map((s, seat) => (
            <tr key={s.id} className="border-t border-line/60 align-top">
              <th scope="row" className="max-w-36 py-3 pl-5 font-semibold">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn('size-3 shrink-0 rounded-full', SEAT_BG[seat])} />
                  <span className="min-w-0 truncate">{s.name}</span>
                </span>
              </th>
              <td className="py-3 text-right tabular-nums">
                <AnimatedNumber value={s.units.value} suffix={s.units.suffix} />
              </td>
              <td className="py-3 pr-5 text-right">
                {s.before !== undefined && s.before !== s.amount && (
                  <span className="block text-sm text-ink-soft tabular-nums">
                    <span className="sr-only">이전 </span>
                    <s>{won(s.before)}</s>
                  </span>
                )}
                <span className="text-lg font-bold tabular-nums">
                  <AnimatedNumber value={s.amount} suffix="원" />
                </span>
                {s.saved !== null && (
                  <span className="block text-sm text-ink-soft tabular-nums">
                    {s.saved >= 0 ? `${won(s.saved)} 절약` : `${won(-s.saved)} 더 냄`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink text-sm font-semibold">
            <th scope="row" className="py-3 pl-5">합계</th>
            <td className="py-3 text-right tabular-nums">{totalUnits}</td>
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
