import type { PlanDraft, ProductDraft, ReferenceDraft } from '../types'
import type { Gig } from './types'

export function createGig(input: {
  id: string
  inviteCode: string
  hostId: string
  now: Date
  product: ProductDraft
  reference: ReferenceDraft
  plan: PlanDraft
  step: number
}): Gig {
  const at = input.now.toISOString()
  return {
    id: input.id,
    inviteCode: input.inviteCode,
    hostId: input.hostId,
    hostAlias: '',
    status: 'draft',
    step: input.step,
    product: input.product,
    reference: input.reference,
    plan: input.plan,
    pickupCandidates: [],
    participants: [],
    settlements: [],
    payments: [],
    pickup: null,
    pickedUp: {},
    issues: [],
    log: [],
    cancelReason: null,
    conditionsEditedAt: null,
    createdAt: at,
    updatedAt: at,
  }
}
