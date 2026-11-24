import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { NumberInput } from './Field'

function Probe() {
  const [v, setV] = useState<number | null>(4830)
  return (
    <>
      <NumberInput aria-label="금액" value={v} onValue={setV} />
      <output>{String(v)}</output>
    </>
  )
}

it('탭으로 들어가 입력하면 기존 금액을 바꾼다', async () => {
  const user = userEvent.setup()
  render(<Probe />)
  await user.tab()
  await user.keyboard('2000')
  expect(screen.getByRole('status')).toHaveTextContent(/^2000$/)
  await user.tab()
  expect(screen.getByLabelText('금액')).toHaveValue('2,000')
})

it('이어서 입력하는 동안에는 다시 선택하지 않는다', async () => {
  const user = userEvent.setup()
  render(<Probe />)
  await user.click(screen.getByLabelText('금액'))
  await user.keyboard('1')
  await user.keyboard('2')
  await user.keyboard('{Backspace}5')
  expect(screen.getByRole('status')).toHaveTextContent(/^15$/)
})
