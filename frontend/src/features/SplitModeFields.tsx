import { Field, NumberInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import type { DirectChecks } from '@/domain/types'
import type { Flow } from './flow'

const CHECKS: { key: keyof DirectChecks; label: string }[] = [
  { key: 'label', label: '제품 표시사항에 덜어 쓰면 안 된다는 문구가 없어요' },
  { key: 'measuring', label: '저울이나 계량컵으로 정확히 잴 수 있어요' },
  { key: 'container', label: '깨끗하고 새지 않는 소분 용기를 준비했어요' },
]

/** 용량형 상품의 나누는 방식 (F-20). ml·g 로 비교할 때만 보여준다. */
export function SplitModeFields({ flow }: { flow: Flow }) {
  const { state, actions, problems } = flow
  const p = state.product
  if (p.measure !== 'ml' && p.measure !== 'g') return null
  return (
    <div className="space-y-3 rounded-control bg-paper p-4">
      <p aria-hidden className="text-sm font-semibold">
        나누는 방식
      </p>
      <Segmented
        label="나누는 방식"
        className="-mx-1"
        tone="onTag"
        value={p.splitMode}
        options={[
          { value: 'sealed', label: '포장 그대로' },
          { value: 'direct', label: '덜어서' },
        ]}
        onChange={(splitMode) => actions.product({ splitMode })}
      />
      {p.splitMode === 'sealed' ? (
        <p className="text-sm text-ink-soft">뜯지 않은 포장 단위로 나눠요. 액체나 세제는 이 방식을 권해요.</p>
      ) : (
        <>
          <Field label="한 번에 덜어 나눌 양" error={problems.directStep}>
            {(a) => <NumberInput {...a} suffix={p.measure} value={p.directStep} onValue={(directStep) => actions.product({ directStep })} />}
          </Field>
          <fieldset>
            <legend className="text-sm font-semibold">세 가지를 확인해 주세요</legend>
            {CHECKS.map((c) => (
              <label key={c.key} className="flex min-h-11 cursor-pointer items-center gap-2.5 py-1 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-cobalt"
                  checked={p.directChecks[c.key]}
                  onChange={(e) => actions.product({ directChecks: { ...p.directChecks, [c.key]: e.target.checked } })}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
          <Notice tone="warn">하나라도 확인하지 못하면 포장 그대로 나눠 주세요.</Notice>
        </>
      )}
    </div>
  )
}
