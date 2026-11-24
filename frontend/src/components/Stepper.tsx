import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { STEPS, type Step } from '@/features/flow'
import { cn } from '@/lib/cn'

interface Props {
  step: Step
  maxStep: Step
  onGo: (step: Step) => void
}

export function Stepper({ step, maxStep, onGo }: Props) {
  return (
    <nav aria-label="진행 단계">
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((label, i) => {
          const reachable = i <= maxStep
          const done = i < step
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => onGo(i as Step)}
                className="w-full rounded-md pb-1 text-left disabled:cursor-not-allowed"
              >
                <span className="block h-1.5 overflow-hidden rounded-full bg-ink/12">
                  <motion.span
                    className="block h-full origin-left rounded-full bg-ink"
                    initial={false}
                    animate={{ scaleX: i <= step ? 1 : 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </span>
                <span
                  className={cn(
                    'mt-1.5 flex min-h-6 items-center gap-1 text-sm',
                    i === step ? 'font-bold' : 'text-ink-soft',
                  )}
                >
                  {done && <Check aria-hidden className="size-4" strokeWidth={3} />}
                  {label}
                  {done && <span className="sr-only">완료</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
