import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import { AnalysisProvider } from './context/AnalysisContext'
import Dashboard from './pages/Dashboard'
import Lighthouse from './pages/Lighthouse'
import NotFound from './pages/NotFound'
import TTFB from './pages/TTFB'
import Uptime from './pages/Uptime'
import { API_URL } from './services/api'

function AppRoutes() {
  const location = useLocation()

  return (
    // Keyed by route so navigating away clears a failed render.
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ttfb" element={<TTFB />} />
        <Route path="/lighthouse" element={<Lighthouse />} />
        <Route path="/uptime" element={<Uptime />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AnalysisProvider>
        <div className="app">
          <Navbar />

          <div className="app__body">
            <Sidebar />

            <main className="app__main">
              <AppRoutes />

              <footer className="app__footer">
                <span>WebAudit · TTFB, Lighthouse and uptime in one place</span>
                <span className="app__footer-endpoint">API {API_URL}</span>
              </footer>
            </main>
          </div>
        </div>
      </AnalysisProvider>
    </BrowserRouter>
  )
}

export default App
