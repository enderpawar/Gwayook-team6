import { Field, NumberInput, controlClass } from '@/components/ui/Field'
import type { Measure } from '@/domain/types'

const MEASURES: { value: Measure; label: string }[] = [
  { value: 'count', label: '개수' },
  { value: 'ml', label: 'ml' },
  { value: 'g', label: 'g' },
  { value: 'm', label: 'm' },
]

interface MeasureProps {
  label: string
  measure: Measure
  net: number | null
  unitName: string
  unresolved?: boolean
  error?: string
  onMeasure: (m: Measure) => void
  onNet: (n: number | null) => void
}

export function MeasureFields({ label, measure, net, unitName, unresolved, error, onMeasure, onNet }: MeasureProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={label}>
        {(a) => (
          <select {...a} className={`${controlClass} select-chevron`} value={measure} onChange={(e) => onMeasure(e.target.value as Measure)}>
            {MEASURES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.value === 'count' ? '개수로 비교' : `${m.label} 단위로 비교`}
              </option>
            ))}
          </select>
        )}
      </Field>
      {measure !== 'count' && (
        <Field label={`1${unitName || '개'}의 양`} unresolved={unresolved} error={error}>
          {(a) => <NumberInput {...a} decimal suffix={measure} value={net} onValue={onNet} />}
        </Field>
      )}
    </div>
  )
}
