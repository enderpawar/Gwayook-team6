import { PriceBars } from '@/components/PriceBars'
import { SettlementTicket } from '@/components/SettlementTicket'
import { SplitBoard } from '@/components/SplitBoard'
import { Sticker } from '@/components/Sticker'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { displayName } from '@/domain/product'
import { MIN_HEADCOUNT } from '@/domain/settlement'
import type { Measure } from '@/domain/types'
import { josa, num, percent, won } from '@/lib/format'
import type { Flow } from './flow'

const amountText = (count: number, net: number | null, measure: Measure, unit: string) =>
  measure === 'count' || net === null ? `${num(count)}${unit}` : `${num(count * net)}${measure}`

export function SplitStep({ flow }: { flow: Flow }) {
  const { state, actions, settlement, comparison, payment, units } = flow
  const { product, reference, plan } = state
  const name = displayName(product)

  return (
    <div>
      <div className="relative">
        <h1 tabIndex={-1} className="pr-28 font-display text-3xl sm:text-4xl">
          몇 명이 나눌까요?
        </h1>
        <p className="mt-2 pr-28 text-ink-soft">나를 포함한 인원이에요. 남는 수량은 방장이 가져가요.</p>
        {comparison.ok && comparison.savingsRate > 0 && (
          <Sticker key={comparison.savingsRate} className="absolute -top-3 right-0 size-24">
            <span className="block font-display text-2xl">{percent(comparison.savingsRate)}</span>
            <span className="block text-xs font-semibold">절약</span>
          </Sticker>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start">
        <section aria-label="나누기" className="rounded-panel bg-tag p-4 sm:p-5">
          <Segmented
            label="나눌 인원"
            tone="onTag"
            value={plan.headcount}
            options={[2, 3, 4].map((n) => ({ value: n, label: `${n}명` }))}
            onChange={(headcount) => actions.plan({ headcount })}
          />
          {settlement.ok ? (
            <SplitBoard
              allocation={settlement.shares.map((s) => s.units)}
              unitName={product.unitName}
              className="mt-3"
            />
          ) : settlement.reason === 'tooFewUnits' ? (
            <Notice tone="error" className="mt-3 bg-surface">
              <p>
                전체 {units}
                {josa(product.unitName, '이라', '라')} {plan.headcount}명이 하나씩 받을 수 없어요.
              </p>
              {settlement.maxHeadcount >= MIN_HEADCOUNT ? (
                <Button
                  variant="ink"
                  className="mt-3 min-h-11 px-4 text-sm"
                  onClick={() => actions.plan({ headcount: settlement.maxHeadcount })}
                >
                  {settlement.maxHeadcount}명으로 줄이기
                </Button>
              ) : (
                <p className="mt-1">나눌 수 있는 상품이 2개 이상이어야 해요. 수량을 확인해 주세요.</p>
              )}
            </Notice>
          ) : (
            <Notice tone="error" className="mt-3 bg-surface">
              수량과 결제 금액을 먼저 확인해 주세요.
            </Notice>
          )}
        </section>

        <>
          {settlement.ok && (
            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <SettlementTicket
                settlement={settlement}
                comparison={comparison}
                unitName={product.unitName}
                estimated={payment.estimated}
                title={name}
              />
            </div>
          )}
          <section aria-labelledby="cmp-title" className="rounded-panel bg-surface p-5 lg:col-start-1">
            <h2 id="cmp-title" className="text-lg font-bold">
              소용량과 단가 비교
            </h2>
            {comparison.ok && units !== null && payment.total !== null ? (
              <div className="mt-2">
                <PriceBars
                  comparison={comparison}
                  bulkName={name}
                  referenceName={reference.name.trim() || '소용량 상품'}
                  bulkNote={`${won(payment.total)} ÷ ${amountText(units, product.netAmountPerUnit, product.measure, product.unitName)}`}
                  referenceNote={`${won(reference.price!)} ÷ ${amountText(reference.unitCount!, reference.netAmountPerUnit, reference.measure, product.unitName)}`}
                />
                <Savings flow={flow} />
                <Source flow={flow} />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <Notice>{comparison.ok ? '' : comparison.message}</Notice>
                <Button variant="outline" className="min-h-11 text-sm" onClick={() => actions.go(1)}>
                  비교 상품 입력하기
                </Button>
              </div>
            )}
          </section>
        </>
      </div>
    </div>
  )
}

function Savings({ flow }: { flow: Flow }) {
  const { settlement, comparison, state } = flow
  const times = state.reference.purchasesPerYear
  if (!settlement.ok || !comparison.ok || !times) return null
  const host = settlement.shares[0]!
  const yearly = comparison.savedFor(host.units, host.amount) * times
  return (
    <p className="mt-2 text-sm text-ink-soft">
      1년에 {times}번 이렇게 나누면 방장은 약 {won(Math.abs(yearly))}
      {yearly >= 0 ? '을 아낄 것으로 예상해요.' : '을 더 쓸 것으로 예상해요.'}
    </p>
  )
}

function Source({ flow }: { flow: Flow }) {
  const r = flow.state.reference
  const label =
    r.sourceKind === 'preset' ? '시연용 예시 값' : r.sourceKind === 'link' ? '입력한 링크' : '직접 입력'
  return (
    <p className="mt-2 text-sm text-ink-soft">
      비교 가격 출처: {label}
      {r.checkedOn && `, ${r.checkedOn} 확인`}
    </p>
  )
}
