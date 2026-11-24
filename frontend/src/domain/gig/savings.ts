import { displayName } from '../product'
import { balance, latest, moneyKeys } from './select'
import type { Gig } from './types'

export interface SavingEntry {
  gigId: string
  name: string
  amount: number
  completedAt: string
  /** 정정·환불이 끝나지 않아 아직 합산하지 않는 건 */
  pending: boolean
}

export interface SavingsSummary {
  total: number
  entries: SavingEntry[]
}

/**
 * 완료 공구의 본인 절약액. 매번 최신 정산에서 다시 계산하므로 정정해도 두 번 더해지지 않는다.
 * 비교 기준이 없거나 금액이 덜 정리된 건은 합계에서 뺀다.
 */
export function summarizeSavings(gigs: Gig[], userId: string): SavingsSummary {
  const unique = new Map(gigs.map((g) => [g.id, g]))
  const entries: SavingEntry[] = []
  for (const g of unique.values()) {
    if (g.status !== 'done') continue
    const key = g.hostId === userId ? 'host' : g.participants.find((p) => p.userId === userId)?.id
    const v = latest(g)
    const row = key ? v?.shares.find((s) => s.key === key) : undefined
    if (!v || !row || row.saved === null) continue
    const mine = key === 'host' ? moneyKeys(g) : [row.key]
    const open = mine.some((k) => balance(g, k).remaining !== 0)
    const waiting = v.needsConfirm.some((id) => !v.confirmed[id] && (key === 'host' || id === key))
    entries.push({
      gigId: g.id,
      name: displayName(g.product),
      amount: row.saved,
      completedAt: g.updatedAt,
      pending: open || waiting,
    })
  }
  return { total: entries.filter((e) => !e.pending).reduce((a, e) => a + e.amount, 0), entries }
}
