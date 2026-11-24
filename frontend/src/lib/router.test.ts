import { expect, it } from 'vitest'
import { parseHash } from './router'

it.each([
  ['', { name: 'plan', draftId: null }],
  ['#/draft/a1', { name: 'plan', draftId: 'a1' }],
  ['#/gigs', { name: 'gigs' }],
  ['#/gigs/a1', { name: 'manage', id: 'a1' }],
  ['#/join/c1', { name: 'join', code: 'c1', version: null }],
  ['#/join/c1/v/2', { name: 'join', code: 'c1', version: 2 }],
  ['#/join/c1/v/x', { name: 'join', code: 'c1', version: null }],
  ['#/join', { name: 'notFound' }],
  ['#/zzz', { name: 'notFound' }],
])('%s', (hash, route) => expect(parseHash(hash)).toEqual(route))
