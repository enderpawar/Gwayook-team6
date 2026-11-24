/** 나누는 단위를 그린 아이콘. 색은 currentColor 를 따른다. */
export function UnitIcon({ unit, className }: { unit: string; className?: string }) {
  const u = unit.trim()
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      {u === '롤' ? <Roll /> : u === '병' ? <Bottle /> : u === '팩' || u === '봉' ? <Pouch /> : <Box />}
    </svg>
  )
}

const Roll = () => (
  <>
    <path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Z" opacity=".28" />
    <path
      fillRule="evenodd"
      d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Zm0 5a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z"
    />
  </>
)

const Bottle = () => (
  <>
    <rect x="9.2" y="1" width="5.6" height="3.4" rx="1" />
    <path d="M9.4 5.4h5.2c.2 2 3 2.8 3 5.6v9.4c0 1.4-1 2.4-2.4 2.4H8.8c-1.4 0-2.4-1-2.4-2.4V11c0-2.8 2.8-3.6 3-5.6Z" opacity=".35" />
    <path d="M6.4 11.6h11.2v6H6.4z" />
  </>
)

const Pouch = () => (
  <>
    <path d="M14.6 1.2h4v3.4h-4z" />
    <path d="M5 4.6h14l1 16.2c.1 1.1-.7 2-1.8 2H5.8c-1.100 0-1.900-.9-1.800-2Z" opacity=".35" />
    <path d="M12 9.400c2 2.500 3.300 4.100 3.300 6a3.300 3.300 0 0 1-6.600 0c0-1.900 1.300-3.500 3.300-6Z" />
  </>
)

const Box = () => (
  <>
    <path d="M2.600 7.400 12 2.200l9.400 5.200v9.200L12 21.800l-9.400-5.200Z" opacity=".32" />
    <path d="M2.600 7.400 12 12.600l9.400-5.200v2.400L12 15 2.600 9.800Z" />
  </>
)
