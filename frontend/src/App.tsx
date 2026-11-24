import { PackagePlus, PiggyBank, Ticket } from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { useEffect, useRef } from 'react'
import { DemoBar } from '@/components/DemoBar'
import { href, useRoute, type Route } from '@/lib/router'
import { cn } from '@/lib/cn'
import { GigListPage } from '@/pages/GigListPage'
import { JoinPage } from '@/pages/JoinPage'
import { ManagePage } from '@/pages/manage/ManagePage'
import { PlanPage } from '@/pages/PlanPage'
import { SavingsPage } from '@/pages/SavingsPage'

const NAV = [
  { to: href.plan, label: '새 공구', icon: PackagePlus, names: ['plan'] },
  { to: href.gigs, label: '내 공구', icon: Ticket, names: ['gigs', 'manage'] },
  { to: href.savings, label: '저금통', icon: PiggyBank, names: ['savings'] },
]

export function App() {
  const { route, visit } = useRoute()
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    if (visit === 0) return
    window.scrollTo({ top: 0 })
    main.current?.focus({ preventScroll: true })
  }, [visit])

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
          <a href={href.plan} className="rounded-md font-display text-xl">
            긱스플리터
          </a>
          <nav aria-label="주요 메뉴" className="flex">
            {NAV.map(({ to, label, icon: Icon, names }) => {
              const on = names.includes(route.name)
              return (
                <a
                  key={to}
                  href={to}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap',
                    on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                  )}
                >
                  <Icon aria-hidden className="size-4.5 max-[22rem]:hidden" />
                  {label}
                </a>
              )
            })}
          </nav>
        </header>
        <DemoBar route={route} />
        <main ref={main} tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          <Page route={route} visit={visit} />
        </main>
      </div>
    </MotionConfig>
  )
}

function Page({ route, visit }: { route: Route; visit: number }) {
  switch (route.name) {
    case 'plan':
      return <PlanPage key={visit} draftId={route.draftId} />
    case 'gigs':
      return <GigListPage />
    case 'manage':
      return <ManagePage key={route.id} id={route.id} />
    case 'join':
      return <JoinPage key={route.code} code={route.code} version={route.version} />
    case 'savings':
      return <SavingsPage />
    case 'notFound':
      return (
        <div className="py-12">
          <h1 className="font-display text-3xl">없는 화면이에요</h1>
          <p className="mt-2 text-ink-soft">주소를 다시 확인해 주세요.</p>
          <a href={href.plan} className="mt-5 inline-flex min-h-11 items-center font-semibold text-cobalt underline">
            새 공구 만들기
          </a>
        </div>
      )
  }
}
