import { beforeEach, describe, expect, it } from 'vitest'
import { PRESETS } from '@/domain/presets'
import { createLocalStore } from './localStore'

const { product, reference } = PRESETS[0]!
const draft = (id = 'd1') => ({ id, step: 3, product, reference, plan: { headcount: 2, place: null, deadline: null, applyMethod: '' } })
const make = () => createLocalStore({ shared: localStorage, session: sessionStorage })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('localStore', () => {
  it('초안을 저장하고 다시 열고 지운다', async () => {
    const s = make()
    await s.saveDraft(draft())
    await s.saveDraft({ ...draft(), step: 1 })
    expect(await make().getHosted('d1')).toMatchObject({ step: 1, status: 'draft' })
    await s.deleteDraft('d1')
    expect(await s.listHosted()).toEqual([])
  })
  it('초안은 초대 링크로 볼 수 없고, 공개한 공구는 초안 저장으로 덮이지 않는다', async () => {
    const s = make()
    await s.saveDraft(draft())
    const { inviteCode } = await s.getHosted('d1')
    await expect(s.getInvite(inviteCode)).rejects.toMatchObject({ code: 'notFound' })
    await s.execute('d1', { type: 'publish', hostAlias: '방장' })
    await s.saveDraft({ ...draft(), step: 0 })
    expect(await s.getHosted('d1')).toMatchObject({ step: 3, status: 'recruiting' })
    await expect(s.deleteDraft('d1')).rejects.toMatchObject({ code: 'badStatus' })
  })
  it('다른 사람은 방장 화면을 열거나 명령을 실행할 수 없다', async () => {
    const s = make()
    await s.saveDraft(draft())
    await s.execute('d1', { type: 'publish', hostAlias: '방장' })
    s.addPerson()
    await expect(s.getHosted('d1')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(s.execute('d1', { type: 'close' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(s.saveDraft(draft())).rejects.toMatchObject({ code: 'forbidden' })
    expect(await s.listHosted()).toEqual([])
  })
  it('저장 값이 깨져도 빈 목록으로 연다', async () => {
    localStorage.setItem('gigsplitter.gigs.v1', '{oops')
    expect(await make().listHosted()).toEqual([])
  })
})
