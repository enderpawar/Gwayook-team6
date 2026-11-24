const nf = new Intl.NumberFormat('ko-KR')

export const num = (n: number) => nf.format(n)
export const won = (n: number) => `${nf.format(n)}원`

/** 단가 표시: 정수면 그대로, 아니면 소수 첫째 자리까지. */
export const unitWon = (n: number) =>
  `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(n)}원`

export const percent = (n: number) => `${Math.abs(n).toFixed(1)}%`

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

/** datetime-local 값(YYYY-MM-DDTHH:mm)을 한국어로 바꾼다. 형식이 틀리면 null. */
export function formatDeadline(value: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '')
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return `${Number(mo)}월 ${Number(d)}일(${DAYS[date.getDay()]}) ${h}:${mi}`
}

/** 받침에 따라 조사를 고른다. 한글이 아니면 두 번째 조사를 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return word + (code >= 0 && code < 11172 && code % 28 !== 0 ? withFinal : withoutFinal)
}
