import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 가장자리가 톱니인 원. 바깥·안쪽 반지름을 번갈아 잇는다. */
const SCALLOP = (() => {
  const teeth = 18
  let d = ''
  for (let i = 0; i < teeth; i += 1) {
    const a0 = (i / teeth) * Math.PI * 2
    const a1 = ((i + 0.5) / teeth) * Math.PI * 2
    const a2 = ((i + 1) / teeth) * Math.PI * 2
    const p = (a: number, r: number) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
    d += `${i === 0 ? `M${p(a0, 44)}` : ''}Q${p(a1, 54)} ${p(a2, 44)}`
  }
  return `${d}Z`
})()

interface Props {
  children: ReactNode
  className?: string
  tone?: 'ink' | 'tag'
  delay?: number
}

/** 쿵 하고 찍히는 할인 스티커 */
export function Sticker({ children, className, tone = 'ink', delay = 0 }: Props) {
  return (
    <motion.div
      initial={{ scale: 1.7, rotate: 10, opacity: 0 }}
      animate={{ scale: 1, rotate: -8, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 19, delay }}
      className={cn('relative grid size-28 place-items-center text-center', className)}
    >
      <svg viewBox="0 0 100 100" aria-hidden className={cn('absolute inset-0 size-full', tone === 'ink' ? 'text-ink' : 'text-tag')}>
        <path d={SCALLOP} fill="currentColor" />
      </svg>
      <div className={cn('relative leading-tight', tone === 'ink' ? 'text-tag' : 'text-ink')}>{children}</div>
    </motion.div>
  )
}
