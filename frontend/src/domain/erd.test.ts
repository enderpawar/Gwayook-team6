import { expect, it } from 'vitest'
import { toErdRows } from './erd'
import { PRESETS } from './presets'
import { settle } from './settlement'

it('ERD 컬럼에 맞게 바꾸고 정산 합계를 보존한다', () => {
  const { product, reference } = PRESETS[0]!
  const s = settle(17700, 30, 4)
  if (!s.ok) throw new Error()
  const rows = toErdRows({
    product, reference, settlement: s, post: { title: 't', body: 'b' },
    plan: { headcount: 4, place: null, deadline: null, applyMethod: '' },
  })
  expect(rows.productAnalysis).toMatchObject({
    source: 'PRESET', short_name: '롤휴지 30롤', unit_name: '롤', bulk_total_qty: 30,
    bulk_total_price: 17700, small_pack_qty: 6, small_pack_price: 7800, annual_purchase_count: 4,
  })
  expect(rows.groupBuy).toMatchObject({ headcount: 4, pickup_location: null, status: 'OPEN' })
  expect(rows.settlementShares.map((r) => r.seat_no)).toEqual([0, 1, 2, 3])
  expect(rows.settlementShares.reduce((a, r) => a + r.amount, 0)).toBe(17700)
})
