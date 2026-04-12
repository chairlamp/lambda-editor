import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Wifi, WifiOff, Loader2, History, ArrowLeft, Bot, Eye, Lock, Link, Copy, Check, Trash2, Plus, X, Users } from 'lucide-react'
import { useStore, Presence } from '../store/useStore'
import { authApi, docsApi, projectsApi } from '../services/api'

interface Props {
  onToggleAI: () => void
  onTogglePreview: () => void
  showAI: boolean
  showPreview: boolean
  showVersionHistory: boolean
  onToggleVersionHistory: () => void
  projectId?: string
  readOnly?: boolean
  isLatexDoc?: boolean
  isEditableDoc?: boolean
}

interface Invite {
  id: string
  project_id: string
  token: string
  role: string
  label: string
}

interface Member {
  user_id: string
  username: string
  email: string
  role: string
}

function Avatar({ p }: { p: Presence }) {
  return (
    <div title={`${p.username}${p.read_only ? ' (viewer)' : ''}`} style={{
      width: 26, height: 26, borderRadius: '50%',
      background: p.color, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 11, fontWeight: 700,
      color: '#fff', border: '2px solid #1e1e3e', marginLeft: -6,
      opacity: p.read_only ? 0.6 : 1,
    }}>
      {p.username[0].toUpperCase()}
    </div>
  )
}

export default function Toolbar({
  onToggleAI, onTogglePreview, showAI, showPreview,
  showVersionHistory, onToggleVersionHistory,
  projectId, readOnly, isLatexDoc = true, isEditableDoc = true,
}: Props) {
  const navigate = useNavigate()
  const { currentDoc, currentProject, user, isConnected, presence, logout } = useStore()
  const [saving, setSaving] = useState(false)
  const [showInvites, setShowInvites] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor')
  const [inviteLabel, setInviteLabel] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const saveDoc = async () => {
    if (!currentDoc || !projectId || saving || readOnly) return
    setSaving(true)
    try {
      await docsApi.update(projectId, currentDoc.id, { content: currentDoc.content })
    } finally {
      setSaving(false)
    }
  }

  const openInvites = async () => {
    setShowInvites(true)
    if (!projectId) return
    const r = await projectsApi.listInvites(projectId)
    setInvites(r.data)
  }

  const createInvite = async () => {
    if (!projectId || inviteLoading || invites.length >= 3) return
    setInviteLoading(true)
    try {
      const r = await projectsApi.createInvite(projectId, inviteRole, inviteLabel.trim())
      setInvites((prev) => [...prev, r.data])
      setInviteLabel('')
    } finally {
      setInviteLoading(false)
    }
  }

  const deleteInvite = async (id: string) => {
    if (!projectId) return
    await projectsApi.deleteInvite(projectId, id)
    setInvites((prev) => prev.filter((i) => i.id !== id))
  }

  const copyInvite = async (inv: Invite) => {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inv.token}`)
    setCopiedId(inv.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const openMembers = async () => {
    if (!projectId) return
    setShowMembers(true)
    setMembersLoading(true)
    try {
      const r = await projectsApi.listMembers(projectId)
      setMembers(r.data)
    } finally {
      setMembersLoading(false)
    }
  }

  const updateMemberRole = async (memberId: string, role: string) => {
    if (!projectId) return
    await projectsApi.updateMemberRole(projectId, memberId, role)
    setMembers((prev) => prev.map((m) => m.user_id === memberId ? { ...m, role } : m))
  }

  const removeMember = async (memberId: string) => {
    if (!projectId) return
    await projectsApi.removeMember(projectId, memberId)
    setMembers((prev) => prev.filter((m) => m.user_id !== memberId))
  }

  const signOut = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
    }
  }

  const isOwner = currentProject?.my_role === 'owner'

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
        height: 48, background: '#0f0f23', borderBottom: '1px solid #1e1e3a',
        flexShrink: 0,
      }}>
        {projectId && (
          <button onClick={() => navigate('/projects')} style={iconBtnStyle} title="Back to projects">
            <ArrowLeft size={15} />
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {currentProject && (
            <>
              <span style={{ color: '#6b7280', cursor: 'pointer' }} onClick={() => navigate('/projects')}>
                {currentProject.title}
              </span>
              <span style={{ color: '#3a3a5a' }}>/</span>
            </>
          )}
          <span style={{
            color: '#c7d2fe', fontWeight: 600,
            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {currentDoc?.title || 'No document open'}
          </span>
          {currentDoc && (
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 999,
              background: currentDoc.kind === 'latex' ? '#312e81' : '#164e63',
              color: currentDoc.kind === 'latex' ? '#c7d2fe' : '#a5f3fc',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              {currentDoc.kind}
            </span>
          )}
          {readOnly && (
            <span title="Viewer — read only" style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
              <Lock size={11} />
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          {isLatexDoc ? (
            <>
              {isConnected
                ? <Wifi size={11} color="#4ade80" />
                : <WifiOff size={11} color="#f87171" />}
              <span style={{ fontSize: 11, color: isConnected ? '#4ade80' : '#f87171' }}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </>
          ) : isEditableDoc ? (
            <>
              <Eye size={11} color="#38bdf8" />
              <span style={{ fontSize: 11, color: '#38bdf8' }}>Editable file</span>
            </>
          ) : (
            <>
              <Eye size={11} color="#38bdf8" />
              <span style={{ fontSize: 11, color: '#38bdf8' }}>Static file</span>
            </>
          )}
        </div>

        {isEditableDoc && presence.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 4, paddingLeft: 6 }}>
            {presence.slice(0, 6).map((p) => <Avatar key={p.user_id} p={p} />)}
            {presence.length > 6 && (
              <div style={{ marginLeft: 4, fontSize: 11, color: '#9ca3af' }}>+{presence.length - 6}</div>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {isLatexDoc && !showPreview && (
          <button onClick={onTogglePreview} style={iconBtnStyle} title="Open PDF Preview">
            <Eye size={15} />
          </button>
        )}
        {isLatexDoc && !showAI && (
          <button onClick={onToggleAI} style={iconBtnStyle} title="Open AI Assistant">
            <Bot size={15} />
          </button>
        )}

        {isOwner && projectId && (
          <button onClick={openMembers} style={iconBtnStyle} title="Manage members">
            <Users size={15} />
          </button>
        )}

        {isOwner && projectId && (
          <button onClick={openInvites} style={iconBtnStyle} title="Manage invite links">
            <Link size={15} />
          </button>
        )}

        {isEditableDoc && !readOnly && (
          <button
            onClick={onToggleVersionHistory}
            style={{ ...iconBtnStyle, color: showVersionHistory ? '#818cf8' : '#9ca3af' }}
            title="Version history"
          >
            <History size={15} />
          </button>
        )}

        {isEditableDoc && !readOnly && (
          <button onClick={saveDoc} disabled={saving || !currentDoc} style={iconBtnStyle} title="Save">
            {saving
              ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
              : <Save size={15} />}
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', background: '#4f46e5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff',
          }}>
            {user?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}>
            Logout
          </button>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {showInvites && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowInvites(false)}>
          <div style={{
            background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 12,
            padding: 24, width: 440, maxWidth: '90vw',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#c7d2fe', margin: 0 }}>Invite links</h3>
              <button onClick={() => setShowInvites(false)} style={modalIconBtn}><X size={14} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {invites.length === 0 && (
                <div style={{ color: '#4a4a6a', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                  No invite links yet
                </div>
              )}
              {invites.map((inv) => (
                <div key={inv.id} style={{
                  background: '#0f0f23', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                        background: inv.role === 'editor' ? '#1a2a1a' : '#1a1a2a',
                        color: inv.role === 'editor' ? '#4ade80' : '#9ca3af',
                      }}>{inv.role}</span>
                      {inv.label && <span style={{ fontSize: 12, color: '#9ca3af' }}>{inv.label}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => copyInvite(inv)} style={modalIconBtn} title="Copy link">
                        {copiedId === inv.id ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => deleteInvite(inv.id)} style={{ ...modalIconBtn, color: '#f87171' }} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#4a4a6a', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {window.location.origin}/join/{inv.token}
                  </div>
                </div>
              ))}
            </div>

            {invites.length < 3 ? (
              <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                  New invite link ({invites.length}/3)
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
                    style={{
                      background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 6,
                      color: '#e2e8f0', fontSize: 13, padding: '6px 10px', cursor: 'pointer',
                    }}
                  >
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <input
                    placeholder="Label (optional)"
                    value={inviteLabel}
                    onChange={(e) => setInviteLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createInvite()}
                    style={{
                      flex: 1, background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 6,
                      padding: '6px 10px', color: '#e2e8f0', fontSize: 13, outline: 'none',
                    }}
                  />
                </div>
                <button
                  onClick={createInvite}
                  disabled={inviteLoading}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    width: '100%', padding: '8px', borderRadius: 6, border: 'none',
                    background: '#4f46e5', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {inviteLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
                  Create link
                </button>
              </div>
            ) : (
              <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 16, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                Maximum 3 invite links reached
              </div>
            )}
          </div>
        </div>
      )}

      {showMembers && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowMembers(false)}>
          <div style={{
            background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 12,
            padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#c7d2fe', margin: 0 }}>Project members</h3>
              <button onClick={() => setShowMembers(false)} style={modalIconBtn}><X size={14} /></button>
            </div>

            {membersLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                <Loader2 size={18} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.length === 0 && (
                  <div style={{ color: '#4a4a6a', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                    No members found
                  </div>
                )}
                {members.map((m) => {
                  const isSelf = m.user_id === user?.id
                  return (
                    <div key={m.user_id} style={{
                      background: '#0f0f23', border: '1px solid #1e1e3a', borderRadius: 8,
                      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: '#4f46e5',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {m.username[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
                          {m.username}{isSelf && <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>(you)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.email}
                        </div>
                      </div>
                      {isOwner && !isSelf ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            value={m.role}
                            onChange={(e) => updateMemberRole(m.user_id, e.target.value)}
                            style={{
                              background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 5,
                              color: '#e2e8f0', fontSize: 12, padding: '4px 8px', cursor: 'pointer',
                            }}
                          >
                            <option value="owner">owner</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                          <button
                            onClick={() => removeMember(m.user_id)}
                            style={{ ...modalIconBtn, color: '#f87171' }}
                            title="Remove member"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: m.role === 'owner' ? '#1a1a3a' : m.role === 'editor' ? '#1a2a1a' : '#1a1a2a',
                          color: m.role === 'owner' ? '#818cf8' : m.role === 'editor' ? '#4ade80' : '#9ca3af',
                        }}>{m.role}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#9ca3af',
  cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
}
const modalIconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 5, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
}
