import { Field, NumberInput, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import type { DiscountMode, FieldName, ShippingMode } from '@/domain/types'
import { josa, won } from '@/lib/format'
import type { Flow } from './flow'
import { MeasureFields } from './MeasureFields'
import { PriceCandidates } from './PriceCandidates'
import { ReferenceForm } from './ReferenceForm'

const INTRO = {
  preset: '시연용 샘플이에요. 실제 상품에 맞게 고쳐 보세요.',
  capture: '캡처에서 읽은 값이에요. 틀린 곳이 없는지 확인해 주세요.',
  manual: '상품 페이지를 보면서 입력해 주세요.',
}

export function ReviewStep({ flow }: { flow: Flow }) {
  const { state, actions, problems, payment, units } = flow
  const p = state.product
  const unresolved = (f: FieldName) => p.unresolvedFields.includes(f)
  // 손대지 않은 빈칸에는 오류 대신 안내만 보이도록, 값이 있거나 캡처에서 온 경우에만 오류를 띄운다.
  const err = (f: FieldName, value: unknown) =>
    p.source !== 'manual' || (value !== null && value !== '') ? problems[f] : undefined
  const missing = Object.keys(problems).length

  return (
    <div>
      <h1 tabIndex={-1} className="font-display text-3xl sm:text-4xl">
        값이 맞는지 확인하세요
      </h1>
      <p className="mt-2 text-ink-soft">{INTRO[p.source]}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="bulk-title" className="rounded-panel bg-surface p-5">
          <h2 id="bulk-title" className="text-lg font-bold">
            함께 살 대용량 상품
          </h2>
          <div className="mt-4 space-y-4">
            <Field label="상품명" error={err('fullTitle', p.fullTitle)} unresolved={unresolved('fullTitle')}>
              {(a) => <TextInput {...a} value={p.fullTitle} maxLength={200} onChange={(e) => actions.product({ fullTitle: e.target.value })} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="모집글에 쓸 짧은 이름" hint="비우면 상품명을 써요.">
                {(a) => <TextInput {...a} value={p.shortName} maxLength={60} onChange={(e) => actions.product({ shortName: e.target.value })} />}
              </Field>
              <Field label="선택 옵션" unresolved={unresolved('selectedOption')} hint="없으면 비워 두세요.">
                {(a) => <TextInput {...a} value={p.selectedOption} maxLength={200} onChange={(e) => actions.product({ selectedOption: e.target.value })} />}
              </Field>
            </div>
            <div className="grid grid-cols-3 items-start gap-3">
              <Field label="묶음 수" error={err('packCount', p.packCount)} unresolved={unresolved('packCount')}>
                {(a) => <NumberInput {...a} value={p.packCount} onValue={(v) => actions.product({ packCount: v })} />}
              </Field>
              <Field label="묶음당 개수" error={err('unitsPerPack', p.unitsPerPack)} unresolved={unresolved('unitsPerPack')}>
                {(a) => <NumberInput {...a} value={p.unitsPerPack} onValue={(v) => actions.product({ unitsPerPack: v })} />}
              </Field>
              <Field label="나눌 단위" error={err('unitName', p.unitName)} unresolved={unresolved('unitName')}>
                {(a) => <TextInput {...a} value={p.unitName} maxLength={10} placeholder="롤, 병, 개" onChange={(e) => actions.product({ unitName: e.target.value })} />}
              </Field>
            </div>
            {units !== null && (
              <p className="text-sm font-semibold">
                전체 {units}
                {josa(p.unitName || '개', '을', '를')} 나눠요.
              </p>
            )}
            <MeasureFields
              label="소용량과 비교할 기준"
              measure={p.measure}
              net={p.netAmountPerUnit}
              unitName={p.unitName}
              unresolved={unresolved('netAmountPerUnit') && p.measure !== 'count'}
              onMeasure={(measure) => actions.product({ measure })}
              onNet={(netAmountPerUnit) => actions.product({ netAmountPerUnit })}
            />
            <Notice>
              액체나 세제는 뜯지 않은 포장 단위로 나누세요. 큰 용기 하나를 덜어 나누는 방식은 지원하지 않아요.
            </Notice>

            <hr className="border-line" />
            {p.priceCandidates.length > 0 && (
              <PriceCandidates
                candidates={p.priceCandidates}
                selected={p.displayedPrice}
                onSelect={(amount) => actions.product({ displayedPrice: amount })}
              />
            )}
            <Field
              label="화면에 표시된 상품 금액"
              error={err('displayedPrice', p.displayedPrice)}
              unresolved={unresolved('displayedPrice')}
              hint="장바구니에 다른 상품이 섞여 있으면 이 상품 금액만 적어 주세요."
            >
              {(a) => <NumberInput {...a} suffix="원" value={p.displayedPrice} onValue={(v) => actions.product({ displayedPrice: v })} />}
            </Field>

            <ModeRow<ShippingMode>
              title="배송비"
              unresolved={unresolved('shippingFee')}
              value={p.shippingMode}
              options={[
                { value: 'included', label: '포함됨' },
                { value: 'none', label: '무료' },
                { value: 'separate', label: '별도' },
                { value: 'unknown', label: '모름' },
              ]}
              onChange={(shippingMode) => actions.product({ shippingMode })}
            />
            {p.shippingMode === 'separate' && (
              <Field label="더할 배송비" error={problems.shippingFee}>
                {(a) => <NumberInput {...a} suffix="원" value={p.shippingFee} onValue={(v) => actions.product({ shippingFee: v })} />}
              </Field>
            )}
            <ModeRow<DiscountMode>
              title="할인·쿠폰"
              unresolved={unresolved('discountAmount')}
              value={p.discountMode}
              options={[
                { value: 'included', label: '반영됨' },
                { value: 'none', label: '없음' },
                { value: 'apply', label: '더 뺌' },
                { value: 'unknown', label: '모름' },
              ]}
              onChange={(discountMode) => actions.product({ discountMode })}
            />
            {p.discountMode === 'apply' && (
              <Field label="뺄 할인 금액" error={problems.discountAmount} hint="내가 실제로 쓸 수 있는 할인만 넣어 주세요.">
                {(a) => <NumberInput {...a} suffix="원" value={p.discountAmount} onValue={(v) => actions.product({ discountAmount: v })} />}
              </Field>
            )}
            {(p.shippingMode === 'unknown' || p.discountMode === 'unknown') && (
              <Notice tone="warn">
                {p.shippingMode === 'unknown' && p.discountMode === 'unknown'
                  ? '배송비와 할인을'
                  : p.shippingMode === 'unknown'
                    ? '배송비를'
                    : '할인을'}{' '}
                확인하기 전에는 금액에 ‘예상’을 붙여요.
              </Notice>
            )}

            <div className="rounded-control bg-paper p-4">
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">나눌 결제 금액</span>
                <span className="font-display text-2xl tabular-nums">{payment.total === null ? '미정' : won(payment.total)}</span>
              </p>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-cobalt"
                  checked={p.priceConfirmed}
                  onChange={(e) => actions.product({ priceConfirmed: e.target.checked })}
                />
                실제로 결제할 금액이 맞아요
              </label>
            </div>
          </div>
        </section>

        <ReferenceForm flow={flow} />
      </div>

      <p role="status" className="mt-5 text-sm text-ink-soft">
        {missing > 0 ? `대용량 상품에서 ${missing}개 항목을 더 채우면 나눌 수 있어요.` : ''}
      </p>
    </div>
  )
}

interface ModeRowProps<T extends string> {
  title: string
  value: T
  unresolved?: boolean
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

function ModeRow<T extends string>({ title, value, unresolved, options, onChange }: ModeRowProps<T>) {
  return (
    <div>
      <p aria-hidden className="mb-1.5 flex items-center justify-between text-sm font-semibold">
        {title}
        {unresolved && value === 'unknown' && <span className="rounded-full bg-tag px-2 py-0.5 text-xs">미확인</span>}
      </p>
      <Segmented label={title} value={value} options={options} onChange={onChange} />
    </div>
  )
}
