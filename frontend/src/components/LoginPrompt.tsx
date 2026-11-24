import { LogIn } from 'lucide-react'
import { href } from '@/lib/router'

export function LoginPrompt({ text, next }: { text: string; next: string }) {
  return (
    <div className="rounded-panel bg-tag p-5">
      <p className="font-semibold">{text}</p>
      <a href={href.login(next)} className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-white">
        <LogIn aria-hidden className="size-5" />
        로그인하기
      </a>
    </div>
  )
}
