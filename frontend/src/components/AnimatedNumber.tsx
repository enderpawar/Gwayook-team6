import NumberFlow from '@number-flow/react'
import { num } from '@/lib/format'

/** 자릿수가 굴러가는 숫자. 보조 기술에는 쪼개지지 않은 텍스트를 읽어 준다. */
export function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  return (
    <>
      <span className="sr-only">
        {num(value)}
        {suffix}
      </span>
      <span aria-hidden>
        <NumberFlow value={value} locales="ko-KR" suffix={suffix} />
      </span>
    </>
  )
}
