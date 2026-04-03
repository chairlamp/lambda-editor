import { useState } from 'react'
import { Check, X, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'

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

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const pending = changes.filter((c) => !accepted.has(c.id) && !rejected.has(c.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        background: '#1e2a4a', borderRadius: 8, padding: '10px 14px',
        fontSize: 13, color: '#c7d2fe', lineHeight: 1.5,
      }}>
        {explanation}
      </div>

      {((pending.length > 0 && canReview) || onAskDifferent) && (
        <div style={{ display: 'flex', gap: 6 }}>
          {pending.length > 0 && canReview && (
            <>
              <button onClick={onAcceptAll} style={acceptAllBtn}>
                <Check size={12} /> Accept all ({pending.length})
              </button>
              <button onClick={onRejectAll} style={rejectAllBtn}>
                <X size={12} /> Reject all
              </button>
            </>
          )}
          {onAskDifferent && (
            <button onClick={onAskDifferent} style={alternateBtn}>
              <ArrowRight size={12} /> Continue
            </button>
          )}
        </div>
      )}

      {changes.map((change) => {
        const isAccepted = accepted.has(change.id)
        const isRejected = rejected.has(change.id)
        const isPending = !isAccepted && !isRejected
        const isOpen = expanded.has(change.id)

        return (
          <div
            key={change.id}
            style={{
              borderRadius: 8, overflow: 'hidden',
              border: `1px solid ${isAccepted ? '#166534' : isRejected ? '#7f1d1d' : '#2a2a4a'}`,
              opacity: isRejected ? 0.5 : 1,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px',
              background: isAccepted ? '#14532d20' : isRejected ? '#7f1d1d20' : '#1e1e3a',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => toggle(change.id)} style={chevronBtn}>
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {change.description || `Change ${change.id}`}
                </span>
                {isAccepted && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ accepted</span>}
                {isRejected && <span style={{ fontSize: 11, color: '#f87171' }}>✗ rejected</span>}
              </div>
              {isPending && canReview && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => onAccept(change)} style={acceptBtn} title="Accept">
                    <Check size={11} />
                  </button>
                  <button onClick={() => onReject(change.id)} style={rejectBtn} title="Reject">
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>

            {isPending && !canReview && (
              <div style={{ padding: '0 12px 8px', fontSize: 11, color: '#6b7280' }}>
                Viewers cannot accept or reject AI changes.
              </div>
            )}

            {isOpen && (
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {change.old_text && change.old_text.split('\n').map((line, i) => (
                  <div
                    key={`old-${i}`}
                    style={{
                      padding: '2px 12px', background: '#3b0d0d',
                      color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      borderLeft: '3px solid #ef4444',
                    }}
                  >
                    <span style={{ color: '#f87171', marginRight: 8, userSelect: 'none' }}>−</span>
                    {line || ' '}
                  </div>
                ))}
                {change.new_text && change.new_text.split('\n').map((line, i) => (
                  <div
                    key={`new-${i}`}
                    style={{
                      padding: '2px 12px', background: '#0d2b1d',
                      color: '#86efac', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      borderLeft: '3px solid #22c55e',
                    }}
                  >
                    <span style={{ color: '#4ade80', marginRight: 8, userSelect: 'none' }}>+</span>
                    {line || ' '}
                  </div>
                ))}
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
  width: 22, height: 22, borderRadius: 4, border: '1px solid #166534',
  background: '#14532d40', color: '#4ade80', cursor: 'pointer',
}
const rejectBtn: React.CSSProperties = {
  ...acceptBtn,
  border: '1px solid #7f1d1d', background: '#7f1d1d40', color: '#f87171',
}
const acceptAllBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
  borderRadius: 5, border: '1px solid #166534', background: '#14532d40',
  color: '#4ade80', fontSize: 11, cursor: 'pointer',
}
const rejectAllBtn: React.CSSProperties = {
  ...acceptAllBtn,
  border: '1px solid #7f1d1d', background: '#7f1d1d40', color: '#f87171',
}
const alternateBtn: React.CSSProperties = {
  ...acceptAllBtn,
  border: '1px solid #1d4ed8', background: '#1d4ed840', color: '#93c5fd',
}
const chevronBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', background: 'none',
  border: 'none', color: '#6b7280', cursor: 'pointer', padding: 2,
}
