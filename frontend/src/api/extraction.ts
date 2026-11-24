import { z } from 'zod'
import { blankProduct } from '@/domain/product'
import type { FieldName, Measure, ProductDraft } from '@/domain/types'

const money = z.number().int().min(0).max(100_000_000)
const count = z.number().int().min(1).max(10_000)

export const extractionSchema = z.object({
  fullTitle: z.string().max(200).nullable(),
  shortName: z.string().max(60).nullable(),
  selectedOption: z.string().max(200).nullable(),
  packCount: count.nullable(),
  unitsPerPack: count.nullable(),
  netAmountPerUnit: z
    .object({ value: z.number().positive().max(1_000_000), unit: z.enum(['ml', 'L', 'g', 'kg', 'm']) })
    .nullable(),
  unitName: z.string().max(10).nullable(),
  displayedTotalPrice: money.nullable(),
  shippingFee: money.nullable(),
  discountAmount: money.nullable(),
  priceCandidates: z
    .array(
      z.object({
        amount: money,
        kind: z.string().max(60),
        condition: z.string().max(200).nullable(),
        evidence: z.string().max(200).nullable(),
      }),
    )
    .max(10),
  evidence: z.record(z.string(), z.string()).nullish(),
  unresolvedFields: z.array(z.string()).max(30),
})

export type Extraction = z.infer<typeof extractionSchema>

export type ExtractionErrorKind = 'timeout' | 'network' | 'server' | 'invalid' | 'rateLimited' | 'rejected'

const MESSAGES: Record<ExtractionErrorKind, string> = {
  timeout: '분석이 오래 걸려 멈췄어요. 다시 시도하거나 직접 입력해 주세요.',
  network: '분석 서버에 연결하지 못했어요. 네트워크를 확인하거나 직접 입력해 주세요.',
  server: '분석 서버가 응답하지 못했어요. 직접 입력하거나 샘플로 계속할 수 있어요.',
  invalid: '분석 결과를 읽지 못했어요. 더 선명한 캡처를 올리거나 직접 입력해 주세요.',
  rateLimited: '분석 요청이 많아요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.',
  rejected: '이 이미지는 분석할 수 없어요. 다른 캡처를 올리거나 직접 입력해 주세요.',
}

export class ExtractionError extends Error {
  readonly kind: ExtractionErrorKind
  constructor(kind: ExtractionErrorKind) {
    super(MESSAGES[kind])
    this.name = 'ExtractionError'
    this.kind = kind
  }
}

const TRANSIENT = new Set([502, 503, 504])

export interface ExtractOptions {
  signal: AbortSignal
  timeoutMs?: number
  retryDelayMs?: number
  fetchImpl?: typeof fetch
}

const baseUrl = () => (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

/** 일시적 오류에 한해 한 번만 다시 시도한다. 제한 시간은 재시도를 포함한 전체 시간이다. */
export async function extractProduct(image: File, options: ExtractOptions): Promise<Extraction> {
  const { signal, timeoutMs = 15_000, retryDelayMs = 600, fetchImpl = fetch } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = AbortSignal.any([signal, timeout])

  const attempt = async (): Promise<Extraction> => {
    const form = new FormData()
    form.append('image', image)
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl()}/api/extractions`, {
        method: 'POST',
        body: form,
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted) throw error
      throw new ExtractionError('network')
    }
    if (response.status === 429) throw new ExtractionError('rateLimited')
    if ([400, 413, 415, 422].includes(response.status)) throw new ExtractionError('rejected')
    if (TRANSIENT.has(response.status)) throw new TransientError()
    if (!response.ok) throw new ExtractionError('server')
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      if (combined.aborted) throw error
      throw new ExtractionError('network')
    }
    return parseExtraction(text)
  }

  try {
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof TransientError) && !isNetwork(error)) throw error
      await wait(retryDelayMs, combined)
      return await attempt()
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('분석이 취소되었습니다.', 'AbortError')
    if (timeout.aborted) throw new ExtractionError('timeout')
    if (error instanceof TransientError) throw new ExtractionError('server')
    throw error
  }
}

class TransientError extends Error {}

const isNetwork = (e: unknown) => e instanceof ExtractionError && e.kind === 'network'

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(id)
      reject(signal.reason)
    }, { once: true })
  })

export function parseExtraction(text: string): Extraction {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ExtractionError('invalid')
  }
  const parsed = extractionSchema.safeParse(json)
  if (!parsed.success) throw new ExtractionError('invalid')
  return parsed.data
}

const UNIT: Record<'ml' | 'L' | 'g' | 'kg' | 'm', { measure: Measure; factor: number }> = {
  ml: { measure: 'ml', factor: 1 },
  L: { measure: 'ml', factor: 1000 },
  g: { measure: 'g', factor: 1 },
  kg: { measure: 'g', factor: 1000 },
  m: { measure: 'm', factor: 1 },
}

const FIELD_OF: Record<string, FieldName> = {
  fullTitle: 'fullTitle',
  selectedOption: 'selectedOption',
  packCount: 'packCount',
  unitsPerPack: 'unitsPerPack',
  unitName: 'unitName',
  netAmountPerUnit: 'netAmountPerUnit',
  displayedTotalPrice: 'displayedPrice',
  shippingFee: 'shippingFee',
  discountAmount: 'discountAmount',
}

/** 추출 결과를 확인용 초안으로 바꾼다. 배송비·할인 적용 여부는 사용자가 정하도록 미확인으로 둔다. */
export function toProductDraft(x: Extraction): ProductDraft {
  const unresolved = new Set<FieldName>()
  for (const key of x.unresolvedFields) if (FIELD_OF[key]) unresolved.add(FIELD_OF[key])
  for (const [key, field] of Object.entries(FIELD_OF)) {
    if (key !== 'selectedOption' && x[key as keyof Extraction] === null) unresolved.add(field)
  }
  const ambiguousPrice = new Set(x.priceCandidates.map((c) => c.amount)).size > 1
  if (ambiguousPrice) unresolved.add('displayedPrice')
  const net = x.netAmountPerUnit

  return {
    ...blankProduct('capture'),
    fullTitle: x.fullTitle ?? '',
    shortName: x.shortName ?? '',
    selectedOption: x.selectedOption ?? '',
    packCount: x.packCount,
    unitsPerPack: x.unitsPerPack,
    unitName: x.unitName ?? '',
    netAmountPerUnit: net ? net.value * UNIT[net.unit].factor : null,
    measure: net ? UNIT[net.unit].measure : 'count',
    displayedPrice: ambiguousPrice ? null : (x.displayedTotalPrice ?? x.priceCandidates[0]?.amount ?? null),
    shippingMode: x.shippingFee === 0 ? 'none' : 'unknown',
    shippingFee: x.shippingFee || null,
    discountMode: x.discountAmount === 0 ? 'none' : 'unknown',
    discountAmount: x.discountAmount || null,
    priceCandidates: x.priceCandidates,
    unresolvedFields: [...unresolved],
  }
}
