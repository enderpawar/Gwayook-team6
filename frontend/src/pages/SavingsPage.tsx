import { SavingsJar } from '@/components/SavingsJar'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { store, usePeople, useQuery } from '@/data/useStore'
import { won } from '@/lib/format'
import { PageError, PageLoading } from './PageState'

export function SavingsPage() {
  const { me } = usePeople()
  const query = useQuery(() => store.savings(), `savings:${me.id}`)
  if (query.status === 'error') return <PageError title="저금통을 열 수 없어요" message={query.message} />
  if (query.status === 'loading') return <PageLoading />
  const { total, entries } = query.data
  const counted = entries.filter((e) => !e.pending)
  return (
    <div className="py-5">
      <h1 className="font-display text-3xl sm:text-4xl">절약 저금통</h1>
      <p className="mt-2 text-ink-soft">완료한 공구에서 내가 실제로 낸 금액을 소용량 가격과 비교해 모아요.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-label="누적 절약액" className="rounded-panel bg-tag p-6 text-center">
          <SavingsJar key={counted.length} count={counted.length} />
          <p className="mt-4 text-sm font-semibold">{total >= 0 ? '지금까지 아낀 금액' : '지금까지 더 쓴 금액'}</p>
          <p className="font-display text-5xl tabular-nums">
            <AnimatedNumber value={Math.abs(total)} suffix="원" />
          </p>
        </section>
        <section aria-label="절약 기록" className="rounded-panel bg-surface p-5">
          <h2 className="text-lg font-bold">공구별 기록</h2>
          {entries.length === 0 ? (
            <p className="mt-3 text-ink-soft">비교 가격이 있는 공구를 완료하면 여기에 쌓여요.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {entries.map((e) => (
                <li key={e.gigId} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{e.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {e.pending ? '금액 정리가 끝나면 더해요' : `${new Date(e.completedAt).toLocaleDateString('ko-KR')} 기준`}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {e.amount >= 0 ? `${won(e.amount)} 절약` : `${won(-e.amount)} 더 냄`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
