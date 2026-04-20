import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { C } from '../design'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import AIChat from '../components/AIChat'
import AssetViewer from '../components/AssetViewer'
import Editor from '../components/Editor'
import FileTree from '../components/FileTree'
import Preview from '../components/Preview'
import RichTextEditor from '../components/RichTextEditor'
import Toolbar from '../components/Toolbar'
import VersionHistoryPanel from '../components/VersionHistoryPanel'
import { WS_BASE_URL } from '../config'
import { docsApi } from '../services/api'
import { RoomSocket } from '../services/socket'
import { Presence, useStore } from '../store/useStore'
import { createSaveFingerprint, saveEventMatchesContent } from '../utils/save-state'

interface RemoteCursor {
  color: string
  username: string
  lineNumber: number
  column: number
  selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
}

type LatexViewMode = 'editor' | 'split' | 'preview'
type EditorHistoryState = { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }

const LAYOUT_KEYS = {
  sidebarWidth: 'lambda-editor:sidebar-width',
  previewWidth: 'lambda-editor:preview-width',
  aiWidth: 'lambda-editor:ai-width',
  viewMode: 'lambda-editor:view-mode',
} as const

function readStoredNumber(key: string, fallback: number) {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function readStoredViewMode(): LatexViewMode {
  if (typeof window === 'undefined') return 'split'
  const raw = window.localStorage.getItem(LAYOUT_KEYS.viewMode)
  return raw === 'editor' || raw === 'split' || raw === 'preview' ? raw : 'split'
}

export default function EditorPage() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>()
  const navigate = useNavigate()
  const {
    token, currentDoc, setCurrentDoc, setPresence, setConnected,
    updateDocContent, updateDocTitle, updateDocSyncState, setCompiledPdf,
    isConnected, user, setTypingUser, clearTypingUsers, setSaveState,
  } = useStore()

  const socketRef = useRef<RoomSocket | null>(null)
  const textInserterRef = useRef<((text: string) => void) | null>(null)
  const historyActionsRef = useRef<Pick<EditorHistoryState, 'undo' | 'redo'> | null>(null)

  const [showAI, setShowAI] = useState(true)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [remoteDecorations, setRemoteDecorations] = useState<Map<string, RemoteCursor>>(new Map())
  const [readOnly, setReadOnly] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredNumber(LAYOUT_KEYS.sidebarWidth, 234))
  const [previewWidth, setPreviewWidth] = useState(() => readStoredNumber(LAYOUT_KEYS.previewWidth, 460))
  const [aiWidth, setAiWidth] = useState(() => readStoredNumber(LAYOUT_KEYS.aiWidth, 340))
  const [viewMode, setViewMode] = useState<LatexViewMode>(() => readStoredViewMode())
  const [, setLocalCursorPos] = useState<{ lineNumber: number; column: number } | null>(null)
  const [quoteForChat, setQuoteForChat] = useState<{ lineStart: number; lineEnd: number; text: string } | null>(null)
  const [pickingEquationLocation, setPickingEquationLocation] = useState(false)
  const [equationLocation, setEquationLocation] = useState<{ line: number; text: string; beforeText: string; afterText: string } | null>(null)
  const [reconnectingDelayMs, setReconnectingDelayMs] = useState<number | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Wait for the first Yjs sync so Monaco never binds to an empty CRDT snapshot.
  const [syncedYdoc, setSyncedYdoc] = useState<Y.Doc | null>(null)
  const richTextPersistedRef = useRef<{ docId: string; content: string } | null>(null)
  const richTextSaveSeqRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAYOUT_KEYS.sidebarWidth, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAYOUT_KEYS.previewWidth, String(previewWidth))
  }, [previewWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAYOUT_KEYS.aiWidth, String(aiWidth))
  }, [aiWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAYOUT_KEYS.viewMode, viewMode)
  }, [viewMode])

  const isLatexDoc = currentDoc?.kind === 'latex'
  const isRichTextDoc = currentDoc?.kind === 'richtext'
  const usesYjs = currentDoc?.kind === 'latex' || currentDoc?.kind === 'text'
  const isEditableDoc = usesYjs || isRichTextDoc
  const showEditorPane = !isLatexDoc || viewMode !== 'preview'
  const showPreviewPane = isLatexDoc && viewMode !== 'editor'
  const editorLanguage = (() => {
    const path = currentDoc?.path || currentDoc?.title || ''
    const ext = path.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'tex':
      case 'ltx':
      case 'latex':
        return 'latex'
      case 'py':
        return 'python'
      case 'js':
      case 'jsx':
        return 'javascript'
      case 'ts':
      case 'tsx':
        return 'typescript'
      case 'md':
      case 'markdown':
        return 'markdown'
      case 'json':
        return 'json'
      case 'yml':
      case 'yaml':
        return 'yaml'
      case 'html':
        return 'html'
      case 'css':
      case 'scss':
        return 'css'
      case 'sh':
      case 'bash':
      case 'zsh':
        return 'shell'
      case 'xml':
        return 'xml'
      default:
        return 'plaintext'
    }
  })()

  const handleHistoryChange = useCallback((history: EditorHistoryState | null) => {
    historyActionsRef.current = history ? { undo: history.undo, redo: history.redo } : null
    setCanUndo(history?.canUndo ?? false)
    setCanRedo(history?.canRedo ?? false)
  }, [])

  useEffect(() => {
    historyActionsRef.current = null
    setCanUndo(false)
    setCanRedo(false)
  }, [docId, currentDoc?.kind])

  useEffect(() => {
    if (!projectId || !docId) return
    setCompiledPdf(null, '')
    docsApi.get(projectId, docId)
      .then((res) => {
        setCurrentDoc(res.data)
        if (res.data.kind === 'richtext') {
          richTextPersistedRef.current = {
            docId: res.data.id,
            content: res.data.content || '<p></p>',
          }
        } else {
          richTextPersistedRef.current = null
        }
        if (res.data.kind === 'latex') {
          setCompiledPdf(res.data.compile_success ? res.data.compile_pdf_base64 : null, res.data.compile_log || '')
        } else {
          setCompiledPdf(null, '')
        }
      })
      .catch(() => navigate(`/projects/${projectId}`))
  }, [projectId, docId, navigate, setCompiledPdf, setCurrentDoc])

  // Keep lightweight room events separate from Yjs so presence and status stay responsive.
  useEffect(() => {
    if (!docId || !token || !isEditableDoc) {
      setConnected(false)
      setPresence([])
      setReadOnly(currentDoc?.kind === 'uploaded')
      setRemoteDecorations(new Map())
      return
    }

    const socket = new RoomSocket(docId, token)
    socketRef.current = socket

    const offs = [
      socket.on('connected', () => {
        setConnected(true)
        setReconnectingDelayMs(null)
      }),
      socket.on('disconnected', () => setConnected(false)),
      socket.on('reconnecting', (msg: any) => setReconnectingDelayMs(msg.delay_ms as number)),
      socket.on('init', (msg: any) => {
        setPresence(msg.presence as Presence[])
        setReadOnly(!!msg.read_only)
        if (msg.cursors) {
          const restored = new Map<string, RemoteCursor>()
          for (const [uid, data] of Object.entries(msg.cursors as Record<string, any>)) {
            restored.set(uid, {
              color: data.color,
              username: data.username,
              lineNumber: data.position.lineNumber,
              column: data.position.column,
            })
          }
          setRemoteDecorations(restored)
        }
      }),
      socket.on('presence', (msg: any) => setPresence(msg.presence as Presence[])),
      socket.on('title', (msg: any) => updateDocTitle(msg.title)),
      socket.on('compile_result', (msg: any) => {
        setCompiledPdf(msg.success ? msg.pdf_base64 : null, msg.log || '')
      }),
      socket.on('cursor', (msg: any) => {
        if (!msg.user_id || !msg.position) return
        setRemoteDecorations((prev) => {
          const next = new Map(prev)
          next.set(msg.user_id as string, {
            color: msg.color as string,
            username: msg.username as string,
            lineNumber: (msg.position as any).lineNumber,
            column: (msg.position as any).column,
            selection: msg.selection ?? undefined,
          })
          return next
        })
      }),
      socket.on('typing', (msg: any) => {
        if (!msg.user_id || !msg.username) return
        setTypingUser({ user_id: msg.user_id as string, username: msg.username as string }, !!msg.is_typing)
      }),
      socket.on('update', (msg: any) => {
        const activeDoc = useStore.getState().currentDoc
        if (!activeDoc || activeDoc.id !== docId || activeDoc.kind !== 'richtext') return
        const nextContent = typeof msg.content === 'string' ? msg.content : activeDoc.content || '<p></p>'
        richTextPersistedRef.current = { docId, content: nextContent }
        updateDocSyncState({
          content: nextContent,
          content_revision: typeof msg.revision === 'number' ? msg.revision : activeDoc.content_revision,
        })
        setSaveState('saved')
      }),
      socket.on('save_status', (msg: any) => {
        const activeDoc = useStore.getState().currentDoc
        if (!activeDoc || activeDoc.id !== docId) return
        const currentContent = activeDoc.content || ''

        if (msg.status === 'saved') {
          updateDocSyncState({
            content_revision: typeof msg.content_revision === 'number' ? msg.content_revision : activeDoc.content_revision,
            updated_at: typeof msg.updated_at === 'string' ? msg.updated_at : activeDoc.updated_at,
          })
          if (saveEventMatchesContent(currentContent, msg)) {
            setSaveState('saved')
          }
          return
        }

        if (msg.status === 'error' && saveEventMatchesContent(currentContent, msg)) {
          setSaveState('error', typeof msg.error === 'string' ? msg.error : 'Could not persist document changes.')
        }
      }),
    ]

    socket.connect()

    return () => {
      offs.forEach((off) => off())
      socket.destroy()
      setConnected(false)
      socketRef.current = null
      clearTypingUsers()
    }
  }, [docId, token, isEditableDoc, currentDoc?.kind, setConnected, setPresence, updateDocTitle, updateDocSyncState, setCompiledPdf, setTypingUser, clearTypingUsers, setSaveState])

  // Start Yjs binding only after the provider has real document state to avoid flicker.
  useEffect(() => {
    if (!docId || !usesYjs) {
      setSyncedYdoc(null)
      return
    }

    const doc = new Y.Doc()
    let destroyed = false
    let observerFn: (() => void) | null = null

    const provider = new WebsocketProvider(
      WS_BASE_URL,
      `ws/${docId}/sync`,
      doc
    )

    const onSync = (synced: boolean) => {
      if (!synced || destroyed) return
      setSyncedYdoc(doc)
      const ytext = doc.getText('content')
      observerFn = () => {
        if (!destroyed) updateDocContent(ytext.toString())
      }
      ytext.observe(observerFn)
    }
    provider.on('sync', onSync)

    return () => {
      destroyed = true
      const ytext = doc.getText('content')
      if (observerFn) ytext.unobserve(observerFn)
      setSyncedYdoc(null)
      provider.destroy()
      doc.destroy()
    }
  }, [docId, usesYjs, updateDocContent])

  useEffect(() => {
    if (!projectId || !currentDoc || currentDoc.kind !== 'richtext' || readOnly) return
    const persisted = richTextPersistedRef.current
    if (!persisted || persisted.docId !== currentDoc.id) {
      richTextPersistedRef.current = {
        docId: currentDoc.id,
        content: currentDoc.content || '<p></p>',
      }
      return
    }

    const currentContent = currentDoc.content || '<p></p>'
    if (currentContent === persisted.content) return

    setSaveState('saving')
    const saveSeq = ++richTextSaveSeqRef.current
    const timeoutId = window.setTimeout(() => {
      void docsApi.update(projectId, currentDoc.id, { content: currentContent })
        .then((response) => {
          if (richTextSaveSeqRef.current !== saveSeq) return
          const savedContent = response.data.content || '<p></p>'
          richTextPersistedRef.current = {
            docId: response.data.id,
            content: savedContent,
          }
          updateDocSyncState({
            content: savedContent,
            content_revision: response.data.content_revision,
            updated_at: response.data.updated_at,
          })
          const fingerprint = createSaveFingerprint(savedContent)
          if (saveEventMatchesContent(useStore.getState().currentDoc?.content || '', {
            content_hash: fingerprint.contentHash,
            content_length: fingerprint.contentLength,
          })) {
            setSaveState('saved')
          }
        })
        .catch((error: any) => {
          if (richTextSaveSeqRef.current !== saveSeq) return
          setSaveState('error', error?.response?.data?.detail || 'Could not persist document changes.')
        })
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [projectId, currentDoc, readOnly, isConnected, setSaveState, updateDocSyncState])

  // Clear LaTeX-only UI state when the current file can no longer use those actions.
  useEffect(() => {
    if (!isEditableDoc) setShowVersionHistory(false)
    if (!isLatexDoc) {
      setPickingEquationLocation(false)
      setEquationLocation(null)
      setQuoteForChat(null)
    }
  }, [isEditableDoc, isLatexDoc])

  const handleOwnCursorMove = useCallback((pos: { lineNumber: number; column: number }) => {
    setLocalCursorPos(pos)
    if (!user || !isEditableDoc) return
    setRemoteDecorations((prev) => {
      const next = new Map(prev)
      next.set(`own-${user.id}`, {
        color: C.accent,
        username: user.username,
        lineNumber: pos.lineNumber,
        column: pos.column,
      })
      return next
    })
  }, [user, isEditableDoc])

  const startDragPreview = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = previewWidth
    const onMove = (ev: MouseEvent) => {
      setPreviewWidth(Math.max(200, Math.min(700, startW + (startX - ev.clientX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [previewWidth])

  const startDragSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.max(180, Math.min(360, startW + (ev.clientX - startX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const startDragAI = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = aiWidth
    const onMove = (ev: MouseEvent) => {
      setAiWidth(Math.max(240, Math.min(600, startW + (startX - ev.clientX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [aiWidth])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: C.bgBase }}>
      <Toolbar
        onToggleAI={() => setShowAI((v) => {
          const next = !v
          if (!next) {
            setPickingEquationLocation(false)
            setEquationLocation(null)
          }
          return next
        })}
        showAI={showAI}
        showVersionHistory={showVersionHistory}
        onToggleVersionHistory={() => setShowVersionHistory((v) => !v)}
        projectId={projectId}
        readOnly={readOnly}
        isLatexDoc={isLatexDoc}
        isEditableDoc={isEditableDoc}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => historyActionsRef.current?.undo()}
        onRedo={() => historyActionsRef.current?.redo()}
        viewMode={isLatexDoc ? viewMode : undefined}
        onChangeViewMode={isLatexDoc ? setViewMode : undefined}
      />

      {isEditableDoc && (!readOnly && !isConnected) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '7px 14px', background: C.redSubtle,
          borderBottom: `1px solid rgba(248,113,113,0.15)`,
          color: C.red, fontSize: 12,
        }}>
          <span>
            Offline mode. Changes will sync automatically when reconnected.
            {reconnectingDelayMs ? ` Reconnecting in ${Math.ceil(reconnectingDelayMs / 1000)}s.` : ''}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: sidebarWidth, flexShrink: 0, borderRight: `1px solid ${C.borderFaint}`, overflow: 'hidden' }}>
          <FileTree projectId={projectId} />
        </div>
        <div
          onMouseDown={startDragSidebar}
          style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        />

        {showEditorPane && (
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            {isEditableDoc ? (
              isRichTextDoc ? (
                <RichTextEditor
                  content={currentDoc?.content || '<p></p>'}
                  readOnly={readOnly}
                  socket={socketRef.current}
                  onChange={updateDocContent}
                  onDirty={() => setSaveState('saving')}
                  onHistoryChange={handleHistoryChange}
                />
              ) : (
                <Editor
                  ydoc={syncedYdoc}
                  socket={socketRef.current}
                  readOnly={readOnly}
                  remoteDecorations={remoteDecorations}
                  onRegisterTextInserter={(fn) => { textInserterRef.current = fn }}
                  onCursorMove={handleOwnCursorMove}
                  onSelectionQuote={(q) => setQuoteForChat(q)}
                  onHistoryChange={handleHistoryChange}
                  pickingLocation={pickingEquationLocation}
                  onLocationPicked={(loc) => { setEquationLocation(loc); setPickingEquationLocation(false) }}
                  ownUsername={user?.username}
                  ownColor={C.accent}
                  language={editorLanguage}
                />
              )
            ) : (
              <AssetViewer projectId={projectId} />
            )}
          </div>
        )}

        {showPreviewPane && (
          <>
            {showEditorPane && (
              <div
                onMouseDown={startDragPreview}
                style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: `1px solid ${C.borderFaint}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              />
            )}
            <div style={showEditorPane ? { width: previewWidth, flexShrink: 0, overflow: 'hidden' } : { flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Preview socket={socketRef.current} onClose={() => setViewMode('editor')} />
            </div>
          </>
        )}

        {isLatexDoc && showAI && (
          <>
            <div
              onMouseDown={startDragAI}
              style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: `1px solid ${C.borderFaint}` }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            />
            <div style={{ width: aiWidth, flexShrink: 0, overflow: 'hidden' }}>
              <AIChat
                socket={socketRef.current}
                ydoc={syncedYdoc}
                onInsertText={(text) => textInserterRef.current?.(text)}
                onClose={() => {
                  setShowAI(false)
                  setPickingEquationLocation(false)
                  setEquationLocation(null)
                }}
                readOnly={readOnly}
                pendingQuote={quoteForChat}
                onQuoteConsumed={() => setQuoteForChat(null)}
                pendingEquationLocation={equationLocation}
                isPickingEquationLocation={pickingEquationLocation}
                onRequestEquationLocation={() => {
                  setEquationLocation(null)
                  setPickingEquationLocation(true)
                }}
                onCancelEquationLocation={() => {
                  setPickingEquationLocation(false)
                  setEquationLocation(null)
                }}
                currentDocTitle={currentDoc?.title}
              />
            </div>
          </>
        )}
      </div>

      {isEditableDoc && showVersionHistory && projectId && docId && (
        <VersionHistoryPanel
          projectId={projectId}
          docId={docId}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </div>
  )
}
