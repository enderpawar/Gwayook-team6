import { motion } from 'motion/react'
import { useId } from 'react'
import { cn } from '@/lib/cn'

interface Props<T extends string | number> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
  tone?: 'light' | 'onTag'
}

/** 선택 표시가 미끄러지는 라디오 묶음. 키보드는 브라우저 기본 라디오 동작을 따른다. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
  tone = 'light',
}: Props<T>) {
  const id = useId()
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div className={cn('flex rounded-full p-1', tone === 'light' ? 'bg-paper' : 'bg-ink/12')}>
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={o.value}
              className={cn(
                'relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-full px-3 text-center text-sm font-semibold',
                'has-focus-visible:outline-3 has-focus-visible:outline-cobalt',
                checked ? 'text-white' : 'text-ink',
              )}
            >
              <input
                type="radio"
                name={id}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(o.value)}
              />
              {checked && (
                <motion.span
                  layoutId={`${id}-pill`}
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                />
              )}
              <span className="relative">{o.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
