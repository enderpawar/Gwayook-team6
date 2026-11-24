import { Check, Copy, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '@/lib/copy'
import { Button } from './ui/Button'
import { Notice } from './ui/Notice'

interface Props {
  text: string
  copyLabel: string
  /** 공유 버튼 문구. 없으면 복사만 보여준다. */
  shareLabel?: string
}

const canShare = () => typeof navigator.share === 'function'

/** 기기의 공유 창(카카오톡 포함)을 열거나 복사한다. 둘 다 막히면 직접 복사할 글을 보여준다. */
export function ShareRow({ text, copyLabel, shareLabel }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const manual = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setState('idle'), [text])
  useEffect(() => {
    if (state !== 'failed') return
    manual.current?.focus()
    manual.current?.select()
  }, [state])

  const copy = async () => setState((await copyText(text)) ? 'done' : 'failed')
  const share = async () => {
    try {
      await navigator.share({ text })
    } catch (e) {
      // 사용자가 공유 창을 닫은 것은 실패가 아니다.
      if (!(e instanceof DOMException && e.name === 'AbortError')) await copy()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {shareLabel && canShare() && (
          <Button className="flex-1 whitespace-nowrap" onClick={() => void share()}>
            <Share2 aria-hidden className="size-5" />
            {shareLabel}
          </Button>
        )}
        <Button variant="outline" className="flex-1 whitespace-nowrap" onClick={() => void copy()}>
          {state === 'done' ? <Check aria-hidden className="size-5" /> : <Copy aria-hidden className="size-5" />}
          {state === 'done' ? '복사됨' : copyLabel}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {state === 'done' ? '복사했어요.' : ''}
      </p>
      {state === 'failed' && (
        <div className="mt-2">
          <Notice tone="error">브라우저가 복사를 막았어요. 아래 글을 직접 복사해 주세요.</Notice>
          <textarea ref={manual} readOnly rows={5} value={text} aria-label="직접 복사할 글" className="mt-2 w-full rounded-control p-3 text-base ring-1 ring-line" />
        </div>
      )}
    </div>
  )
}
