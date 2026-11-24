import { useEffect, useState } from 'react'

export type Route =
  | { name: 'plan'; draftId: string | null }
  | { name: 'gigs' }
  | { name: 'manage'; id: string }
  | { name: 'join'; code: string; version: number | null }
  | { name: 'savings' }
  | { name: 'notFound' }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [head, id, sub, v] = parts
  if (!head) return { name: 'plan', draftId: null }
  if (head === 'draft' && id) return { name: 'plan', draftId: id }
  if (head === 'gigs') return id ? { name: 'manage', id } : { name: 'gigs' }
  if (head === 'savings') return { name: 'savings' }
  if (head === 'join' && id) {
    const version = sub === 'v' && /^\d+$/.test(v ?? '') ? Number(v) : null
    return { name: 'join', code: id, version }
  }
  return { name: 'notFound' }
}

export const href = {
  plan: '#/',
  draft: (id: string) => `#/draft/${id}`,
  gigs: '#/gigs',
  manage: (id: string) => `#/gigs/${id}`,
  join: (code: string) => `#/join/${code}`,
  joinVersion: (code: string, version: number) => `#/join/${code}/v/${version}`,
  savings: '#/savings',
}

export const absolute = (hash: string) => `${location.origin}${location.pathname}${hash}`

export const navigate = (hash: string) => {
  location.hash = hash
}

/** 해시가 바뀔 때마다 visit 이 늘어난다. 같은 화면으로 다시 들어와도 새로 시작하게 한다. */
export function useRoute(): { route: Route; visit: number } {
  const [state, setState] = useState(() => ({ route: parseHash(location.hash), visit: 0 }))
  useEffect(() => {
    const onChange = () => setState((s) => ({ route: parseHash(location.hash), visit: s.visit + 1 }))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return state
}
