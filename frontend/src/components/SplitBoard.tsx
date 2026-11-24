import { LayoutGroup, motion } from 'motion/react'
import { useId, useMemo } from 'react'
import { cn } from '@/lib/cn'
import { SEAT_BG, SEAT_TEXT, seatName } from './seats'
import { UnitIcon } from './UnitIcon'

const MAX_TOKENS = 60

interface Props {
  /** 자리별 수량. 하나뿐이면 아직 나누지 않은 묶음으로 보여준다. */
  allocation: number[]
  unitName: string
  className?: string
}

/** 상품을 낱개로 펼쳐 인원별 더미로 옮겨 보여주는 판. 수량이 많으면 비율 막대로 바꾼다. */
export function SplitBoard({ allocation, unitName, className }: Props) {
  const groupId = useId()
  const total = allocation.reduce((a, b) => a + b, 0)
  const whole = allocation.length === 1
  const label = whole
    ? `전체 ${total}${unitName}`
    : allocation.map((n, seat) => `${seatName(seat)} ${n}${unitName}`).join(', ')

  const piles = useMemo(() => {
    let next = 0
    return allocation.map((n) => Array.from({ length: n }, () => next++))
  }, [allocation])

  if (total > MAX_TOKENS) return <RatioBars allocation={allocation} unitName={unitName} label={label} className={className} />

  return (
    <LayoutGroup id={groupId}>
      <div role="img" aria-label={label} className={cn('grid gap-2', whole ? 'grid-cols-1' : 'grid-cols-2', className)}>
        {piles.map((units, seat) => (
          <motion.div
            layout
            key={seat}
            className="min-w-0 rounded-control bg-surface p-3"
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          >
            <motion.p layout="position" className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{whole ? '한 묶음' : seatName(seat)}</span>
              <span className="font-display text-lg tabular-nums">
                {units.length}
                {unitName}
              </span>
            </motion.p>
            <div className="mt-2 flex min-h-14 flex-wrap content-start gap-1">
              {units.map((unit, i) => (
                <motion.span
                  key={unit}
                  layoutId={`unit-${unit}`}
                  className={cn('size-6', whole ? 'text-ink' : SEAT_TEXT[seat])}
                  transition={{ type: 'spring', stiffness: 260, damping: 24, delay: i * 0.012 + seat * 0.05 }}
                >
                  <UnitIcon unit={unitName} className="size-full" />
                </motion.span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </LayoutGroup>
  )
}

function RatioBars({ allocation, unitName, label, className }: Props & { label: string }) {
  const max = Math.max(...allocation)
  return (
    <div role="img" aria-label={label} className={cn('space-y-3 rounded-control bg-surface p-4', className)}>
      {allocation.map((n, seat) => (
        <div key={seat}>
          <p className="flex justify-between text-sm">
            <span className="font-semibold">{allocation.length === 1 ? '한 묶음' : seatName(seat)}</span>
            <span className="tabular-nums">
              {n}
              {unitName}
            </span>
          </p>
          <motion.div
            className={cn('mt-1 h-3 rounded-r-sm', SEAT_BG[seat])}
            initial={false}
            animate={{ width: `${(n / max) * 100}%` }}
          />
        </div>
      ))}
    </div>
  )
}
