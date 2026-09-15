import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="page page--centered">
      <div className="not-found">
        <p className="not-found__code">404</p>
        <h1 className="not-found__title">This page does not exist</h1>
        <p className="not-found__text">
          The route you tried does not match any analysis view. Head back to the dashboard and start
          a new run.
        </p>
        <div className="not-found__actions">
          <Link className="btn btn--primary" to="/">
            Back to dashboard
          </Link>
          <Link className="btn btn--ghost" to="/ttfb">
            Measure TTFB
          </Link>
        </div>
      </div>
    </div>
  )
}
