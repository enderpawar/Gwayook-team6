import { createGig } from '@/domain/gig/create'
import { GigError, type Balance, type Command, type Gig, type SettlementVersion } from '@/domain/gig/types'
import type { InviteView, MyView } from '@/domain/gig/views'
import type { SavingsSummary } from '@/domain/gig/savings'
import { newId } from '@/lib/id'
import type { GigStore, Person } from './store'
import {
  fromBalance, fromServerProduct, fromSnapshot, ISSUE, PARTICIPANT, publishProblems, ratioToWon, SERVER_ISSUES, serverError, STATUS,
  toIso, toLocal, toServerInput, type ServerBalance, type ServerProduct, type ServerSnapshot,
} from './serverMap'

const SESSION = 'gigsplitter.session.v1'
const INVITES = 'gigsplitter.invites.v1'
const JOINED = 'gigsplitter.joined.v1'

interface Session {
  token: string
  expiresAt: string
  user: { id: string; displayName: string }
}

interface PublicGroup {
  id: string
  status: string
  updatedAt: string
  people: number
  remainingSeats: number
  acceptingApplications: boolean
  publicLocation: string | null
  applicationDeadline: string
  pickupCandidates: string[]
  shortName: string
  fullTitle: string
  unitName: string
  estimatedShares: { role: string; quantity: number; amount: number }[]
}

interface Applicant {
  userId: string
  alias: string
  status: string
  requestedAt: string
  approvalSeq: number | null
}

interface OwnerGroup extends PublicGroup {
  role: 'ORGANIZER'
  revision: number
  analysis: { product: ServerProduct }
  applications: Applicant[]
}

interface MemberGroup extends PublicGroup {
  role: 'MEMBER'
  application: Applicant
  estimatedShare: { quantity: number; amount: number } | null
}

interface LedgerEvent {
  id: string
  type: string
  versionNo: number
  userId: string
  amount?: number
  quantity?: number
  relatedEventId?: string
  recordedAt: string
}

interface HostSettlement {
  versionNo: number
  latestVersionNo: number | null
  pendingVersionNo: number | null
  snapshot: ServerSnapshot
  ledger?: { balances: ServerBalance[]; merchantRefundsApplied: boolean }
  events?: LedgerEvent[]
  actions?: { id: string; kind: string; userId: string | null; openedAt: number; resolvedAt: number | null }[]
}

interface MemberSettlement {
  versionNo: number
  confirmedAt: string | null
  pickup: { at: string | null; publicHub: string | null }
  latestVersionNo: number | null
  pendingVersionNo: number | null
  line?: ServerSnapshot['lines'][number]
  balance?: ServerBalance
  previousAmount?: number | null
  reconfirmed?: boolean
  reconfirmationRequired?: boolean
}

interface Deps {
  shared: Storage
  session: Storage
  drafts: GigStore
  base?: string
  fetchImpl?: typeof fetch
}

/** 백엔드 P1 API 저장소. 초안은 로그인 없이도 쓸 수 있도록 브라우저에 두고, 공개할 때 서버로 보낸다. */
export function createHttpStore({ shared, session, drafts, base = '', fetchImpl = (...a) => fetch(...a) }: Deps): GigStore {
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const readJson = <T>(storage: Storage, key: string, fallback: T): T => {
    try {
      return (JSON.parse(storage.getItem(key) ?? 'null') as T | null) ?? fallback
    } catch {
      return fallback
    }
  }
  const writeJson = (storage: Storage, key: string, value: unknown) => {
    try {
      storage.setItem(key, JSON.stringify(value))
    } catch {
      // 저장이 막혀도 이번 화면에서는 계속 쓸 수 있다.
    }
  }

  let current: Session | null = readJson<Session | null>(session, SESSION, null)
  if (current && Date.parse(current.expiresAt) <= Date.now()) current = null
  const setSession = (next: Session | null) => {
    current = next
    if (next) writeJson(session, SESSION, next)
    else
      try {
        session.removeItem(SESSION)
      } catch {
        // 지우지 못해도 메모리에서는 로그아웃된다.
      }
    notify()
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response
    let text: string
    try {
      response = await fetchImpl(`${base}/api/p1${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(current ? { Authorization: `Bearer ${current.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      })
      text = await response.text()
    } catch {
      throw new GigError('network', '서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해 주세요.')
    }
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      throw new GigError('server', '서버 응답을 읽지 못했어요.')
    }
    if (!response.ok) {
      const code = typeof json === 'object' && json !== null && 'code' in json ? String(json.code) : null
      if (response.status === 401 && code === 'AUTH_REQUIRED' && current) setSession(null)
      throw serverError(response.status, code)
    }
    return json as T
  }

  const optional = async <T>(job: Promise<T>): Promise<T | null> => {
    try {
      return await job
    } catch (e) {
      if (e instanceof GigError && e.code === 'notFound') return null
      throw e
    }
  }
  const requireLogin = () => {
    if (!current) throw new GigError('auth', '로그인이 필요해요.')
    return current.user
  }

  const tokenOf = (id: string) => readJson<Record<string, string>>(shared, INVITES, {})[id] ?? null
  const saveToken = (id: string, token: string) => writeJson(shared, INVITES, { ...readJson(shared, INVITES, {}), [id]: token })
  const joinedKey = () => `${JOINED}.${current?.user.id ?? ''}`
  const joined = () => readJson<{ id: string; token: string }[]>(shared, joinedKey(), [])
  const remember = (id: string, token: string) => {
    if (!joined().some((j) => j.id === id)) writeJson(shared, joinedKey(), [...joined(), { id, token }])
  }

  const settlement = (id: string, version?: number) =>
    optional(call<HostSettlement>('GET', `/groups/${id}/settlement${version ? `/${version}` : ''}`))

  async function hostGig(id: string): Promise<{ gig: Gig; view: OwnerGroup; current: HostSettlement | null }> {
    requireLogin()
    const view = await call<OwnerGroup | MemberGroup>('GET', `/groups/${id}`)
    if (view.role !== 'ORGANIZER') throw new GigError('forbidden', '방장만 볼 수 있는 화면이에요.')
    const { product, reference } = fromServerProduct(view.analysis.product)
    const started = ['SETTLING', 'PICKUP', 'COMPLETED', 'CANCELLED'].includes(view.status)
    const now = started ? await settlement(id) : null
    const confirmed: SettlementVersion[] = []
    let pending: SettlementVersion | null = null
    if (now) {
      const last = Math.max(now.latestVersionNo ?? 0, now.pendingVersionNo ?? 0, now.versionNo)
      // 바뀐 후보는 404 로 오므로 빠진 번호는 건너뛴다.
      const all = await Promise.all(Array.from({ length: last }, (_, i) => (i + 1 === now.versionNo ? now : settlement(id, i + 1))))
      for (const s of all) {
        if (!s) continue
        const v = fromSnapshot(s.snapshot, product, reference)
        if (s.snapshot.confirmedAt) confirmed.push(v)
        else pending = v
      }
    }
    const hostUser = current!.user
    const keyOf = (userId: string) => (userId === hostUser.id ? 'host' : userId)
    const balances: Record<string, Balance> = {}
    const pickedUp: Record<string, string> = {}
    for (const b of now?.ledger?.balances ?? []) {
      balances[keyOf(b.userId)] = fromBalance(b)
      if (b.receiptStatus === 'RECEIVED') pickedUp[keyOf(b.userId)] = 'server'
    }
    const terms = now?.snapshot.terms.pickup
    const gig: Gig = {
      ...createGig({
        id, inviteCode: tokenOf(id) ?? '', hostId: hostUser.id, now: new Date(), product, reference, step: 3,
        plan: { headcount: view.people, place: view.publicLocation, deadline: toLocal(view.applicationDeadline), applyMethod: '' },
      }),
      hostAlias: hostUser.displayName,
      status: STATUS[view.status] ?? 'recruiting',
      pickupCandidates: view.pickupCandidates.map((c) => toLocal(c)),
      participants: view.applications.map((a) => ({
        id: a.userId, userId: a.userId, alias: a.alias, status: PARTICIPANT[a.status] ?? 'applied',
        appliedAt: a.requestedAt, approvedAt: null, ...(a.approvalSeq ? { order: a.approvalSeq } : {}),
      })),
      settlements: confirmed,
      pickup: confirmed.length && terms?.publicHub ? { place: terms.publicHub, at: toLocal(terms.at) } : null,
      pickedUp,
      issues: (now?.actions ?? []).map((a) => ({
        id: a.id, kind: ISSUE[a.kind] ?? 'other', key: a.userId, reason: '', followUp: '',
        createdAt: new Date(a.openedAt).toISOString(), resolvedAt: a.resolvedAt ? new Date(a.resolvedAt).toISOString() : null,
      })),
      updatedAt: view.updatedAt,
      server: {
        revision: view.revision,
        inviteToken: tokenOf(id),
        pending,
        balances,
        refundUnapplied: now?.ledger ? !now.ledger.merchantRefundsApplied : false,
      },
    }
    return { gig, view, current: now }
  }

  function publicView(g: PublicGroup, code: string): InviteView {
    const guests = g.estimatedShares.filter((s) => s.role === 'MEMBER')
    return {
      code,
      status: STATUS[g.status] ?? 'recruiting',
      productName: g.shortName || g.fullTitle,
      option: '',
      hostAlias: '',
      headcount: g.people,
      seatsLeft: g.remainingSeats,
      applyOpen: g.acceptingApplications,
      deadline: toLocal(g.applicationDeadline),
      place: g.publicLocation,
      pickupCandidates: g.pickupCandidates.map((c) => toLocal(c)),
      conditionsEditedAt: null,
      cancelReason: null,
      estimated: true,
      estimate: guests.length
        ? { units: `${guests[0]!.quantity}${g.unitName}`, min: Math.min(...guests.map((s) => s.amount)), max: Math.max(...guests.map((s) => s.amount)) }
        : null,
      savingsRate: null,
      isHost: false,
      hostGigId: null,
      me: null,
    }
  }

  async function memberView(g: MemberGroup, code: string): Promise<InviteView> {
    const read = (version?: number) =>
      optional(call<MemberSettlement>('GET', `/groups/${g.id}/settlement${version ? `/${version}` : ''}`))
    const base = await read()
    const pending = base?.pendingVersionNo && base.pendingVersionNo !== base.versionNo ? await read(base.pendingVersionNo) : null
    const shown = pending ?? base
    const line = shown?.line
    const before =
      line && shown.reconfirmationRequired
        ? shown.previousAmount != null
          ? { units: base?.line && base !== shown ? `${base.line.quantity}${base.line.unitName}` : `${line.quantity}${line.unitName}`, amount: shown.previousAmount }
          : g.estimatedShare
            ? { units: `${g.estimatedShare.quantity}${g.unitName}`, amount: g.estimatedShare.amount }
            : null
        : null
    const b = base?.balance
    const me: MyView = {
      participantId: g.application.userId,
      alias: g.application.alias,
      status: PARTICIPANT[g.application.status] ?? 'applied',
      latestVersion: base?.latestVersionNo ?? null,
      share:
        shown && line
          ? {
              version: shown.versionNo,
              reason: shown.versionNo === 1 ? '주문 확정' : '정산 변경',
              units: `${line.quantity}${line.unitName}`,
              amount: line.amount,
              saved: null,
              needsConfirm: Boolean(shown.reconfirmationRequired && !shown.reconfirmed),
              waiting: !shown.confirmedAt,
              before,
            }
          : null,
      balance: b ? fromBalance(b) : null,
      pickup: base?.confirmedAt && base.pickup.publicHub ? { place: base.pickup.publicHub, at: toLocal(base.pickup.at) } : null,
      pickedUp: Boolean(b && b.targetQuantity > 0 && b.receiptStatus === 'RECEIVED'),
    }
    return { ...publicView(g, code), me }
  }

  async function inviteById(id: string, code: string): Promise<InviteView | null> {
    const own = await optional(call<OwnerGroup | MemberGroup>('GET', `/groups/${id}`))
    if (!own) return null
    if (own.role === 'ORGANIZER') return { ...publicView(own, code), isHost: true, hostGigId: id, hostAlias: current!.user.displayName }
    remember(id, code)
    return memberView(own, code)
  }

  async function getInvite(code: string): Promise<InviteView> {
    const open = await optional(call<PublicGroup>('GET', `/invites/${encodeURIComponent(code)}`))
    if (!open) {
      const known = current && joined().find((j) => j.token === code)
      const mine = known ? await inviteById(known.id, code) : null
      if (mine) return mine
      throw new GigError('notFound', '초대 링크가 만료됐거나 새 링크로 바뀌었어요.')
    }
    return (current && (await inviteById(open.id, code))) || publicView(open, code)
  }

  async function groupIdOf(code: string): Promise<string> {
    const known = joined().find((j) => j.token === code)
    return known ? known.id : (await call<PublicGroup>('GET', `/invites/${encodeURIComponent(code)}`)).id
  }

  async function hostCommand(id: string, command: Command) {
    const state = await hostGig(id)
    const { gig, view, current: now } = state
    const revision = view.revision
    const path = `/groups/${id}`
    const events = `${path}/settlement/events`
    const settled = now?.latestVersionNo ?? null
    const version = () => settled ?? raise('아직 확정한 정산이 없어요.')
    const hostId = current!.user.id
    const userIdOf = (key: string) => (key === 'host' ? hostId : key)
    /** 명단에서 빠진 참여자는 마지막으로 포함됐던 정산에 기록한다. */
    const versionWith = (userId: string) =>
      [...gig.settlements].reverse().find((v) => v.shares.some((s) => userIdOf(s.key) === userId))?.version ?? version()

    switch (command.type) {
      case 'approve':
      case 'exclude':
        return call('POST', `${path}/applications/${command.participantId}/${command.type}`, {})
      case 'close':
      case 'reopen':
        return call('POST', `${path}/${command.type}`, { revision })
      case 'editConditions': {
        const c = command.conditions
        return call('PATCH', `${path}/recruitment`, {
          revision,
          ...(c.headcount !== undefined ? { people: c.headcount } : {}),
          ...(c.place !== undefined ? { publicLocation: c.place?.trim() || null } : {}),
          ...(c.deadline ? { applicationDeadline: toIso(c.deadline) } : {}),
          ...(c.pickupCandidates ? { pickupCandidates: c.pickupCandidates.map(toIso) } : {}),
        })
      }
      case 'rotateInvite': {
        const { inviteToken } = await call<{ inviteToken: string }>('POST', `${path}/invite`, {})
        saveToken(id, inviteToken)
        return
      }
      case 'confirmOrder':
      case 'revise': {
        const o = command.order
        return call('POST', `${path}/settlement/candidate`, {
          revision,
          priceConfirmed: true,
          quantity: o.totalUnits,
          payment: { productAmount: o.itemAmount, shippingFee: o.shippingFee, discountAmount: o.discountAmount, includesShipping: false, includesDiscount: false },
          hostAlias: current!.user.displayName,
          ...(command.pickup ? { publicHub: command.pickup.place.trim() || null, pickupAt: command.pickup.at ? toIso(command.pickup.at) : null } : {}),
          ...(command.type === 'confirmOrder' || !settled
            ? { orderAt: toIso(o.orderedAt) }
            : { reason: command.reason, ...(command.removeParticipantIds.length ? { excludeUserIds: command.removeParticipantIds } : {}) }),
        })
      }
      case 'confirmPending':
        return call('POST', `${path}/settlement/${command.version}/confirm`, {})
      case 'confirmPayment': {
        const linked = new Set((now?.events ?? []).map((e) => e.relatedEventId))
        const report = (now?.events ?? []).find((e) => e.type === 'TRANSFER_REPORTED' && e.userId === command.participantId && !linked.has(e.id))
        return call('POST', events, {
          type: 'TRANSFER_CONFIRMED', requestKey: command.commandId, versionNo: version(), userId: command.participantId, amount: command.amount,
          ...(report ? { relatedEventId: report.id } : {}),
        })
      }
      case 'refund':
        return call('POST', events, {
          type: 'REFUND_CONFIRMED', requestKey: command.commandId, versionNo: versionWith(command.participantId), userId: command.participantId, amount: command.amount,
        })
      case 'merchantRefund':
        return call('POST', events, {
          type: 'MERCHANT_REFUND_CONFIRMED', requestKey: command.commandId, versionNo: version(), userId: hostId, amount: command.amount,
        })
      case 'setPickedUp': {
        const userId = userIdOf(command.participantId)
        const line = now?.snapshot.lines.find((l) => l.userId === userId)
        if (command.done) {
          if (!line) return raise('정산에 포함된 사람이 아니에요.')
          return call('POST', events, { type: 'RECEIVED', requestKey: newId(), versionNo: version(), userId, quantity: line.quantity, unitName: line.unitName })
        }
        const reversed = new Set((now?.events ?? []).filter((e) => e.type === 'REVERSED').map((e) => e.relatedEventId))
        const last = [...(now?.events ?? [])].reverse().find((e) => e.type === 'RECEIVED' && e.userId === userId && !reversed.has(e.id))
        if (!last) return
        return call('POST', events, { type: 'REVERSED', requestKey: newId(), versionNo: last.versionNo, userId, relatedEventId: last.id })
      }
      case 'startPickup':
        return call('POST', `${path}/settlement/pickup`, {})
      case 'complete':
        return call('POST', `${path}/settlement/complete`, {})
      case 'openIssue': {
        const kind = SERVER_ISSUES.find((i) => i.kind === command.kind)?.code ?? raise('서버가 받지 않는 항목이에요.')
        return call('POST', `${path}/settlement/action`, { kind, ...(command.key ? { userId: command.key } : {}) })
      }
      case 'resolveIssue':
        return call('POST', `${path}/settlement/resolve`, { id: command.issueId })
      case 'cancel':
        return call('POST', `${path}/settlement/cancel`, { reason: command.reason })
      default:
        return raise('지금은 할 수 없어요.')
    }
  }

  const raise = (message: string): never => {
    throw new GigError('unsupported', message)
  }

  const isDraft = async (id: string) => (await drafts.listHosted()).some((g) => g.id === id && g.status === 'draft')

  return {
    local: false,
    auth: {
      user: () => (current ? { id: current.user.id, alias: current.user.displayName } : null),
      async login(email, password) {
        setSession(await call<Session>('POST', '/auth/login', { email, password }))
      },
      async register(email, password, displayName) {
        await call('POST', '/auth/register', { email, password, displayName })
        setSession(await call<Session>('POST', '/auth/login', { email, password }))
      },
      async logout() {
        try {
          await call('POST', '/auth/logout')
        } catch {
          // 서버에 닿지 않아도 이 브라우저에서는 로그아웃한다.
        }
        setSession(null)
      },
    },
    me: (): Person => (current ? { id: current.user.id, alias: current.user.displayName } : { id: '', alias: '' }),
    people: () => [],
    switchTo: () => undefined,
    addPerson: () => undefined,
    setAlias: () => undefined,
    async listHosted() {
      const local = (await drafts.listHosted()).filter((g) => g.status === 'draft')
      if (!current) return local
      const { groups } = await call<{ groups: { id: string; status: string }[] }>('GET', '/groups')
      const mine = await Promise.all(groups.filter((g) => g.status !== 'DRAFT').map((g) => hostGig(g.id).then((r) => r.gig)))
      return [...mine, ...local]
    },
    async listJoined() {
      if (!current) return []
      const views = await Promise.all(joined().map((j) => inviteById(j.id, j.token)))
      return views.filter((v): v is InviteView => v !== null && v.me !== null)
    },
    async getHosted(id) {
      if (await isDraft(id)) return drafts.getHosted(id)
      return (await hostGig(id)).gig
    },
    getInvite,
    saveDraft: (input) => drafts.saveDraft(input),
    deleteDraft: (id) => drafts.deleteDraft(id),
    async publish(id, { pickupCandidates }) {
      requireLogin()
      const draft = await drafts.getHosted(id)
      const problems = publishProblems(draft.product, draft.plan, pickupCandidates)
      if (problems.length) throw new GigError('incomplete', problems.join(' '))
      const created = await call<{ id: string; revision: number }>('POST', '/groups', {
        input: toServerInput(draft.product, draft.reference, draft.plan, pickupCandidates),
      })
      try {
        const result = await call<{ inviteToken: string }>('POST', `/groups/${created.id}/publish`, { revision: created.revision })
        saveToken(created.id, result.inviteToken)
      } catch (e) {
        // 공개하지 못한 서버 초안은 남기지 않는다. 입력은 브라우저 초안에 그대로 있다.
        await call('DELETE', `/groups/${created.id}`, { revision: created.revision }).catch(() => undefined)
        throw e
      }
      await drafts.deleteDraft(id)
      notify()
      return created.id
    },
    async execute(id, command) {
      requireLogin()
      try {
        await hostCommand(id, command)
      } finally {
        notify()
      }
    },
    async executeByCode(code, command) {
      requireLogin()
      try {
        if (command.type === 'apply') {
          const { id } = await call<PublicGroup>('GET', `/invites/${encodeURIComponent(code)}`)
          await call('POST', `/invites/${encodeURIComponent(code)}/applications`, { alias: command.alias.trim() })
          remember(id, code)
          return
        }
        const id = await groupIdOf(code)
        if (command.type === 'withdraw') await call('POST', `/groups/${id}/withdraw`, {})
        else if (command.type === 'confirmShare') await call('POST', `/groups/${id}/settlement/${command.version}/reconfirm`, {})
        else if (command.type === 'reportPayment') {
          const now = await call<MemberSettlement>('GET', `/groups/${id}/settlement`)
          await call('POST', `/groups/${id}/settlement/events`, {
            type: 'TRANSFER_REPORTED', requestKey: command.commandId, versionNo: now.versionNo, amount: command.amount,
          })
        } else raise('지금은 할 수 없어요.')
      } finally {
        notify()
      }
    },
    async savings(): Promise<SavingsSummary> {
      if (!current) return { total: 0, entries: [] }
      const data = await call<{ records: { groupBuyId: string; numerator: string; denominator: string }[]; numerator: string; denominator: string }>('GET', '/savings')
      const entries = await Promise.all(
        data.records.map(async (r) => {
          const g = await optional(call<PublicGroup>('GET', `/groups/${r.groupBuyId}`))
          return { gigId: r.groupBuyId, name: g?.shortName ?? '완료한 공구', amount: ratioToWon(r.numerator, r.denominator), completedAt: g?.updatedAt ?? '', pending: false }
        }),
      )
      return { total: ratioToWon(data.numerator, data.denominator), entries }
    },
    subscribe(listener) {
      listeners.add(listener)
      const off = drafts.subscribe(listener)
      return () => {
        listeners.delete(listener)
        off()
      }
    },
  }
}

/** P1 API 가 켜져 있는지 확인한다. 백엔드는 같은 컴퓨터에서 온 요청만 받으므로 그 밖에서는 묻지 않는다. */
export async function p1Available(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return false
  try {
    const response = await fetchImpl('/api/p1/groups', { signal: AbortSignal.timeout(1500) })
    if (response.status !== 401) return false
    const body = (await response.json()) as { code?: unknown }
    return body.code === 'AUTH_REQUIRED'
  } catch {
    return false
  }
}
