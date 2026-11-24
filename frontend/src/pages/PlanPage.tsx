import { ArrowLeft, ArrowRight, CloudCheck, CloudOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/ui/Button'
import type { PublishInput } from '@/data/store'
import { store, useQuery } from '@/data/useStore'
import { useFlow, type FlowSeed, type Step } from '@/features/flow'
import { PostStep } from '@/features/PostStep'
import { ProductStep } from '@/features/ProductStep'
import { ReviewStep } from '@/features/ReviewStep'
import { SplitStep } from '@/features/SplitStep'
import { won } from '@/lib/format'
import { newId } from '@/lib/id'
import { href, navigate } from '@/lib/router'
import { PageError, PageLoading } from './PageState'

const NEXT_LABEL = ['값 확인하기', '나누기', '모집글 만들기', ''] as const

export function PlanPage({ draftId }: { draftId: string | null }) {
  return draftId ? <SavedPlan id={draftId} /> : <Planner id={null} seed={null} />
}

function SavedPlan({ id }: { id: string }) {
  // 처음 한 번만 읽는다. 자동 저장이 저장소를 바꿔도 입력 중인 화면을 다시 만들지 않는다.
  const query = useQuery(() => store.getHosted(id), `draft:${id}`)
  const first = useRef<FlowSeed | null>(null)
  const published = query.status === 'ready' && query.data.status !== 'draft'
  if (query.status === 'ready' && !first.current && !published) first.current = query.data

  useEffect(() => {
    if (published) navigate(href.manage(id))
  }, [published, id])

  if (first.current) return <Planner id={id} seed={first.current} />
  if (query.status === 'error') return <PageError title="초안을 열 수 없어요" message={query.message} />
  return <PageLoading />
}

type SaveState = 'idle' | 'saved' | 'failed'

function Planner({ id, seed }: { id: string | null; seed: FlowSeed | null }) {
  const flow = useFlow(seed)
  const { state, actions, maxStep } = flow
  const [draftId] = useState(() => id ?? newId())
  const [save, setSave] = useState<SaveState>(seed ? 'saved' : 'idle')
  const root = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const published = useRef(false)

  const { started, step, product, reference, plan } = state
  const pending = useRef<(() => Promise<void>) | null>(null)

  // 초안 자동 저장 (F-14). 이미지는 저장하지 않고 확인된 입력만 남긴다.
  useEffect(() => {
    if (!started) return
    const job = async () => {
      pending.current = null
      if (published.current) return
      try {
        await store.saveDraft({ id: draftId, step, product, reference, plan })
        setSave('saved')
        if (['', '#', '#/'].includes(location.hash)) history.replaceState(null, '', href.draft(draftId))
      } catch {
        setSave('failed')
      }
    }
    pending.current = job
    const timer = setTimeout(() => void job(), 400)
    return () => clearTimeout(timer)
  }, [draftId, started, step, product, reference, plan])

  useEffect(() => {
    const flush = () => void pending.current?.()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    root.current?.querySelector('h1')?.focus({ preventScroll: true })
  }, [step])

  const publish = async (input: PublishInput) => {
    await store.saveDraft({ id: draftId, step, product, reference, plan })
    // 공개하는 동안 자동 저장이 초안을 되살리지 않게 한다.
    published.current = true
    pending.current = null
    try {
      const gigId = await store.publish(draftId, input)
      store.setAlias(input.hostAlias)
      navigate(href.manage(gigId))
    } catch (e) {
      published.current = false
      throw e
    }
  }

  return (
    <div ref={root} className="flex flex-1 flex-col">
      <Stepper step={step} maxStep={maxStep} onGo={actions.go} />
      <p className="mt-1 flex min-h-6 items-center justify-end gap-1.5 text-sm text-ink-soft">
        {save === 'saved' && (
          <>
            <CloudCheck aria-hidden className="size-4" /> 초안 저장됨
          </>
        )}
        {save === 'failed' && (
          <span role="alert" className="flex items-center gap-1.5 text-danger">
            <CloudOff aria-hidden className="size-4" /> 초안을 저장하지 못했어요
          </span>
        )}
      </p>
      <div className="flex-1 py-4 sm:py-5">
        {step === 0 && <ProductStep flow={flow} />}
        {step === 1 && <ReviewStep flow={flow} />}
        {step === 2 && <SplitStep flow={flow} />}
        {step === 3 && <PostStep flow={flow} returnTo={href.draft(draftId)} onPublish={publish} />}
      </div>
      {step > 0 && <BottomBar flow={flow} />}
    </div>
  )
}

function BottomBar({ flow }: { flow: ReturnType<typeof useFlow> }) {
  const { state, actions, maxStep, settlement, payment } = flow
  const guest = settlement.ok ? settlement.shares[1] : undefined
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-line bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
      <Button variant="ghost" onClick={() => actions.go((state.step - 1) as Step)} className="px-4">
        <ArrowLeft aria-hidden className="size-5" />
        이전
      </Button>
      {state.step < 3 && (
        <>
          <p className="min-w-0 flex-1 text-right text-sm leading-tight">
            {guest && state.step === 2 && (
              <>
                <span className="block text-ink-soft">참여자{payment.estimated ? ' 예상' : ''}</span>
                <span className="font-bold tabular-nums">{won(guest.amount)}</span>
              </>
            )}
          </p>
          <Button onClick={() => actions.go((state.step + 1) as Step)} disabled={state.step >= maxStep}>
            {NEXT_LABEL[state.step]}
            <ArrowRight aria-hidden className="size-5" />
          </Button>
        </>
      )}
    </div>
  )
}
