/** http 주소에서도 쓸 수 있는 임의 id. randomUUID 는 보안 컨텍스트에서만 동작한다. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
