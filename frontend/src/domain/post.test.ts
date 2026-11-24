import { describe, expect, it } from 'vitest'
import { compare } from './comparison'
import { buildPost } from './post'
import { PRESETS } from './presets'
import { paymentTotal, totalUnits } from './product'
import { settle } from './settlement'
import type { PlanDraft, ProductDraft } from './types'

const preset = PRESETS[0]!
const plan: PlanDraft = { headcount: 4, place: '학교 정문', deadline: '2026-11-28T18:00', applyMethod: '쪽지 주세요' }

function make(p: Partial<ProductDraft> = {}, q: Partial<PlanDraft> = {}) {
  const product = { ...preset.product, ...p }
  const pl = { ...plan, ...q }
  const pay = paymentTotal(product)
  const s = settle(pay.total, totalUnits(product), pl.headcount)
  if (!s.ok) throw new Error('정산 가능해야 한다')
  return buildPost({ product, plan: pl, settlement: s, estimated: pay.estimated, comparison: compare(product, preset.reference), referenceName: preset.reference.name })
}

describe('buildPost', () => {
  it('필수 항목을 모두 담는다', () => {
    const { title, body } = make({ priceConfirmed: true })
    expect(title).toContain('롤휴지 30롤')
    expect(title).toContain('3명')
    for (const s of ['3자리', '7롤', '4,130원', '9롤', '5,310원', '학교 정문', '11월 28일(토) 18:00', '쪽지 주세요', '17,700원']) {
      expect(body).toContain(s)
    }
    expect(body).not.toContain('예상')
  })
  it('미확정 금액에는 예상을 붙인다', () => {
    expect(make({ priceConfirmed: false }).body).toContain('예상')
  })
  it('장소·마감이 없으면 미정이라고 쓴다', () => {
    const { body } = make({}, { place: null, deadline: null })
    expect(body).toContain('수령 장소: 미정')
    expect(body).toContain('마감: 미정')
  })
  it('참여자 금액이 다르면 범위로 쓴다', () => {
    const { body } = make({ displayedPrice: 17702, unitsPerPack: 28, unitName: '롤' })
    expect(body).toMatch(/4,425원~4,426원/)
  })
  it('공동구매가 더 비싸면 절감 문구를 넣지 않는다', () => {
    expect(make({ displayedPrice: 90000 }).body).not.toContain('저렴')
  })
})
