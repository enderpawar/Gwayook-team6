import { describe, expect, it } from 'vitest'
import { allocateUnits, settle, splitAmount } from './settlement'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('allocateUnits', () => {
  it('나머지 수량은 방장에게 준다', () => {
    expect(allocateUnits(30, 4)).toEqual([9, 7, 7, 7])
    expect(allocateUnits(24, 4)).toEqual([6, 6, 6, 6])
    expect(allocateUnits(31, 2)).toEqual([16, 15])
  })
  it('한 명이라도 못 받으면 null', () => {
    expect(allocateUnits(3, 4)).toBeNull()
    expect(allocateUnits(0, 2)).toBeNull()
  })
  it('2~4명 밖이거나 정수가 아니면 null', () => {
    expect(allocateUnits(30, 1)).toBeNull()
    expect(allocateUnits(30, 5)).toBeNull()
    expect(allocateUnits(30.5, 2)).toBeNull()
  })
})

describe('splitAmount', () => {
  it('PRD 검증 예시', () => {
    expect(splitAmount(17700, [9, 7, 7, 7])).toEqual([5310, 4130, 4130, 4130])
    expect(splitAmount(17701, [9, 7, 7, 7])).toEqual([5311, 4130, 4130, 4130])
  })
  it('남는 원은 소수 잔여가 큰 순서로, 동률이면 앞 순서로 준다', () => {
    expect(splitAmount(100, [1, 1, 1])).toEqual([34, 33, 33])
    // 10*[2,1,1]/4 = 5, 2.5, 2.5 → 방장 잔여는 0 이므로 참여자 1이 받는다
    expect(splitAmount(10, [2, 1, 1])).toEqual([5, 3, 2])
  })
  it('어떤 조합에서도 합계가 결제 총액과 같다', () => {
    for (let total = 1; total < 4000; total += 37) {
      for (let q = 4; q < 60; q += 1) {
        for (const n of [2, 3, 4]) {
          const units = allocateUnits(q, n)!
          const amounts = splitAmount(total, units)
          expect(sum(amounts)).toBe(total)
          expect(sum(units)).toBe(q)
        }
      }
    }
  })
  it('큰 금액도 부동소수 오차 없이 나눈다', () => {
    const amounts = splitAmount(9_007_199_254_740_991, [3, 2, 2])
    expect(amounts.reduce((a, b) => a + BigInt(b), 0n)).toBe(9_007_199_254_740_991n)
  })
})

describe('settle', () => {
  it('인원이 수량보다 많으면 가능한 최대 인원을 알려준다', () => {
    expect(settle(17700, 3, 4)).toEqual({ ok: false, reason: 'tooFewUnits', maxHeadcount: 3 })
    expect(settle(17700, 1, 2)).toEqual({ ok: false, reason: 'tooFewUnits', maxHeadcount: 1 })
  })
  it('금액이나 수량이 없으면 막는다', () => {
    expect(settle(null, 30, 4)).toMatchObject({ ok: false, reason: 'missing' })
    expect(settle(17700, null, 4)).toMatchObject({ ok: false, reason: 'missing' })
  })
})
