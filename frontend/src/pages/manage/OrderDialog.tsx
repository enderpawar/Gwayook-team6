import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DateField'
import { Dialog } from '@/components/ui/Dialog'
import { Field, NumberInput, TextInput, controlClass } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { SERVER_ISSUES } from '@/data/serverMap'
import { store, useAction } from '@/data/useStore'
import { execute } from '@/domain/gig/execute'
import { estimate, latest, orderTotal } from '@/domain/gig/select'
import { GigError, type Command, type Gig, type OrderInput, type SettlementVersion } from '@/domain/gig/types'
import { formatUnits, isDirectSplit, totalUnits } from '@/domain/product'
import { nowLocal, won } from '@/lib/format'

function initialOrder(gig: Gig): OrderInput {
  const last = gig.server?.pending ?? latest(gig)
  if (last) return { ...last.order }
  const p = gig.product
  return {
    itemAmount: p.displayedPrice ?? 0,
    shippingFee: p.shippingMode === 'separate' ? (p.shippingFee ?? 0) : 0,
    discountAmount: p.discountMode === 'apply' ? (p.discountAmount ?? 0) : 0,
    totalUnits: totalUnits(p) ?? 0,
    orderedAt: nowLocal(),
  }
}

interface Props {
  gig: Gig
  mode: 'order' | 'revise'
  onClose: () => void
}

/** 주문 확정과 정산 변경. 저장하기 전에 누구의 금액이 어떻게 바뀌는지 먼저 보여준다. */
export function OrderDialog({ gig, mode, onClose }: Props) {
  const [order, setOrder] = useState(() => initialOrder(gig))
  const [removed, setRemoved] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const { run, pending, error } = useAction()
  const set = (patch: Partial<OrderInput>) => setOrder((o) => ({ ...o, ...patch }))
  const last = latest(gig)
  const server = gig.server
  const [place, setPlace] = useState(gig.pickup?.place ?? gig.plan.place ?? '')
  const [pickupAt, setPickupAt] = useState(gig.pickup?.at ?? gig.pickupCandidates[0] ?? '')
  const pickup = server ? { pickup: { place, at: pickupAt || null } } : {}

  const command: Command =
    mode === 'order'
      ? { type: 'confirmOrder', order, ...pickup }
      : { type: 'revise', order, removeParticipantIds: removed, reason: reason.trim(), ...pickup }

  const preview = useMemo<{ next: SettlementVersion | null; message: string | null }>(() => {
    // 서버 공구는 확정 전 정산이 따로 있어, 같은 명단으로 새로 계산해 미리 보여준다.
    const target: Gig = server
      ? { ...gig, server: undefined, status: 'closed', settlements: [], participants: gig.participants.filter((p) => !removed.includes(p.id)) }
      : gig
    const dry: Command = server ? { type: 'confirmOrder', order } : command.type === 'revise' ? { ...command, reason: command.reason || '미리보기' } : command
    try {
      const result = execute(target, dry, { userId: gig.hostId, now: new Date(), newId: () => 'preview' })
      return { next: latest(result), message: null }
    } catch (e) {
      return { next: null, message: e instanceof GigError ? e.message : '계산할 수 없어요.' }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gig, order, removed, mode])

  const est = estimate(gig)
  const beforeOf = (key: string, index: number) =>
    last ? last.shares.find((s) => s.key === key)?.amount : est.ok ? est.shares[index]?.amount : undefined
  const unitLabel = isDirectSplit(gig.product) ? `최종 수량 (${formatUnits(gig.product, 1)} 단위)` : '최종 수량'
  const moneyOk = [order.itemAmount, order.shippingFee, order.discountAmount].every((n) => n >= 0)

  return (
    <Dialog title={mode === 'order' ? (server ? '주문 금액 입력하기' : '주문 금액 확정하기') : '정산 바꾸기'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, command)).then((ok) => ok && onClose())
        }}
      >
        {mode === 'revise' && last && (
          <>
            <p className="text-sm text-ink-soft">지금 정산은 그대로 남고 {last.version + 1}차 정산이 새로 만들어져요.</p>
            <Field label="바꾸는 이유" hint={server ? undefined : '참여자에게 보여요. 예: 일부 품절로 부분 환불'}>
              {(a) =>
                server ? (
                  <select {...a} className={`${controlClass} select-chevron`} value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">고르세요</option>
                    {SERVER_ISSUES.map((i) => (
                      <option key={i.code} value={i.code}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <TextInput {...a} value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} />
                )
              }
            </Field>
            <fieldset>
              <legend className="text-sm font-semibold">빠지는 참여자</legend>
              {last.shares
                .filter((s) => s.key !== 'host')
                .map((s) => (
                  <label key={s.key} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-cobalt"
                      checked={removed.includes(s.key)}
                      onChange={(e) => setRemoved((r) => (e.target.checked ? [...r, s.key] : r.filter((k) => k !== s.key)))}
                    />
                    {s.alias}
                  </label>
                ))}
            </fieldset>
          </>
        )}
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label="상품 금액">
            {(a) => <NumberInput {...a} suffix="원" value={order.itemAmount} onValue={(v) => set({ itemAmount: v ?? 0 })} />}
          </Field>
          <Field label="배송비">
            {(a) => <NumberInput {...a} suffix="원" value={order.shippingFee} onValue={(v) => set({ shippingFee: v ?? 0 })} />}
          </Field>
          <Field label={server ? '할인' : '할인·부분 환불'} hint={server && mode === 'revise' ? '판매처 환불은 ‘입금과 수령’에서 기록하세요.' : undefined}>
            {(a) => <NumberInput {...a} suffix="원" value={order.discountAmount} onValue={(v) => set({ discountAmount: v ?? 0 })} />}
          </Field>
          <Field label={unitLabel}>
            {(a) => <NumberInput {...a} value={order.totalUnits} onValue={(v) => set({ totalUnits: v ?? 0 })} />}
          </Field>
        </div>
        {!(server && mode === 'revise') && (
        <Field label="주문 시각">
          {(a) => <DateField {...a} label="주문 시각" mode="datetime" max={nowLocal()} clearable={false} value={order.orderedAt} onChange={(orderedAt) => set({ orderedAt })} />}
        </Field>
        )}
        {server && (
          <>
            <Field label="수령 장소" hint="누구나 찾을 수 있는 공개된 장소를 적어 주세요.">
              {(a) => <TextInput {...a} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />}
            </Field>
            <Field label="수령 일시">
              {(a) => <DateField {...a} label="수령 일시" mode="datetime" min={order.orderedAt} value={pickupAt} onChange={setPickupAt} />}
            </Field>
          </>
        )}

        <section aria-label="바뀌는 금액" aria-live="polite" className="rounded-control bg-paper p-4">
          {preview.next && moneyOk ? (
            <>
              <p className="flex justify-between gap-3 font-bold tabular-nums">
                <span>실제 결제 금액</span>
                <span>
                  {(last ?? est.ok) && <Before value={last ? last.total : est.ok ? est.total : 0} now={preview.next.total} />}
                  {won(preview.next.total)}
                </span>
              </p>
              <ul className="mt-2 divide-y divide-line text-sm">
                {preview.next.shares.map((s, i) => (
                  <li key={s.key} className="flex justify-between gap-3 py-1.5 tabular-nums">
                    <span className="min-w-0 truncate">
                      {s.alias} {formatUnits(gig.product, s.units)}
                      {!server && preview.next!.needsConfirm.includes(s.key) && <span className="font-semibold"> · 다시 확인 필요</span>}
                    </span>
                    <span className="shrink-0">
                      <Before value={beforeOf(s.key, i)} now={s.amount} />
                      {won(s.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              {server && <p className="mt-2 text-sm">금액, 수량, 수령 안내가 모집 때나 이전 정산과 다르면 참여자 모두의 확인을 받은 뒤 확정해요.</p>}
              {!server && preview.next.needsConfirm.length > 0 && (
                <p className="mt-2 text-sm">금액이나 수량이 바뀐 참여자에게 다시 확인을 받아요. 그전에는 입금을 확인하지 않아요.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-danger">{preview.message ?? '금액을 다시 확인해 주세요.'}</p>
          )}
        </section>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={pending || !preview.next || orderTotal(order) < 1 || (mode === 'revise' && !reason.trim())}>
          {mode === 'order' ? (server ? '정산안 만들기' : '이 금액으로 확정하기') : '새 정산 만들기'}
        </Button>
      </form>
    </Dialog>
  )
}

function Before({ value, now }: { value: number | undefined; now: number }) {
  if (value === undefined || value === now) return null
  return (
    <>
      <span className="sr-only">이전 </span>
      <s className="mr-1.5 font-normal text-ink-soft">{won(value)}</s>
    </>
  )
}
