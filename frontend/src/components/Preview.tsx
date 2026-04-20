import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { C } from '../design'

interface Props {
  onClose?: () => void
}

export default function Preview({ onClose }: Props) {
  const { currentDoc, compiledPdf, compileLog, isCompiling } = useStore()
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (!compileLog) {
      setShowLog(false)
      return
    }
    if (!compiledPdf) setShowLog(true)
  }, [compileLog, compiledPdf])

  const pdfUrl = compiledPdf ? `data:application/pdf;base64,${compiledPdf}` : null
  const pdfEmbedUrl = pdfUrl ? `${pdfUrl}#page=1&zoom=page-width` : null
  const previewTitle = currentDoc?.path || currentDoc?.title || 'Rendered PDF'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgBase }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px',
        height: 44, background: C.bgRaised, borderBottom: `1px solid ${C.borderFaint}`,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: C.textSecondary,
          marginRight: 4,
        }}>
          Preview
        </span>

        {compiledPdf && (
          <span style={{
            fontSize: 11.5,
            color: C.textMuted,
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            padding: '4px 8px',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {previewTitle.replace(/\.tex$/i, '.pdf')}
          </span>
        )}

        {isCompiling ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.textMuted, fontSize: 11.5 }}>
            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Rendering…
          </span>
        ) : compiledPdf ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.green, fontSize: 11.5 }}>
            <CheckCircle size={11} /> PDF ready
          </span>
        ) : compileLog ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.red, fontSize: 11.5 }}>
            <AlertCircle size={11} /> Compile failed
          </span>
        ) : null}

        <div style={{ flex: 1 }} />

        {pdfUrl && (
          <button onClick={() => window.open(pdfUrl, '_blank', 'noopener,noreferrer')} style={closeBtn} title="Open PDF in new tab">
            <ExternalLink size={12} />
          </button>
        )}

        {onClose && (
          <button onClick={onClose} style={closeBtn} title="Close preview">
            <X size={12} />
          </button>
        )}
      </div>

      {/* PDF viewer */}
      <div style={{ flex: 1, overflow: 'hidden', background: C.bgSurface, padding: 12 }}>
        {pdfEmbedUrl ? (
          <div style={{
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: '#fff',
            boxShadow: '0 18px 42px rgba(15,23,42,0.12)',
          }}>
            <iframe
              src={pdfEmbedUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: '#fff',
                display: 'block',
              }}
              title="PDF Preview"
            />
            {/* Mask the noisy generated filename while preserving the viewer toolbar controls. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 360,
                maxWidth: '48%',
                height: 36,
                background: '#3c4043',
                borderTopLeftRadius: 12,
                pointerEvents: 'none',
              }}
            />
          </div>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 10,
            borderRadius: 12,
            border: `1px dashed ${C.borderStrong}`,
            background: C.bgRaised,
          }}>
            <FileText size={36} color={C.textDisabled} strokeWidth={1.2} />
            <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>Render PDF to preview here</p>
            <p style={{ fontSize: 11.5, color: C.textMuted, margin: 0 }}>Other formats download directly</p>
          </div>
        )}
      </div>

      {/* Compile log */}
      {compileLog && (
        <div style={{
          background: C.bgBase,
          borderTop: `1px solid ${C.borderFaint}`,
          flexShrink: 0,
        }}>
          <button
            onClick={() => setShowLog((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '9px 12px',
              border: 'none',
              background: 'transparent',
              color: compiledPdf ? C.green : C.red,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
              {compiledPdf ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
              <span style={{ fontWeight: 600 }}>{compiledPdf ? 'Compilation log' : 'Error log'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: C.textMuted }}>
              <span>{showLog ? 'Hide' : 'Show'}</span>
              {showLog ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </div>
          </button>
          {showLog && (
            <div style={{ maxHeight: 220, overflow: 'auto', padding: '0 12px 12px' }}>
              <pre style={{ fontSize: 10.5, color: C.textMuted, whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>
                {compileLog}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const closeBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 5, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textMuted, cursor: 'pointer', flexShrink: 0,
}
