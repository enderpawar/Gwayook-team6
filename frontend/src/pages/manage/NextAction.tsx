import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { store, useAction } from '@/data/useStore'
import { aliasOf, applicants, approved, completionBlockers, deadlinePassed, hasOpenMoney, seatsLeft, unconfirmed } from '@/domain/gig/select'
import type { Command, Gig } from '@/domain/gig/types'
import type { ManageDialog } from './ManagePage'

interface Props {
  gig: Gig
  onOpen: (dialog: ManageDialog) => void
}

/** 지금 상태에서 방장이 할 일을 한 곳에 모은다. */
export function NextAction({ gig, onOpen }: Props) {
  const { run, pending, error } = useAction()
  const send = (c: Command) => void run(() => store.execute(gig.id, c))
  const blockers = completionBlockers(gig)
  const waiting = applicants(gig).length
  const pendingNames = unconfirmed(gig).map((k) => aliasOf(gig, k)).join(', ')

  let title = ''
  let detail: ReactNode = null
  let buttons: ReactNode = null

  switch (gig.status) {
    case 'recruiting': {
      const full = seatsLeft(gig) === 0
      title = waiting ? `신청 ${waiting}건을 확인하세요` : full ? '자리가 모두 찼어요' : '초대 링크를 보내 신청을 받으세요'
      detail = deadlinePassed(gig, new Date())
        ? '신청 마감이 지나 새 신청을 받지 않아요. 마감을 바꾸거나 모집을 마감하세요.'
        : full
          ? '승인한 명단이 맞으면 모집을 마감하세요.'
          : `${seatsLeft(gig)}자리 남았어요.`
      buttons = (
        <>
          <Button variant="ink" disabled={pending || approved(gig).length === 0} onClick={() => send({ type: 'close' })}>
            모집 마감하기
          </Button>
          <Button variant="outline" onClick={() => onOpen('conditions')}>
            조건 바꾸기
          </Button>
        </>
      )
      break
    }
    case 'closed':
      title = '주문하고 실제 금액을 입력하세요'
      detail = `방장 포함 ${approved(gig).length + 1}명이 함께해요. 확정하기 전에는 다시 모집할 수 있어요.`
      buttons = (
        <>
          <Button variant="ink" onClick={() => onOpen('order')}>
            주문 금액 확정하기
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => send({ type: 'reopen' })}>
            다시 모집하기
          </Button>
          <Button variant="outline" onClick={() => onOpen('conditions')}>
            조건 바꾸기
          </Button>
        </>
      )
      break
    case 'settling':
      title = pendingNames ? '바뀐 금액의 확인을 기다려요' : '입금을 확인하고 수령을 안내하세요'
      detail = pendingNames ? `아직 확인하지 않은 참여자: ${pendingNames}` : '수령 안내를 먼저 하고 입금은 나중에 확인해도 돼요.'
      buttons = (
        <>
          <Button variant="ink" disabled={Boolean(pendingNames)} onClick={() => onOpen('pickup')}>
            수령 안내하기
          </Button>
          <Button variant="outline" onClick={() => onOpen('revise')}>
            정산 바꾸기
          </Button>
        </>
      )
      break
    case 'pickup':
      title = blockers.length ? '수령과 입금을 정리하세요' : '모두 정리됐어요. 완료할 수 있어요'
      detail = blockers.length ? (
        <ul className="list-disc space-y-0.5 pl-5">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null
      buttons = (
        <>
          <Button variant="ink" disabled={pending || blockers.length > 0} onClick={() => send({ type: 'complete' })}>
            공구 완료하기
          </Button>
          <Button variant="outline" onClick={() => onOpen('pickup')}>
            수령 안내 바꾸기
          </Button>
          <Button variant="outline" onClick={() => onOpen('revise')}>
            정산 바꾸기
          </Button>
        </>
      )
      break
    case 'done':
      title = hasOpenMoney(gig) ? '정정한 금액을 정리하세요' : '공구를 완료했어요'
      detail = '환불이나 정정이 생기면 정산을 바꿔 주세요. 저금통은 바뀐 값으로 다시 계산돼요.'
      buttons = (
        <Button variant="outline" onClick={() => onOpen('revise')}>
          정산 바꾸기
        </Button>
      )
      break
    case 'cancelled':
      title = hasOpenMoney(gig) ? '받은 금액을 돌려주세요' : '취소한 공구예요'
      detail = `취소 이유: ${gig.cancelReason}`
      break
    case 'draft':
      return null
  }

  const cancellable = gig.status !== 'done' && gig.status !== 'cancelled'
  return (
    <section aria-label="지금 할 일" className={gig.status === 'cancelled' ? 'rounded-panel bg-danger-wash p-5' : 'rounded-panel bg-tag p-5'}>
      <h2 className="text-xl font-bold">{title}</h2>
      {detail && <div className="mt-1">{detail}</div>}
      {(buttons || cancellable) && (
        <div className="mt-4 flex flex-wrap gap-2 [&_button:disabled]:bg-ink/15 [&_button:disabled]:text-ink">
          {buttons}
          {cancellable && (
            <Button variant="ghost" className="text-ink" onClick={() => onOpen('cancel')}>
              공구 취소
            </Button>
          )}
        </div>
      )}
      {error && (
        <Notice tone="error" className="mt-3 bg-surface">
          {error}
        </Notice>
      )}
    </section>
  )
}
