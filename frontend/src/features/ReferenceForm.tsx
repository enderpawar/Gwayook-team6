import { DateField } from '@/components/ui/DateField'
import { Field, NumberInput, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import type { Flow } from './flow'
import { MeasureFields } from './MeasureFields'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function ReferenceForm({ flow }: { flow: Flow }) {
  const { state, actions, comparison } = flow
  const r = state.reference
  const measureMismatch = r.price !== null && r.measure !== state.product.measure
  const badUrl = r.sourceUrl.trim() !== '' && !isHttpUrl(r.sourceUrl.trim())

  return (
    <section aria-labelledby="ref-title" className="rounded-panel bg-surface p-5">
      <h2 id="ref-title" className="text-lg font-bold">
        비교할 소용량 상품
      </h2>
      <p className="mt-1 text-sm text-ink-soft">비워 둬도 정산은 할 수 있어요. 절감률만 표시하지 않아요.</p>
      <div className="mt-4 space-y-4">
        <Field label="소용량 상품명">
          {(a) => <TextInput {...a} value={r.name} maxLength={100} onChange={(e) => actions.reference({ name: e.target.value })} />}
        </Field>
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label="실제 구매 가격" hint="배송비까지 더한 값" error={r.price === 0 ? '0보다 큰 금액을 입력하세요.' : undefined}>
            {(a) => <NumberInput {...a} suffix="원" value={r.price} onValue={(v) => actions.reference({ price: v, checkedOn: r.checkedOn || today() })} />}
          </Field>
          <Field label="들어 있는 개수" error={r.unitCount === 0 ? '1 이상을 입력하세요.' : undefined}>
            {(a) => <NumberInput {...a} value={r.unitCount} onValue={(v) => actions.reference({ unitCount: v })} />}
          </Field>
        </div>
        <MeasureFields
          label="비교 기준"
          measure={r.measure}
          net={r.netAmountPerUnit}
          unitName=""
          onMeasure={(measure) => actions.reference({ measure })}
          onNet={(netAmountPerUnit) => actions.reference({ netAmountPerUnit })}
        />
        {measureMismatch && <Notice tone="warn">대용량 상품과 비교 기준이 달라요. 같은 기준으로 맞춰 주세요.</Notice>}
        {r.measure === 'count' && state.product.measure === 'count' && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-cobalt"
              checked={r.sameSpecConfirmed}
              onChange={(e) => actions.reference({ sameSpecConfirmed: e.target.checked })}
            />
            길이, 겹수, 크기 같은 규격이 같은 상품이에요
          </label>
        )}

        <hr className="border-line" />
        {r.sourceKind === 'preset' && <Notice>가격 출처: 시연용 예시 값. 실제 판매 가격이 아니에요.</Notice>}
        {r.sourceKind === 'serverPreset' && (
          <Notice tone="warn">서버의 시연 데이터에서 가져온 비교 값이에요. 규격이 같은지 직접 확인해 주세요.</Notice>
        )}
        {r.sourceKind === 'capture' && (
          <Notice tone="warn">캡처에서 읽은 비교 값이에요. 가격과 규격이 맞는지 확인해 주세요.</Notice>
        )}
        <Field
          label="가격 출처 링크"
          hint="선택 사항이에요. 비우면 직접 입력한 가격으로 표시해요."
          error={badUrl ? 'http:// 또는 https://로 시작하는 주소를 넣어 주세요.' : undefined}
        >
          {(a) => (
            <TextInput
              {...a}
              type="url"
              inputMode="url"
              value={r.sourceUrl}
              maxLength={500}
              onChange={(e) =>
                actions.reference({
                  sourceUrl: e.target.value,
                  sourceKind: e.target.value.trim() ? 'link' : 'manual',
                  checkedOn: r.checkedOn || today(),
                })
              }
            />
          )}
        </Field>
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label="가격 확인일">
            {(a) => <DateField {...a} label="가격 확인일" mode="date" max={today()} value={r.checkedOn} onChange={(checkedOn) => actions.reference({ checkedOn })} />}
          </Field>
          <Field label="1년 구매 횟수" hint="넣으면 연간 예상액을 보여줘요.">
            {(a) => <NumberInput {...a} suffix="회" value={r.purchasesPerYear} onValue={(v) => actions.reference({ purchasesPerYear: v })} />}
          </Field>
        </div>
        <p role="status" className="text-sm font-semibold">
          {comparison.ok ? '두 상품을 비교할 수 있어요.' : comparison.reason === 'missingProduct' ? '' : comparison.message}
        </p>
      </div>
    </section>
  )
}
