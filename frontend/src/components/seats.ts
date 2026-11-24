export const SEAT_BG = ['bg-seat-0', 'bg-seat-1', 'bg-seat-2', 'bg-seat-3'] as const
export const SEAT_TEXT = ['text-seat-0', 'text-seat-1', 'text-seat-2', 'text-seat-3'] as const

export const seatName = (seat: number) => (seat === 0 ? '방장' : `참여자 ${seat}`)
