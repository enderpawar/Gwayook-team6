import { ArrowLeft, ArrowRight } from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { useEffect, useRef } from 'react'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/ui/Button'
import { useFlow, type Step } from '@/features/flow'
import { PostStep } from '@/features/PostStep'
import { ProductStep } from '@/features/ProductStep'
import { ReviewStep } from '@/features/ReviewStep'
import { SplitStep } from '@/features/SplitStep'
import { won } from '@/lib/format'

const NEXT_LABEL = ['값 확인하기', '나누기', '모집글 만들기', ''] as const

export function App() {
  const flow = useFlow()
  const { state, actions, maxStep } = flow
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    main.current?.querySelector('h1')?.focus({ preventScroll: true })
  }, [state.step])

  const go = (step: Step) => actions.go(step)

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 py-4">
          <p className="font-display text-xl">긱스플리터</p>
          {import.meta.env.VITE_MOCK_API && (
            <p className="rounded-full bg-tag px-3 py-1 text-xs font-semibold">모의 분석 응답 사용 중</p>
          )}
        </header>
        <Stepper step={state.step} maxStep={maxStep} onGo={go} />
        <main ref={main} className="flex-1 py-6 sm:py-8">
          {state.step === 0 && <ProductStep flow={flow} />}
          {state.step === 1 && <ReviewStep flow={flow} />}
          {state.step === 2 && <SplitStep flow={flow} />}
          {state.step === 3 && <PostStep flow={flow} />}
        </main>
        {state.step > 0 && (
          <BottomBar flow={flow} onBack={() => go((state.step - 1) as Step)} onNext={() => go((state.step + 1) as Step)} />
        )}
      </div>
    </MotionConfig>
  )
}

function BottomBar({ flow, onBack, onNext }: { flow: ReturnType<typeof useFlow>; onBack: () => void; onNext: () => void }) {
  const { state, maxStep, settlement, payment } = flow
  const guest = settlement.ok ? settlement.shares[1] : undefined
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-line bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
      <Button variant="ghost" onClick={onBack} className="px-4">
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
          <Button onClick={onNext} disabled={state.step >= maxStep}>
            {NEXT_LABEL[state.step]}
            <ArrowRight aria-hidden className="size-5" />
          </Button>
        </>
      )}
    </div>
  )
}
