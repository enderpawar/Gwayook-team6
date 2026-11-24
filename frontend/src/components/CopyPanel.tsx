import { Check, Copy } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Post } from '@/domain/post'
import { copyText } from '@/lib/copy'
import { Sticker } from './Sticker'
import { Button } from './ui/Button'
import { Notice } from './ui/Notice'

type Result = { status: 'idle' } | { status: 'done' | 'failed'; target: string; text: string }

export function CopyPanel({ post }: { post: Post }) {
  const full = `${post.title}\n\n${post.body}`
  const [result, setResult] = useState<Result>({ status: 'idle' })
  const [stamp, setStamp] = useState(false)
  const manual = useRef<HTMLTextAreaElement>(null)

  // 내용이 바뀌면 이전 복사 결과는 더 이상 맞지 않는다.
  useEffect(() => setResult({ status: 'idle' }), [full])

  useEffect(() => {
    if (result.status !== 'failed') return
    manual.current?.focus()
    manual.current?.select()
  }, [result])

  // 스티커는 잠깐만 보여 글을 가리지 않게 한다. 결과 문구는 계속 남는다.
  useEffect(() => {
    if (result.status !== 'done') {
      setStamp(false)
      return
    }
    setStamp(true)
    const id = setTimeout(() => setStamp(false), 1600)
    return () => clearTimeout(id)
  }, [result])

  const copy = async (target: string, text: string) => {
    const ok = await copyText(text)
    setResult({ status: ok ? 'done' : 'failed', target, text })
  }

  return (
    <section aria-label="모집글 미리보기" className="relative">
      <div className="ticket" style={{ '--notch': 'calc(100% - 4.5rem)' } as CSSProperties}>
        <article className="p-5">
          <h2 className="text-lg font-bold">{post.title}</h2>
          <p className="mt-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap">{post.body}</p>
        </article>
        <div className="mx-5 border-t-2 border-dashed border-line" />
        <div className="flex h-18 items-center gap-2 px-5">
          <Button variant="ghost" className="min-h-11 flex-1 px-2 text-sm" onClick={() => void copy('제목', post.title)}>
            제목만 복사
          </Button>
          <Button variant="ghost" className="min-h-11 flex-1 px-2 text-sm" onClick={() => void copy('본문', post.body)}>
            본문만 복사
          </Button>
        </div>
      </div>
      <AnimatePresence>
        {stamp && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -top-4 -right-1"
            exit={{ opacity: 0 }}
          >
            <Sticker tone="tag" className="size-24">
              <Check className="mx-auto size-7" strokeWidth={3.5} />
              <span className="block text-sm font-bold">복사됨</span>
            </Sticker>
          </motion.div>
        )}
      </AnimatePresence>
      <Button className="mt-4 w-full" onClick={() => void copy('모집글', full)}>
        <Copy aria-hidden className="size-5" />
        모집글 전체 복사
      </Button>
      <p role="status" className="mt-2 min-h-6 text-center text-sm font-semibold">
        {result.status === 'done' && `${result.target === '모집글' ? '모집글을' : result.target === '제목' ? '제목을' : '본문을'} 복사했어요.`}
      </p>
      {result.status === 'failed' && (
        <div>
          <Notice tone="error">브라우저가 복사를 막았어요. 아래에 선택된 글을 길게 누르거나 Ctrl+C(⌘C)로 복사해 주세요.</Notice>
          <textarea
            ref={manual}
            readOnly
            aria-label={`직접 복사할 ${result.target}`}
            value={result.text}
            rows={10}
            className="mt-2 w-full rounded-control bg-surface p-3.5 text-base ring-1 ring-line"
          />
        </div>
      )}
    </section>
  )
}
