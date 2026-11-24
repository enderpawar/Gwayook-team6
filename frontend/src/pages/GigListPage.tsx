import { ArrowRight, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Seats } from '@/components/SeatBoard'
import { LoginPrompt } from '@/components/LoginPrompt'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { store, useAction, usePeople, useQuery } from '@/data/useStore'
import { displayName, paymentTotal } from '@/domain/product'
import { applicants, approved, completionBlockers, hasOpenMoney, latest } from '@/domain/gig/select'
import type { Gig } from '@/domain/gig/types'
import type { InviteView } from '@/domain/gig/views'
import { formatDeadline, won } from '@/lib/format'
import { href } from '@/lib/router'
import { PageError, PageLoading } from './PageState'

export function GigListPage() {
  const { me, user } = usePeople()
  const guest = !store.local && !user
  const hosted = useQuery(() => store.listHosted(), `hosted:${me.id}`)
  const joined = useQuery(() => store.listJoined(), `joined:${me.id}`)
  if (hosted.status === 'error') return <PageError title="목록을 열 수 없어요" message={hosted.message} />
  if (hosted.status === 'loading' || joined.status === 'loading') return <PageLoading />
  const drafts = hosted.data.filter((g) => g.status === 'draft')
  const open = hosted.data.filter((g) => g.status !== 'draft')
  const mine = joined.status === 'ready' ? joined.data : []
  const empty = !drafts.length && !open.length && !mine.length

  return (
    <div className="py-5">
      <h1 className="font-display text-3xl sm:text-4xl">내 공구</h1>
      {guest && (
        <div className="mt-6">
          <LoginPrompt text="로그인하면 내가 연 공구와 참여한 공구를 볼 수 있어요." next={href.gigs} />
        </div>
      )}
      {empty && !guest && (
        <div className="mt-6 rounded-panel bg-tag p-6">
          <p className="text-lg font-bold">아직 공구가 없어요.</p>
          <p className="mt-1">나눌 상품을 고르면 초안이 자동으로 저장돼요.</p>
          <a href={href.plan} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-white">
            첫 공구 만들기 <ArrowRight aria-hidden className="size-5" />
          </a>
        </div>
      )}
      {open.length > 0 && (
        <Group title="내가 연 공구">
          {open.map((g) => (
            <HostedTicket key={g.id} gig={g} />
          ))}
        </Group>
      )}
      {mine.length > 0 && (
        <Group title={store.local ? '참여한 공구' : '이 브라우저에서 참여한 공구'}>
          {mine.map((v) => (
            <JoinedTicket key={v.code} view={v} />
          ))}
        </Group>
      )}
      {drafts.length > 0 && (
        <Group title="이어서 쓸 초안">
          {drafts.map((g) => (
            <DraftTicket key={g.id} gig={g} />
          ))}
        </Group>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-7">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <ul className="grid gap-4 sm:grid-cols-2">{children}</ul>
    </section>
  )
}

const STUB = { '--notch': 'calc(100% - 3.75rem)' } as CSSProperties

function hostHint(g: Gig): string {
  const waiting = applicants(g).length
  if (g.server?.pending) return '정산을 확정하세요'
  switch (g.status) {
    case 'recruiting':
      return waiting ? `신청 ${waiting}건을 확인하세요` : '신청을 기다리는 중'
    case 'closed':
      return '주문하고 금액을 확정하세요'
    case 'settling':
      return '입금을 확인하고 수령을 안내하세요'
    case 'pickup':
      return completionBlockers(g).length ? '수령과 입금을 확인하세요' : '완료할 수 있어요'
    case 'cancelled':
      return hasOpenMoney(g) ? '환불할 금액이 남았어요' : '정리됐어요'
    case 'done':
      return hasOpenMoney(g) ? '정정 금액이 남았어요' : '모두 끝났어요'
    case 'draft':
      return ''
  }
}

function HostedTicket({ gig: g }: { gig: Gig }) {
  const total = latest(g)?.total ?? paymentTotal(g.product).total
  return (
    <li className="ticket flex flex-col" style={STUB}>
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-bold">{displayName(g.product)}</h3>
          <StatusBadge status={g.status} />
        </div>
        <p className="mt-1 mb-4 text-sm text-ink-soft tabular-nums">
          {total !== null && won(total)}, 마감 {formatDeadline(g.plan.deadline) ?? '미정'}
        </p>
        <Seats headcount={g.plan.headcount} names={[g.hostAlias, ...approved(g).map((p) => p.alias)]} quiet={g.status === 'cancelled'} />
      </div>
      <div className="mx-5 border-t-2 border-dashed border-line" />
      <a href={href.manage(g.id)} className="flex h-15 items-center justify-between gap-2 px-5 font-semibold hover:bg-cobalt-wash">
        <span className="min-w-0 truncate">{hostHint(g)}</span>
        <ArrowRight aria-hidden className="size-5 shrink-0" />
      </a>
    </li>
  )
}

const MY_STATUS = { applied: '승인을 기다리는 중', approved: '참여 확정', excluded: '참여하지 않아요', withdrawn: '철회했어요' }

function JoinedTicket({ view: v }: { view: InviteView }) {
  return (
    <li className="ticket flex flex-col" style={STUB}>
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-bold">{v.productName}</h3>
          <StatusBadge status={v.status} />
        </div>
        {v.hostAlias && <p className="mt-1 text-sm text-ink-soft">방장 {v.hostAlias}</p>}
        {v.me?.share && (
          <p className="mt-3 font-display text-2xl tabular-nums">
            {v.me.share.units} {won(v.me.share.amount)}
          </p>
        )}
      </div>
      <div className="mx-5 border-t-2 border-dashed border-line" />
      <a href={href.join(v.code)} className="flex h-15 items-center justify-between gap-2 px-5 font-semibold hover:bg-cobalt-wash">
        <span className="min-w-0 truncate">{v.me?.share?.needsConfirm ? '바뀐 금액을 확인하세요' : v.me ? MY_STATUS[v.me.status] : ''}</span>
        <ArrowRight aria-hidden className="size-5 shrink-0" />
      </a>
    </li>
  )
}

function DraftTicket({ gig: g }: { gig: Gig }) {
  const { run, pending, error } = useAction()
  const name = displayName(g.product) || '이름 없는 상품'
  return (
    <li className="flex flex-col rounded-panel bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg font-bold">{name}</h3>
        <StatusBadge status="draft" />
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {new Date(g.updatedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 저장
      </p>
      <div className="mt-4 flex gap-2">
        <a href={href.draft(g.id)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 font-semibold text-white">
          이어서 쓰기
        </a>
        <Button
          variant="outline"
          className="min-h-11 px-4"
          aria-label={`${name} 초안 삭제`}
          disabled={pending}
          onClick={() => {
            if (window.confirm(`‘${name}’ 초안을 지울까요? 되돌릴 수 없어요.`)) void run(() => store.deleteDraft(g.id))
          }}
        >
          <Trash2 aria-hidden className="size-5" />
        </Button>
      </div>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </li>
  )
}
