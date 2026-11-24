import { describe, expect, it } from 'vitest'
import { blankProduct, draftProblems, paymentTotal, totalUnits } from './product'

const base = { ...blankProduct('manual'), displayedPrice: 10000, packCount: 2, unitsPerPack: 12, fullTitle: '생수', unitName: '병' }

describe('paymentTotal', () => {
  it('이미 포함된 배송비·할인은 다시 반영하지 않는다', () => {
    expect(paymentTotal({ ...base, shippingMode: 'included', shippingFee: 3000, discountMode: 'included', discountAmount: 1000 }).total).toBe(10000)
  })
  it('별도 배송비는 더하고 적용할 할인은 뺀다', () => {
    expect(paymentTotal({ ...base, shippingMode: 'separate', shippingFee: 3000, discountMode: 'apply', discountAmount: 1000 }).total).toBe(12000)
  })
  it('별도라고 했는데 금액이 비면 총액을 만들지 않는다', () => {
    expect(paymentTotal({ ...base, shippingMode: 'separate', shippingFee: null }).total).toBeNull()
    expect(paymentTotal({ ...base, discountMode: 'apply', discountAmount: null }).total).toBeNull()
  })
  it('배송비·할인이 미확인이거나 금액을 확정하지 않으면 예상이다', () => {
    expect(paymentTotal({ ...base, shippingMode: 'unknown', priceConfirmed: true }).estimated).toBe(true)
    expect(paymentTotal({ ...base, shippingMode: 'none', discountMode: 'unknown', priceConfirmed: true }).estimated).toBe(true)
    expect(paymentTotal({ ...base, shippingMode: 'none', discountMode: 'none', priceConfirmed: false }).estimated).toBe(true)
    expect(paymentTotal({ ...base, shippingMode: 'none', discountMode: 'none', priceConfirmed: true }).estimated).toBe(false)
  })
  it('할인이 금액보다 크면 총액을 만들지 않는다', () => {
    expect(paymentTotal({ ...base, shippingMode: 'none', discountMode: 'apply', discountAmount: 10000 }).total).toBeNull()
  })
})

describe('totalUnits / draftProblems', () => {
  it('묶음 수 × 묶음당 개수', () => {
    expect(totalUnits(base)).toBe(24)
    expect(totalUnits({ ...base, packCount: 0 })).toBeNull()
    expect(totalUnits({ ...base, unitsPerPack: 1.5 })).toBeNull()
  })
  it('막힌 필드와 고칠 방법을 알려준다', () => {
    const p = draftProblems({ ...base, fullTitle: ' ', packCount: 0, displayedPrice: null })
    expect(Object.keys(p).sort()).toEqual(['displayedPrice', 'fullTitle', 'packCount'])
  })
  it('문제가 없으면 빈 객체', () => {
    expect(draftProblems({ ...base, shippingMode: 'none', discountMode: 'none' })).toEqual({})
  })
})
