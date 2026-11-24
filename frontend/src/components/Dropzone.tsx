import { ImageUp, RefreshCw, ScanText, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { ACCEPTED_IMAGES } from '@/api/imageFile'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

interface Props {
  image: { file: File; url: string } | null
  loading: boolean
  onSelect: (file: File) => void
  onRemove: () => void
  onAnalyze: () => void
}

export function Dropzone({ image, loading, onSelect, onRemove, onAnalyze }: Props) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onSelect(file)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPTED_IMAGES}
        className="peer sr-only"
        tabIndex={image ? -1 : 0}
        aria-label="쇼핑몰 캡처 이미지 선택"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onSelect(file)
          e.target.value = ''
        }}
      />
      {image ? (
        <div className="overflow-hidden rounded-panel bg-surface">
          <div className="relative grid max-h-80 place-items-center overflow-hidden bg-ink">
            <img src={image.url} alt="올린 쇼핑몰 캡처" className="max-h-80 w-full object-contain" />
            {loading && (
              <div aria-hidden className="absolute inset-0 overflow-hidden bg-ink/40">
                <div className="h-full animate-scan border-b-4 border-tag bg-linear-to-b from-transparent to-tag/35" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Button onClick={onAnalyze} disabled={loading} className="flex-1 whitespace-nowrap">
              <ScanText aria-hidden className="size-5" />
              {loading ? '읽는 중…' : '상품 정보 읽기'}
            </Button>
            <Button variant="outline" aria-label="다른 이미지로 교체" className="px-4" onClick={() => input.current?.click()}>
              <RefreshCw aria-hidden className="size-5" />
            </Button>
            <Button variant="outline" aria-label="이미지 삭제" className="px-4" onClick={onRemove}>
              <Trash2 aria-hidden className="size-5" />
            </Button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            'flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-panel border-2 border-dashed bg-surface p-5 text-center transition-colors',
            'peer-focus-visible:outline-3 peer-focus-visible:outline-cobalt',
            over ? 'border-cobalt bg-cobalt-wash' : 'border-ink-soft/50 hover:border-cobalt',
          )}
        >
          <motion.span
            aria-hidden
            animate={over ? { y: -8, rotate: -6, scale: 1.12 } : { y: 0, rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            className="grid size-14 place-items-center rounded-full bg-cobalt text-white"
          >
            <ImageUp className="size-7" />
          </motion.span>
          <span className="mt-3 font-bold">{over ? '여기에 놓으세요' : '캡처 이미지 선택'}</span>
          <span className="mt-1 text-sm text-ink-soft">JPG, PNG, WebP 한 장, 5MB 이하</span>
        </label>
      )}
    </div>
  )
}
