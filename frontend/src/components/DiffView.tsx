import { useState } from 'react'
import { Check, X, ArrowRight, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { C } from '../design'

export interface DiffChange {
  id: string
  description: string
  old_text: string
  new_text: string
}

interface Props {
  explanation: string
  changes: DiffChange[]
  onAccept: (change: DiffChange) => void
  onReject: (changeId: string) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onAskDifferent?: () => void
  accepted: Set<string>
  rejected: Set<string>
  canReview?: boolean
}

export default function DiffView({
  explanation,
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onAskDifferent,
  accepted,
  rejected,
  canReview = true,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(changes.map((c) => c.id)))
  // editingId → current draft text for that change
  const [editDrafts, setEditDrafts] = useState<Map<string, string>>(new Map())

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const startEdit = (change: DiffChange) => {
    setEditDrafts((prev) => {
      const next = new Map(prev)
      next.set(change.id, change.new_text)
      return next
    })
  }

  const cancelEdit = (id: string) => {
    setEditDrafts((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const acceptEdited = (change: DiffChange) => {
    const draft = editDrafts.get(change.id)
    onAccept({ ...change, new_text: draft ?? change.new_text })
    cancelEdit(change.id)
  }

  const pending = changes.filter((c) => !accepted.has(c.id) && !rejected.has(c.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        background: C.bgCard, borderRadius: 8, padding: '10px 14px',
        fontSize: 13, color: C.textPrimary, lineHeight: 1.55,
        border: `1px solid ${C.borderFaint}`,
      }}>
        {explanation}
      </div>

      {((pending.length > 0 && canReview) || onAskDifferent) && (
        <div style={{ display: 'flex', gap: 6 }}>
          {pending.length > 0 && canReview && (
            <>
              <button onClick={onAcceptAll} style={acceptAllBtn}>
                <Check size={11} /> Accept all ({pending.length})
              </button>
              <button onClick={onRejectAll} style={rejectAllBtn}>
                <X size={11} /> Reject all
              </button>
            </>
          )}
          {onAskDifferent && (
            <button onClick={onAskDifferent} style={alternateBtn}>
              <ArrowRight size={11} /> Continue
            </button>
          )}
        </div>
      )}

      {changes.map((change) => {
        const isAccepted = accepted.has(change.id)
        const isRejected = rejected.has(change.id)
        const isPending = !isAccepted && !isRejected
        const isOpen = expanded.has(change.id)
        const isEditing = editDrafts.has(change.id)
        const draft = editDrafts.get(change.id) ?? change.new_text

        return (
          <div
            key={change.id}
            style={{
              borderRadius: 8, overflow: 'hidden',
              border: `1px solid ${isAccepted ? 'rgba(52,211,153,0.25)' : isRejected ? 'rgba(248,113,113,0.2)' : isEditing ? 'rgba(96,165,250,0.3)' : C.border}`,
              opacity: isRejected ? 0.5 : 1,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 12px',
              background: isAccepted ? C.greenSubtle : isRejected ? C.redSubtle : isEditing ? C.blueSubtle : C.bgRaised,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <button onClick={() => toggle(change.id)} style={chevronBtn}>
                  {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                <span style={{ fontSize: 12, color: C.textSecondary }}>
                  {change.description || `Change ${change.id}`}
                </span>
                {isAccepted && <span style={{ fontSize: 10.5, color: C.green }}>✓ accepted</span>}
                {isRejected && <span style={{ fontSize: 10.5, color: C.red }}>✗ rejected</span>}
                {isEditing && <span style={{ fontSize: 10.5, color: C.blue }}>editing…</span>}
              </div>
              {isPending && canReview && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => acceptEdited(change)} style={acceptBtn} title="Accept edited version">
                        <Check size={11} />
                      </button>
                      <button onClick={() => cancelEdit(change.id)} style={rejectBtn} title="Cancel edit">
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(change)} style={editBtn} title="Edit before accepting">
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => onAccept(change)} style={acceptBtn} title="Accept">
                        <Check size={11} />
                      </button>
                      <button onClick={() => onReject(change.id)} style={rejectBtn} title="Reject">
                        <X size={11} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {isPending && !canReview && (
              <div style={{ padding: '0 12px 8px', fontSize: 11, color: C.textMuted }}>
                Viewers cannot accept or reject AI changes.
              </div>
            )}

            {isOpen && (
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {change.old_text && change.old_text.split('\n').map((line, i) => (
                  <div
                    key={`old-${i}`}
                    style={{
                      padding: '2px 12px', background: 'rgba(248,113,113,0.07)',
                      color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      borderLeft: `3px solid ${C.red}`,
                    }}
                  >
                    <span style={{ color: C.red, marginRight: 8, userSelect: 'none' }}>−</span>
                    {line || ' '}
                  </div>
                ))}

                {isEditing ? (
                  <div style={{ background: C.blueSubtle, padding: '8px 12px', borderLeft: `3px solid ${C.blue}` }}>
                    <div style={{ fontSize: 10.5, color: C.blue, marginBottom: 4 }}>Edit replacement text:</div>
                    <textarea
                      value={draft}
                      onChange={(e) => setEditDrafts((prev) => {
                        const next = new Map(prev)
                        next.set(change.id, e.target.value)
                        return next
                      })}
                      style={{
                        width: '100%', minHeight: 80, background: C.bgBase,
                        border: `1px solid ${C.blue}`, borderRadius: 5,
                        color: C.textPrimary, fontFamily: 'monospace', fontSize: 12,
                        padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  </div>
                ) : (
                  change.new_text && change.new_text.split('\n').map((line, i) => (
                    <div
                      key={`new-${i}`}
                      style={{
                        padding: '2px 12px', background: 'rgba(52,211,153,0.07)',
                        color: '#86efac', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        borderLeft: `3px solid ${C.green}`,
                      }}
                    >
                      <span style={{ color: C.green, marginRight: 8, userSelect: 'none' }}>+</span>
                      {line || ' '}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const acceptBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: `1px solid rgba(52,211,153,0.3)`,
  background: C.greenSubtle, color: C.green, cursor: 'pointer',
}
const rejectBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: `1px solid rgba(248,113,113,0.3)`,
  background: C.redSubtle, color: C.red, cursor: 'pointer',
}
const editBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: `1px solid rgba(96,165,250,0.3)`,
  background: C.blueSubtle, color: C.blue, cursor: 'pointer',
}
const acceptAllBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px',
  borderRadius: 5, border: `1px solid rgba(52,211,153,0.3)`, background: C.greenSubtle,
  color: C.green, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
}
const rejectAllBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px',
  borderRadius: 5, border: `1px solid rgba(248,113,113,0.3)`, background: C.redSubtle,
  color: C.red, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
}
const alternateBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px',
  borderRadius: 5, border: `1px solid rgba(96,165,250,0.3)`, background: C.blueSubtle,
  color: C.blue, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
}
const chevronBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', background: 'none',
  border: 'none', color: C.textMuted, cursor: 'pointer', padding: 2,
}
