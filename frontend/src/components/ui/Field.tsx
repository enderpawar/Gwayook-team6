import { CircleAlert, CircleHelp } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string
  unresolved?: boolean
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}

export function Field({ label, hint, error, unresolved, children, className }: FieldProps) {
  const id = useId()
  const described = [error && `${id}-e`, hint && `${id}-h`, unresolved && `${id}-u`].filter(Boolean).join(' ')
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {unresolved && (
          <span
            id={`${id}-u`}
            className="inline-flex items-center gap-1 rounded-full bg-tag px-2 py-0.5 text-xs font-semibold"
          >
            <CircleHelp aria-hidden className="size-3.5" />
            미확인
          </span>
        )}
      </div>
      {children({ id, 'aria-describedby': described || undefined, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={`${id}-e`} className="mt-1.5 flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {hint && (
        <p id={`${id}-h`} className="mt-1.5 text-sm text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  )
}

export const controlClass =
  'h-12 w-full min-w-0 rounded-control bg-surface px-3.5 text-base ring-1 ring-inset ring-line ' +
  'transition-shadow hover:ring-ink-soft aria-invalid:ring-2 aria-invalid:ring-danger'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />
}

interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onValue: (value: number | null) => void
  suffix?: string
  decimal?: boolean
}

/** 입력 중에는 원문을 유지하고, 포커스를 잃으면 천 단위 쉼표를 붙인다. */
export function NumberInput({ value, onValue, suffix, decimal, className, ...props }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : num(value))
  return (
    <div className="relative">
      <input
        {...props}
        inputMode={decimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        className={cn(controlClass, 'tabular-nums', suffix && 'pr-12', className)}
        value={shown}
        onFocus={() => setDraft(value === null ? '' : String(value))}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const raw = e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, '').slice(0, 10)
          setDraft(raw)
          const parsed = raw === '' || raw === '.' ? null : Number(raw)
          onValue(parsed !== null && Number.isFinite(parsed) ? parsed : null)
        }}
      />
      {suffix && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-soft"
        >
          {suffix}
        </span>
      )}
    </div>
  )
}
