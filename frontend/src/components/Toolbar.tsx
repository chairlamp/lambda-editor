import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Wifi, WifiOff, Loader2, History, ArrowLeft, Bot, Eye, Lock, Link, Copy, Check, Trash2, Plus, X, Users, UserPlus, CloudOff, Cloud, AlertTriangle } from 'lucide-react'
import { useStore, Presence } from '../store/useStore'
import { authApi, docsApi, projectsApi } from '../services/api'
import { C } from '../design'
import ThemeToggle from './ThemeToggle'
import { createSaveFingerprint, saveEventMatchesContent } from '../utils/save-state'

interface Props {
  onToggleAI: () => void
  showAI: boolean
  showVersionHistory: boolean
  onToggleVersionHistory: () => void
  projectId?: string
  readOnly?: boolean
  isLatexDoc?: boolean
  isEditableDoc?: boolean
  viewMode?: 'editor' | 'split' | 'preview'
  onChangeViewMode?: (mode: 'editor' | 'split' | 'preview') => void
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
      width: 24, height: 24, borderRadius: '50%',
      background: p.color, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 10, fontWeight: 700,
      color: '#fff', border: `2px solid ${C.bgRaised}`, marginLeft: -6,
      opacity: p.read_only ? 0.5 : 1, flexShrink: 0,
    }}>
      {p.username[0].toUpperCase()}
    </div>
  )
}

export default function Toolbar({
  onToggleAI, showAI,
  showVersionHistory, onToggleVersionHistory,
  projectId, readOnly, isLatexDoc = true, isEditableDoc = true,
  viewMode, onChangeViewMode,
}: Props) {
  const navigate = useNavigate()
  const { currentDoc, currentProject, user, isConnected, presence, logout, saveStatus, saveError, typingUsers, setSaveState, updateDocSyncState } = useStore()
  const [saving, setSaving] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberInput, setAddMemberInput] = useState('')
  const [addMemberRole, setAddMemberRole] = useState<'editor' | 'viewer'>('editor')
  const [addMemberLoading, setAddMemberLoading] = useState(false)
  const [addMemberError, setAddMemberError] = useState<string | null>(null)
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
    setSaveState('saving')
    try {
      const response = await docsApi.update(projectId, currentDoc.id, { content: currentDoc.content })
      const fingerprint = createSaveFingerprint(response.data.content || '')
      updateDocSyncState({
        content_revision: response.data.content_revision,
        updated_at: response.data.updated_at,
      })
      if (saveEventMatchesContent(useStore.getState().currentDoc?.content || '', {
        content_hash: fingerprint.contentHash,
        content_length: fingerprint.contentLength,
      })) {
        setSaveState('saved')
      }
    } catch (err: any) {
      setSaveState('error', err?.response?.data?.detail || 'Could not persist document changes.')
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

  const addMemberDirect = async () => {
    if (!projectId || !addMemberInput.trim() || addMemberLoading) return
    setAddMemberLoading(true)
    setAddMemberError(null)
    try {
      const r = await projectsApi.addMember(projectId, addMemberInput.trim(), addMemberRole)
      setMembers((prev) => [...prev, r.data])
      setAddMemberInput('')
      setShowAddMember(false)
    } catch (err: any) {
      setAddMemberError(err?.response?.data?.detail || 'Failed to add member')
    } finally {
      setAddMemberLoading(false)
    }
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
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px',
        height: 46, background: C.bgRaised, borderBottom: `1px solid ${C.borderFaint}`,
        flexShrink: 0,
      }}>
        {/* Back + breadcrumb */}
        {projectId && (
          <button onClick={() => navigate('/projects')} style={iconBtn} title="Back to projects">
            <ArrowLeft size={14} />
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, minWidth: 0 }}>
          {currentProject && (
            <>
              <span
                style={{ color: C.textMuted, cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => navigate('/projects')}
              >
                {currentProject.title}
              </span>
              <span style={{ color: C.borderStrong }}>/</span>
            </>
          )}
          <span style={{
            color: C.textPrimary, fontWeight: 500,
            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {currentDoc?.title || 'No document open'}
          </span>
          {currentDoc && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: currentDoc.kind === 'latex' ? C.accentSubtle : C.blueSubtle,
              color: currentDoc.kind === 'latex' ? C.accent : C.blue,
              border: `1px solid ${currentDoc.kind === 'latex' ? C.accentBorder : 'rgba(96,165,250,0.25)'}`,
              textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
            }}>
              {currentDoc.kind}
            </span>
          )}
          {readOnly && (
            <span title="Viewer — read only" style={{ display: 'flex', alignItems: 'center' }}>
              <Lock size={10} color={C.textMuted} />
            </span>
          )}
        </div>

        {/* Connection + save status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
          {isLatexDoc ? (
            <>
              {isConnected
                ? <Wifi size={10} color={C.green} />
                : <WifiOff size={10} color={C.red} />}
              <span style={{ fontSize: 11, color: isConnected ? C.green : C.red }}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </>
          ) : isEditableDoc ? (
            <>
              <Eye size={10} color={C.blue} />
              <span style={{ fontSize: 11, color: C.blue }}>Editable</span>
            </>
          ) : (
            <>
              <Eye size={10} color={C.textMuted} />
              <span style={{ fontSize: 11, color: C.textMuted }}>Static</span>
            </>
          )}
        </div>

        {isEditableDoc && !readOnly && saveStatus !== 'idle' && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 3 }}
            title={saveStatus === 'error' ? (saveError || 'Could not persist document changes.') : undefined}
          >
            {saveStatus === 'saving'
              ? <><CloudOff size={10} color={C.textMuted} /><span style={{ fontSize: 10.5, color: C.textMuted }}>Saving…</span></>
              : saveStatus === 'error'
                ? <><AlertTriangle size={10} color={C.red} /><span style={{ fontSize: 10.5, color: C.red }}>Save failed</span></>
                : <><Cloud size={10} color={C.green} /><span style={{ fontSize: 10.5, color: C.green }}>Saved</span></>
            }
          </div>
        )}

        {typingUsers.length > 0 && (
          <div style={{
            fontSize: 10.5, color: C.accent, fontStyle: 'italic',
            maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {typingUsers.map((u) => u.username).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}

        {/* Presence avatars */}
        {isEditableDoc && presence.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 2, paddingLeft: 6 }}>
            {presence.slice(0, 6).map((p) => <Avatar key={p.user_id} p={p} />)}
            {presence.length > 6 && (
              <span style={{ marginLeft: 6, fontSize: 10.5, color: C.textMuted }}>+{presence.length - 6}</span>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {isLatexDoc && viewMode && onChangeViewMode && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: 3,
            borderRadius: 9,
            border: `1px solid ${C.border}`,
            background: C.bgBase,
          }}>
            {([
              ['editor', 'Code'],
              ['split', 'Split'],
              ['preview', 'Preview'],
            ] as const).map(([mode, label]) => {
              const active = viewMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => onChangeViewMode(mode)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 7,
                    border: 'none',
                    background: active ? C.accentSubtle : 'transparent',
                    color: active ? C.accent : C.textSecondary,
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {/* Action buttons */}
        {isLatexDoc && !showAI && (
          <button onClick={onToggleAI} style={iconBtn} title="Open AI Assistant">
            <Bot size={14} />
          </button>
        )}

        {isOwner && projectId && (
          <button onClick={openMembers} style={iconBtn} title="Manage members">
            <Users size={14} />
          </button>
        )}
        {isOwner && projectId && (
          <button
            onClick={() => { setShowAddMember(true); setAddMemberError(null); setAddMemberInput('') }}
            style={iconBtn} title="Add member by username or email"
          >
            <UserPlus size={14} />
          </button>
        )}
        {isOwner && projectId && (
          <button onClick={openInvites} style={iconBtn} title="Manage invite links">
            <Link size={14} />
          </button>
        )}

        {isEditableDoc && !readOnly && (
          <button
            onClick={onToggleVersionHistory}
            style={{ ...iconBtn, color: showVersionHistory ? C.accent : C.textSecondary }}
            title="Version history"
          >
            <History size={14} />
          </button>
        )}

        {isEditableDoc && !readOnly && (
          <button onClick={saveDoc} disabled={saving || !currentDoc} style={iconBtn} title="Save">
            {saving
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              : <Save size={14} />}
          </button>
        )}

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: 4 }}>
          <ThemeToggle compact />
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.accent}, ${C.lambda})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#fff',
          }}>
            {user?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <button onClick={signOut} style={{
            background: 'none', border: 'none', color: C.textMuted, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* ── Invite links modal ── */}
      {showInvites && (
        <div style={overlay} onClick={() => setShowInvites(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3 style={modalTitle}>Invite links</h3>
              <button onClick={() => setShowInvites(false)} style={iconBtn}><X size={13} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {invites.length === 0 && (
                <div style={{ color: C.textMuted, fontSize: 12.5, textAlign: 'center', padding: '14px 0' }}>
                  No invite links yet
                </div>
              )}
              {invites.map((inv) => (
                <div key={inv.id} style={{
                  background: C.bgBase, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '10px 13px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={roleBadge(inv.role)}>{inv.role}</span>
                      {inv.label && <span style={{ fontSize: 12, color: C.textSecondary }}>{inv.label}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => copyInvite(inv)} style={iconBtn} title="Copy link">
                        {copiedId === inv.id ? <Check size={12} color={C.green} /> : <Copy size={12} />}
                      </button>
                      <button onClick={() => deleteInvite(inv.id)} style={{ ...iconBtn, color: C.red }} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {window.location.origin}/join/{inv.token}
                  </div>
                </div>
              ))}
            </div>

            {invites.length < 3 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 10 }}>New invite ({invites.length}/3)</div>
                <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')} style={selectSt}>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <input
                    placeholder="Label (optional)" value={inviteLabel}
                    onChange={(e) => setInviteLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createInvite()}
                    style={{ ...inputSt, flex: 1 }}
                  />
                </div>
                <button onClick={createInvite} disabled={inviteLoading} style={primaryBtn}>
                  {inviteLoading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={12} />}
                  Create link
                </button>
              </div>
            ) : (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
                Maximum 3 invite links reached
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add member modal ── */}
      {showAddMember && (
        <div style={overlay} onClick={() => setShowAddMember(false)}>
          <div style={{ ...modalCard, width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3 style={modalTitle}>Add member</h3>
              <button onClick={() => setShowAddMember(false)} style={iconBtn}><X size={13} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                placeholder="Username or email" value={addMemberInput}
                onChange={(e) => { setAddMemberInput(e.target.value); setAddMemberError(null) }}
                onKeyDown={(e) => e.key === 'Enter' && addMemberDirect()}
                autoFocus style={inputSt}
              />
              <select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value as 'editor' | 'viewer')} style={selectSt}>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              {addMemberError && (
                <div style={{ fontSize: 12, color: C.red, background: C.redSubtle, border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 6, padding: '6px 10px' }}>
                  {addMemberError}
                </div>
              )}
              <button
                onClick={addMemberDirect}
                disabled={addMemberLoading || !addMemberInput.trim()}
                style={{ ...primaryBtn, opacity: !addMemberInput.trim() ? 0.5 : 1 }}
              >
                {addMemberLoading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <UserPlus size={12} />}
                Add member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Members modal ── */}
      {showMembers && (
        <div style={overlay} onClick={() => setShowMembers(false)}>
          <div style={{ ...modalCard, width: 460, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3 style={modalTitle}>Project members</h3>
              <button onClick={() => setShowMembers(false)} style={iconBtn}><X size={13} /></button>
            </div>

            {membersLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
                <Loader2 size={16} color={C.accent} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.length === 0 && (
                  <div style={{ color: C.textMuted, fontSize: 12.5, textAlign: 'center', padding: '14px 0' }}>No members found</div>
                )}
                {members.map((m) => {
                  const isSelf = m.user_id === user?.id
                  return (
                    <div key={m.user_id} style={{
                      background: C.bgBase, border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: '10px 13px',
                      display: 'flex', alignItems: 'center', gap: 11,
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${C.accent}, ${C.lambda})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {m.username[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>
                          {m.username}
                          {isSelf && <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 11, marginLeft: 5 }}>(you)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                      </div>
                      {isOwner && !isSelf ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select value={m.role} onChange={(e) => updateMemberRole(m.user_id, e.target.value)} style={selectSt}>
                            <option value="owner">owner</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                          <button onClick={() => removeMember(m.user_id)} style={{ ...iconBtn, color: C.red }} title="Remove">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <span style={roleBadge(m.role)}>{m.role}</span>
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

function roleBadge(role: string): React.CSSProperties {
  const color = role === 'owner' ? C.yellow : role === 'editor' ? C.green : C.textMuted
  const bg = role === 'owner' ? C.yellowSubtle : role === 'editor' ? C.greenSubtle : 'transparent'
  return {
    fontSize: 10.5, padding: '2px 7px', borderRadius: 999, fontWeight: 600,
    background: bg, color,
    border: `1px solid ${color}30`,
  }
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modalCard: React.CSSProperties = {
  background: C.bgCard, border: `1px solid ${C.border}`,
  borderRadius: 12, padding: 22, width: 440, maxWidth: '90vw',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
}
const modalHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18,
}
const modalTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: C.textPrimary, margin: 0,
}
const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textSecondary, cursor: 'pointer',
  transition: 'all 0.12s', flexShrink: 0,
}
const inputSt: React.CSSProperties = {
  width: '100%', background: C.bgBase, border: `1px solid ${C.border}`,
  borderRadius: 7, padding: '8px 11px', color: C.textPrimary, fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const selectSt: React.CSSProperties = {
  background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 7,
  color: C.textPrimary, fontSize: 13, padding: '7px 10px',
  cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%', padding: '9px', borderRadius: 7, border: 'none',
  background: C.accent, color: '#fff', fontSize: 13, cursor: 'pointer',
  fontWeight: 500, fontFamily: 'inherit',
}
