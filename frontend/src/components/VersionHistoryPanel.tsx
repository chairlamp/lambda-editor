import { useEffect, useState } from 'react'
import { X, RotateCcw, Plus, Loader2, Clock } from 'lucide-react'
import { versionsApi } from '../services/api'
import { useStore } from '../store/useStore'
import { C } from '../design'

interface Version {
  id: string
  label: string
  created_at: string
}

interface Props {
  projectId: string
  docId: string
  onClose: () => void
}

export default function VersionHistoryPanel({ projectId, docId, onClose }: Props) {
  const { updateDocContent } = useStore()
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [label, setLabel] = useState('')
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    versionsApi.list(projectId, docId)
      .then((r) => setVersions(r.data))
      .finally(() => setLoading(false))
  }, [projectId, docId])

  const saveSnapshot = async () => {
    if (saving) return
    setSaving(true)
    try {
      const r = await versionsApi.create(projectId, docId, label.trim())
      setVersions((prev) => [r.data, ...prev])
      setLabel('')
    } finally {
      setSaving(false)
    }
  }

  const restore = async (v: Version) => {
    const num = versions.length - versions.findIndex((x) => x.id === v.id)
    if (!confirm(`Restore to v${num}${v.label ? ` — ${v.label}` : ''}?`)) return
    setRestoringId(v.id)
    try {
      const r = await versionsApi.restore(projectId, docId, v.id)
      updateDocContent(r.data.content)
      const refreshed = await versionsApi.list(projectId, docId)
      setVersions(refreshed.data)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
      background: C.bgCard, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 500,
      boxShadow: '-16px 0 48px rgba(0,0,0,0.35)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: 46,
        background: C.bgRaised, borderBottom: `1px solid ${C.borderFaint}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Clock size={13} color={C.accent} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Version History</span>
        </div>
        <button onClick={onClose} style={iconBtn}><X size={13} /></button>
      </div>

      {/* Save snapshot */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.borderFaint}`, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 7 }}>Save current state as a snapshot</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveSnapshot()}
            placeholder={`v${versions.length + 1} — optional label`}
            style={inputSt}
          />
          <button onClick={saveSnapshot} disabled={saving} style={saveBtn} title="Save snapshot">
            {saving
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Plus size={12} />}
          </button>
        </div>
      </div>

      {/* Version list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 28 }}>
            <Loader2 size={15} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {!loading && versions.length === 0 && (
          <div style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: 28 }}>
            No snapshots yet. Save one above.
          </div>
        )}
        {versions.map((v, i) => {
          const num = versions.length - i
          return (
            <div key={v.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: `1px solid ${C.borderFaint}`,
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary }}>
                  v{num}
                  {v.label && (
                    <span style={{ color: C.textSecondary, fontWeight: 400, marginLeft: 5 }}>— {v.label}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => restore(v)}
                disabled={restoringId === v.id}
                style={restoreBtn}
                title="Restore to this version"
              >
                {restoringId === v.id
                  ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  : <RotateCcw size={12} />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 27, height: 27, borderRadius: 6, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textSecondary, cursor: 'pointer',
}
const inputSt: React.CSSProperties = {
  flex: 1, background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '6px 10px', color: C.textPrimary, fontSize: 12, outline: 'none', fontFamily: 'inherit',
}
const saveBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 6, border: 'none', flexShrink: 0,
  background: C.accent, color: '#fff', cursor: 'pointer',
}
const restoreBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.accent, cursor: 'pointer', flexShrink: 0,
}
