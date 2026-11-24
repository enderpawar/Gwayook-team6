import { formatDeadline, won } from '@/lib/format'
import { displayName, formatUnits } from '../product'
import { approved, latest, seatsLeft } from './select'
import type { Gig } from './types'

/** 카카오톡에 붙여 넣을 정산 안내. 별칭만 쓰고 결제 정보와 상세 주소는 넣지 않는다. (F-07) */
export function settlementShareText(g: Gig): string | null {
  const v = latest(g)
  if (!v) return null
  const when = g.pickup?.at ? (formatDeadline(g.pickup.at) ?? '미정') : '미정'
  return [
    `[${displayName(g.product)}] 정산 안내${v.version > 1 ? ` (${v.version}차, ${v.reason})` : ''}`,
    `총 결제 금액 ${won(v.total)}`,
    '',
    ...v.shares.map((s) => `· ${s.alias}${s.key === 'host' ? '(방장)' : ''}: ${formatUnits(g.product, s.units)}, ${won(s.amount)}`),
    '',
    `수령 일정: ${when}`,
    `수령 장소: ${g.pickup?.place ?? g.plan.place ?? '미정'}`,
    '',
    '보낼 계좌는 방장이 따로 알려 드려요.',
  ].join('\n')
}

/** 현재 상태를 알리는 짧은 안내 (F-19) */
export function statusShareText(g: Gig, link: string): string {
  const name = displayName(g.product)
  const body = {
    draft: '아직 모집 전이에요.',
    recruiting: `모집 중이에요. 남은 자리 ${seatsLeft(g)}개, 마감 ${formatDeadline(g.plan.deadline) ?? '미정'}${g.conditionsEditedAt ? '\n모집 조건이 바뀌었으니 다시 확인해 주세요.' : ''}`,
    closed: `모집을 마감했어요. 방장 포함 ${approved(g).length + 1}명이 함께해요.`,
    settling: `주문을 확정했어요. 정산 ${latest(g)?.version ?? 1}차 금액을 확인해 주세요.`,
    pickup: `수령을 시작해요. 일정 ${g.pickup?.at ? (formatDeadline(g.pickup.at) ?? '미정') : '미정'}\n장소는 링크에서 확인해 주세요.`,
    done: '공구를 완료했어요. 함께해 주셔서 고마워요.',
    cancelled: `공구가 취소됐어요. 이유: ${g.cancelReason ?? ''}`,
  }[g.status]
  return `[${name}] ${body}\n${link}`
}
