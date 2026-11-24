import { href } from '@/lib/router'

export function PageLoading() {
  return (
    <div role="status" className="space-y-4 py-8">
      <span className="sr-only">불러오는 중이에요.</span>
      <div className="h-10 w-2/3 animate-pulse rounded-control bg-line" />
      <div className="h-40 animate-pulse rounded-panel bg-line" />
    </div>
  )
}

export function PageError({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="py-10">
      <h1 className="font-display text-3xl">{title}</h1>
      <p className="mt-2 text-ink-soft">{message}</p>
      <a href={href.gigs} className="mt-5 inline-flex min-h-11 items-center font-semibold text-cobalt underline">
        내 공구로 가기
      </a>
    </div>
  )
}
