import { Download, FileText, Image as ImageIcon } from 'lucide-react'
import { docsApi } from '../services/api'
import { useStore } from '../store/useStore'
import { C } from '../design'

interface Props {
  projectId?: string
}

function isImage(mimeType?: string | null, title?: string) {
  return (mimeType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(title || '')
}

function isTextLike(mimeType?: string | null, title?: string) {
  return (mimeType || '').startsWith('text/') || /\.(txt|md|markdown|csv|json|ya?ml|xml)$/i.test(title || '')
}

export default function AssetViewer({ projectId }: Props) {
  const { currentDoc } = useStore()

  if (!currentDoc || !projectId) {
    return null
  }

  const downloadUrl = docsApi.downloadUrl(projectId, currentDoc.id)
  const imageAsset = isImage(currentDoc.mime_type, currentDoc.source_filename || currentDoc.title)
  const textAsset = isTextLike(currentDoc.mime_type, currentDoc.source_filename || currentDoc.title)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgSurface }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgRaised,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{currentDoc.title}</div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
            {currentDoc.mime_type || 'application/octet-stream'}
            {typeof currentDoc.file_size === 'number' ? ` • ${currentDoc.file_size.toLocaleString()} bytes` : ''}
          </div>
        </div>
        <a
          href={downloadUrl}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 8, textDecoration: 'none',
            background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          <Download size={14} />
          Download
        </a>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {imageAsset ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100%', background: C.bgBase, borderRadius: 14, border: `1px solid ${C.border}`, padding: 16,
          }}>
            <img
              src={downloadUrl}
              alt={currentDoc.title}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }}
            />
          </div>
        ) : textAsset ? (
          <pre style={{
            margin: 0, padding: 18, borderRadius: 14, background: C.bgBase, color: C.textPrimary,
            border: `1px solid ${C.border}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 13, lineHeight: 1.55, fontFamily: 'Monaco, Menlo, monospace',
          }}>
            {currentDoc.content || ''}
          </pre>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: '100%', gap: 14, color: C.textSecondary,
            border: `1px dashed ${C.borderStrong}`, borderRadius: 14, background: C.bgBase,
          }}>
            {currentDoc.mime_type?.startsWith('image/') ? <ImageIcon size={44} /> : <FileText size={44} />}
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Preview unavailable</div>
            <div style={{ fontSize: 12 }}>Download the file to open it locally.</div>
          </div>
        )}
      </div>
    </div>
  )
}
