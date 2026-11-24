import type { SavingsSummary } from '@/domain/gig/savings'
import type { Command, Gig } from '@/domain/gig/types'
import type { InviteView } from '@/domain/gig/views'
import type { PlanDraft, ProductDraft, ReferenceDraft } from '@/domain/types'

export interface Person {
  id: string
  alias: string
}

export interface DraftInput {
  id: string
  step: number
  product: ProductDraft
  reference: ReferenceDraft
  plan: PlanDraft
}

/**
 * 공구 저장소. 지금은 브라우저 저장소로 구현되어 있고, 운영 API 가 준비되면 같은 인터페이스로 바꿔 끼운다.
 * 권한 검사와 정원·중복 처리는 서버 구현에서도 domain/gig/execute 와 같은 규칙이어야 한다.
 */
export interface PublishInput {
  hostAlias: string
  pickupCandidates: string[]
}

export interface Auth {
  user(): Person | null
  login(email: string, password: string): Promise<void>
  register(email: string, password: string, displayName: string): Promise<void>
  logout(): Promise<void>
}

export interface GigStore {
  /** true 면 이 브라우저에만 저장하는 시연용 저장소 */
  readonly local: boolean
  /** 서버 저장소일 때만 있다. */
  readonly auth: Auth | null
  me(): Person
  people(): Person[]
  switchTo(id: string): void
  addPerson(): void
  setAlias(alias: string): void
  listHosted(): Promise<Gig[]>
  listJoined(): Promise<InviteView[]>
  getHosted(id: string): Promise<Gig>
  getInvite(code: string): Promise<InviteView>
  saveDraft(input: DraftInput): Promise<void>
  deleteDraft(id: string): Promise<void>
  /** 초안을 공개하고 공구 id 를 돌려준다. */
  publish(id: string, input: PublishInput): Promise<string>
  execute(id: string, command: Command): Promise<void>
  executeByCode(code: string, command: Command): Promise<void>
  savings(): Promise<SavingsSummary>
  subscribe(listener: () => void): () => void
}
