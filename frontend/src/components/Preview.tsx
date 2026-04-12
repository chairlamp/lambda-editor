import { useState } from 'react'
import { AlertCircle, CheckCircle, ChevronDown, Download, FileText, Loader2, X } from 'lucide-react'
import { compileApi } from '../services/api'
import { RoomSocket } from '../services/socket'
import { useStore } from '../store/useStore'
import { C } from '../design'

interface Props {
  onClose?: () => void
  socket?: RoomSocket | null
}

type ExportFormat = 'pdf' | 'dvi' | 'ps'

const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'dvi', 'ps']

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function Preview({ onClose, socket }: Props) {
  const { currentDoc, compiledPdf, compileLog, isCompiling, setCompiledPdf, setCompiling } = useStore()
  const [isExporting, setIsExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)

  const compilePdf = async () => {
    if (!currentDoc?.content || isCompiling) return
    setCompiling(true)
    try {
      const res = await compileApi.compile(currentDoc.content, currentDoc.project_id, currentDoc.id, 'pdf')
      const { success, pdf_base64, log } = res.data
      setCompiledPdf(success ? pdf_base64 : null, log)
      socket?.sendCompileResult({ success, pdf_base64: success ? pdf_base64 : null, log })
    } catch (e: any) {
      const log = e?.response?.data?.detail || 'Compilation failed'
      setCompiledPdf(null, log)
      socket?.sendCompileResult({ success: false, pdf_base64: null, log })
    } finally {
      setCompiling(false)
    }
  }

  const exportRenderedFile = async (exportFormat: ExportFormat) => {
    if (!currentDoc?.content || isExporting) return
    setIsExporting(true)
    setShowExportMenu(false)
    try {
      const res = await compileApi.compile(currentDoc.content, currentDoc.project_id, currentDoc.id, exportFormat)
      const { success, file_base64, file_name, mime_type, log } = res.data
      if (!success || !file_base64 || !file_name || !mime_type) {
        setCompiledPdf(compiledPdf, log || 'Export failed')
        return
      }
      downloadBlob(base64ToBlob(file_base64, mime_type), file_name)
      if (exportFormat === 'pdf') {
        setCompiledPdf(file_base64, log || '')
        socket?.sendCompileResult({ success: true, pdf_base64: file_base64, log: log || '' })
      }
    } catch (e: any) {
      const log = e?.response?.data?.detail || 'Export failed'
      setCompiledPdf(compiledPdf, log)
    } finally {
      setIsExporting(false)
    }
  }

  const pdfUrl = compiledPdf ? `data:application/pdf;base64,${compiledPdf}` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgBase }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px',
        height: 42, background: C.bgRaised, borderBottom: `1px solid ${C.borderFaint}`,
        flexShrink: 0,
      }}>
        <button
          onClick={compilePdf}
          disabled={isCompiling || !currentDoc}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 6, border: 'none',
            background: isCompiling || !currentDoc ? C.bgActive : C.accent,
            color: '#fff', cursor: isCompiling || !currentDoc ? 'not-allowed' : 'pointer',
            fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          {isCompiling ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
          {isCompiling ? 'Rendering…' : 'Render PDF'}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => !isExporting && setShowExportMenu((v) => !v)}
            disabled={isExporting || !currentDoc}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.textSecondary,
              cursor: isExporting || !currentDoc ? 'not-allowed' : 'pointer',
              fontSize: 12.5, fontFamily: 'inherit',
            }}
          >
            {isExporting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
            Export
            <ChevronDown size={12} />
          </button>

          {showExportMenu && !isExporting && currentDoc && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 5px)', left: 0,
              minWidth: 150, background: C.bgCard,
              border: `1px solid ${C.border}`, borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
              overflow: 'hidden', zIndex: 20,
            }}>
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format}
                  onClick={() => void exportRenderedFile(format)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center',
                    padding: '9px 13px', background: 'transparent',
                    border: 'none', color: C.textSecondary, fontSize: 12.5,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.textPrimary }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary }}
                >
                  Export {format.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {compiledPdf && !isCompiling && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.green, fontSize: 11.5 }}>
            <CheckCircle size={11} /> PDF ready
          </span>
        )}

        <div style={{ flex: 1 }} />

        {onClose && (
          <button onClick={onClose} style={closeBtn} title="Close preview">
            <X size={12} />
          </button>
        )}
      </div>

      {/* PDF viewer */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            title="PDF Preview"
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 10,
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
          maxHeight: 140, overflow: 'auto', background: C.bgBase,
          borderTop: `1px solid ${C.borderFaint}`, padding: '8px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: compiledPdf ? C.green : C.red, fontSize: 11.5 }}>
            {compiledPdf ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
            <span style={{ fontWeight: 600 }}>{compiledPdf ? 'Compilation log' : 'Error log'}</span>
          </div>
          <pre style={{ fontSize: 10.5, color: C.textMuted, whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>
            {compileLog}
          </pre>
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
