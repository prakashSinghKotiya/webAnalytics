import { useState } from 'react'
import { isValidUrl, normalizeUrl } from '../services/api'

/**
 * URL entry form, controlled by the shared target in `AnalysisContext` so all
 * pages keep working with the same URL.
 *
 * `children` is rendered as a second row inside the form — used for the region
 * picker — so anything placed there also submits on Enter.
 */
export default function UrlInput({
  value = '',
  onChange,
  onSubmit,
  children,
  loading = false,
  disabled = false,
  placeholder = 'example.com',
  autoFocus = false,
  submitLabel = 'Analyze',
  compact = false,
}) {
  const [error, setError] = useState(null)
  const busy = loading || disabled

  const handleSubmit = (event) => {
    event.preventDefault()
    if (busy) return

    const trimmed = value.trim()
    if (!trimmed) {
      setError('Enter a URL first.')
      return
    }
    if (!isValidUrl(trimmed)) {
      setError('That does not look like a valid URL.')
      return
    }

    setError(null)
    onSubmit?.(normalizeUrl(trimmed))
  }

  const handleChange = (event) => {
    onChange?.(event.target.value)
    if (error) setError(null)
  }

  return (
    <form
      className={`url-input${compact ? ' url-input--compact' : ''}`}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className={`url-input__field${error ? ' url-input__field--invalid' : ''}`}>
        <svg className="url-input__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5 0 4-4 4-9s-1.5-9-4-9-4 4-4 9 1.5 9 4 9ZM3.5 9h17m-17 6h17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        <input
          type="url"
          className="url-input__control"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={busy}
          spellCheck="false"
          autoComplete="url"
          aria-label="Website URL"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'url-input-error' : undefined}
        />

        {value ? (
          <button
            type="button"
            className="url-input__clear"
            onClick={() => {
              onChange?.('')
              setError(null)
            }}
            disabled={busy}
            aria-label="Clear URL"
          >
            ×
          </button>
        ) : null}
      </div>

      <button type="submit" className="btn btn--primary url-input__submit" disabled={busy}>
        {loading ? (
          <>
            <span className="loading__spinner loading__spinner--sm" aria-hidden="true" />
            Working
          </>
        ) : (
          submitLabel
        )}
      </button>

      {children ? <div className="url-input__extras">{children}</div> : null}

      {error ? (
        <p className="url-input__error" id="url-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
