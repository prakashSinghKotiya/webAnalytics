import { ALL_REGIONS, REGION_LABELS, REGIONS } from '../services/api'

const OPTIONS = [ALL_REGIONS, ...REGIONS]

/**
 * Picks which TTFB queue a measurement is sent to.
 *
 * `All` maps to the backend's `/ttfb/findAll` route, which fans the job out to
 * the india, europe and usa queues and answers with one shared room id.
 */
export default function RegionSelect({ value, onChange, disabled = false, className = '' }) {
  return (
    <div className={`region-select ${className}`.trim()} role="group" aria-label="Region">
      {OPTIONS.map((option) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            className={`region-select__option${active ? ' region-select__option--active' : ''}`}
            onClick={() => onChange(option)}
            disabled={disabled}
            aria-pressed={active}
          >
            {option === ALL_REGIONS ? 'All regions' : REGION_LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
