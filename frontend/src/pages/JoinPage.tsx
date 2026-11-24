import { CircleCheck, Crown } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { LoginPrompt } from '@/components/LoginPrompt'
import { StatusBadge } from '@/components/StatusBadge'
import { Sticker } from '@/components/Sticker'
import { Button } from '@/components/ui/Button'
import { Field, NumberInput, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { store, useAction, usePeople, useQuery } from '@/data/useStore'
import type { Command } from '@/domain/gig/types'
import type { InviteView, MyView } from '@/domain/gig/views'
import { formatDeadline, percent, won } from '@/lib/format'
import { newId } from '@/lib/id'
import { href } from '@/lib/router'
import { PageError, PageLoading } from './PageState'

export function JoinPage({ code, version }: { code: string; version: number | null }) {
  const { me } = usePeople()
  const query = useQuery(() => store.getInvite(code), `join:${code}:${me.id}`)
  if (query.status === 'error') {
    return (
      <PageError
        title="초대 링크를 열 수 없어요"
        message={store.local ? '주소가 잘못됐거나 다른 기기에서 만든 공구예요. 시연용 공구는 만든 브라우저에서만 열려요.' : query.message}
      />
    )
  }
  if (query.status === 'loading') return <PageLoading />
  return <Join key={me.id} view={query.data} version={version} />
}

const CLOSED: Partial<Record<InviteView['status'], string>> = {
  closed: '모집이 마감됐어요.',
  settling: '모집이 마감됐어요.',
  pickup: '모집이 마감됐어요.',
  done: '완료된 공구예요.',
  cancelled: '취소된 공구예요.',
}

function Join({ view: v, version }: { view: InviteView; version: number | null }) {
  const current = v.me?.share?.version ?? null
  const outdated = version !== null && current !== null && version < current
  return (
    <div className="mx-auto w-full max-w-xl py-5">
      {outdated && (
        <Notice tone="warn" className="mb-4">
          <p>
            이 링크는 정산 {version}차예요. 최신 정산은 {current}차예요.
          </p>
          <a href={href.join(v.code)} className="mt-1 inline-flex min-h-11 items-center font-semibold underline">
            최신 정산 보기
          </a>
        </Notice>
      )}
      <article className="relative">
        {v.me?.pickedUp && (
          <Sticker tone="ink" className="absolute -top-3 -right-1 z-10 size-24">
            <span className="block text-sm font-bold">수령 완료</span>
          </Sticker>
        )}
        <div className="rounded-t-panel bg-tag p-5">
          <StatusBadge status={v.status} label={v.status === 'recruiting' && !v.applyOpen ? '신청 마감' : undefined} />
          <h1 className="mt-3 pr-20 font-display text-3xl sm:text-4xl">{v.productName}</h1>
          {v.option && <p className="mt-1">{v.option}</p>}
          {v.hostAlias && (
            <p className="mt-1 flex items-center gap-1.5">
              <Crown aria-hidden className="size-4.5" /> 방장 {v.hostAlias}
            </p>
          )}
        </div>
        <div className="ticket rounded-t-none" style={{ '--notch': '0px', borderTopLeftRadius: 0, borderTopRightRadius: 0 } as CSSProperties}>
          <div className="mx-5 border-t-2 border-dashed border-line" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5">
            {!v.me?.share && (
            <Item term={v.status === 'recruiting' || v.status === 'closed' ? '1인당' : '모집 때 1인당'} wide>
              {v.estimate ? (
                <span className="font-display text-2xl tabular-nums">
                  {v.estimate.units}{' '}
                  {v.estimate.min === v.estimate.max ? won(v.estimate.min) : `${won(v.estimate.min)}~${won(v.estimate.max)}`}
                </span>
              ) : (
                '확인 중'
              )}
              {v.estimated && <span className="block text-sm text-ink-soft">예상 금액이라 주문할 때 달라질 수 있어요.</span>}
            </Item>
            )}
            <Item term="남은 자리">{v.status === 'recruiting' ? `${v.seatsLeft}자리 (모두 ${v.headcount}명)` : '모집 끝'}</Item>
            <Item term="신청 마감">{formatDeadline(v.deadline) ?? '미정'}</Item>
            <Item term="수령 장소">{v.place ?? '미정'}</Item>
            {store.local && <Item term="소용량보다">{v.savingsRate === null ? '비교 정보 없음' : v.savingsRate >= 0 ? `${percent(v.savingsRate)} 저렴` : `${percent(v.savingsRate)} 비쌈`}</Item>}
            {v.pickupCandidates.length > 0 && (
              <Item term="수령 후보" wide>
                {v.pickupCandidates.map((c) => formatDeadline(c)).join(', ')}
              </Item>
            )}
          </dl>
          {v.conditionsEditedAt && (
            <p className="px-5 pb-5 text-sm">
              모집 조건이 {new Date(v.conditionsEditedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 바뀌었어요.
            </p>
          )}
        </div>
      </article>

      <div className="mt-5 space-y-5">
        {v.status === 'cancelled' && <Notice tone="error">취소된 공구예요.{v.cancelReason && ` 이유: ${v.cancelReason}`}</Notice>}
        {v.isHost ? (
          <a href={href.manage(v.hostGigId!)} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink px-5 font-semibold text-white">
            방장 화면으로 가기
          </a>
        ) : (
          <Mine view={v} />
        )}
      </div>
    </div>
  )
}

function Item({ term, wide, children }: { term: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-sm text-ink-soft">{term}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  )
}

function Mine({ view: v }: { view: InviteView }) {
  const me = v.me
  const { run, pending, error } = useAction()
  const send = (c: Command) => run(() => store.executeByCode(v.code, c))
  const active = me?.status === 'applied' || me?.status === 'approved'
  const { user } = usePeople()
  const guest = !store.local && !user
  // 서버는 한 번 신청한 사람의 재신청을 받지 않는다.
  const canApply = v.applyOpen && (store.local || !me)

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {me?.share && <MyShare view={v} me={me} send={send} pending={pending} />}
      {!me?.share && active && (
        <section className="rounded-panel bg-surface p-5">
          <h2 className="text-lg font-bold">{me.status === 'applied' ? '신청했어요' : '참여가 확정됐어요'}</h2>
          <p className="mt-1 text-ink-soft">
            {me.status === 'applied' ? '방장이 승인하면 여기에 표시돼요.' : '주문이 확정되면 내 부담금을 알려드려요.'}
          </p>
          {(v.status === 'recruiting' || v.status === 'closed') && (
            <Button
              variant="outline"
              className="mt-4"
              disabled={pending}
              onClick={() => {
                if (window.confirm(store.local ? '신청을 철회할까요?' : '신청을 철회할까요? 철회하면 다시 신청할 수 없어요.')) void send({ type: 'withdraw' })
              }}
            >
              신청 철회
            </Button>
          )}
        </section>
      )}
      {!active && !me?.share && me?.status === 'excluded' && <Notice>방장이 이 공구의 참여를 제외했어요.</Notice>}
      {!active && me?.status !== 'excluded' && me?.status !== 'withdrawn' && guest && v.applyOpen && (
        <LoginPrompt text="로그인하면 참여를 신청할 수 있어요." next={href.join(v.code)} />
      )}
      {!active && me?.status === 'withdrawn' && !canApply && <Notice>신청을 철회했어요.</Notice>}
      {!active && me?.status !== 'excluded' && !guest && canApply && <ApplyForm view={v} send={send} pending={pending} />}
      {!active && me?.status !== 'excluded' && me?.status !== 'withdrawn' && !v.applyOpen && <Closed view={v} full={v.status === 'recruiting' && v.seatsLeft === 0} />}
      {me?.balance && !me.share && <BalanceLine me={me} />}
    </>
  )
}

function Closed({ view: v, full }: { view: InviteView; full: boolean }) {
  if (v.status === 'cancelled') return null
  if (full) return <Notice>자리가 모두 찼어요.</Notice>
  return <Notice>{CLOSED[v.status] ?? '신청 마감이 지났어요.'}</Notice>
}

interface SendProps {
  send: (c: Command) => Promise<boolean>
  pending: boolean
}

function ApplyForm({ view: v, send, pending }: { view: InviteView } & SendProps) {
  const { me: person } = usePeople()
  const [alias, setAlias] = useState(v.me?.alias ?? person.alias)
  return (
    <form
      className="rounded-panel bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void send({ type: 'apply', alias }).then((ok) => ok && store.setAlias(alias.trim()))
      }}
    >
      <h2 className="text-lg font-bold">{v.me ? '다시 신청하기' : '참여 신청하기'}</h2>
      <p className="mt-1 text-sm text-ink-soft">별칭은 방장과 정산 안내에만 쓰여요. 실명이나 연락처는 적지 마세요.</p>
      {v.seatsLeft === 0 && (
        <Notice tone="warn" className="mt-3">
          지금은 자리가 모두 찼어요. 신청하면 빈자리가 났을 때 방장이 승인할 수 있어요.
        </Notice>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="별칭" className="min-w-40 flex-1">
          {(a) => <TextInput {...a} value={alias} maxLength={20} autoComplete="nickname" onChange={(e) => setAlias(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={pending || !alias.trim()}>
          신청하기
        </Button>
      </div>
    </form>
  )
}

function MyShare({ view: v, me, send, pending }: { view: InviteView; me: MyView } & SendProps) {
  const s = me.share!
  return (
    <section aria-label="내 몫" className="rounded-panel bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">{me.alias}의 몫</h2>
        <p className="text-sm text-ink-soft">
          정산 {s.version}차{s.waiting && ', 확정 전'}
        </p>
      </div>
      <p className="mt-2 font-display text-4xl tabular-nums">{won(s.amount)}</p>
      <p className="mt-1 font-semibold">
        {s.units} 받아요
        {s.saved !== null && <span className="font-normal text-ink-soft">, {s.saved >= 0 ? `${won(s.saved)} 절약` : `${won(-s.saved)} 더 냄`}</span>}
      </p>

      {s.needsConfirm ? (
        <Notice tone="warn" className="mt-4">
          <p className="font-semibold">금액이나 수량이 바뀌었어요. {s.reason}</p>
          {s.before && (
            <p className="mt-1 tabular-nums">
              {s.before.units}, {won(s.before.amount)} → {s.units}, {won(s.amount)}
            </p>
          )}
          <Button className="mt-3 min-h-11 px-4 text-sm" disabled={pending} onClick={() => void send({ type: 'confirmShare', version: s.version })}>
            바뀐 내용 확인했어요
          </Button>
        </Notice>
      ) : (
        <BalanceLine me={me} />
      )}

      {s.waiting && !s.needsConfirm && <Notice className="mt-4">확인했어요. 방장이 정산을 확정하면 입금할 금액이 정해져요.</Notice>}

      {!s.needsConfirm && !s.waiting && me.balance && me.balance.remaining > 0 && v.status !== 'cancelled' && (
        <ReportForm remaining={me.balance.remaining} send={send} pending={pending} />
      )}

      {me.pickup && (
        <dl className="mt-4 grid grid-cols-2 gap-4 rounded-control bg-cobalt-wash p-4">
          <Item term="수령 일시">{formatDeadline(me.pickup.at) ?? '미정'}</Item>
          <Item term="수령 장소">{me.pickup.place}</Item>
        </dl>
      )}
    </section>
  )
}

function BalanceLine({ me }: { me: MyView }) {
  const b = me.balance
  if (!b) return null
  const received = b.received - b.refunded
  return (
    <p role="status" className="mt-4 flex items-start gap-1.5 rounded-control bg-paper p-3.5 text-sm">
      {b.remaining === 0 && <CircleCheck aria-hidden className="mt-0.5 size-4.5 shrink-0" />}
      <span>
        {b.remaining > 0
          ? `방장이 확인한 입금 ${won(received)}, 남은 금액 ${won(b.remaining)}`
          : b.remaining < 0
            ? `돌려받을 금액이 ${won(-b.remaining)} 있어요.`
            : b.due > 0
              ? `방장이 입금 ${won(received)}을 확인했어요.`
              : '금액 정리가 끝났어요.'}
        {b.reported > received && b.remaining > 0 && ' 보냈다고 표시한 금액을 방장이 확인하고 있어요.'}
      </span>
    </p>
  )
}

function ReportForm({ remaining, send, pending }: { remaining: number } & SendProps) {
  const [amount, setAmount] = useState<number | null>(remaining)
  const [commandId, setCommandId] = useState(newId)
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void send({ type: 'reportPayment', commandId, amount: amount ?? 0 }).then((ok) => ok && setCommandId(newId()))
      }}
    >
      <Field label="보낸 금액" hint="송금은 은행 앱에서 하고, 여기에는 보냈다고 표시만 해요." className="min-w-40 flex-1">
        {(a) => <NumberInput {...a} suffix="원" value={amount} onValue={setAmount} />}
      </Field>
      <Button type="submit" variant="outline" className="mb-7" disabled={pending || !amount}>
        보냈어요
      </Button>
    </form>
  )
}
