/** 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다. 시간대 때문에 하루가 밀리는 일을 막는다. */
const pad = (n: number) => String(n).padStart(2, '0')

export const ymd = (y: number, m: number, d: number) => {
  const t = new Date(y, m - 1, d)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

export const parts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}

export const addDays = (date: string, n: number) => {
  const { y, m, d } = parts(date)
  return ymd(y, m, d + n)
}

/** 달을 옮길 때 없는 날짜(예: 2월 31일)는 그 달의 마지막 날로 맞춘다. */
export const addMonths = (date: string, n: number) => {
  const { y, m, d } = parts(date)
  const last = new Date(y, m - 1 + n + 1, 0).getDate()
  return ymd(y, m + n, Math.min(d, last))
}

export const weekday = (date: string) => {
  const { y, m, d } = parts(date)
  return new Date(y, m - 1, d).getDay()
}

/** 일요일로 시작하는 6주. 앞뒤 달의 날짜도 채운다. */
export function monthGrid(date: string): string[][] {
  const { y, m } = parts(date)
  const first = ymd(y, m, 1)
  const start = addDays(first, -weekday(first))
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
}

export const todayYmd = (now = new Date()) => ymd(now.getFullYear(), now.getMonth() + 1, now.getDate())

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7)
