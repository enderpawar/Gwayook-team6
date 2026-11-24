import { Megaphone, X } from 'lucide-react'
import { useState } from 'react'
import { LoginPrompt } from '@/components/LoginPrompt'
import { Button } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DateField'
import { Field, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { publishProblems } from '@/data/serverMap'
import type { PublishInput } from '@/data/store'
import { store, useAction, usePeople } from '@/data/useStore'
import type { PlanDraft, ProductDraft } from '@/domain/types'
import { formatDeadline, nowLocal } from '@/lib/format'

interface Props {
  product: ProductDraft
  plan: PlanDraft
  /** 로그인한 뒤 돌아올 초안 주소 */
  returnTo: string
  onPublish: (input: PublishInput) => Promise<void>
}

/** 모집글 복사 뒤에 공구를 열어 신청과 정산을 관리하게 한다. */
export function PublishPanel({ product, plan, returnTo, onPublish }: Props) {
  const { me, user } = usePeople()
  const [alias, setAlias] = useState(me.alias)
  const [candidates, setCandidates] = useState<string[]>([])
  const { run, pending, error } = useAction()

  if (!store.local && !user) {
    return <LoginPrompt text="로그인하면 공구를 열어 신청부터 정산까지 관리할 수 있어요." next={returnTo} />
  }
  const problems = store.local ? [] : publishProblems(product, plan, candidates)
  const hostAlias = store.local ? alias : (user?.alias ?? '')
  return (
    <form
      className="rounded-panel bg-tag p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => onPublish({ hostAlias, pickupCandidates: candidates }))
      }}
    >
      <h2 className="text-lg font-bold">신청부터 정산까지 관리하기</h2>
      <p className="mt-1 text-sm">공구를 열면 초대 링크로 신청을 받고, 입금과 수령을 확인할 수 있어요.</p>
      {store.local ? (
        <Field label="참여자에게 보일 내 별칭" className="mt-4">
          {(a) => <TextInput {...a} value={alias} maxLength={20} autoComplete="nickname" onChange={(e) => setAlias(e.target.value)} />}
        </Field>
      ) : (
        <>
          <Field label="수령 후보 일시" className="mt-4">
            {(a) => (
              <DateField
                {...a}
                label="수령 후보 일시"
                mode="datetime"
                min={plan.deadline ?? nowLocal()}
                clearable={false}
                value=""
                onChange={(v) => setCandidates((c) => (c.includes(v) || c.length >= 5 ? c : [...c, v].sort()))}
              />
            )}
          </Field>
          <ul className="mt-2 flex flex-wrap gap-2">
            {candidates.map((c) => (
              <li key={c} className="inline-flex items-center rounded-full bg-surface pl-4 text-sm font-semibold">
                {formatDeadline(c)}
                <button type="button" aria-label={`${formatDeadline(c)} 후보 삭제`} className="grid size-11 place-items-center rounded-full" onClick={() => setCandidates((l) => l.filter((x) => x !== c))}>
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {problems.length > 0 && (
            <Notice className="mt-3 bg-surface">
              <p className="font-semibold">공구를 열려면</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
        </>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      <Button type="submit" variant="ink" disabled={pending || !hostAlias.trim() || problems.length > 0} className="mt-4 w-full disabled:bg-ink/15 disabled:text-ink">
        <Megaphone aria-hidden className="size-5" />
        공구 열기
      </Button>
    </form>
  )
}
