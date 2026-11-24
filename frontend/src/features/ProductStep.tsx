import { useEffect, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { Dropzone } from '@/components/Dropzone'
import { SplitBoard } from '@/components/SplitBoard'
import { Sticker } from '@/components/Sticker'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { UnitIcon } from '@/components/UnitIcon'
import { compare } from '@/domain/comparison'
import { PRESETS } from '@/domain/presets'
import { paymentTotal, totalUnits } from '@/domain/product'
import { settle } from '@/domain/settlement'
import { percent, won } from '@/lib/format'
import type { Flow } from './flow'

export function ProductStep({ flow }: { flow: Flow }) {
  const { state, actions } = flow
  const loading = state.analysis.status === 'loading'
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
      <Hero />
      <div className="space-y-6">
        <section aria-labelledby="upload-title">
          <h2 id="upload-title" className="mb-3 text-lg font-bold">
            쇼핑몰 화면 올리기
          </h2>
          <Dropzone
            image={state.image}
            loading={loading}
            onSelect={actions.selectImage}
            onRemove={actions.removeImage}
            onAnalyze={() => state.image && void actions.analyze(state.image.file)}
          />
          <p className="mt-2 text-sm text-ink-soft">
            주문번호, 이름, 연락처, 주소가 보이면 자르거나 가린 뒤 올려 주세요.
          </p>
          <div aria-live="polite" className="sr-only">
            {loading ? '상품 정보를 읽고 있어요.' : ''}
          </div>
          {state.analysis.status === 'error' && (
            <Notice tone="error" className="mt-3">
              <p>{state.analysis.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {state.analysis.retryable && state.image && (
                  <Button variant="ink" className="min-h-11 px-4 text-sm" onClick={() => void actions.analyze(state.image!.file)}>
                    다시 시도
                  </Button>
                )}
                <Button variant="outline" className="min-h-11 px-4 text-sm" onClick={actions.manual}>
                  직접 입력
                </Button>
              </div>
            </Notice>
          )}
        </section>

        <section aria-labelledby="preset-title">
          <h2 id="preset-title" className="text-lg font-bold">
            샘플로 해보기
          </h2>
          <p className="mt-1 text-sm text-ink-soft">시연용 예시 가격이에요. 다음 화면에서 고칠 수 있어요.</p>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => actions.loadPreset(p)}
                  className="group flex h-full w-full flex-col items-start rounded-control bg-surface p-3 text-left ring-1 ring-line transition-[box-shadow,translate] ring-inset hover:-translate-y-0.5 hover:ring-2 hover:ring-ink"
                >
                  <UnitIcon unit={p.product.unitName} className="size-9 transition-transform group-hover:-rotate-12" />
                  <span className="mt-2 font-bold">{p.label}</span>
                  <span className="text-sm text-ink-soft">{p.detail}</span>
                  <span className="mt-auto pt-2 text-sm font-semibold tabular-nums">{won(p.product.displayedPrice!)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <Button variant="ghost" className="w-full" onClick={actions.manual}>
          <PencilLine aria-hidden className="size-5" />
          {state.started ? '입력하던 값으로 돌아가기' : '캡처 없이 직접 입력하기'}
        </Button>
      </div>
    </div>
  )
}

const sample = PRESETS[0]!
const sampleUnits = totalUnits(sample.product)!
const sampleTotal = paymentTotal(sample.product).total
const sampleRate = compare(sample.product, sample.reference)

/** 첫 화면. 30롤 묶음이 한 번 갈라지고, 이후에는 인원을 눌러 직접 나눠 본다. */
function Hero() {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setCount((c) => c ?? 4), 900)
    return () => clearTimeout(id)
  }, [])
  const s = count === null ? null : settle(sampleTotal, sampleUnits, count)
  const allocation = s?.ok ? s.shares.map((x) => x.units) : [sampleUnits]
  const guest = s?.ok ? s.shares[1]! : null

  return (
    <section className="relative rounded-panel bg-tag p-5 sm:p-7">
      <h1 tabIndex={-1} className="font-display text-[clamp(2rem,9vw,3.25rem)] leading-[1.12]">
        {sampleUnits}롤 사서
        <br />
        {guest?.units ?? 7}롤만 가져가기
      </h1>
      <p className="mt-3 max-w-96 leading-relaxed text-balance">
        대용량 상품을 나눌 몫과 부담금을 계산하고 모집글까지 만들어요.
      </p>
      {sampleRate.ok && (
        <Sticker delay={1.5} className="absolute -top-4 right-3 size-24 sm:-top-3 sm:right-5 sm:size-30">
          <span className="block text-xs font-semibold">1롤당</span>
          <span className="block font-display text-2xl sm:text-3xl">{percent(sampleRate.savingsRate)}</span>
          <span className="block text-xs font-semibold">절약</span>
        </Sticker>
      )}
      <Segmented
        label="나눌 인원"
        tone="onTag"
        className="mt-5"
        value={count ?? 0}
        options={[2, 3, 4].map((n) => ({ value: n, label: `${n}명` }))}
        onChange={setCount}
      />
      <SplitBoard allocation={allocation} unitName={sample.product.unitName} className="mt-3 min-h-64 content-start" />
      <p className="mt-3 text-sm">
        예시 롤휴지 {sampleUnits}롤 {won(sampleTotal!)}
        {guest && (
          <>
            , 참여자 1명 부담 <strong className="tabular-nums">{won(guest.amount)}</strong>
          </>
        )}
      </p>
    </section>
  )
}
