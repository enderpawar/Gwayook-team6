import { Ban, CircleCheck, Clock, Coins, PackageOpen, PencilLine, Users } from 'lucide-react'
import { STATUS_LABEL, type GigStatus } from '@/domain/gig/types'
import { cn } from '@/lib/cn'

const ICON = { draft: PencilLine, recruiting: Users, closed: Clock, settling: Coins, pickup: PackageOpen, done: CircleCheck, cancelled: Ban }

const TONE: Record<GigStatus, string> = {
  draft: 'bg-paper text-ink',
  recruiting: 'bg-cobalt text-white',
  closed: 'bg-ink text-white',
  settling: 'bg-tag text-ink',
  pickup: 'bg-tag text-ink',
  done: 'bg-cobalt-wash text-ink',
  cancelled: 'bg-danger-wash text-danger',
}

export function StatusBadge({ status, label }: { status: GigStatus; label?: string }) {
  const Icon = ICON[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold', TONE[status])}>
      <Icon aria-hidden className="size-4" />
      {label ?? STATUS_LABEL[status]}
    </span>
  )
}
