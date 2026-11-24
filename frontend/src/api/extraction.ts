import { z } from 'zod'
import { blankProduct, blankReference } from '@/domain/product'
import type { FieldName, Measure, ProductDraft, ReferenceDraft } from '@/domain/types'

const money = z.number().int().min(0).max(100_000_000)
const count = z.number().int().min(1).max(10_000)

/** 기능정의서 v1.1 6장의 추출 필드 */
export const extractionSchema = z.object({
  fullTitle: z.string().max(200).nullable(),
  shortName: z.string().max(80).nullable(),
  selectedOption: z.string().max(200).nullable(),
  /** 옵션이 여러 개 보일 때의 후보. 백엔드가 보내지 않으면 빈 목록이다. */
  optionCandidates: z.array(z.string().max(200)).max(10).nullish(),
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

/** 현재 백엔드(v1.0)가 보내는 값. 422 면 일부 필드가 빠진다. */
const legacyProductSchema = z.object({
  shortName: z.string().max(80).optional(),
  fullTitle: z.string().max(200).optional(),
  bulkTotalPrice: z.number().int().positive().max(100_000_000).optional(),
  bulkTotalQty: z.number().int().positive().optional(),
  unitName: z.enum(['롤', '병', '개', 'ml', 'g']).optional(),
  smallPackQty: z.number().int().positive().optional(),
  smallPackPrice: z.number().int().positive().max(100_000_000).optional(),
})
const legacySchema = z.object({
  product: legacyProductSchema,
  comparisonSource: z
    .object({ kind: z.enum(['SCREENSHOT', 'PRESET']), label: z.string().optional(), url: z.string().optional() })
    .nullish(),
})

/** backend/src/gemini.js 가 `{ extraction }` 으로 보내는 값. 200 과 422 MANUAL_CORRECTION_REQUIRED 모두 같은 모양이다. */
const backendExtractionSchema = z.object({
  fullTitle: z.string().nullable(),
  shortName: z.string().nullable(),
  selectedOption: z.string().nullable(),
  optionCandidates: z.array(z.string()),
  packCount: z.number().int().nullable(),
  unitsPerPack: z.number().int().nullable(),
  netAmountPerUnit: z
    .object({ amount: z.number().positive(), unit: z.enum(['ml', 'L', 'g', 'kg', 'mm', 'cm', 'm']) })
    .nullable(),
  unitName: z.string().nullable(),
  displayedTotalPrice: z.number().int().nullable(),
  shippingFee: z.number().int().nullable(),
  discountAmount: z.number().int().nullable(),
  priceCandidates: z.array(
    z.object({
      amount: z.number().int(),
      type: z.string(),
      option: z.string().nullable(),
      condition: z.string().nullable(),
      evidence: z.string(),
    }),
  ),
  evidence: z.array(z.string()),
  unresolvedFields: z.array(z.string()),
})

const PRICE_KIND: Record<string, string> = {
  LIST_PRICE: '정가',
  SALE_PRICE: '판매가',
  COUPON_PRICE: '쿠폰 적용가',
  MEMBER_PRICE: '회원가',
  DISPLAYED_TOTAL: '표시 합계',
  CHECKOUT_TOTAL: '결제 예정 금액',
  OTHER: '기타',
}

/** 백엔드 판독 값을 이 앱의 추출 스키마로 옮긴다. 길이 단위는 m 로 맞춘다. */
function fromBackend(x: z.infer<typeof backendExtractionSchema>): unknown {
  const net = x.netAmountPerUnit
  const netAmountPerUnit =
    net === null
      ? null
      : net.unit === 'mm'
        ? { value: net.amount / 1000, unit: 'm' }
        : net.unit === 'cm'
          ? { value: net.amount / 100, unit: 'm' }
          : { value: net.amount, unit: net.unit }
  return {
    fullTitle: x.fullTitle,
    shortName: x.shortName,
    selectedOption: x.selectedOption,
    optionCandidates: x.optionCandidates.slice(0, 10),
    packCount: x.packCount,
    unitsPerPack: x.unitsPerPack,
    netAmountPerUnit,
    unitName: x.unitName,
    displayedTotalPrice: x.displayedTotalPrice,
    shippingFee: x.shippingFee,
    discountAmount: x.discountAmount,
    priceCandidates: x.priceCandidates.slice(0, 10).map((c) => ({
      amount: c.amount,
      kind: PRICE_KIND[c.type] ?? '기타',
      condition: [c.option, c.condition].filter(Boolean).join(' · ') || null,
      evidence: c.evidence,
    })),
    evidence: Object.fromEntries(x.evidence.map((line, i) => [String(i + 1), line])),
    unresolvedFields: x.unresolvedFields,
  }
}

export interface ExtractedDraft {
  product: ProductDraft
  /** 캡처나 서버 프리셋에서 찾은 비교 값. 규격은 사용자가 확인하기 전까지 같다고 보지 않는다. */
  reference: ReferenceDraft | null
}

export type ExtractionErrorKind = 'timeout' | 'network' | 'server' | 'invalid' | 'rateLimited' | 'rejected' | 'notReady'

const MESSAGES: Record<ExtractionErrorKind, string> = {
  timeout: '분석이 오래 걸려 멈췄어요. 다시 시도하거나 직접 입력해 주세요.',
  network: '분석 서버에 연결하지 못했어요. 네트워크를 확인하거나 직접 입력해 주세요.',
  server: '분석 서버가 응답하지 못했어요. 직접 입력하거나 샘플로 계속할 수 있어요.',
  notReady: '지금은 캡처 분석을 쓸 수 없어요. 직접 입력하거나 샘플로 계속할 수 있어요.',
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

export interface ExtractOptions {
  signal: AbortSignal
  people: number
  timeoutMs?: number
  retryDelayMs?: number
  fetchImpl?: typeof fetch
}

const baseUrl = () => (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

class TransientError extends Error {
  readonly kind: ExtractionErrorKind
  constructor(kind: ExtractionErrorKind) {
    super(kind)
    this.kind = kind
  }
}

/** 일시적 오류에 한해 한 번만 다시 시도한다. 제한 시간은 재시도를 포함한 전체 시간이다. */
export async function extractProduct(image: File, options: ExtractOptions): Promise<ExtractedDraft> {
  const { signal, people, timeoutMs = 15_000, retryDelayMs = 600, fetchImpl = fetch } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = AbortSignal.any([signal, timeout])

  const attempt = async (): Promise<ExtractedDraft> => {
    const form = new FormData()
    form.append('image', image)
    form.append('people', String(people))
    let status: number
    let text: string
    try {
      const response = await fetchImpl(`${baseUrl()}/api/products/extract`, {
        method: 'POST',
        body: form,
        signal: combined,
      })
      status = response.status
      text = await response.text()
    } catch (error) {
      if (combined.aborted) throw error
      throw new TransientError('network')
    }
    const code = errorCode(text)
    if (status === 429) throw new ExtractionError('rateLimited')
    if (code === 'GEMINI_NOT_CONFIGURED') throw new ExtractionError('notReady')
    if (status === 504) throw new TransientError('timeout')
    if (status === 502 || status === 503) throw new TransientError('server')
    if (status === 200 || (status === 422 && code === 'MANUAL_CORRECTION_REQUIRED')) return parseResponse(text)
    if ([400, 413, 415, 422].includes(status)) throw new ExtractionError('rejected')
    throw new ExtractionError('server')
  }

  try {
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof TransientError)) throw error
      await wait(retryDelayMs, combined)
      return await attempt()
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('분석이 취소되었습니다.', 'AbortError')
    if (timeout.aborted) throw new ExtractionError('timeout')
    if (error instanceof TransientError) throw new ExtractionError(error.kind)
    throw error
  }
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(id)
      reject(signal.reason)
    }, { once: true })
  })

function errorCode(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string' ? value.code : null
  } catch {
    return null
  }
}

/** 백엔드 응답({ extraction }), v1.1 응답(필드가 바로 있거나 product 안에 있음), 이전 백엔드 응답을 모두 읽는다. */
export function parseResponse(text: string): ExtractedDraft {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ExtractionError('invalid')
  }
  if (typeof json === 'object' && json !== null && 'extraction' in json) {
    const backend = backendExtractionSchema.safeParse(json.extraction)
    const next = backend.success ? extractionSchema.safeParse(fromBackend(backend.data)) : null
    if (!next?.success) throw new ExtractionError('invalid')
    return { product: toProductDraft(next.data), reference: null }
  }
  const body = typeof json === 'object' && json !== null && 'product' in json ? json.product : json
  const next = extractionSchema.safeParse(body)
  if (next.success) return { product: toProductDraft(next.data), reference: null }
  const legacy = legacySchema.safeParse(json)
  if (!legacy.success || Object.keys(legacy.data.product).length === 0) throw new ExtractionError('invalid')
  return fromLegacy(legacy.data)
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
  const options = [...new Set(x.optionCandidates ?? [])]
  const ambiguousOption = options.length > 1 && !x.selectedOption
  if (ambiguousOption) unresolved.add('selectedOption')
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
    optionCandidates: options,
    unresolvedFields: [...unresolved],
  }
}

function fromLegacy({ product: p, comparisonSource }: z.infer<typeof legacySchema>): ExtractedDraft {
  // 전체 용량(ml·g)만 있으면 포장 수를 알 수 없으므로 임의로 채우지 않고 사용자에게 묻는다.
  const volume = p.unitName === 'ml' || p.unitName === 'g' ? p.unitName : null
  const unresolved: FieldName[] = ['shippingFee', 'discountAmount']
  if (!p.fullTitle) unresolved.push('fullTitle')
  if (!p.bulkTotalPrice) unresolved.push('displayedPrice')
  if (!p.unitName || volume) unresolved.push('unitName')
  if (!p.bulkTotalQty || volume) unresolved.push('packCount', 'unitsPerPack')
  if (volume) unresolved.push('netAmountPerUnit')

  const product: ProductDraft = {
    ...blankProduct('capture'),
    fullTitle: p.fullTitle ?? '',
    shortName: p.shortName ?? '',
    packCount: volume || !p.bulkTotalQty ? null : 1,
    unitsPerPack: volume ? null : (p.bulkTotalQty ?? null),
    unitName: volume ? '' : (p.unitName ?? ''),
    measure: volume ?? 'count',
    displayedPrice: p.bulkTotalPrice ?? null,
    unresolvedFields: unresolved,
  }
  if (!p.smallPackQty || !p.smallPackPrice) return { product, reference: null }
  const reference: ReferenceDraft = {
    ...blankReference(),
    name: comparisonSource?.label ?? '',
    price: p.smallPackPrice,
    unitCount: volume ? 1 : p.smallPackQty,
    netAmountPerUnit: volume ? p.smallPackQty : null,
    measure: volume ?? 'count',
    sameSpecConfirmed: false,
    sourceKind: comparisonSource?.kind === 'PRESET' ? 'serverPreset' : 'capture',
    sourceUrl: comparisonSource?.url && /^https?:\/\//.test(comparisonSource.url) ? comparisonSource.url : '',
  }
  return { product, reference }
}
