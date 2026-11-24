import { describe, expect, it } from 'vitest'
import { compare } from './comparison'
import { blankProduct, blankReference } from './product'
import { PRESETS } from './presets'

const roll = {
  ...blankProduct('manual'), fullTitle: '롤휴지', unitName: '롤', packCount: 1, unitsPerPack: 30,
  displayedPrice: 17700, shippingMode: 'none' as const, discountMode: 'none' as const,
}
const small = { ...blankReference(), name: '6롤', price: 7800, unitCount: 6, sameSpecConfirmed: true }

describe('compare', () => {
  it('PRD 검증 예시: 590원, 1300원, 54.6%', () => {
    const r = compare(roll, small)
    if (!r.ok) throw new Error('비교 가능해야 한다')
    expect(r.bulk.perBasis).toBe(590)
    expect(r.reference.perBasis).toBe(1300)
    expect(r.savingsRate.toFixed(1)).toBe('54.6')
    expect(r.savedFor(9, 5310)).toBe(6390)
    expect(r.savedFor(7, 4130)).toBe(4970)
  })
  it('용량이 다르면 총 용량으로 환산한다', () => {
    const water = { ...roll, unitName: '병', packCount: 1, unitsPerPack: 24, netAmountPerUnit: 2000, measure: 'ml' as const, displayedPrice: 16800 }
    const ref = { ...blankReference(), price: 2700, unitCount: 6, netAmountPerUnit: 500, measure: 'ml' as const }
    const r = compare(water, ref)
    if (!r.ok) throw new Error('비교 가능해야 한다')
    expect(r.basisLabel).toBe('100ml')
    expect(r.bulk.perBasis).toBe(35)
    expect(r.reference.perBasis).toBe(90)
    expect(r.savedFor(6, 4200)).toBe(6600)
  })
  it('공동구매가 더 비싸면 음수 그대로', () => {
    const r = compare({ ...roll, displayedPrice: 60000 }, small)
    if (!r.ok) throw new Error('비교 가능해야 한다')
    expect(r.savingsRate).toBeLessThan(0)
    expect(r.savedFor(7, 14000)).toBe(-4900)
  })
  it.each([
    ['기준가 미확인', roll, { ...small, price: null }, 'missingReference'],
    ['기준가 0', roll, { ...small, price: 0 }, 'missingReference'],
    ['수량 0', roll, { ...small, unitCount: 0 }, 'missingReference'],
    ['같은 규격 미확인', roll, { ...small, sameSpecConfirmed: false }, 'specUnconfirmed'],
    ['단위 불일치', roll, { ...small, measure: 'ml' as const, netAmountPerUnit: 100 }, 'incompatible'],
    ['규격 값 없음', { ...roll, measure: 'ml' as const }, { ...small, measure: 'ml' as const, netAmountPerUnit: 100 }, 'missingSpec'],
    ['결제 금액 없음', { ...roll, displayedPrice: null }, small, 'missingProduct'],
  ])('%s 이면 보류한다', (_, p, r, reason) => {
    expect(compare(p, r)).toMatchObject({ ok: false, reason })
  })
  it('소수 규격도 정확히 환산한다', () => {
    const p = { ...roll, measure: 'm' as const, netAmountPerUnit: 33.3 }
    const r = compare(p, { ...small, measure: 'm' as const, netAmountPerUnit: 33.3 })
    expect(r.ok && r.savingsRate.toFixed(1)).toBe('54.6')
  })
  it('모든 프리셋은 비교가 가능하다', () => {
    for (const preset of PRESETS) expect(compare(preset.product, preset.reference).ok).toBe(true)
  })
})
