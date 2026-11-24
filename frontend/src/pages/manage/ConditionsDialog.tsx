import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, NumberInput, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { store, useAction } from '@/data/useStore'
import { approved } from '@/domain/gig/select'
import type { Gig } from '@/domain/gig/types'
import { formatDeadline } from '@/lib/format'

export function ConditionsDialog({ gig, onClose }: { gig: Gig; onClose: () => void }) {
  const min = Math.max(2, approved(gig).length + 1)
  const [headcount, setHeadcount] = useState(gig.plan.headcount)
  const [price, setPrice] = useState<number | null>(gig.product.displayedPrice)
  const [place, setPlace] = useState(gig.plan.place ?? '')
  const [deadline, setDeadline] = useState(gig.plan.deadline ?? '')
  const [candidates, setCandidates] = useState(gig.pickupCandidates)
  const [draft, setDraft] = useState('')
  const { run, pending, error } = useAction()

  return (
    <Dialog title="모집 조건 바꾸기" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() =>
            store.execute(gig.id, {
              type: 'editConditions',
              conditions: {
                headcount,
                place,
                pickupCandidates: candidates,
                ...(deadline !== (gig.plan.deadline ?? '') ? { deadline: deadline || null } : {}),
                ...(price !== null && price !== gig.product.displayedPrice ? { displayedPrice: price } : {}),
              },
            }),
          ).then((ok) => ok && onClose())
        }}
      >
        <p className="text-sm text-ink-soft">바꾼 시각이 초대 링크에 표시돼요.</p>
        <div>
          <p aria-hidden className="mb-1.5 text-sm font-semibold">
            목표 인원 (방장 포함)
          </p>
          <Segmented
            label="목표 인원"
            value={headcount}
            options={[2, 3, 4].filter((n) => n >= min).map((n) => ({ value: n, label: `${n}명` }))}
            onChange={setHeadcount}
          />
          {min > 2 && <p className="mt-1.5 text-sm text-ink-soft">이미 승인한 참여자가 있어 {min}명부터 고를 수 있어요.</p>}
        </div>
        <Field label="상품 금액">
          {(a) => <NumberInput {...a} suffix="원" value={price} onValue={setPrice} />}
        </Field>
        <Field label="수령 장소" hint="비우면 미정으로 표시해요.">
          {(a) => <TextInput {...a} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />}
        </Field>
        <Field label="신청 마감" hint="비우면 미정으로 표시해요.">
          {(a) => <TextInput {...a} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
        <div>
          <div className="flex items-end gap-2">
            <Field label="수령 후보 일시" className="flex-1">
              {(a) => <TextInput {...a} type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} />}
            </Field>
            <Button
              variant="outline"
              aria-label="수령 후보 추가"
              className="px-4"
              disabled={!draft || candidates.includes(draft) || candidates.length >= 5}
              onClick={() => {
                setCandidates((c) => [...c, draft].sort())
                setDraft('')
              }}
            >
              <Plus aria-hidden className="size-5" />
            </Button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {candidates.map((c) => (
              <li key={c} className="inline-flex items-center rounded-full bg-paper pl-4 text-sm font-semibold">
                {formatDeadline(c)}
                <button
                  type="button"
                  aria-label={`${formatDeadline(c)} 후보 삭제`}
                  className="grid size-11 place-items-center rounded-full"
                  onClick={() => setCandidates((list) => list.filter((x) => x !== c))}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={pending}>
          조건 저장하기
        </Button>
      </form>
    </Dialog>
  )
}
