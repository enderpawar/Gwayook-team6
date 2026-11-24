import { createGig } from '@/domain/gig/create'
import { execute } from '@/domain/gig/execute'
import { summarizeSavings } from '@/domain/gig/savings'
import { GigError, type Command, type Gig } from '@/domain/gig/types'
import { inviteView } from '@/domain/gig/views'
import { newId } from '@/lib/id'
import type { GigStore, Person } from './store'

const GIGS = 'gigsplitter.gigs.v1'
const PEOPLE = 'gigsplitter.people.v1'
const ME = 'gigsplitter.me.v1'

interface Storages {
  shared: Storage
  session: Storage
}

const isGigList = (v: unknown): v is Gig[] =>
  Array.isArray(v) &&
  v.every((g) => typeof g === 'object' && g !== null && typeof (g as Gig).id === 'string' && Array.isArray((g as Gig).participants))

const isPeople = (v: unknown): v is Person[] =>
  Array.isArray(v) && v.every((p) => typeof p === 'object' && p !== null && typeof (p as Person).id === 'string')

/** 한 브라우저 안에서만 공유되는 시연용 저장소. 탭마다 다른 사람으로 볼 수 있다. */
export function createLocalStore({ shared, session }: Storages): GigStore {
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const read = <T>(key: string, guard: (v: unknown) => v is T, fallback: T): T => {
    try {
      const value: unknown = JSON.parse(shared.getItem(key) ?? 'null')
      return guard(value) ? value : fallback
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown) => {
    try {
      shared.setItem(key, JSON.stringify(value))
    } catch {
      throw new GigError('storage', '이 브라우저에 저장하지 못했어요. 저장 공간이나 비공개 모드를 확인해 주세요.')
    }
    notify()
  }

  const gigs = () => read(GIGS, isGigList, [])
  const people = (): Person[] => {
    const list = read(PEOPLE, isPeople, [])
    if (list.length) return list
    const first = [{ id: newId(), alias: '' }]
    try {
      shared.setItem(PEOPLE, JSON.stringify(first))
    } catch {
      // 저장이 막힌 환경에서도 화면은 동작하게 둔다.
    }
    return first
  }
  let memoryMe: string | null = null
  const currentId = () => {
    try {
      return session.getItem(ME) ?? memoryMe
    } catch {
      return memoryMe
    }
  }
  const me = (): Person => {
    const list = people()
    return list.find((p) => p.id === currentId()) ?? list[0]!
  }
  const setCurrent = (id: string) => {
    memoryMe = id
    try {
      session.setItem(ME, id)
    } catch {
      // 탭을 새로 고치면 첫 사람으로 돌아간다.
    }
    notify()
  }

  const replace = (next: Gig) => write(GIGS, gigs().map((g) => (g.id === next.id ? next : g)))
  const run = (gig: Gig | undefined, command: Command) => {
    if (!gig) throw new GigError('notFound', '공구를 찾을 수 없어요.')
    const next = execute(gig, command, { userId: me().id, now: new Date(), newId })
    if (next !== gig) replace(next)
  }
  // 공개된 공구만 초대 코드로 찾을 수 있다. 초안은 방장만 본다.
  const byCode = (code: string) => gigs().find((g) => g.inviteCode === code && g.status !== 'draft')

  return {
    local: true,
    me,
    people,
    switchTo: setCurrent,
    addPerson() {
      const person = { id: newId(), alias: '' }
      write(PEOPLE, [...people(), person])
      setCurrent(person.id)
    },
    setAlias(alias) {
      const id = me().id
      write(PEOPLE, people().map((p) => (p.id === id ? { ...p, alias } : p)))
    },
    async listHosted() {
      return gigs()
        .filter((g) => g.hostId === me().id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async listJoined() {
      const id = me().id
      return gigs()
        .filter((g) => g.participants.some((p) => p.userId === id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((g) => inviteView(g, id, new Date()))
    },
    async getHosted(id) {
      const gig = gigs().find((g) => g.id === id)
      if (!gig) throw new GigError('notFound', '공구를 찾을 수 없어요.')
      if (gig.hostId !== me().id) throw new GigError('forbidden', '방장만 볼 수 있는 화면이에요.')
      return gig
    },
    async getInvite(code) {
      const gig = byCode(code)
      if (!gig) throw new GigError('notFound', '초대 링크를 찾을 수 없어요.')
      return inviteView(gig, me().id, new Date())
    },
    async saveDraft(input) {
      const list = gigs()
      const existing = list.find((g) => g.id === input.id)
      if (existing) {
        if (existing.hostId !== me().id) throw new GigError('forbidden', '내 초안이 아니에요.')
        if (existing.status !== 'draft') return
        replace({ ...existing, ...input, updatedAt: new Date().toISOString() })
        return
      }
      write(GIGS, [...list, createGig({ ...input, inviteCode: newId().slice(0, 12), hostId: me().id, now: new Date() })])
    },
    async deleteDraft(id) {
      const gig = gigs().find((g) => g.id === id)
      if (!gig) return
      if (gig.hostId !== me().id) throw new GigError('forbidden', '내 초안이 아니에요.')
      if (gig.status !== 'draft') throw new GigError('badStatus', '공개한 공구는 지울 수 없어요. 취소해 주세요.')
      write(GIGS, gigs().filter((g) => g.id !== id))
    },
    async execute(id, command) {
      run(gigs().find((g) => g.id === id), command)
    },
    async executeByCode(code, command) {
      run(byCode(code), command)
    },
    async savings() {
      return summarizeSavings(gigs(), me().id)
    },
    subscribe(listener) {
      listeners.add(listener)
      const onStorage = (e: StorageEvent) => {
        if (e.key === GIGS || e.key === PEOPLE) listener()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}
