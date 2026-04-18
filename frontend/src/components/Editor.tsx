import { useRef, useEffect, useCallback, useState } from 'react'
import MonacoEditor, { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as Y from 'yjs'
import { MonacoBinding } from 'y-monaco'
import { useStore } from '../store/useStore'
import { RoomSocket } from '../services/socket'
import { FileText, Quote, MapPin } from 'lucide-react'
import { C, getMonacoTheme } from '../design'

interface RemoteCursor {
  color: string
  username: string
  lineNumber: number
  column: number
  selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
}

interface Props {
  socket: RoomSocket | null
  ydoc?: Y.Doc | null
  readOnly?: boolean
  remoteDecorations: Map<string, RemoteCursor>
  onRegisterTextInserter?: (fn: (text: string) => void) => void
  onRegisterGetCursorPos?: (fn: () => { lineNumber: number; column: number } | null) => void
  onCursorMove?: (pos: { lineNumber: number; column: number }) => void
  onSelectionQuote?: (quote: { lineStart: number; lineEnd: number; text: string }) => void
  pickingLocation?: boolean
  onLocationPicked?: (loc: { line: number; text: string; beforeText: string; afterText: string }) => void
  ownUsername?: string
  ownColor?: string
  language?: string
}

interface SelectionPopup {
  x: number
  y: number
  lineStart: number
  lineEnd: number
  text: string
}

const LATEX_SNIPPETS = [
  { label: '\\begin{equation}', insertText: '\\begin{equation}\n\t$0\n\\end{equation}' },
  { label: '\\begin{align}', insertText: '\\begin{align}\n\t$0\n\\end{align}' },
  { label: '\\begin{figure}', insertText: '\\begin{figure}[h]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{$1}\n\t\\caption{$2}\n\t\\label{fig:$3}\n\\end{figure}' },
  { label: '\\begin{table}', insertText: '\\begin{table}[h]\n\t\\centering\n\t\\begin{tabular}{|c|c|}\n\t\t\\hline\n\t\t$0 \\\\\\\\\n\t\t\\hline\n\t\\end{tabular}\n\t\\caption{$1}\n\\end{table}' },
  { label: '\\frac', insertText: '\\frac{$1}{$2}' },
  { label: '\\sum', insertText: '\\sum_{$1}^{$2}' },
  { label: '\\int', insertText: '\\int_{$1}^{$2}' },
]

export default function Editor({ socket, ydoc, readOnly, remoteDecorations, onRegisterTextInserter, onRegisterGetCursorPos, onCursorMove, onSelectionQuote, pickingLocation, onLocationPicked, ownUsername, ownColor, language = 'plaintext' }: Props) {
  const { currentDoc, updateDocContent, setSaveStatus, theme } = useStore()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const isRemoteUpdate = useRef(false)
  const decorationIds = useRef<string[]>([])
  const bindingRef = useRef<MonacoBinding | null>(null)
  const socketRef = useRef<RoomSocket | null>(null)
  useEffect(() => { socketRef.current = socket }, [socket])
  const pickingLocationRef = useRef(false)
  const onLocationPickedRef = useRef(onLocationPicked)
  useEffect(() => { pickingLocationRef.current = pickingLocation ?? false }, [pickingLocation])
  useEffect(() => { onLocationPickedRef.current = onLocationPicked }, [onLocationPicked])

  const [selPopup, setSelPopup] = useState<SelectionPopup | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(false)

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setEditorReady(true)

    let lastCursorPos: { lineNumber: number; column: number } | null = null

    editor.onDidChangeCursorPosition((e) => {
      lastCursorPos = { lineNumber: e.position.lineNumber, column: e.position.column }
      onCursorMove?.({ lineNumber: e.position.lineNumber, column: e.position.column })
    })

    if (onRegisterTextInserter) {
      onRegisterTextInserter((text: string) => {
        const pos = lastCursorPos ?? editor.getPosition()
        if (!pos) return
        editor.executeEdits('insert-text', [{
          range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text,
        }])
        editor.focus()
      })
    }

    if (onRegisterGetCursorPos) {
      onRegisterGetCursorPos(() => lastCursorPos)
    }

    if (ownUsername && ownColor) {
      const ownClass = `rc-own-${ownUsername.replace(/[^a-zA-Z0-9]/g, '')}`
      _ensureCursorStyle(ownClass, ownColor, `${ownUsername} (you)`)
    }

    // Reuse one selection listener so cursor presence and quote actions stay in sync.
    editor.onDidChangeCursorSelection(() => {
      const pos = editor.getPosition()
      const sel = editor.getSelection()

      if (pos) {
        const selRange = sel && !sel.isEmpty() ? {
          startLineNumber: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLineNumber: sel.endLineNumber,
          endColumn: sel.endColumn,
        } : null
        socketRef.current?.sendCursor(
          { lineNumber: pos.lineNumber, column: pos.column },
          selRange,
        )
      }

      if (!sel || sel.isEmpty()) {
        setSelPopup(null)
        return
      }
      const model = editor.getModel()
      if (!model) return
      const selectedText = model.getValueInRange(sel)
      if (selectedText.trim().length < 3) {
        setSelPopup(null)
        return
      }
      const endPos = { lineNumber: sel.endLineNumber, column: sel.endColumn }
      const coords = editor.getScrolledVisiblePosition(endPos)
      if (!coords) { setSelPopup(null); return }
      const container = editor.getContainerDomNode()
      const rect = container.getBoundingClientRect()
      setSelPopup({
        x: rect.left + coords.left,
        y: rect.top + coords.top + coords.height + 6,
        lineStart: sel.startLineNumber,
        lineEnd: sel.endLineNumber,
        text: selectedText,
      })
    })

    // Capture the next click directly from Monaco so equation insertion stays line-accurate.
    editor.onMouseDown((e) => {
      if (!pickingLocationRef.current) return
      const pos = e.target.position
      const model = editor.getModel()
      if (!pos || !model) return
      const lineText = model.getLineContent(pos.lineNumber)
      const beforeText = pos.lineNumber > 1 ? model.getLineContent(pos.lineNumber - 1) : ''
      const afterText = pos.lineNumber < model.getLineCount() ? model.getLineContent(pos.lineNumber + 1) : ''
      onLocationPickedRef.current?.({
        line: pos.lineNumber,
        text: lineText,
        beforeText,
        afterText,
      })
    })

    monaco.languages.register({ id: 'latex' })
    monaco.languages.setMonarchTokensProvider('latex', {
      tokenizer: {
        root: [
          [/\\[a-zA-Z]+/, 'keyword'],
          [/\$\$[\s\S]*?\$\$/, 'string'],
          [/\$[^$]*\$/, 'string'],
          [/%.*$/, 'comment'],
          [/[{}[\]]/, 'delimiter'],
          [/[^\\$%{}[\]]+/, 'text'],
        ],
      },
    })

    monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['\\'],
      provideCompletionItems(model, position) {
        return {
          suggestions: LATEX_SNIPPETS.map((s) => ({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column - 1,
              endColumn: position.column,
            },
          })),
        }
      },
    })

    _injectCursorStyles()
  }

  // Recreate the binding when the backing doc changes so Monaco never points at stale CRDT state.
  useEffect(() => {
    bindingRef.current?.destroy()
    bindingRef.current = null
    if (!editorReady || !ydoc) return
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const ytext = ydoc.getText('content')
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]))
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
    }
  }, [editorReady, ydoc])

  // Keep non-Yjs documents editable through the same component instead of splitting editors.
  useEffect(() => {
    if (ydoc) return
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return
    const docContent = currentDoc?.content ?? ''
    if (model.getValue() === docContent) return

    isRemoteUpdate.current = true
    editor.executeEdits('remote-full', [{
      range: model.getFullModelRange(),
      text: docContent,
    }])
    isRemoteUpdate.current = false
  }, [currentDoc?.content, ydoc])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = []
    remoteDecorations.forEach(({ color, username, lineNumber, column, selection }, userId) => {
      const safeId = userId.replace(/[^a-zA-Z0-9]/g, '')
      const cursorClass = `rc-${safeId}`
      _ensureCursorStyle(cursorClass, color, username)

      newDecorations.push({
        range: new monaco.Range(lineNumber, column, lineNumber, column),
        options: {
          className: cursorClass,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 100,
        },
      })

      if (selection) {
        // Keep selection styling isolated from cursor styling so one rule cannot override the other.
        const selClass = `rs-${safeId}`
        _ensureSelectionStyle(selClass, color)
        newDecorations.push({
          range: new monaco.Range(
            selection.startLineNumber, selection.startColumn,
            selection.endLineNumber, selection.endColumn,
          ),
          options: {
            inlineClassName: selClass,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }
    })
    decorationIds.current = editor.deltaDecorations(decorationIds.current, newDecorations)
  }, [remoteDecorations])

  // Fire typing indicator and save-status updates on any local content change.
  const handleLocalEdit = useCallback(() => {
    if (readOnly) return
    // Save status: mark as saving; reset timer to "saved" 3s after the last keystroke.
    setSaveStatus('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveStatus('saved'), 3000)

    // Typing indicator: start indicator if not already active; stop after 3s of silence.
    if (!isTypingRef.current) {
      isTypingRef.current = true
      socketRef.current?.sendTyping(true)
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      socketRef.current?.sendTyping(false)
    }, 3000)
  }, [readOnly, setSaveStatus])

  // For Yjs-backed docs, watch the Y.Text directly for local transaction events.
  useEffect(() => {
    if (!ydoc) return
    const ytext = ydoc.getText('content')
    const observer = (_: unknown, transaction: any) => {
      if (transaction.local) handleLocalEdit()
    }
    ytext.observe(observer)
    return () => ytext.unobserve(observer)
  }, [ydoc, handleLocalEdit])

  // Clean up timers and stop-typing signal when unmounting.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (isTypingRef.current) socketRef.current?.sendTyping(false)
    }
  }, [])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (ydoc) return
      if (isRemoteUpdate.current) return
      updateDocContent(value ?? '')
      handleLocalEdit()
    },
    [ydoc, updateDocContent, handleLocalEdit]
  )

  const handleQuote = () => {
    if (!selPopup) return
    onSelectionQuote?.({ lineStart: selPopup.lineStart, lineEnd: selPopup.lineEnd, text: selPopup.text })
    setSelPopup(null)
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <MonacoEditor
        height="100%"
        language={language}
        theme={getMonacoTheme(theme)}
        value={currentDoc?.content ?? ''}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: 14,
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
          minimap: { enabled: false },
          wordWrap: 'on',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly: readOnly ?? false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          tabSize: 2,
          renderWhitespace: 'boundary',
          bracketPairColorization: { enabled: true },
        }}
      />

      {pickingLocation && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          background: C.yellowSubtle, borderBottom: `2px solid ${C.yellow}`,
          padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8,
          pointerEvents: 'none',
        }}>
          <MapPin size={13} color={C.yellow} />
          <span style={{ fontSize: 12, color: C.yellow, fontWeight: 600 }}>
            Click anywhere in the document to set the equation insertion point
          </span>
        </div>
      )}

      {selPopup && (
        <div
          style={{
            position: 'fixed',
            left: selPopup.x,
            top: selPopup.y,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: C.bgCard,
            border: `1px solid ${C.accentBorder}`,
            borderRadius: 6,
            padding: '4px 10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            pointerEvents: 'all',
          }}
          // Preserve the selected range so quoting still has access to the original text.
          onMouseDown={(e) => e.preventDefault()}
        >
          <FileText size={11} color={C.accent} />
          <span style={{ fontSize: 11, color: C.textSecondary }}>
            L{selPopup.lineStart}{selPopup.lineEnd !== selPopup.lineStart ? `–${selPopup.lineEnd}` : ''}
          </span>
          <button
            onClick={handleQuote}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: C.accent, border: 'none', borderRadius: 4,
              color: '#fff', fontSize: 11, fontWeight: 600,
              padding: '2px 8px', cursor: 'pointer',
            }}
          >
            <Quote size={10} /> Quote
          </button>
        </div>
      )}
    </div>
  )
}

function _injectCursorStyles() {
  if (document.getElementById('remote-cursor-base')) return
  const style = document.createElement('style')
  style.id = 'remote-cursor-base'
  style.textContent = `
    [class^="rc-"] { border-left: 2px solid var(--rc-color, #818cf8); position: relative; }
  `
  document.head.appendChild(style)
}

const _injectedClasses = new Set<string>()

const _injectedSelClasses = new Set<string>()

function _ensureSelectionStyle(className: string, color: string) {
  // Replace prior rules so reconnects cannot leave stale collaborator colors behind.
  const existing = document.getElementById(`style-${className}`)
  if (existing) existing.remove()
  _injectedSelClasses.add(className)
  const style = document.createElement('style')
  style.id = `style-${className}`
  style.textContent = `
    .${className} {
      background: ${color}55 !important;
      outline: 1px solid ${color}99;
      border-radius: 2px;
    }
  `
  document.head.appendChild(style)
}

function _ensureCursorStyle(className: string, color: string, username: string) {
  if (_injectedClasses.has(className)) return
  _injectedClasses.add(className)
  const style = document.createElement('style')
  style.textContent = `
    .${className} { --rc-color: ${color}; border-left: 2px solid ${color} !important; }
    .${className}::after {
      content: '${CSS.escape(username)}';
      position: absolute; top: -18px; left: -2px;
      background: ${color}; color: #fff; font-size: 10px;
      padding: 1px 5px; border-radius: 3px;
      white-space: nowrap; pointer-events: none; z-index: 200;
    }
  `
  document.head.appendChild(style)
}
