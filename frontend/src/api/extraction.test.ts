import { describe, expect, it, vi } from 'vitest'
import { ExtractionError, extractProduct, parseExtraction, toProductDraft, type Extraction } from './extraction'
import { checkImage, sniffImage } from './imageFile'

const good: Extraction = {
  fullTitle: '생수 2L 24병', shortName: '생수', selectedOption: null, packCount: 4, unitsPerPack: 6,
  netAmountPerUnit: { value: 2, unit: 'L' }, unitName: '병', displayedTotalPrice: 16800, shippingFee: 3000,
  discountAmount: 0, priceCandidates: [], evidence: {}, unresolvedFields: [],
}
const file = new File(['x'], 'a.png')
const run = (fetchImpl: typeof fetch, extra = {}) =>
  extractProduct(file, { signal: new AbortController().signal, retryDelayMs: 1, fetchImpl, ...extra })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('extractProduct', () => {
  it('정상 응답을 돌려준다', async () => {
    await expect(run(vi.fn(async () => json(good)))).resolves.toEqual(good)
  })
  it('503 은 한 번만 재시도한다', async () => {
    const ok = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(good))
    await expect(run(ok)).resolves.toEqual(good)
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
    expect(() => parseExtraction(JSON.stringify({ ...good, packCount: -1 }))).toThrow(ExtractionError)
  })
  const hang: typeof fetch = (_, init) =>
    new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
  it('시간을 넘기면 timeout', async () => {
    await expect(run(hang, { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('사용자가 교체하면 AbortError', async () => {
    const c = new AbortController()
    const p = extractProduct(file, { signal: c.signal, fetchImpl: hang })
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
