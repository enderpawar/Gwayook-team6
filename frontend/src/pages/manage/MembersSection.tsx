import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { store, useAction } from '@/data/useStore'
import { applicants, approved, seatsLeft } from '@/domain/gig/select'
import type { Command, Gig, Participant } from '@/domain/gig/types'

const STATUS = { applied: '신청', approved: '승인', excluded: '제외', withdrawn: '철회' }

export function MembersSection({ gig }: { gig: Gig }) {
  const { run, pending, error } = useAction()
  const send = (c: Command) => void run(() => store.execute(gig.id, c))
  const editable = gig.status === 'recruiting' || gig.status === 'closed'
  const left = seatsLeft(gig)
  const past = gig.participants.filter((p) => p.status === 'excluded' || p.status === 'withdrawn')

  const row = (p: Participant, actions: React.ReactNode) => (
    <motion.li
      key={p.id}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{p.alias}</span>
        <span className="block text-sm text-ink-soft">
          {new Date(p.approvedAt ?? p.appliedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{' '}
          {STATUS[p.status]}
        </span>
      </span>
      <span className="flex gap-2">{actions}</span>
    </motion.li>
  )

  const exclude = (p: Participant) => (
    <Button
      variant="outline"
      className="min-h-11 px-4 text-sm"
      disabled={pending}
      aria-label={`${p.alias} 제외`}
      onClick={() => {
        if (window.confirm(`${p.alias}을(를) 제외할까요? 제외하면 다시 신청할 수 없어요.`)) send({ type: 'exclude', participantId: p.id })
      }}
    >
      <X aria-hidden className="size-4" />
      제외
    </Button>
  )

  return (
    <section aria-labelledby="members-title" className="rounded-panel bg-surface p-5">
      <h2 id="members-title" className="text-lg font-bold">
        참여자
      </h2>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {gig.status === 'recruiting' && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-ink-soft">승인을 기다리는 신청</h3>
          {applicants(gig).length === 0 ? (
            <p className="py-2 text-sm">아직 없어요. 초대 링크를 보내 주세요.</p>
          ) : (
            <ul className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {applicants(gig).map((p) =>
                  row(
                    p,
                    <>
                      <Button
                        className="min-h-11 px-4 text-sm"
                        disabled={pending || left === 0}
                        aria-label={`${p.alias} 승인`}
                        onClick={() => send({ type: 'approve', participantId: p.id })}
                      >
                        <Check aria-hidden className="size-4" />
                        승인
                      </Button>
                      {exclude(p)}
                    </>,
                  ),
                )}
              </AnimatePresence>
            </ul>
          )}
          {left === 0 && applicants(gig).length > 0 && (
            <p className="text-sm text-ink-soft">자리가 모두 차서 더 승인할 수 없어요.</p>
          )}
        </div>
      )}
      <div className="mt-3">
        <h3 className="text-sm font-semibold text-ink-soft">확정한 참여자</h3>
        {approved(gig).length === 0 ? (
          <p className="py-2 text-sm">아직 없어요.</p>
        ) : (
          <ul className="divide-y divide-line">{approved(gig).map((p) => row(p, editable ? exclude(p) : null))}</ul>
        )}
      </div>
      {past.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer py-3 text-sm font-semibold text-ink-soft">제외·철회 {past.length}명</summary>
          <ul className="divide-y divide-line">{past.map((p) => row(p, null))}</ul>
        </details>
      )}
    </section>
  )
}
