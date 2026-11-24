export const MIN_HEADCOUNT = 2
export const MAX_HEADCOUNT = 4

export interface Share {
  seat: number
  isHost: boolean
  units: number
  amount: number
}

export type Settlement =
  | { ok: true; total: number; totalUnits: number; shares: Share[] }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'tooFewUnits'; maxHeadcount: number }

/** 몫을 균등 배정하고 나머지를 방장(0번)에게 더한다. 배정할 수 없으면 null. */
export function allocateUnits(totalUnits: number, headcount: number): number[] | null {
  if (!Number.isInteger(totalUnits) || !Number.isInteger(headcount)) return null
  if (headcount < MIN_HEADCOUNT || headcount > MAX_HEADCOUNT) return null
  const base = Math.floor(totalUnits / headcount)
  if (base < 1) return null
  const rest = totalUnits - base * headcount
  return Array.from({ length: headcount }, (_, seat) => (seat === 0 ? base + rest : base))
}

/**
 * 수량에 비례해 원 단위로 나눈다. 내림한 뒤 남는 원은 소수 잔여가 큰 순서로 1원씩,
 * 동률이면 앞 순서(방장, 확정 순)가 먼저 받는다. 합계는 항상 total 과 같다.
 */
export function splitAmount(total: number, units: number[]): number[] {
  const P = BigInt(total)
  const Q = units.reduce((acc, u) => acc + BigInt(u), 0n)
  const rows = units.map((u, seat) => {
    const product = P * BigInt(u)
    return { seat, floor: product / Q, remainder: product % Q }
  })
  let left = P - rows.reduce((acc, r) => acc + r.floor, 0n)
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.seat - b.seat : a.remainder > b.remainder ? -1 : 1,
  )
  const result = rows.map((r) => r.floor)
  for (const row of order) {
    if (left === 0n) break
    result[row.seat] = row.floor + 1n
    left -= 1n
  }
  return result.map(Number)
}

export function settle(
  total: number | null,
  totalUnits: number | null,
  headcount: number,
): Settlement {
  if (total === null || totalUnits === null || total < 1 || totalUnits < 1) {
    return { ok: false, reason: 'missing' }
  }
  const units = allocateUnits(totalUnits, headcount)
  if (!units) return { ok: false, reason: 'tooFewUnits', maxHeadcount: Math.floor(totalUnits) }
  const amounts = splitAmount(total, units)
  return {
    ok: true,
    total,
    totalUnits,
    shares: units.map((u, seat) => ({
      seat,
      isHost: seat === 0,
      units: u,
      amount: amounts[seat]!,
    })),
  }
}
