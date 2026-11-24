import { CircleAlert, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  tone?: 'info' | 'warn' | 'error'
  children: ReactNode
  className?: string
}

const TONES = {
  info: 'bg-cobalt-wash',
  warn: 'bg-tag/35',
  error: 'bg-danger-wash',
}

export function Notice({ tone = 'info', children, className }: Props) {
  const Icon = tone === 'info' ? Info : CircleAlert
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('flex gap-2.5 rounded-control p-3.5 text-sm leading-relaxed', TONES[tone], className)}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4.5 shrink-0', tone === 'error' && 'text-danger')} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
