import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GigError } from '@/domain/gig/types'
import { createHttpStore, p1Available } from './httpStore'
import { createLocalStore } from './localStore'
import type { GigStore } from './store'

const local = createLocalStore({ shared: localStorage, session: sessionStorage })

/** 화면을 그리기 전에 initStore 가 정한다. */
export let store: GigStore = local

/** P1 서버가 켜져 있으면 서버를, 아니면 브라우저 저장소를 쓴다. */
export async function initStore(): Promise<void> {
  if (await p1Available()) store = createHttpStore({ shared: localStorage, session: sessionStorage, drafts: local })
}

export type Query<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; code: string; message: string }

/** 저장소가 바뀌면 다시 읽는다. 늦게 도착한 이전 응답은 버린다. */
export function useQuery<T>(load: () => Promise<T>, key: string): Query<T> {
  const [state, setState] = useState<{ key: string; query: Query<T> }>({ key, query: { status: 'loading' } })
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let turn = 0
    const run = () => {
      const mine = ++turn
      loader.current().then(
        (data) => mine === turn && setState({ key, query: { status: 'ready', data } }),
        (e: unknown) =>
          mine === turn &&
          setState({
            key,
            query: {
              status: 'error',
              code: e instanceof GigError ? e.code : 'unknown',
              message: e instanceof GigError ? e.message : '불러오지 못했어요. 다시 시도해 주세요.',
            },
          }),
      )
    }
    run()
    const off = store.subscribe(run)
    return () => {
      turn = -1
      off()
    }
  }, [key])
  return state.key === key ? state.query : { status: 'loading' }
}

/** 명령 하나를 실행하고 진행·오류 상태를 돌려준다. 실행 중에는 다시 실행하지 않는다. */
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const run = useCallback(async (job: () => Promise<void>): Promise<boolean> => {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await job()
      return true
    } catch (e) {
      setError(e instanceof GigError ? e.message : '처리하지 못했어요. 다시 시도해 주세요.')
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }, [])
  const clear = useCallback(() => setError(null), [])
  return { pending, error, run, clear }
}

const snapshot = () => JSON.stringify([store.me(), store.people()])

export function usePeople() {
  useSyncExternalStore((l) => store.subscribe(l), snapshot)
  return { me: store.me(), people: store.people(), user: store.auth?.user() ?? null }
}
