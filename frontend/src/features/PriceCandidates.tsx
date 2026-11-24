import type { PriceCandidate } from '@/domain/types'
import { cn } from '@/lib/cn'
import { won } from '@/lib/format'

interface Props {
  candidates: PriceCandidate[]
  selected: number | null
  onSelect: (amount: number) => void
}

export function PriceCandidates({ candidates, selected, onSelect }: Props) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">캡처에서 찾은 가격 중 결제할 금액을 고르세요</legend>
      <div className="grid gap-2">
        {candidates.map((c, i) => (
          <label
            key={i}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-control p-3.5 ring-inset',
              'has-focus-visible:outline-3 has-focus-visible:outline-cobalt',
              selected === c.amount ? 'bg-cobalt-wash ring-2 ring-cobalt' : 'ring-1 ring-line',
            )}
          >
            <input
              type="radio"
              name="price-candidate"
              className="size-5 shrink-0 accent-cobalt"
              checked={selected === c.amount}
              onChange={() => onSelect(c.amount)}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{c.kind}</span>
              {c.condition && <span className="block text-sm text-ink-soft">조건: {c.condition}</span>}
              {c.evidence && <span className="block text-sm text-ink-soft">화면 문구: {c.evidence}</span>}
            </span>
            <span className="font-bold tabular-nums">{won(c.amount)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
