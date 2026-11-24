import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ExtractionError, extractProduct } from '@/api/extraction'
import { checkImage } from '@/api/imageFile'
import { compare } from '@/domain/comparison'
import { buildPost } from '@/domain/post'
import type { Preset } from '@/domain/presets'
import { blankProduct, blankReference, draftProblems, paymentTotal, totalUnits } from '@/domain/product'
import { settle } from '@/domain/settlement'
import type { PlanDraft, ProductDraft, ReferenceDraft } from '@/domain/types'

export const STEPS = ['상품', '확인', '나누기', '모집글'] as const
export type Step = 0 | 1 | 2 | 3

type Analysis =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }

interface State {
  step: Step
  started: boolean
  image: { file: File; url: string } | null
  analysis: Analysis
  product: ProductDraft
  reference: ReferenceDraft
  plan: PlanDraft
}

type Action =
  | { type: 'go'; step: Step }
  | { type: 'image'; image: State['image'] }
  | { type: 'analysis'; analysis: Analysis }
  | { type: 'load'; product: ProductDraft; reference?: ReferenceDraft }
  | { type: 'manual' }
  | { type: 'product'; patch: Partial<ProductDraft> }
  | { type: 'reference'; patch: Partial<ReferenceDraft> }
  | { type: 'plan'; patch: Partial<PlanDraft> }

const initial: State = {
  step: 0,
  started: false,
  image: null,
  analysis: { status: 'idle' },
  product: blankProduct('manual'),
  reference: blankReference(),
  plan: { headcount: 4, place: null, deadline: null, applyMethod: '' },
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go':
      return { ...state, step: action.step }
    case 'image':
      return { ...state, image: action.image }
    case 'analysis':
      return { ...state, analysis: action.analysis }
    case 'load':
      return {
        ...state,
        step: 1,
        started: true,
        analysis: { status: 'idle' },
        product: action.product,
        reference:
          action.reference ??
          (state.reference.sourceKind === 'manual' || state.reference.sourceKind === 'link' ? state.reference : blankReference()),
      }
    case 'manual':
      return {
        ...state,
        step: 1,
        analysis: { status: 'idle' },
        // 이미 입력하던 값이 있으면 지우지 않는다.
        product: state.started ? state.product : blankProduct('manual'),
        started: true,
      }
    case 'product': {
      const touched = Object.keys(action.patch)
      return {
        ...state,
        product: {
          ...state.product,
          ...action.patch,
          unresolvedFields: state.product.unresolvedFields.filter((f) => {
            if (f === 'shippingFee') return !touched.includes('shippingMode')
            if (f === 'discountAmount') return !touched.includes('discountMode')
            return !touched.includes(f)
          }),
        },
      }
    }
    case 'reference': {
      // 비교 값을 고치면 원래 출처를 붙이지 않는다.
      const own = ['preset', 'serverPreset', 'capture'].includes(state.reference.sourceKind) && ['price', 'unitCount', 'netAmountPerUnit', 'measure'].some((k) => k in action.patch)
      return {
        ...state,
        reference: { ...state.reference, ...(own ? { sourceKind: 'manual' as const, sourceUrl: '' } : {}), ...action.patch },
      }
    }
    case 'plan':
      return { ...state, plan: { ...state.plan, ...action.patch } }
  }
}

export function useFlow() {
  const [state, dispatch] = useReducer(reducer, initial)
  const running = useRef<AbortController | null>(null)
  const imageUrl = useRef<string | null>(null)
  const headcount = useRef(state.plan.headcount)
  headcount.current = state.plan.headcount

  const cancel = useCallback(() => {
    running.current?.abort()
    running.current = null
  }, [])

  const setImage = useCallback((file: File | null) => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    imageUrl.current = file ? URL.createObjectURL(file) : null
    dispatch({ type: 'image', image: file ? { file, url: imageUrl.current! } : null })
  }, [])

  useEffect(
    () => () => {
      running.current?.abort()
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    },
    [],
  )

  const selectImage = useCallback(
    async (file: File) => {
      cancel()
      const controller = new AbortController()
      running.current = controller
      const check = await checkImage(file)
      if (controller.signal.aborted) return
      if (!check.ok) {
        setImage(null)
        dispatch({ type: 'analysis', analysis: { status: 'error', message: check.message, retryable: false } })
        return
      }
      setImage(file)
      dispatch({ type: 'analysis', analysis: { status: 'idle' } })
    },
    [cancel, setImage],
  )

  const analyze = useCallback(
    async (file: File) => {
      cancel()
      const controller = new AbortController()
      running.current = controller
      dispatch({ type: 'analysis', analysis: { status: 'loading' } })
      try {
        const result = await extractProduct(file, { signal: controller.signal, people: headcount.current })
        // 이미지를 바꿨다면 이전 응답은 버린다.
        if (running.current !== controller) return
        dispatch({ type: 'load', product: result.product, reference: result.reference ?? undefined })
      } catch (error) {
        if (running.current !== controller) return
        const message =
          error instanceof ExtractionError
            ? error.message
            : '분석하지 못했어요. 다시 시도하거나 직접 입력해 주세요.'
        const retryable = !(error instanceof ExtractionError) || error.kind !== 'rejected'
        dispatch({ type: 'analysis', analysis: { status: 'error', message, retryable } })
      }
    },
    [cancel],
  )

  const actions = useMemo(
    () => ({
      go: (step: Step) => dispatch({ type: 'go', step }),
      selectImage,
      analyze,
      removeImage: () => {
        cancel()
        setImage(null)
        dispatch({ type: 'analysis', analysis: { status: 'idle' } })
      },
      loadPreset: (preset: Preset) => {
        cancel()
        dispatch({ type: 'load', product: preset.product, reference: preset.reference })
      },
      manual: () => {
        cancel()
        dispatch({ type: 'manual' })
      },
      product: (patch: Partial<ProductDraft>) => dispatch({ type: 'product', patch }),
      reference: (patch: Partial<ReferenceDraft>) => dispatch({ type: 'reference', patch }),
      plan: (patch: Partial<PlanDraft>) => dispatch({ type: 'plan', patch }),
    }),
    [analyze, cancel, selectImage, setImage],
  )

  const derived = useMemo(() => {
    const { product, reference, plan } = state
    const problems = draftProblems(product)
    const payment = paymentTotal(product)
    const units = totalUnits(product)
    const comparison = compare(product, reference)
    const settlement = settle(payment.total, units, plan.headcount)
    const post = settlement.ok
      ? buildPost({
          product,
          plan,
          settlement,
          estimated: payment.estimated,
          comparison,
          referenceName: reference.name,
        })
      : null
    const valid = Object.keys(problems).length === 0
    const maxStep: Step = !state.started ? 0 : !valid ? 1 : !settlement.ok ? 2 : 3
    return { problems, payment, units, comparison, settlement, post, maxStep }
  }, [state])

  return { state, actions, ...derived }
}

export type Flow = ReturnType<typeof useFlow>
