import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const VARIANTS = {
  primary: 'bg-cobalt text-white hover:bg-cobalt-deep',
  ink: 'bg-ink text-white hover:bg-ink/90',
  outline: 'bg-surface text-ink ring-1 ring-inset ring-line hover:ring-ink-soft',
  ghost: 'text-ink-soft hover:bg-ink/5 hover:text-ink',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
}

export function Button({ variant = 'primary', className, type = 'button', ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 font-semibold',
        'transition-[background-color,box-shadow,scale] duration-150 active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft disabled:active:scale-100',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
