import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, Trash2, LogOut, Users } from 'lucide-react'
import { authApi, projectsApi } from '../services/api'
import { useStore } from '../store/useStore'

export default function ProjectsPage() {
  const { user, projects, setProjects, logout } = useStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    projectsApi.list().then((r) => { setProjects(r.data); setLoading(false) })
  }, [])

  const createProject = async () => {
    if (!newTitle.trim()) return
    try {
      const r = await projectsApi.create(newTitle.trim(), newDesc.trim())
      setProjects([r.data, ...projects])
      setNewTitle('')
      setNewDesc('')
      setCreating(false)
    } catch {
      setError('Failed to create project')
    }
  }

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project and all its documents?')) return
    await projectsApi.delete(id)
    setProjects(projects.filter((p) => p.id !== id))
  }

  const joinProject = async () => {
    if (!inviteInput.trim()) return
    // Accept pasted links as well as bare tokens so sharing works across chat and email.
    const token = inviteInput.trim().split('/').pop() || ''
    try {
      const r = await projectsApi.join(token)
      setProjects([r.data, ...projects.filter((p) => p.id !== r.data.id)])
      setInviteInput('')
    } catch {
      setError('Invalid invite link')
    }
  }

  const signOut = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f23', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px', background: '#16213e', borderBottom: '1px solid #1e1e3a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#818cf8' }}>λ Editor</span>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Projects</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>{user?.username}</span>
          <button onClick={signOut} style={ghostBtn}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#c7d2fe' }}>My Projects</h1>
          <button onClick={() => setCreating(true)} style={primaryBtn}>
            <Plus size={14} /> New project
          </button>
        </div>

        {creating && (
          <div style={card}>
            <h3 style={{ color: '#a5b4fc', marginBottom: 12, fontSize: 14 }}>New Project</h3>
            <input
              autoFocus
              placeholder="Project title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              style={inputStyle}
            />
            <textarea
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', marginTop: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={createProject} style={primaryBtn}>Create</button>
              <button onClick={() => setCreating(false)} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
          <Users size={14} color="#6b7280" />
          <input
            placeholder="Paste invite link to join a project…"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinProject()}
            style={{ ...inputStyle, flex: 1, margin: 0 }}
          />
          <button onClick={joinProject} style={primaryBtn} disabled={!inviteInput.trim()}>Join</button>
        </div>

        {error && (
          <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ color: '#4a4a6a', textAlign: 'center', marginTop: 60 }}>Loading…</div>
        ) : projects.length === 0 ? (
          <div style={{ color: '#4a4a6a', textAlign: 'center', marginTop: 60 }}>
            No projects yet. Create one to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map((p) => (
              <div
                key={p.id}
                style={{
                  ...card,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                onClick={() => navigate(`/projects/${p.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#1e1e3a')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <FolderOpen size={18} color="#818cf8" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#e2e8f0' }}>{p.title}</div>
                    {p.description && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{p.description}</div>
                    )}
                    <div style={{ fontSize: 11, color: '#4a4a6a', marginTop: 3 }}>
                      Role: <span style={{ color: roleColor(p.my_role) }}>{p.my_role}</span>
                    </div>
                  </div>
                </div>

                {p.my_role === 'owner' && (
                  <button
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); deleteProject(p.id) }}
                    style={{ ...iconBtn, color: '#f87171' }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function roleColor(role: string) {
  return role === 'owner' ? '#fbbf24' : role === 'editor' ? '#4ade80' : '#9ca3af'
}

const card: React.CSSProperties = {
  background: '#16213e', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 20px',
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 6,
  padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
  borderRadius: 6, border: 'none', background: '#4f46e5', color: '#fff',
  fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  borderRadius: 6, border: '1px solid #2a2a4a', background: 'transparent',
  color: '#9ca3af', fontSize: 13, cursor: 'pointer',
}
const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 5, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
}
