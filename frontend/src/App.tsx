import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from './store/useStore'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import EditorPage from './pages/EditorPage'
import { projectsApi } from './services/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useStore()
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

  return <div style={{ color: '#e2e8f0', padding: 40, textAlign: 'center' }}>Joining project…</div>
}

export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  )
}
