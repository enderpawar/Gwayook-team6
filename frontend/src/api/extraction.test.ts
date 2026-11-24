import { describe, expect, it, vi } from 'vitest'
import { ExtractionError, extractProduct, parseResponse, toProductDraft, type Extraction } from './extraction'
import { checkImage, sniffImage } from './imageFile'

const good: Extraction = {
  fullTitle: '생수 2L 24병', shortName: '생수', selectedOption: null, packCount: 4, unitsPerPack: 6,
  netAmountPerUnit: { value: 2, unit: 'L' }, unitName: '병', displayedTotalPrice: 16800, shippingFee: 3000,
  discountAmount: 0, priceCandidates: [], evidence: {}, unresolvedFields: [],
}
const file = new File(['x'], 'a.png')
const run = (fetchImpl: typeof fetch, extra = {}) =>
  extractProduct(file, { signal: new AbortController().signal, people: 4, retryDelayMs: 1, fetchImpl, ...extra })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('extractProduct', () => {
  it('정상 응답을 돌려준다', async () => {
    const f = vi.fn(async () => json(good))
    await expect(run(f)).resolves.toMatchObject({ product: { fullTitle: '생수 2L 24병' }, reference: null })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/products/extract')
    expect((init.body as FormData).get('people')).toBe('4')
  })
  it('503 은 한 번만 재시도한다', async () => {
    const ok = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(good))
    await expect(run(ok)).resolves.toMatchObject({ product: { unitsPerPack: 6 } })
    const fail = vi.fn(async () => json({}, 503))
    await expect(run(fail)).rejects.toMatchObject({ kind: 'server' })
    expect(fail).toHaveBeenCalledTimes(2)
  })
  it.each([[404, 'server'], [429, 'rateLimited'], [413, 'rejected']])('%i 은 재시도하지 않는다', async (status, kind) => {
    const f = vi.fn(async () => json({}, status))
    await expect(run(f)).rejects.toMatchObject({ kind })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('잘못된 JSON 과 스키마 위반은 invalid', async () => {
    await expect(run(vi.fn(async () => new Response('<html>')))).rejects.toMatchObject({ kind: 'invalid' })
    expect(() => parseResponse(JSON.stringify({ ...good, packCount: -1 }))).toThrow(ExtractionError)
  })
  const hang: typeof fetch = (_, init) =>
    new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
  it('시간을 넘기면 timeout', async () => {
    await expect(run(hang, { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('사용자가 교체하면 AbortError', async () => {
    const c = new AbortController()
    const p = extractProduct(file, { signal: c.signal, people: 4, fetchImpl: hang })
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('toProductDraft', () => {
  it('단위를 환산하고 배송비 적용은 사용자에게 남긴다', () => {
    const d = toProductDraft(good)
    expect(d).toMatchObject({ netAmountPerUnit: 2000, measure: 'ml', shippingMode: 'unknown', shippingFee: 3000, discountMode: 'none' })
  })
  it('가격 후보가 여러 개면 고르기 전까지 비워 둔다', () => {
    const c = (amount: number) => ({ amount, kind: '판매가', condition: null, evidence: null })
    const d = toProductDraft({ ...good, priceCandidates: [c(16800), c(15800)] })
    expect(d.displayedPrice).toBeNull()
    expect(d.unresolvedFields).toContain('displayedPrice')
  })
  it('null 필드는 미확인으로 표시한다', () => {
    expect(toProductDraft({ ...good, unitsPerPack: null }).unresolvedFields).toContain('unitsPerPack')
  })
})

describe('이미지 검사', () => {
  it('머리글로 형식을 판단한다', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull()
  })
  it('이름만 png 인 파일을 거른다', async () => {
    expect((await checkImage(new File(['hello'], 'a.png', { type: 'image/png' }))).ok).toBe(false)
    expect((await checkImage(new File([], 'a.png'))).ok).toBe(false)
  })
})

describe('현재 백엔드(v1.0) 응답', () => {
  const body = { product: { shortName: '휴지', fullTitle: '휴지 30롤', bulkTotalQty: 30, bulkTotalPrice: 17701, unitName: '롤', smallPackQty: 6, smallPackPrice: 7800 }, comparisonSource: { kind: 'PRESET', label: '33m 12롤', url: 'https://example.com' } }
  it('비교 값은 규격 확인 전 상태로 가져온다', () => {
    const d = parseResponse(JSON.stringify(body))
    expect(d.product).toMatchObject({ packCount: 1, unitsPerPack: 30, displayedPrice: 17701, shippingMode: 'unknown' })
    expect(d.reference).toMatchObject({ price: 7800, unitCount: 6, sameSpecConfirmed: false, sourceKind: 'serverPreset' })
  })
  it('422 부분 판독은 읽은 값만 남긴다', async () => {
    const f = vi.fn(async () => json({ code: 'MANUAL_CORRECTION_REQUIRED', product: { fullTitle: '휴지', bulkTotalPrice: 100 }, fields: ['bulkTotalQty'], comparisonSource: null }, 422))
    const d = await run(f)
    expect(d.product).toMatchObject({ fullTitle: '휴지', packCount: null })
    expect(d.product.unresolvedFields).toContain('packCount')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('총 용량만 알면 포장 수를 지어내지 않는다', () => {
    const d = parseResponse(JSON.stringify({ product: { ...body.product, unitName: 'ml', bulkTotalQty: 4000 }, comparisonSource: null }))
    expect(d.product).toMatchObject({ packCount: null, unitsPerPack: null, unitName: '', measure: 'ml' })
  })
  it('아무것도 못 읽으면 invalid, 잘못된 입력 422 는 rejected', async () => {
    expect(() => parseResponse(JSON.stringify({ product: {}, comparisonSource: null }))).toThrow(ExtractionError)
    await expect(run(vi.fn(async () => json({ code: 'INVALID_ANALYSIS_INPUT' }, 422)))).rejects.toMatchObject({ kind: 'rejected' })
  })
  it('키가 없는 서버는 재시도하지 않고, 504 는 시간 초과로 알린다', async () => {
    const f = vi.fn(async () => json({ code: 'GEMINI_NOT_CONFIGURED' }, 503))
    await expect(run(f)).rejects.toMatchObject({ kind: 'notReady' })
    expect(f).toHaveBeenCalledTimes(1)
    await expect(run(vi.fn(async () => json({ code: 'GEMINI_TIMEOUT' }, 504)))).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('백엔드 응답 { extraction }', () => {
  // backend/src/gemini.js resultFor() 가 돌려주는 모양 그대로
  const extraction = {
    fullTitle: '3겹 롤휴지 30m × 30롤', shortName: '3겹 롤휴지', selectedOption: null,
    optionCandidates: ['30롤', '24롤'], packCount: 1, unitsPerPack: 30,
    netAmountPerUnit: { amount: 3000, unit: 'cm' }, unitName: '롤', mixedCart: false,
    displayedTotalPrice: 17701, shippingFee: 0, discountAmount: null,
    priceCandidates: [
      { amount: 17701, type: 'DISPLAYED_TOTAL', option: '30롤', condition: null, evidence: '17,701원' },
      { amount: 15900, type: 'COUPON_PRICE', option: null, condition: '첫 구매 쿠폰', evidence: '15,900원' },
    ],
    evidence: ['30m × 30롤', '17,701원'],
    unresolvedFields: ['selectedOption', 'discountAmount'],
  }

  it('200 응답을 확인 폼 초안으로 바꾼다', async () => {
    const d = await run(vi.fn(async () => json({ extraction })))
    expect(d.reference).toBeNull()
    expect(d.product).toMatchObject({
      fullTitle: '3겹 롤휴지 30m × 30롤', packCount: 1, unitsPerPack: 30, unitName: '롤',
      netAmountPerUnit: 30, measure: 'm', shippingMode: 'none', discountMode: 'unknown',
      optionCandidates: ['30롤', '24롤'],
    })
    expect(d.product.priceCandidates).toEqual([
      { amount: 17701, kind: '표시 합계', condition: '30롤', evidence: '17,701원' },
      { amount: 15900, kind: '쿠폰 적용가', condition: '첫 구매 쿠폰', evidence: '15,900원' },
    ])
    expect(d.product.unresolvedFields).toEqual(expect.arrayContaining(['selectedOption', 'discountAmount', 'displayedPrice']))
  })

  it('422 MANUAL_CORRECTION_REQUIRED 도 읽은 값을 남긴다', async () => {
    const partial = { ...extraction, displayedTotalPrice: null, priceCandidates: [], packCount: null, netAmountPerUnit: { amount: 2, unit: 'L' } }
    const f = vi.fn(async () => json({ code: 'MANUAL_CORRECTION_REQUIRED', extraction: partial }, 422))
    const d = await run(f)
    expect(d.product).toMatchObject({ fullTitle: '3겹 롤휴지 30m × 30롤', packCount: null, displayedPrice: null, netAmountPerUnit: 2000, measure: 'ml' })
    expect(d.product.unresolvedFields).toEqual(expect.arrayContaining(['packCount', 'displayedPrice']))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('mm 는 m 로 환산한다', () => {
    const d = parseResponse(JSON.stringify({ extraction: { ...extraction, netAmountPerUnit: { amount: 1500, unit: 'mm' } } }))
    expect(d.product).toMatchObject({ netAmountPerUnit: 1.5, measure: 'm' })
  })

  it('모양이 다르면 invalid', () => {
    expect(() => parseResponse(JSON.stringify({ extraction: { fullTitle: 1 } }))).toThrow(ExtractionError)
  })
})

describe('옵션 후보', () => {
  it('여러 개면 고르기 전까지 미확인으로 둔다', () => {
    const d = toProductDraft({ ...good, optionCandidates: ['24병', '48병'] })
    expect(d).toMatchObject({ selectedOption: '', optionCandidates: ['24병', '48병'] })
    expect(d.unresolvedFields).toContain('selectedOption')
  })
})
