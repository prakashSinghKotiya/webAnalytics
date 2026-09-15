/**
 * Single loading primitive used across the app.
 *
 * - `inline`    keeps it on the same line as text (buttons, table cells)
 * - `fullscreen` centers it inside the viewport for route-level waits
 */
export default function Loading({
  size = 'md',
  label,
  inline = false,
  fullscreen = false,
  className = '',
}) {
  const classes = [
    'loading',
    `loading--${size}`,
    inline ? 'loading--inline' : '',
    fullscreen ? 'loading--fullscreen' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <span className="loading__spinner" aria-hidden="true" />
      {label ? <span className="loading__label">{label}</span> : null}
      <span className="sr-only">{label || 'Loading'}</span>
    </div>
  )
}
