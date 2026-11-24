import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { useAction, usePeople } from '@/data/useStore'

/** 모집글 복사 뒤에 공구를 열어 신청과 정산을 관리하게 한다. */
export function PublishPanel({ onPublish }: { onPublish: (alias: string) => Promise<void> }) {
  const { me } = usePeople()
  const [alias, setAlias] = useState(me.alias)
  const { run, pending, error } = useAction()
  return (
    <form
      className="rounded-panel bg-tag p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => onPublish(alias))
      }}
    >
      <h2 className="text-lg font-bold">신청부터 정산까지 관리하기</h2>
      <p className="mt-1 text-sm">공구를 열면 초대 링크로 신청을 받고, 입금과 수령을 확인할 수 있어요.</p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="참여자에게 보일 내 별칭" className="min-w-40 flex-1">
          {(a) => <TextInput {...a} value={alias} maxLength={20} autoComplete="nickname" onChange={(e) => setAlias(e.target.value)} />}
        </Field>
        <Button type="submit" variant="ink" disabled={pending || !alias.trim()} className="disabled:bg-ink/15 disabled:text-ink">
          <Megaphone aria-hidden className="size-5" />
          공구 열기
        </Button>
      </div>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </form>
  )
}
