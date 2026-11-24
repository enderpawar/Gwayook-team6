import { UserPlus } from 'lucide-react'
import { store, usePeople } from '@/data/useStore'
import type { Route } from '@/lib/router'

/** 로컬 저장소를 쓰는 동안만 보인다. 서버가 없어도 방장과 참여자 화면을 번갈아 볼 수 있게 한다. */
export function DemoBar({ route }: { route: Route }) {
  const { me, people } = usePeople()
  if (!store.local || route.name === 'plan' || route.name === 'notFound') return null
  const name = (p: { alias: string }, i: number) => p.alias || `이름 없는 사람 ${i + 1}`
  return (
    <aside aria-label="시연 설정" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-ink px-3.5 py-2.5 text-sm text-white">
      <p className="min-w-0 flex-1 basis-56">시연용이에요. 이 브라우저에만 저장되고 다른 기기에서는 보이지 않아요.</p>
      <label className="flex items-center gap-2">
        <span className="whitespace-nowrap">보는 사람</span>
        <select
          value={me.id}
          onChange={(e) => store.switchTo(e.target.value)}
          className="h-11 max-w-36 rounded-md bg-white px-2 text-ink"
        >
          {people.map((p, i) => (
            <option key={p.id} value={p.id}>
              {name(p, i)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => store.addPerson()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-semibold underline-offset-4 hover:underline focus-visible:outline-white">
        <UserPlus aria-hidden className="size-4.5" />
        사람 추가
      </button>
    </aside>
  )
}
