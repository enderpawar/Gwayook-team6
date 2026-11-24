import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

/** 브라우저 기본 dialog 를 쓴다. 포커스 가두기와 Esc 닫기를 브라우저가 처리한다. */
export function Dialog({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [opener] = useState(() => document.activeElement)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
    // 저장하고 바로 사라지는 창도 열었던 버튼으로 포커스를 돌려준다.
    return () => {
      queueMicrotask(() => {
        if (el && !el.isConnected && opener instanceof HTMLElement && opener.isConnected) opener.focus()
      })
    }
  }, [opener])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="dialog-in m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-panel bg-surface p-0 text-ink backdrop:bg-ink/55 max-sm:mb-4"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={id} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => ref.current?.close()}
            className="-m-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  )
}
