import { Crown, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { SEAT_BG } from './seats'

interface Props {
  headcount: number
  /** 방장을 포함해 확정된 사람의 별칭 */
  names: string[]
  /** 취소된 공구에는 남은 자리를 안내하지 않는다. */
  quiet?: boolean
}

/** 자리가 채워지는 모습. 승인하면 색 토큰이 자리에 떨어진다. */
export function Seats({ headcount, names, quiet }: Props) {
  const left = Math.max(0, headcount - names.length)
  return (
    <div>
      <ul className="grid grid-cols-4 gap-2">
        {Array.from({ length: headcount }, (_, i) => {
          const name = names[i]
          return (
            <li key={i} className="min-w-0 text-center">
              <div className="relative mx-auto grid aspect-square w-full max-w-20 place-items-center rounded-full border-2 border-dashed border-ink-soft/50">
                <Plus aria-hidden className="size-5 text-ink-soft" />
                <AnimatePresence>
                  {name !== undefined && (
                    <motion.span
                      initial={{ y: -28, scale: 0.7, opacity: 0 }}
                      animate={{ y: 0, scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                      aria-hidden
                      className={cn('absolute -inset-0.5 grid place-items-center rounded-full text-lg font-bold text-white', SEAT_BG[i])}
                    >
                      {i === 0 ? <Crown className="size-6" /> : name.slice(0, 1)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <p className="mt-1 truncate text-sm">{name ?? '빈자리'}</p>
            </li>
          )
        })}
      </ul>
      {!quiet && <p className="mt-2 text-sm font-semibold">{left === 0 ? '자리가 모두 찼어요.' : `${left}자리 남았어요.`}</p>}
    </div>
  )
}
