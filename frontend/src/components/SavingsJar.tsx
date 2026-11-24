import { motion } from 'motion/react'

const COLS = 5
const MAX = 25

/** 완료한 공구마다 동전이 하나씩 떨어져 쌓이는 저금통 */
export function SavingsJar({ count }: { count: number }) {
  const coins = Math.min(count, MAX)
  return (
    <svg viewBox="0 0 200 220" role="img" aria-label={`완료한 공구 ${count}건이 쌓인 저금통`} className="mx-auto w-full max-w-60">
      <rect x="52" y="8" width="96" height="22" rx="6" className="fill-ink" />
      <rect x="84" y="15" width="32" height="6" rx="3" className="fill-tag" />
      <path d="M44 34h112c4 14 18 20 18 42v108c0 16-12 26-28 26H54c-16 0-28-10-28-26V76c0-22 14-28 18-42Z" className="fill-surface stroke-ink" strokeWidth="5" />
      <g>
        {Array.from({ length: coins }, (_, i) => {
          const row = Math.floor(i / COLS)
          const x = 52 + (i % COLS) * 24 + (row % 2) * 4 - 2
          const y = 190 - row * 23
          return (
            <motion.g
              key={i}
              initial={{ y: -170, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 160, damping: 13, delay: 0.15 + i * 0.07 }}
            >
              <circle cx={x} cy={y} r="11.5" className="fill-tag stroke-ink" strokeWidth="2.5" />
              <path d={`M${x - 5} ${y - 4}l2.5 8 2.500-6 2.500 6 2.500-8M${x - 6.5} ${y}h13`} className="fill-none stroke-ink" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" />
            </motion.g>
          )
        })}
      </g>
      <path d="M40 84c-2 22-2 62 0 92" className="fill-none stroke-ink/20" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}
