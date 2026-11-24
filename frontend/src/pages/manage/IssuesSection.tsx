import { CircleAlert, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, TextInput, controlClass } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { SERVER_ISSUES } from '@/data/serverMap'
import { store, useAction } from '@/data/useStore'
import { aliasOf, approved } from '@/domain/gig/select'
import { ISSUE_LABEL, type Gig, type Issue, type IssueKind } from '@/domain/gig/types'

/** 품절, 주문 취소, 부분 환불, 노쇼의 사유와 후속 조치를 남긴다. (F-18) */
export function IssuesSection({ gig }: { gig: Gig }) {
  const [adding, setAdding] = useState(false)
  const [resolving, setResolving] = useState<Issue | null>(null)
  const { run, pending, error } = useAction()
  const resolveNow = (issueId: string) => void run(() => store.execute(gig.id, { type: 'resolveIssue', issueId, followUp: '' }))
  const canAdd = store.local
    ? ['closed', 'settling', 'pickup', 'done'].includes(gig.status)
    : gig.settlements.length > 0 && !gig.server?.pending && ['settling', 'pickup', 'done', 'cancelled'].includes(gig.status)
  if (!canAdd && gig.issues.length === 0) return null
  return (
    <section aria-labelledby="issues-title" className="rounded-panel bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="issues-title" className="text-lg font-bold">
          문제와 변경
        </h2>
        {canAdd && (
          <Button variant="outline" className="min-h-11 px-4 text-sm" onClick={() => setAdding(true)}>
            기록하기
          </Button>
        )}
      </div>
      {gig.issues.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">품절, 취소, 노쇼가 생기면 이유와 처리 방법을 남겨 주세요.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {gig.issues.map((i) => (
            <li key={i.id} className="py-3">
              <p className="flex items-center gap-1.5 font-semibold">
                {i.resolvedAt ? <CircleCheck aria-hidden className="size-4.5" /> : <CircleAlert aria-hidden className="size-4.5 text-danger" />}
                {ISSUE_LABEL[i.kind]}
                {i.key && ` (${aliasOf(gig, i.key)})`}
                <span className="font-normal text-ink-soft">{i.resolvedAt ? '해결' : '처리 중'}</span>
              </p>
              {i.reason && <p className="mt-1 text-sm">{i.reason}</p>}
              {i.resolvedAt ? (
                i.followUp && <p className="mt-1 text-sm text-ink-soft">처리: {i.followUp}</p>
              ) : (
                <Button variant="outline" className="mt-2 min-h-11 px-4 text-sm" disabled={pending} onClick={() => (store.local ? setResolving(i) : resolveNow(i.id))}>
                  해결로 표시
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {adding && <AddDialog gig={gig} onClose={() => setAdding(false)} />}
      {resolving && <ResolveDialog gig={gig} issue={resolving} onClose={() => setResolving(null)} />}
    </section>
  )
}

const LOCAL_KINDS: IssueKind[] = ['soldOut', 'orderCancelled', 'partialRefund', 'noShow', 'other']

function AddDialog({ gig, onClose }: { gig: Gig; onClose: () => void }) {
  const [kind, setKind] = useState<IssueKind>(store.local ? 'soldOut' : 'orderIssue')
  const [key, setKey] = useState('')
  const [reason, setReason] = useState('')
  const { run, pending, error } = useAction()
  const needsPerson = !store.local && (kind === 'noShow' || kind === 'returnRequired')
  return (
    <Dialog title="문제 기록하기" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, { type: 'openIssue', kind, key: key || null, reason })).then((ok) => ok && onClose())
        }}
      >
        <Field label="무슨 일인가요?">
          {(a) => (
            <select {...a} className={`${controlClass} select-chevron`} value={kind} onChange={(e) => setKind(e.target.value as IssueKind)}>
              {(store.local ? LOCAL_KINDS : SERVER_ISSUES.map((i) => i.kind)).map((k) => (
                <option key={k} value={k}>
                  {ISSUE_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="관련된 참여자">
          {(a) => (
            <select {...a} className={`${controlClass} select-chevron`} value={key} onChange={(e) => setKey(e.target.value)}>
              {!needsPerson && <option value="">공구 전체</option>}
              {needsPerson && <option value="">고르세요</option>}
              {approved(gig).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.alias}
                </option>
              ))}
            </select>
          )}
        </Field>
        {store.local && (
          <Field label="이유">
            {(a) => <TextInput {...a} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
        <p className="text-sm text-ink-soft">금액이나 인원이 바뀌면 ‘정산 바꾸기’도 함께 해 주세요.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={pending || (store.local ? !reason.trim() : needsPerson && !key)}>
          기록하기
        </Button>
      </form>
    </Dialog>
  )
}

function ResolveDialog({ gig, issue, onClose }: { gig: Gig; issue: Issue; onClose: () => void }) {
  const [followUp, setFollowUp] = useState('')
  const { run, pending, error } = useAction()
  return (
    <Dialog title={`${ISSUE_LABEL[issue.kind]} 해결하기`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => store.execute(gig.id, { type: 'resolveIssue', issueId: issue.id, followUp })).then((ok) => ok && onClose())
        }}
      >
        <Field label="어떻게 처리했나요?">
          {(a) => <TextInput {...a} value={followUp} maxLength={200} onChange={(e) => setFollowUp(e.target.value)} />}
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={pending || !followUp.trim()}>
          해결로 표시
        </Button>
      </form>
    </Dialog>
  )
}
