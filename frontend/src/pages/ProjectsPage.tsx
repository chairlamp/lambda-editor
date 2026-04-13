import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, Trash2, LogOut, Users, ArrowRight, Loader2, Link } from 'lucide-react'
import { authApi, projectsApi } from '../services/api'
import { useStore } from '../store/useStore'
import { C } from '../design'
import ThemeToggle from '../components/ThemeToggle'

export default function ProjectsPage() {
  const { user, projects, setProjects, logout } = useStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [error, setError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  useEffect(() => {
    projectsApi.list().then((r) => { setProjects(r.data); setLoading(false) })
  }, [])

  const createProject = async () => {
    if (!newTitle.trim() || createLoading) return
    setCreateLoading(true)
    try {
      const r = await projectsApi.create(newTitle.trim(), newDesc.trim())
      setProjects([r.data, ...projects])
      setNewTitle(''); setNewDesc(''); setCreating(false)
    } catch {
      setError('Failed to create project')
    } finally {
      setCreateLoading(false)
    }
  }

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this project and all its documents?')) return
    try {
      await projectsApi.delete(id)
      setProjects(projects.filter((p) => p.id !== id))
    } catch {
      setError('Failed to delete project')
    }
  }

  const joinProject = async () => {
    if (!inviteInput.trim()) return
    const token = inviteInput.trim().split('/').pop() || ''
    try {
      const r = await projectsApi.join(token)
      setProjects([r.data, ...projects.filter((p) => p.id !== r.data.id)])
      setInviteInput(''); setShowJoin(false)
    } catch {
      setError('Invalid invite link or token')
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
    <div style={{ minHeight: '100vh', background: C.bgBase, color: C.textPrimary }}>
      {/* Top nav */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
        background: C.bgRaised, borderBottom: `1px solid ${C.borderFaint}`,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.lambda }}>λ</span>
          <span style={{ width: 1, height: 14, background: C.border }} />
          <span style={{ fontSize: 13, color: C.textSecondary }}>Projects</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 7, padding: '4px 10px',
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              background: `linear-gradient(135deg, ${C.accent}, ${C.lambda})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: '#fff',
            }}>
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: C.textSecondary }}>{user?.username}</span>
          </div>
          <ThemeToggle compact />
          <button onClick={signOut} style={ghostSt}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '36px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', color: C.textPrimary }}>
              Projects
            </h1>
            {!loading && (
              <p style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={() => { setShowJoin((v) => !v); setError('') }} style={ghostSt}>
              <Link size={12} /> Join
            </button>
            <button onClick={() => { setCreating(true); setError('') }} style={primarySt}>
              <Plus size={13} /> New project
            </button>
          </div>
        </div>

        {creating && (
          <div style={{ ...cardSt, marginBottom: 14, animation: 'fadeIn 0.2s ease' }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: C.textSecondary, marginBottom: 12 }}>New project</p>
            <input autoFocus placeholder="Project title" value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              style={inputSt} />
            <textarea placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2} style={{ ...inputSt, resize: 'vertical', marginTop: 8 }} />
            <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
              <button onClick={createProject} disabled={createLoading || !newTitle.trim()} style={{
                ...primarySt, opacity: !newTitle.trim() ? 0.5 : 1,
              }}>
                {createLoading && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
                Create
              </button>
              <button onClick={() => { setCreating(false); setError('') }} style={ghostSt}>Cancel</button>
            </div>
          </div>
        )}

        {showJoin && (
          <div style={{
            ...cardSt, marginBottom: 14, animation: 'fadeIn 0.2s ease',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Users size={13} color={C.textMuted} style={{ flexShrink: 0 }} />
            <input placeholder="Paste invite link or token…" value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinProject()}
              autoFocus style={{ ...inputSt, flex: 1, margin: 0 }} />
            <button onClick={joinProject} disabled={!inviteInput.trim()} style={{
              ...primarySt, flexShrink: 0, opacity: !inviteInput.trim() ? 0.5 : 1,
            }}>Join</button>
          </div>
        )}

        {error && (
          <div style={{
            background: C.redSubtle, border: `1px solid rgba(248,113,113,0.2)`,
            borderRadius: 7, padding: '8px 12px', color: C.red, fontSize: 12, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
            <Loader2 size={18} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <FolderOpen size={32} color={C.textDisabled} strokeWidth={1.2} />
            <p style={{ fontSize: 14, color: C.textSecondary, fontWeight: 500 }}>No projects yet</p>
            <p style={{ fontSize: 12, color: C.textMuted }}>Create one to start writing collaborative LaTeX.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {projects.map((p) => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '13px 16px', borderRadius: 10,
                  background: C.bgCard, border: `1px solid ${C.borderFaint}`,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = C.border
                  e.currentTarget.style.background = C.bgHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = C.borderFaint
                  e.currentTarget.style.background = C.bgCard
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(124,106,246,0.15), rgba(157,123,232,0.06))',
                    border: `1px solid rgba(124,106,246,0.12)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <FolderOpen size={15} color={C.lambda} strokeWidth={1.5} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: C.textPrimary }}>
                      {p.title}
                    </div>
                    {p.description && (
                      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>
                        {p.description}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: roleColor(p.my_role), marginTop: 2 }}>
                      {p.my_role}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {p.my_role === 'owner' && (
                    <button title="Delete" onClick={(e) => deleteProject(p.id, e)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, borderRadius: 5,
                      border: `1px solid transparent`, background: 'transparent',
                      color: C.textMuted, cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.25)'; e.currentTarget.style.background = C.redSubtle }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <ArrowRight size={13} color={C.textMuted} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function roleColor(role: string) {
  return role === 'owner' ? C.yellow : role === 'editor' ? C.green : C.textMuted
}

const cardSt: React.CSSProperties = {
  background: C.bgCard, border: `1px solid ${C.border}`,
  borderRadius: 10, padding: '14px 16px',
}
const inputSt: React.CSSProperties = {
  width: '100%', background: C.bgBase,
  border: `1px solid ${C.border}`, borderRadius: 7,
  padding: '8px 11px', color: C.textPrimary, fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const primarySt: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '7px 13px', borderRadius: 7, border: 'none',
  background: C.accent, color: '#fff', fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
const ghostSt: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '6px 11px', borderRadius: 7, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textSecondary, fontSize: 12.5,
  cursor: 'pointer', fontFamily: 'inherit',
}
