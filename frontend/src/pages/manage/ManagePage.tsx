import { useState } from 'react'
import { LoginPrompt } from '@/components/LoginPrompt'
import { StatusBadge } from '@/components/StatusBadge'
import { Seats } from '@/components/SeatBoard'
import { SettlementTicket } from '@/components/SettlementTicket'
import { ShareRow } from '@/components/ShareRow'
import { Sticker } from '@/components/Sticker'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { store, useAction, usePeople, useQuery } from '@/data/useStore'
import { approved, estimate, hasOpenMoney, latest } from '@/domain/gig/select'
import { settlementShareText, statusShareText } from '@/domain/gig/shareText'
import type { Gig } from '@/domain/gig/types'
import { displayName, formatUnits, paymentTotal, unitParts } from '@/domain/product'
import { formatDeadline, percent } from '@/lib/format'
import { absolute, href } from '@/lib/router'
import { PageError, PageLoading } from '../PageState'
import { ConditionsDialog } from './ConditionsDialog'
import { HistorySection } from './HistorySection'
import { IssuesSection } from './IssuesSection'
import { MembersSection } from './MembersSection'
import { MoneySection } from './MoneySection'
import { NextAction } from './NextAction'
import { OrderDialog } from './OrderDialog'
import { CancelDialog, PickupDialog } from './StateDialogs'

export type ManageDialog = 'conditions' | 'order' | 'revise' | 'pickup' | 'cancel'

const FLOW = ['recruiting', 'closed', 'settling', 'pickup', 'done'] as const
const FLOW_LABEL = { recruiting: '모집', closed: '마감', settling: '정산', pickup: '수령', done: '완료' }

export function ManagePage({ id }: { id: string }) {
  const { me } = usePeople()
  const query = useQuery(() => store.getHosted(id), `gig:${id}:${me.id}`)
  if (query.status === 'error') {
    if (query.code === 'auth') {
      return (
        <div className="py-8">
          <LoginPrompt text="로그인하면 이 공구를 관리할 수 있어요." next={href.manage(id)} />
        </div>
      )
    }
    return <PageError title="공구를 열 수 없어요" message={query.message} />
  }
  if (query.status === 'loading') return <PageLoading />
  if (query.data.status === 'draft') {
    return <PageError title="아직 초안이에요" message="초안을 이어서 쓴 뒤 공구를 열어 주세요." />
  }
  return <Manage gig={query.data} />
}

function Manage({ gig }: { gig: Gig }) {
  const [dialog, setDialog] = useState<ManageDialog | null>(null)
  const close = () => setDialog(null)
  const link = gig.inviteCode ? absolute(href.join(gig.inviteCode)) : null
  const v = latest(gig)
  const settled = settlementShareText(gig)
  const active = gig.status !== 'cancelled'

  return (
    <div className="py-5">
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={gig.status} />
          {gig.conditionsEditedAt && gig.status === 'recruiting' && (
            <span className="text-sm text-ink-soft">
              조건 수정 {new Date(gig.conditionsEditedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <h1 className="mt-2 pr-24 font-display text-3xl sm:text-4xl">{displayName(gig.product)}</h1>
        <p className="mt-1 pr-24 text-ink-soft">
          수령 {gig.pickup?.place ?? gig.plan.place ?? '장소 미정'}, 마감 {formatDeadline(gig.plan.deadline) ?? '미정'}
        </p>
        {gig.status === 'done' && v?.comparison && v.comparison.savingsRate > 0 && (
          <Sticker className="absolute -top-2 right-0 size-24">
            <span className="block font-display text-2xl">{percent(v.comparison.savingsRate)}</span>
            <span className="block text-xs font-semibold">절약 완료</span>
          </Sticker>
        )}
      </div>

      {active && <Progress gig={gig} />}
      <div className="mt-5">
        <NextAction gig={gig} onOpen={setDialog} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <section aria-label="자리" className="rounded-panel bg-surface p-5">
            <h2 className="mb-4 text-lg font-bold">자리</h2>
            <Seats headcount={gig.plan.headcount} names={[gig.hostAlias, ...approved(gig).map((p) => p.alias)]} quiet={gig.status === 'cancelled'} />
          </section>
          <MembersSection gig={gig} />
          {(v || hasOpenMoney(gig)) && <MoneySection gig={gig} />}
          {gig.status !== 'recruiting' && <IssuesSection gig={gig} />}
        </div>
        <div className="space-y-6">
          <Ticket gig={gig} />
          <section aria-label="공유" className="space-y-4 rounded-panel bg-surface p-5">
            <h2 className="text-lg font-bold">공유하기</h2>
            <div>
              <p className="mb-2 text-sm font-semibold">초대 링크와 현재 상태</p>
              {link ? (
                <>
                  <p className="mb-2 rounded-control bg-paper px-3.5 py-2.5 text-sm break-all">{link}</p>
                  <ShareRow text={statusShareText(gig, link)} copyLabel="안내 복사" shareLabel="안내 공유" />
                </>
              ) : (
                <p className="text-sm text-ink-soft">이 브라우저에는 초대 링크가 없어요.</p>
              )}
              {gig.server && (gig.status === 'recruiting' || gig.status === 'closed') && <NewInvite gig={gig} hasLink={Boolean(link)} />}
            </div>
            {settled && (
              <div>
                <p className="mb-2 text-sm font-semibold">카카오톡 정산 안내</p>
                <p className="mb-2 rounded-control bg-paper p-3.5 text-sm leading-relaxed whitespace-pre-wrap">{settled}</p>
                <ShareRow text={settled} copyLabel="정산 안내 복사" shareLabel="카카오톡으로 공유" />
                <p className="mt-2 text-sm text-ink-soft">계좌와 상세 주소는 승인한 참여자에게 따로 보내 주세요.</p>
              </div>
            )}
            {store.local && <Notice>지금은 이 브라우저에서만 링크가 열려요. 다른 기기로 보내도 열리지 않아요.</Notice>}
            {!store.local && <Notice>서버가 같은 컴퓨터의 접속만 받아서, 링크는 이 컴퓨터에서만 열려요.</Notice>}
          </section>
          <HistorySection gig={gig} />
        </div>
      </div>

      {dialog === 'conditions' && <ConditionsDialog gig={gig} onClose={close} />}
      {dialog === 'order' && <OrderDialog gig={gig} mode="order" onClose={close} />}
      {dialog === 'revise' && <OrderDialog gig={gig} mode="revise" onClose={close} />}
      {dialog === 'pickup' && <PickupDialog gig={gig} onClose={close} />}
      {dialog === 'cancel' && <CancelDialog gig={gig} onClose={close} />}
    </div>
  )
}

function NewInvite({ gig, hasLink }: { gig: Gig; hasLink: boolean }) {
  const { run, pending, error } = useAction()
  return (
    <div className="mt-2">
      <Button
        variant="outline"
        className="min-h-11 px-4 text-sm"
        disabled={pending}
        onClick={() => {
          if (!hasLink || window.confirm('새 링크를 만들면 지금 링크는 더 이상 열리지 않아요. 만들까요?')) {
            void run(() => store.execute(gig.id, { type: 'rotateInvite' }))
          }
        }}
      >
        새 초대 링크 만들기
      </Button>
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
  )
}

function Progress({ gig }: { gig: Gig }) {
  const at = FLOW.findIndex((s) => s === gig.status)
  return (
    <ol aria-label="공구 진행" className="mt-5 grid grid-cols-5 gap-1.5">
      {FLOW.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined}>
          <span aria-hidden className={`block h-1.5 rounded-full ${i <= at ? 'bg-ink' : 'bg-ink/12'}`} />
          <span className={`mt-1 block text-sm ${i === at ? 'font-bold' : 'text-ink-soft'}`}>{FLOW_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  )
}

function Ticket({ gig }: { gig: Gig }) {
  const waiting = gig.server?.pending
  const v = waiting ?? latest(gig)
  if (v) {
    const prev = waiting ? gig.settlements.at(-1) : gig.settlements.at(-2)
    return (
      <SettlementTicket
        title={displayName(gig.product)}
        caption={waiting ? `정산 ${v.version}차, 확정 전` : v.version === 1 ? '정산 1차, 확정 금액' : `정산 ${v.version}차, ${v.reason}`}
        total={v.total}
        totalUnits={formatUnits(gig.product, v.order.totalUnits)}
        rows={v.shares.map((s) => ({
          id: s.key,
          name: s.key === 'host' ? `${s.alias} (방장)` : s.alias,
          units: unitParts(gig.product, s.units),
          amount: s.amount,
          saved: s.saved,
          before: prev?.shares.find((x) => x.key === s.key)?.amount,
        }))}
      />
    )
  }
  const est = estimate(gig)
  if (!est.ok) return null
  const names = [gig.hostAlias, ...approved(gig).map((p) => p.alias)]
  return (
    <SettlementTicket
      title={displayName(gig.product)}
      caption={paymentTotal(gig.product).estimated ? '모집 때 보여준 예상 금액' : '모집 때 보여준 금액'}
      total={est.total}
      totalUnits={formatUnits(gig.product, est.totalUnits)}
      rows={est.shares.map((s) => ({
        id: String(s.seat),
        name: s.seat === 0 ? `${names[0]} (방장)` : (names[s.seat] ?? '빈자리'),
        units: unitParts(gig.product, s.units),
        amount: s.amount,
        saved: null,
      }))}
    />
  )
}
