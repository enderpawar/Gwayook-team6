import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DateField'
import { Dialog } from '@/components/ui/Dialog'
import { Field, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { store, useAction } from '@/data/useStore'
import { balance, moneyKeys } from '@/domain/gig/select'
import type { Gig } from '@/domain/gig/types'
import { formatDeadline, won } from '@/lib/format'

interface Props {
  gig: Gig
  onClose: () => void
}

export function PickupDialog({ gig, onClose }: Props) {
  const [place, setPlace] = useState(gig.pickup?.place ?? gig.plan.place ?? '')
  const [at, setAt] = useState(gig.pickup?.at ?? gig.pickupCandidates[0] ?? '')
  const { run, pending, error } = useAction()
  return (
    <Dialog title="수령 안내하기" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, { type: 'startPickup', place, at: at || null })).then((ok) => ok && onClose())
        }}
      >
        <Field label="수령 장소" hint="누구나 찾을 수 있는 공개된 장소를 적어 주세요.">
          {(a) => <TextInput {...a} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />}
        </Field>
        {gig.pickupCandidates.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">모집 때 정한 후보</p>
            <div className="flex flex-wrap gap-2">
              {gig.pickupCandidates.map((c) => (
                <Button key={c} variant={c === at ? 'ink' : 'outline'} className="min-h-11 px-4 text-sm" aria-pressed={c === at} onClick={() => setAt(c)}>
                  {formatDeadline(c)}
                </Button>
              ))}
            </div>
          </div>
        )}
        <Field label="수령 일시" hint="비우면 미정으로 안내해요.">
          {(a) => <DateField {...a} label="수령 일시" mode="datetime" value={at} onChange={setAt} />}
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={pending || !place.trim()}>
          이 내용으로 안내하기
        </Button>
      </form>
    </Dialog>
  )
}

export function CancelDialog({ gig, onClose }: Props) {
  const [reason, setReason] = useState('')
  const { run, pending, error } = useAction()
  const refundable = moneyKeys(gig).reduce((a, k) => {
    const b = balance(gig, k)
    return a + b.received - b.refunded
  }, 0)
  return (
    <Dialog title="공구를 취소할까요?" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, { type: 'cancel', reason })).then((ok) => ok && onClose())
        }}
      >
        <p>취소하면 되돌릴 수 없고, 초대 링크에 취소됐다고 표시돼요.</p>
        {refundable > 0 && <Notice tone="warn">이미 받은 {won(refundable)}은 돌려줄 금액으로 남아요. 환불을 끝까지 기록해 주세요.</Notice>}
        <Field label="취소 이유" hint="참여자에게 보여요.">
          {(a) => <TextInput {...a} value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            그대로 두기
          </Button>
          <Button type="submit" className="flex-1 bg-danger hover:bg-danger/90" disabled={pending || !reason.trim()}>
            공구 취소
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
