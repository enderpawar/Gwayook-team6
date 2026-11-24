import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { store, useAction, usePeople } from '@/data/useStore'
import { href, navigate } from '@/lib/router'

/** 서버 저장소를 쓸 때의 로그인. 비밀번호는 저장하지 않고, 로그인 정보는 이 탭에만 둔다. */
export function LoginPage({ next }: { next: string | null }) {
  const { user } = usePeople()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const { run, pending, error, clear } = useAction()
  const auth = store.auth

  if (!auth) {
    return (
      <div className="py-8">
        <h1 className="font-display text-3xl">로그인이 필요 없어요</h1>
        <p className="mt-2 text-ink-soft">지금은 서버 없이 이 브라우저에만 저장하는 시연용으로 쓰고 있어요.</p>
      </div>
    )
  }
  if (user) {
    return (
      <div className="py-8">
        <h1 className="font-display text-3xl">{user.alias}님, 로그인했어요</h1>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={next ?? href.gigs} className="inline-flex min-h-12 items-center rounded-full bg-ink px-5 font-semibold text-white">
            {next ? '하던 일 계속하기' : '내 공구로 가기'}
          </a>
          <Button variant="outline" disabled={pending} onClick={() => void run(() => auth.logout())}>
            로그아웃
          </Button>
        </div>
      </div>
    )
  }
  const joining = mode === 'register'
  return (
    <div className="mx-auto w-full max-w-md py-5">
      <h1 className="font-display text-3xl sm:text-4xl">{joining ? '가입하기' : '로그인하기'}</h1>
      <p className="mt-2 text-ink-soft">공구를 열거나 참여하려면 로그인해 주세요. 나누기와 모집글 복사는 로그인 없이 쓸 수 있어요.</p>
      <div className="mt-5 rounded-panel bg-surface p-5">
        <Segmented
          label="로그인 방법"
          value={mode}
          options={[
            { value: 'login', label: '로그인' },
            { value: 'register', label: '처음이에요' },
          ]}
          onChange={(m) => {
            setMode(m)
            clear()
          }}
        />
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => (joining ? auth.register(email, password, name.trim()) : auth.login(email, password))).then((ok) => {
              setPassword('')
              if (ok) navigate(next ?? href.gigs)
            })
          }}
        >
          <Field label="이메일">
            {(a) => <TextInput {...a} type="email" autoComplete="email" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="비밀번호" hint={joining ? '12자 이상' : undefined}>
            {(a) => (
              <TextInput
                {...a}
                type="password"
                autoComplete={joining ? 'new-password' : 'current-password'}
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {joining && (
            <Field label="별칭" hint="정산 안내에 보여요. 실명 대신 별칭을 써 주세요.">
              {(a) => <TextInput {...a} autoComplete="nickname" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={pending}>
            {joining ? '가입하고 시작하기' : '로그인'}
          </Button>
        </form>
      </div>
    </div>
  )
}
