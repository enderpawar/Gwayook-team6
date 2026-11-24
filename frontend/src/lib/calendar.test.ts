import { expect, it } from 'vitest'
import { addDays, addMonths, monthGrid, weekday } from './calendar'

it('달력은 일요일로 시작하는 6주다', () => {
  const g = monthGrid('2026-11-24')
  expect(g).toHaveLength(6)
  expect(g[0]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
  expect(monthGrid('2026-12-15')[0]![0]).toBe('2026-11-29')
})
it('달과 해를 넘긴다', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
})
it('없는 날짜는 그 달의 마지막 날로 맞춘다', () => {
  expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
  expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
})
it('요일을 계산한다', () => expect(weekday('2026-11-24')).toBe(2))
