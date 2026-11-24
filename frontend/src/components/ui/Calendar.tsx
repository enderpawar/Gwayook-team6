import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { addDays, addMonths, monthGrid, parts, sameMonth, todayYmd, weekday } from '@/lib/calendar'
import { cn } from '@/lib/cn'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

interface Props {
  value: string | null
  onSelect: (date: string) => void
  min?: string
  max?: string
}

const label = (date: string) => {
  const { y, m, d } = parts(date)
  return `${y}년 ${m}월 ${d}일 ${DAYS[weekday(date)]}요일`
}

/** 가격표처럼 노란 머리를 단 달력. 방향키, Home/End, PageUp/PageDown 으로 움직인다. */
export function Calendar({ value, onSelect, min, max }: Props) {
  const today = todayYmd()
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max)
  const [cursor, setCursor] = useState(() => {
    const start = value ?? today
    return min && start < min ? min : max && start > max ? max : start
  })
  const [slide, setSlide] = useState(0)
  const grid = useRef<HTMLTableElement>(null)
  const moved = useRef(false)

  useEffect(() => {
    if (!moved.current) return
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)?.focus()
  }, [cursor])

  // 바깥에서 날짜를 고르면(오늘, 내일 등) 그 달로 옮긴다.
  useEffect(() => {
    if (value) setCursor(value)
  }, [value])

  const go = (next: string, byKeyboard: boolean) => {
    moved.current = byKeyboard
    if (!sameMonth(next, cursor)) setSlide(next > cursor ? 1 : -1)
    setCursor(next)
  }

  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, string> = {
      ArrowLeft: addDays(cursor, -1),
      ArrowRight: addDays(cursor, 1),
      ArrowUp: addDays(cursor, -7),
      ArrowDown: addDays(cursor, 7),
      Home: addDays(cursor, -weekday(cursor)),
      End: addDays(cursor, 6 - weekday(cursor)),
      PageUp: addMonths(cursor, -1),
      PageDown: addMonths(cursor, 1),
    }
    const next = step[e.key]
    if (!next) return
    e.preventDefault()
    go(next, true)
  }

  const { y, m } = parts(cursor)
  return (
    <div className="overflow-hidden rounded-panel ring-1 ring-line ring-inset">
      <div className="flex items-center justify-between bg-tag px-2 py-1.5">
        <button type="button" aria-label="이전 달" className="grid size-11 place-items-center rounded-full hover:bg-ink/10" onClick={() => go(addMonths(cursor, -1), false)}>
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <p aria-live="polite" className="font-display text-xl tabular-nums">
          {y}년 {m}월
        </p>
        <button type="button" aria-label="다음 달" className="grid size-11 place-items-center rounded-full hover:bg-ink/10" onClick={() => go(addMonths(cursor, 1), false)}>
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </div>
      <div className="overflow-hidden bg-surface p-2">
        <motion.table
          key={`${y}-${m}`}
          ref={grid}
          role="grid"
          aria-label={`${y}년 ${m}월`}
          className="w-full table-fixed text-center"
          initial={slide === 0 ? false : { x: slide * 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onKeyDown={onKey}
        >
          <thead>
            <tr>
              {DAYS.map((d, i) => (
                <th key={d} scope="col" abbr={`${d}요일`} className={cn('py-1.5 text-sm font-semibold', i === 0 ? 'text-danger' : 'text-ink-soft')}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(cursor).map((week) => (
              <tr key={week[0]}>
                {week.map((date, i) => {
                  const selected = date === value
                  const outside = !sameMonth(date, cursor)
                  const disabled = !allowed(date)
                  return (
                    <td key={date} aria-selected={selected} className="p-0.5">
                      <button
                        type="button"
                        data-date={date}
                        tabIndex={date === cursor ? 0 : -1}
                        aria-label={label(date)}
                        aria-current={date === today ? 'date' : undefined}
                        aria-disabled={disabled || undefined}
                        onClick={() => {
                          if (disabled) return
                          go(date, false)
                          onSelect(date)
                        }}
                        className={cn(
                          'relative grid aspect-square w-full max-h-11 place-items-center rounded-full text-base tabular-nums transition-colors',
                          selected
                            ? 'bg-cobalt font-bold text-white'
                            : disabled
                              ? 'cursor-not-allowed text-ink-soft line-through decoration-ink-soft/50'
                              : cn('hover:bg-cobalt-wash', outside ? 'text-ink-soft' : i === 0 && 'text-danger'),
                          date === today && !selected && 'font-bold ring-2 ring-ink ring-inset',
                        )}
                      >
                        {parts(date).d}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </motion.table>
      </div>
    </div>
  )
}
