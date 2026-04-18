import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from './store/useStore'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import EditorPage from './pages/EditorPage'
import { authApi, projectsApi, refreshAuthSession } from './services/api'
import { C, applyTheme } from './design'

function FullPageMessage({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: C.bgBase,
      color: C.textSecondary,
      fontSize: 14,
    }}>
      {message}
    </div>
  )
}

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { token, setAuthReady, setUser, logout } = useStore()

  useEffect(() => {
    let cancelled = false
    setAuthReady(false)

    authApi.me()
      .then((res) => {
        if (!cancelled) {
          setUser(res.data, 'session')
        }
      })
      .catch(() => {
        if (!cancelled) {
          logout()
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [logout, setAuthReady, setUser])

  useEffect(() => {
    if (!token) return

    const intervalId = window.setInterval(() => {
      void refreshAuthSession()
    }, 12 * 60 * 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [token])

  return <>{children}</>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, authReady } = useStore()
  if (!authReady) return <FullPageMessage message="Restoring session…" />
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Resolve invite links immediately so shared URLs can drop users into the project flow.
function JoinPage() {
  const { token: inviteToken } = useParams<{ token: string }>()
  const { token: authToken } = useStore()

  useEffect(() => {
    if (!inviteToken) return
    if (!authToken) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
      return
    }
    projectsApi.join(inviteToken)
      .then((r) => { window.location.href = `/projects/${r.data.id}` })
      .catch(() => { window.location.href = '/projects' })
  }, [inviteToken, authToken])

  return (
    <div style={{ minHeight: '100vh', background: C.bgBase, color: C.textPrimary, padding: 40, textAlign: 'center' }}>
      Joining project…
    </div>
  )
}

export default function App() {
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <BrowserRouter>
      <AuthBootstrap>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
          <Route path="/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
          <Route path="/projects/:projectId" element={<RequireAuth><ProjectPage /></RequireAuth>} />
          <Route
            path="/projects/:projectId/docs/:docId"
            element={<RequireAuth><EditorPage /></RequireAuth>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthBootstrap>
    </BrowserRouter>
  )
}
