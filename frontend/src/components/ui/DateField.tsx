import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'
import { addDays, parts, todayYmd, weekday } from '@/lib/calendar'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Calendar } from './Calendar'
import { Dialog } from './Dialog'
import { controlClass } from './Field'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '10', '20', '30', '40', '50']

interface Props {
  id?: string
  'aria-describedby'?: string
  /** 창 제목과 버튼 이름에 쓴다. */
  label: string
  /** date: YYYY-MM-DD, datetime: YYYY-MM-DDTHH:mm */
  mode: 'date' | 'datetime'
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  clearable?: boolean
}

const dateText = (date: string) => {
  const { y, m, d } = parts(date)
  const year = y === new Date().getFullYear() ? '' : `${y}년 `
  return `${year}${m}월 ${d}일(${DAYS[weekday(date)]})`
}

/** 브라우저 기본 달력 대신 쓰는 날짜·시간 선택. 휴대폰에서는 아래에서 올라온다. */
export function DateField({ id, label, mode, value, onChange, min, max, clearable = true, ...aria }: Props) {
  const [open, setOpen] = useState(false)
  const shown = value ? `${dateText(value.slice(0, 10))}${mode === 'datetime' ? ` ${value.slice(11, 16)}` : ''}` : ''
  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        {...aria}
        onClick={() => setOpen(true)}
        className={cn(controlClass, 'flex items-center gap-2.5 text-left', clearable && value && 'pr-12')}
      >
        <CalendarDays aria-hidden className="size-5 shrink-0 text-ink-soft" />
        <span className={cn('truncate tabular-nums', !shown && 'text-ink-soft')}>{shown || '날짜 고르기'}</span>
      </button>
      {clearable && value && (
        <button type="button" aria-label={`${label} 지우기`} onClick={() => onChange('')} className="absolute inset-y-0 right-0.5 grid w-11 place-items-center rounded-control">
          <X aria-hidden className="size-4" />
        </button>
      )}
      {open && <Picker label={label} mode={mode} value={value} min={min} max={max} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  )
}

interface PickerProps {
  label: string
  mode: 'date' | 'datetime'
  value: string
  min?: string
  max?: string
  onPick: (value: string) => void
  onClose: () => void
}

function Picker({ label, mode, value, min, max, onPick, onClose }: PickerProps) {
  const today = todayYmd()
  const [date, setDate] = useState<string | null>(value ? value.slice(0, 10) : null)
  const [hour, setHour] = useState(value.slice(11, 13) || '18')
  const [minute, setMinute] = useState(value.slice(14, 16) || '00')
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort()
  const allowed = (d: string) => (!min || d >= min.slice(0, 10)) && (!max || d <= max.slice(0, 10))
  const result = date && (mode === 'date' ? date : `${date}T${hour}:${minute}`)
  const tooEarly = Boolean(result && min && mode === 'datetime' && min.length > 10 && result < min)
  const tooLate = Boolean(result && max && mode === 'datetime' && max.length > 10 && result > max)

  const quick = [
    { name: '오늘', date: today },
    { name: '내일', date: addDays(today, 1) },
    { name: '이번 토요일', date: addDays(today, (6 - weekday(today) + 7) % 7) },
    { name: '일주일 뒤', date: addDays(today, 7) },
  ].filter((q, i, all) => allowed(q.date) && all.findIndex((x) => x.date === q.date) === i)

  const choose = (next: string) => {
    setDate(next)
    if (mode === 'date') {
      onPick(next)
      onClose()
    }
  }
  const select = 'select-chevron h-12 rounded-control bg-surface pl-3.5 text-base tabular-nums ring-1 ring-line ring-inset'

  return (
    <Dialog title={label} onClose={onClose}>
      {mode === 'datetime' && quick.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q.name} variant={q.date === date ? 'ink' : 'outline'} className="min-h-11 px-4 text-sm" aria-pressed={q.date === date} onClick={() => choose(q.date)}>
              {q.name}
            </Button>
          ))}
        </div>
      )}
      <Calendar value={date} onSelect={choose} min={min?.slice(0, 10)} max={max?.slice(0, 10)} />
      {mode === 'datetime' && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <span className="mr-auto text-sm font-semibold">시간</span>
            <select aria-label="시" className={cn(select, 'w-24')} value={hour} onChange={(e) => setHour(e.target.value)}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}시
                </option>
              ))}
            </select>
            <select aria-label="분" className={cn(select, 'w-24')} value={minute} onChange={(e) => setMinute(e.target.value)}>
              {minutes.map((m) => (
                <option key={m} value={m}>
                  {m}분
                </option>
              ))}
            </select>
          </div>
          <p role="status" className="mt-2 min-h-5 text-sm text-danger">
            {tooEarly ? '더 늦은 시간을 골라 주세요.' : tooLate ? '지금보다 이른 시간을 골라 주세요.' : ''}
          </p>
          <Button
            className="mt-2 w-full"
            disabled={!result || tooEarly || tooLate}
            onClick={() => {
              if (!result) return
              onPick(result)
              onClose()
            }}
          >
            {date ? `${dateText(date)} ${hour}:${minute}로 정하기` : '날짜를 골라 주세요'}
          </Button>
        </>
      )}
    </Dialog>
  )
}
