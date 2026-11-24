import { describe, expect, it, vi } from 'vitest'
import { PRESETS } from '@/domain/presets'
import type { PlanDraft } from '@/domain/types'
import { createHttpStore, p1Available } from './httpStore'
import { createLocalStore } from './localStore'
import { fromBalance, publishProblems, ratioToWon, serverError, toIso, toLocal, toServerInput, toServerProduct } from './serverMap'

const roll = { ...PRESETS[0]!.product, priceConfirmed: true }
const plan: PlanDraft = { headcount: 4, place: '학교 정문', deadline: '2030-05-01T18:00', applyMethod: '' }
const after = ['2030-05-02T18:00']

describe('공개 전 확인', () => {
  it('서버가 받는 초안은 문제가 없다', () => expect(publishProblems(roll, plan, after)).toEqual([]))
  it.each([
    ['마감 없음', roll, { ...plan, deadline: null }, after],
    ['수령 후보 없음', roll, plan, []],
    ['수령이 마감보다 빠름', roll, plan, ['2030-04-30T18:00']],
    ['예상 금액', { ...roll, priceConfirmed: false }, plan, after],
    ['배송비 모름', { ...roll, shippingMode: 'unknown' as const }, plan, after],
    ['덜어 나누기', { ...roll, splitMode: 'direct' as const }, plan, after],
    ['지원하지 않는 단위', { ...roll, unitName: '팩' }, plan, after],
  ])('%s', (_, p, pl, c) => expect(publishProblems(p, pl, c)).not.toEqual([]))
})

describe('서버 입력', () => {
  it('배송비와 할인은 이미 포함됐는지까지 보낸다', () => {
    const p = toServerProduct({ ...roll, shippingMode: 'separate', shippingFee: 3000, discountMode: 'included', discountAmount: 500 }, PRESETS[0]!.reference)
    expect(p.payment).toEqual({ productAmount: 17700, shippingFee: 3000, discountAmount: 0, includesShipping: false, includesDiscount: true, isEstimate: false })
  })
  it('시연용 비교 값은 보내지 않고 직접 입력한 값만 보낸다', () => {
    const m = { ...roll, measure: 'm' as const, netAmountPerUnit: 30 }
    const ref = { ...PRESETS[0]!.reference, measure: 'm' as const, netAmountPerUnit: 30 }
    expect(toServerProduct(m, ref)).not.toHaveProperty('comparisonBaseline')
    expect(toServerProduct(m, { ...ref, sourceKind: 'manual' })).toMatchObject({ comparisonBaseline: { price: 7800, quantity: 6, spec: { unit: 'm', amountPerUnit: 30 } } })
  })
  it('롤을 개수로만 비교하면 서버 비교에서 뺀다', () => {
    expect(toServerProduct(roll, { ...PRESETS[0]!.reference, sourceKind: 'manual' })).not.toHaveProperty('comparisonSpec')
  })
  it('시각은 UTC 로 보내고 현지 시각으로 되돌린다', () => {
    expect(toLocal(toIso('2030-05-01T18:00'))).toBe('2030-05-01T18:00')
    expect(toServerInput(roll, PRESETS[0]!.reference, plan, after).applicationDeadline).toMatch(/Z$/)
  })
})

it('송금 표시는 확인한 입금보다 클 때만 대기 중이다', () => {
  const b = { userId: 'u', active: true, targetAmount: 6900, targetQuantity: 10, actualQuantity: 0, refunded: 0, receiptStatus: 'MISSING' }
  expect(fromBalance({ ...b, reportedAmount: 6900, confirmedIn: 0, netPaid: 0, due: 6900 })).toMatchObject({ reported: 6900, received: 0, remaining: 6900 })
  expect(fromBalance({ ...b, reportedAmount: 0, confirmedIn: 2000, netPaid: 2000, due: 4900 })).toMatchObject({ reported: 2000, received: 2000 })
})

it('기약분수 절약액을 원 단위로 반올림한다', () => {
  expect(ratioToWon('6100', '1')).toBe(6100)
  expect(ratioToWon('1', '2')).toBe(1)
  expect(ratioToWon('-1', '2')).toBe(-1)
  expect(ratioToWon('-10', '3')).toBe(-3)
})

it('인증 오류와 로그인 실패를 구분한다', () => {
  expect(serverError(401, 'AUTH_REQUIRED').code).toBe('auth')
  expect(serverError(401, 'INVALID_CREDENTIALS').message).toContain('비밀번호')
})

describe('httpStore', () => {
  const make = (fetchImpl: typeof fetch) => {
    localStorage.clear()
    sessionStorage.clear()
    const drafts = createLocalStore({ shared: localStorage, session: sessionStorage })
    return { drafts, store: createHttpStore({ shared: localStorage, session: sessionStorage, drafts, fetchImpl }) }
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const login = { token: 't', expiresAt: '2999-01-01T00:00:00Z', user: { id: 'H', displayName: '방장' } }

  it('공개에 실패하면 서버 초안을 지우고 브라우저 초안은 남긴다', async () => {
    const calls: string[] = []
    const { drafts, store } = make((async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      if (url.endsWith('/auth/login')) return json(200, login)
      if (url.endsWith('/publish')) return json(422, { code: 'DEADLINE_NOT_FUTURE' })
      return json(201, { id: 'S1', revision: 1 })
    }) as unknown as typeof fetch)
    await store.auth!.login('a@b.c', 'x'.repeat(12))
    await store.saveDraft({ id: 'd', step: 3, product: roll, reference: PRESETS[0]!.reference, plan })
    await expect(store.publish('d', { hostAlias: '', pickupCandidates: after })).rejects.toMatchObject({ code: 'DEADLINE_NOT_FUTURE' })
    expect(calls).toContain('DELETE /api/p1/groups/S1')
    expect((await drafts.listHosted()).map((g) => g.id)).toEqual(['d'])
  })
  it('세션이 만료되면 로그아웃된다', async () => {
    const { store } = make((async (url: string) => (url.endsWith('/auth/login') ? json(200, login) : json(401, { code: 'AUTH_REQUIRED' }))) as unknown as typeof fetch)
    await store.auth!.login('a@b.c', 'x'.repeat(12))
    await expect(store.savings()).rejects.toMatchObject({ code: 'auth' })
    expect(store.auth!.user()).toBeNull()
  })
  it('비밀번호는 저장하지 않는다', async () => {
    const { store } = make((async () => json(200, login)) as unknown as typeof fetch)
    await store.auth!.login('a@b.c', 'secret-secret-1')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-secret-1')
  })
  it('P1 서버가 아니면 시연용으로 둔다', async () => {
    expect(await p1Available(vi.fn(async () => new Response('<html>')))).toBe(false)
    expect(await p1Available(vi.fn(async () => json(404, { code: 'NOT_FOUND' })))).toBe(false)
    expect(await p1Available(vi.fn(async () => json(401, { code: 'AUTH_REQUIRED' })))).toBe(true)
  })
})
