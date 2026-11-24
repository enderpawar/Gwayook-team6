import { Check, MapPin } from 'lucide-react'
import { useState } from 'react'
import { CopyPanel } from '@/components/CopyPanel'
import { Field, TextInput } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import type { Flow } from './flow'

const PLACES = ['행복기숙사 1동 로비', '학교 정문', '도서관 앞', '학생회관 1층']

export function PostStep({ flow }: { flow: Flow }) {
  const { state, actions, post } = flow
  const { plan } = state
  const [custom, setCustom] = useState(plan.place !== null && !PLACES.includes(plan.place))

  const chips: { label: string; selected: boolean; pick: () => void }[] = [
    ...PLACES.map((p) => ({
      label: p,
      selected: !custom && plan.place === p,
      pick: () => {
        setCustom(false)
        actions.plan({ place: p })
      },
    })),
    {
      label: '직접 입력',
      selected: custom,
      pick: () => {
        setCustom(true)
        actions.plan({ place: PLACES.includes(plan.place ?? '') ? null : plan.place })
      },
    },
    {
      label: '아직 미정',
      selected: !custom && plan.place === null,
      pick: () => {
        setCustom(false)
        actions.plan({ place: null })
      },
    },
  ]

  return (
    <div>
      <h1 tabIndex={-1} className="font-display text-3xl sm:text-4xl">
        모집글을 복사하세요
      </h1>
      <p className="mt-2 text-ink-soft">고르는 대로 글이 바뀌어요. 복사해서 에브리타임에 직접 올려 주세요.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-label="모집 조건" className="space-y-5 rounded-panel bg-surface p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">수령 장소</legend>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <label
                  key={c.label}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors',
                    'has-focus-visible:outline-3 has-focus-visible:outline-cobalt',
                    c.selected ? 'bg-ink text-white' : 'bg-paper hover:bg-line',
                  )}
                >
                  <input type="radio" name="place" className="sr-only" checked={c.selected} onChange={c.pick} />
                  {c.selected ? <Check aria-hidden className="size-4" strokeWidth={3} /> : <MapPin aria-hidden className="size-4" />}
                  {c.label}
                </label>
              ))}
            </div>
            {custom && (
              <Field label="수령 장소 직접 입력" className="mt-3" hint="집 주소 대신 누구나 찾을 수 있는 공개된 장소를 적어 주세요.">
                {(a) => (
                  <TextInput {...a} value={plan.place ?? ''} maxLength={100} onChange={(e) => actions.plan({ place: e.target.value || null })} />
                )}
              </Field>
            )}
          </fieldset>
          <Field label="모집 마감" hint="비우면 미정으로 표시해요.">
            {(a) => (
              <TextInput
                {...a}
                type="datetime-local"
                value={plan.deadline ?? ''}
                onChange={(e) => actions.plan({ deadline: e.target.value || null })}
              />
            )}
          </Field>
          <Field label="신청 방법" hint="비우면 ‘댓글이나 쪽지로 알려 주세요’로 들어가요.">
            {(a) => (
              <TextInput
                {...a}
                value={plan.applyMethod}
                maxLength={200}
                placeholder="예: 오픈채팅 링크, 쪽지"
                onChange={(e) => actions.plan({ applyMethod: e.target.value })}
              />
            )}
          </Field>
        </section>
        {post && <CopyPanel post={post} />}
      </div>
    </div>
  )
}
