import { CircleCheck, PackageCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, NumberInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { store, useAction } from '@/data/useStore'
import { aliasOf, balance, latest, moneyKeys, unconfirmed } from '@/domain/gig/select'
import type { Command, Gig } from '@/domain/gig/types'
import { won } from '@/lib/format'
import { newId } from '@/lib/id'

interface Target {
  key: string
  kind: 'confirmPayment' | 'refund'
}

export function MoneySection({ gig }: { gig: Gig }) {
  const [target, setTarget] = useState<Target | null>(null)
  const { run, pending, error } = useAction()
  const send = (c: Command) => void run(() => store.execute(gig.id, c))
  const inTicket = new Set(latest(gig)?.shares.map((s) => s.key))
  const waiting = unconfirmed(gig)

  return (
    <section aria-labelledby="money-title" className="rounded-panel bg-surface p-5">
      <h2 id="money-title" className="text-lg font-bold">
        입금과 수령
      </h2>
      <p className="mt-1 text-sm text-ink-soft">돈은 앱 밖에서 주고받고, 여기에는 확인한 내용만 기록해요.</p>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      <ul className="mt-2 divide-y divide-line">
        {moneyKeys(gig).map((key) => {
          const b = balance(gig, key)
          const name = aliasOf(gig, key)
          const needsConfirm = waiting.includes(key)
          const picked = Boolean(gig.pickedUp[key])
          const net = b.received - b.refunded
          return (
            <li key={key} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-bold">{name}</span>
                <span className="shrink-0 tabular-nums">
                  {won(net)} <span className="text-ink-soft">/ {won(b.due)}</span>
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-cobalt-wash" aria-hidden>
                <div
                  className="h-full rounded-full bg-cobalt transition-[width] duration-500"
                  style={{ width: `${b.due > 0 ? Math.min(100, Math.max(0, (net / b.due) * 100)) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm">
                {needsConfirm ? (
                  '바뀐 금액을 아직 확인하지 않았어요.'
                ) : b.remaining > 0 ? (
                  <>
                    받을 금액 <strong>{won(b.remaining)}</strong>
                    {b.reported > 0 && net < b.reported && <> · 참여자가 {won(b.reported)} 보냈다고 표시했어요</>}
                  </>
                ) : b.remaining < 0 ? (
                  <>
                    돌려줄 금액 <strong>{won(-b.remaining)}</strong>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <CircleCheck aria-hidden className="size-4" />
                    {net > 0 ? '입금 정리 완료' : b.received > 0 ? '환불 완료' : '정리할 금액 없음'}
                  </span>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {b.remaining > 0 && (
                  <Button className="min-h-11 px-4 text-sm" disabled={needsConfirm} aria-label={`${name} 입금 확인`} onClick={() => setTarget({ key, kind: 'confirmPayment' })}>
                    입금 확인
                  </Button>
                )}
                {b.remaining < 0 && (
                  <Button variant="ink" className="min-h-11 px-4 text-sm" aria-label={`${name} 환불 기록`} onClick={() => setTarget({ key, kind: 'refund' })}>
                    환불 기록
                  </Button>
                )}
                {gig.status === 'pickup' && inTicket.has(key) && (
                  <Button
                    variant="outline"
                    className="min-h-11 px-4 text-sm"
                    aria-pressed={picked}
                    aria-label={`${name} 수령 확인`}
                    disabled={pending}
                    onClick={() => send({ type: 'setPickedUp', participantId: key, done: !picked })}
                  >
                    <PackageCheck aria-hidden className="size-4" />
                    {picked ? '수령함' : '수령 확인'}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {target && <AmountDialog gig={gig} target={target} onClose={() => setTarget(null)} />}
    </section>
  )
}

function AmountDialog({ gig, target, onClose }: { gig: Gig; target: Target; onClose: () => void }) {
  const name = aliasOf(gig, target.key)
  const suggested = Math.abs(balance(gig, target.key).remaining)
  const [amount, setAmount] = useState<number | null>(suggested)
  // 창을 한 번 열 때마다 id 하나. 두 번 눌러도 같은 기록으로 처리된다.
  const [commandId] = useState(newId)
  const { run, pending, error } = useAction()
  const paying = target.kind === 'confirmPayment'
  return (
    <Dialog title={paying ? `${name} 입금 확인` : `${name} 환불 기록`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, { type: target.kind, commandId, participantId: target.key, amount: amount ?? 0 })).then(
            (ok) => ok && onClose(),
          )
        }}
      >
        <p className="mb-4 text-sm text-ink-soft">
          {paying ? '내 계좌에서 실제로 들어온 금액을 확인한 뒤 적어 주세요.' : '실제로 돌려준 금액을 적어 주세요.'}
        </p>
        <Field label={paying ? '들어온 금액' : '돌려준 금액'} hint={paying ? '일부만 들어왔다면 그 금액만 적으면 돼요.' : undefined}>
          {(a) => <NumberInput {...a} suffix="원" value={amount} onValue={setAmount} />}
        </Field>
        {paying && amount !== null && amount > suggested && (
          <Notice tone="warn" className="mt-3">
            받을 금액보다 {won(amount - suggested)} 많아요. 차액은 환불할 금액으로 남아요.
          </Notice>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
        <Button type="submit" className="mt-5 w-full" disabled={pending || !amount}>
          {paying ? '입금 확인' : '환불 기록'}
        </Button>
      </form>
    </Dialog>
  )
}
