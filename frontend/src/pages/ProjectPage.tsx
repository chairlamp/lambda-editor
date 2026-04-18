import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, FilePlus, Trash2, FileText, Users, Copy, Check,
  Shield, Eye, Edit3, Crown, Link, Plus, Upload, X,
} from 'lucide-react'
import { projectsApi, docsApi } from '../services/api'
import { ProjectSocket } from '../services/socket'
import { useStore, Document, Project } from '../store/useStore'
import { C } from '../design'
import ThemeToggle from '../components/ThemeToggle'

interface Member {
  user_id: string
  username: string
  email: string
  role: string
}

interface Invite {
  id: string
  project_id: string
  token: string
  role: string
  label: string
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { token, user, currentProject, setCurrentProject, documents, setDocuments, upsertDocument, removeDocument } = useStore()

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const [showInvitePanel, setShowInvitePanel] = useState(false)
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [newDocTitle, setNewDocTitle] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [newInviteRole, setNewInviteRole] = useState<'editor' | 'viewer'>('editor')
  const [newInviteLabel, setNewInviteLabel] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!projectId) return
    projectsApi.get(projectId)
      .then((r) => {
        const project: Project = r.data
        setCurrentProject(project)
        // Prefer the main document immediately so project links land in an editable file.
        if (project.main_doc_id) {
          navigate(`/projects/${projectId}/docs/${project.main_doc_id}`, { replace: true })
        }
      })
      .catch(() => navigate('/'))
    docsApi.list(projectId).then((r) => { setDocuments(r.data); setLoadingDocs(false) })
    projectsApi.listMembers(projectId).then((r) => setMembers(r.data))
  }, [projectId, navigate, setCurrentProject, setDocuments])

  useEffect(() => {
    if (!projectId || !token) return
    const socket = new ProjectSocket(projectId, token)
    const offs = [
      socket.on('document_created', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_updated', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_deleted', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) removeDocument(doc.id)
      }),
    ]
    socket.connect()
    return () => {
      offs.forEach((off) => off())
      socket.destroy()
    }
  }, [projectId, token, upsertDocument, removeDocument])

  // Fall back after the document list loads so older projects still open predictably.
  useEffect(() => {
    if (!loadingDocs && documents.length > 0 && projectId) {
      const mainDoc = documents.find((d) => d.kind === 'latex' && d.title === 'main.tex')
        ?? documents.find((d) => d.kind !== 'uploaded')
        ?? documents[0]
      navigate(`/projects/${projectId}/docs/${mainDoc.id}`, { replace: true })
    }
  }, [loadingDocs, documents, navigate, projectId])

  const loadInvites = async () => {
    if (!projectId) return
    const r = await projectsApi.listInvites(projectId)
    setInvites(r.data)
  }

  const openInvitePanel = () => {
    setShowInvitePanel(true)
    loadInvites()
  }

  const createInvite = async () => {
    if (!projectId) return
    if (invites.length >= 3) return
    await projectsApi.createInvite(projectId, newInviteRole, newInviteLabel.trim())
    setNewInviteLabel('')
    await loadInvites()
  }

  const deleteInvite = async (inviteId: string) => {
    if (!projectId) return
    await projectsApi.deleteInvite(projectId, inviteId)
    setInvites((prev) => prev.filter((i) => i.id !== inviteId))
  }

  const copyInviteLink = async (invite: Invite) => {
    const url = `${window.location.origin}/join/${invite.token}`
    await navigator.clipboard.writeText(url)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const createDoc = async () => {
    if (!newDocTitle.trim() || !projectId) return
    try {
      const r = await docsApi.create(projectId, newDocTitle.trim(), '')
      upsertDocument(r.data)
      setNewDocTitle('')
      setCreatingDoc(false)
      navigate(`/projects/${projectId}/docs/${r.data.id}`)
    } catch {
      setError('Failed to create document')
    }
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!projectId || !files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const r = await docsApi.upload(projectId, file)
        upsertDocument(r.data)
      }
    } finally {
      setUploading(false)
    }
  }

  const deleteDoc = async (docId: string) => {
    if (!projectId || !confirm('Delete this document?')) return
    await docsApi.delete(projectId, docId)
    removeDocument(docId)
  }

  const updateRole = async (userId: string, role: string) => {
    if (!projectId) return
    await projectsApi.updateMemberRole(projectId, userId, role)
    setMembers(members.map((m) => m.user_id === userId ? { ...m, role } : m))
  }

  const removeMember = async (userId: string) => {
    if (!projectId || !confirm('Remove this member?')) return
    await projectsApi.removeMember(projectId, userId)
    setMembers(members.filter((m) => m.user_id !== userId))
  }

  const isOwner = currentProject?.my_role === 'owner'
  const canEdit = currentProject?.my_role !== 'viewer'

  return (
    <div style={{ minHeight: '100vh', background: C.bgBase, color: C.textPrimary }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px', background: C.bgRaised, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/projects')} style={ghostBtn}>
            <ArrowLeft size={14} />
          </button>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
            {currentProject?.title ?? '…'}
          </span>
          {currentProject && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: C.bgActive, color: roleColor(currentProject.my_role),
            }}>
              {currentProject.my_role}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle compact />
          {isOwner && (
            <button onClick={openInvitePanel} style={ghostBtn} title="Manage invite links">
              <Link size={14} /> Invite links
            </button>
          )}
          <button
            onClick={() => setShowMembers((v) => !v)}
            style={{ ...ghostBtn, background: showMembers ? C.bgActive : undefined }}
          >
            <Users size={14} /> Members ({members.length})
          </button>
          {canEdit && (
            <label style={{ ...ghostBtn, cursor: uploading ? 'wait' : 'pointer' }}>
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload files'}
              <input
                type="file"
                multiple
                onChange={(e) => void uploadFiles(e.target.files)}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {canEdit && (
            <button onClick={() => setCreatingDoc(true)} style={primaryBtn}>
              <FilePlus size={14} /> New document
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 53px)' }}>
        <div style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
          {currentProject?.description && (
            <p style={{ color: C.textSecondary, fontSize: 13, marginBottom: 20 }}>
              {currentProject.description}
            </p>
          )}

          {creatingDoc && (
            <div style={{ ...card, marginBottom: 16 }}>
              <input
                autoFocus
                placeholder="File path (e.g. src/app.py)"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createDoc()}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={createDoc} style={primaryBtn}>Create</button>
                <button onClick={() => setCreatingDoc(false)} style={ghostBtn}>Cancel</button>
              </div>
            </div>
          )}

          {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}

          {loadingDocs ? (
            <div style={{ color: C.textMuted }}>Loading…</div>
          ) : documents.length === 0 ? (
            <div style={{ color: C.textMuted, marginTop: 40, textAlign: 'center' }}>
              No documents yet.{canEdit ? ' Create one to get started.' : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    ...card, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onClick={() => navigate(`/projects/${projectId}/docs/${doc.id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.accent)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={16} color={C.accent} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</div>
                      <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{doc.path}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 999,
                          background: doc.kind === 'latex' ? C.accentSubtle : C.blueSubtle,
                          color: doc.kind === 'latex' ? C.accent : C.blue,
                          textTransform: 'uppercase', letterSpacing: 0.4,
                        }}>
                          {doc.kind}
                        </span>
                      {doc.updated_at && (
                        <div style={{ fontSize: 11, color: C.textMuted }}>
                          Updated {new Date(doc.updated_at).toLocaleDateString()}
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }}
                      style={{ ...iconBtn, color: C.red }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {showMembers && (
          <div style={{
            width: 300, borderLeft: `1px solid ${C.border}`, padding: '20px 16px',
            background: C.bgSurface, overflow: 'auto',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 16 }}>
              Members
            </h3>
            {members.map((m) => (
              <div key={m.user_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                    {m.username}
                    {m.user_id === user?.id && (
                      <span style={{ color: C.textSecondary, fontWeight: 400 }}> (you)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.textSecondary }}>{m.email}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isOwner && m.user_id !== user?.id ? (
                    <select
                      value={m.role}
                      onChange={(e) => updateRole(m.user_id, e.target.value)}
                      style={{
                        background: C.bgActive, border: `1px solid ${C.border}`, borderRadius: 4,
                        color: roleColor(m.role), fontSize: 11, padding: '2px 6px', cursor: 'pointer',
                      }}
                    >
                      <option value="owner">owner</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  ) : (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      background: C.bgActive, color: roleColor(m.role),
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {m.role === 'owner' ? <Crown size={10} /> : m.role === 'editor' ? <Edit3 size={10} /> : <Eye size={10} />}
                      {m.role}
                    </span>
                  )}
                  {isOwner && m.user_id !== user?.id && m.role !== 'owner' && (
                    <button onClick={() => removeMember(m.user_id)} style={{ ...iconBtn, color: C.red }}>
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showInvitePanel && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowInvitePanel(false)}>
          <div style={{
            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 24, width: 440, maxWidth: '90vw',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, margin: 0 }}>
                Invite links
              </h3>
              <button onClick={() => setShowInvitePanel(false)} style={iconBtn}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {invites.length === 0 && (
                <div style={{ color: C.textMuted, fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                  No invite links yet
                </div>
              )}
              {invites.map((inv) => (
                <div key={inv.id} style={{
                  background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                        background: inv.role === 'editor' ? C.greenSubtle : C.bgActive,
                        color: inv.role === 'editor' ? C.green : C.textSecondary,
                      }}>
                        {inv.role}
                      </span>
                      {inv.label && (
                        <span style={{ fontSize: 12, color: C.textSecondary }}>{inv.label}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => copyInviteLink(inv)} style={iconBtn} title="Copy link">
                        {copiedId === inv.id ? <Check size={13} color={C.green} /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => deleteInvite(inv.id)} style={{ ...iconBtn, color: C.red }} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div style={{
                    fontSize: 11, color: C.textMuted, fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {window.location.origin}/join/{inv.token}
                  </div>
                </div>
              ))}
            </div>

            {invites.length < 3 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10 }}>
                  New invite link ({invites.length}/3)
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select
                    value={newInviteRole}
                    onChange={(e) => setNewInviteRole(e.target.value as 'editor' | 'viewer')}
                    style={{
                      background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 6,
                      color: C.textPrimary, fontSize: 13, padding: '6px 10px', cursor: 'pointer',
                    }}
                  >
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <input
                    placeholder="Label (optional)"
                    value={newInviteLabel}
                    onChange={(e) => setNewInviteLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createInvite()}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                <button onClick={createInvite} style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}>
                  <Plus size={14} /> Create link
                </button>
              </div>
            ) : (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
                Maximum 3 invite links reached
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function roleColor(role: string) {
  return role === 'owner' ? C.yellow : role === 'editor' ? C.green : C.textSecondary
}

const card: React.CSSProperties = {
  background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px',
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '8px 12px', color: C.textPrimary, fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
  borderRadius: 6, border: 'none', background: C.accent, color: '#fff',
  fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent',
  color: C.textSecondary, fontSize: 13, cursor: 'pointer',
}
const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 5, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textSecondary, cursor: 'pointer',
}
