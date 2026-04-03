import { useEffect, useState } from 'react'
import { X, RotateCcw, Plus, Loader2, Clock } from 'lucide-react'
import { versionsApi } from '../services/api'
import { useStore } from '../store/useStore'

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
      // Keep optimistic ordering aligned with the API so version numbers stay stable.
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
      // Reload so the safety snapshot created during restore appears immediately.
      const refreshed = await versionsApi.list(projectId, docId)
      setVersions(refreshed.data)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 340,
      background: '#12122a', borderLeft: '1px solid #1e1e3a',
      display: 'flex', flexDirection: 'column', zIndex: 500,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: '#16213e', borderBottom: '1px solid #1e1e3a',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={14} color="#818cf8" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#c7d2fe' }}>Version History</span>
        </div>
        <button onClick={onClose} style={iconBtn}><X size={14} /></button>
      </div>

      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1e1e3a', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>Save current state as a snapshot</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveSnapshot()}
            placeholder={`v${versions.length + 1} — optional label`}
            style={inputStyle}
          />
          <button onClick={saveSnapshot} disabled={saving} style={saveBtn}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {loading && (
          <div style={{ color: '#4a4a6a', fontSize: 12, textAlign: 'center', padding: 24 }}>Loading…</div>
        )}
        {!loading && versions.length === 0 && (
          <div style={{ color: '#4a4a6a', fontSize: 12, textAlign: 'center', padding: 24 }}>
            No snapshots yet. Save one above.
          </div>
        )}
        {versions.map((v, i) => {
          const num = versions.length - i
          return (
            <div key={v.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: '1px solid #1a1a30',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe' }}>
                  v{num}
                  {v.label && (
                    <span style={{ color: '#818cf8', fontWeight: 400, marginLeft: 6 }}>— {v.label}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#4a4a6a', marginTop: 2 }}>
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}


const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 5, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
}
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 6,
  padding: '6px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
}
const saveBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 6, border: 'none', flexShrink: 0,
  background: '#4f46e5', color: '#fff', cursor: 'pointer',
}
const restoreBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 5, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#818cf8', cursor: 'pointer', flexShrink: 0,
}
