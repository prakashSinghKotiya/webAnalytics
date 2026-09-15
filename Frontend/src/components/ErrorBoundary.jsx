import { Component } from 'react'

/**
 * Keeps a render error inside the page that caused it.
 *
 * Queue results come from a separate codebase, so an unexpected payload shape
 * used to unmount the whole app. Here the failing route shows what happened and
 * the nav/sidebar keep working; navigating away resets the boundary.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <div className="page">
        <div className="alert alert--error" role="alert">
          <strong>This page could not be rendered.</strong>
          <span>{error.message || String(error)}</span>
        </div>

        <div className="panel">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">What to do</h2>
              <p className="panel__subtitle">
                The data behind this page did not match what the UI expects, so it was left out
                instead of taking the whole app down. Retrying re-runs the request.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>

          {error.stack ? <pre className="error-details">{error.stack}</pre> : null}
        </div>
      </div>
    )
  }
}
