export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp'

export type ImageCheck = { ok: true } | { ok: false; message: string }

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b)

/** 확장자나 MIME 이 아니라 실제 파일 머리글로 형식을 확인한다. */
export function sniffImage(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp'
  }
  return null
}

export async function checkImage(file: File): Promise<ImageCheck> {
  if (file.size === 0) return { ok: false, message: '빈 파일이에요. 다른 이미지를 골라 주세요.' }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: '5MB 이하 이미지만 올릴 수 있어요. 필요한 부분만 잘라 다시 올려 주세요.' }
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (!sniffImage(head)) {
    return { ok: false, message: 'JPG, PNG, WebP 이미지만 읽을 수 있어요.' }
  }
  return { ok: true }
}
