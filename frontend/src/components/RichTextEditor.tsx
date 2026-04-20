import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  type LucideIcon,
  List,
  ListOrdered,
} from 'lucide-react'
import { C } from '../design'
import { type RoomSocket } from '../services/socket'

interface Props {
  content: string
  readOnly?: boolean
  socket?: RoomSocket | null
  onChange: (content: string) => void
  onDirty?: () => void
  onHistoryChange?: (history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void } | null) => void
}

interface ToolbarButton {
  key: string
  label: string
  icon: LucideIcon
  isActive?: (editor: TiptapEditor) => boolean
  canRun?: (editor: TiptapEditor) => boolean
  run: (editor: TiptapEditor) => void
}

const EMPTY_DOC = '<p></p>'

export default function RichTextEditor({ content, readOnly = false, socket = null, onChange, onDirty, onHistoryChange }: Props) {
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingActiveRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Write with headings, lists, and code blocks here…',
      }),
    ],
    content: content || EMPTY_DOC,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'lambda-richtext-surface',
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor: nextEditor }) => {
      onChange(nextEditor.getHTML())
      onDirty?.()
      if (!socket || readOnly) return
      if (!typingActiveRef.current) {
        typingActiveRef.current = true
        socket.sendTyping(true)
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        typingActiveRef.current = false
        socket.sendTyping(false)
      }, 3000)
    },
  }, [readOnly, socket])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return
    const next = content || EMPTY_DOC
    if (editor.getHTML() === next) return
    editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, content])

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      if (typingActiveRef.current && socket) socket.sendTyping(false)
    }
  }, [socket])

  useEffect(() => {
    if (!onHistoryChange) return
    if (!editor) {
      onHistoryChange(null)
      return
    }

    const emitHistoryState = () => {
      onHistoryChange({
        canUndo: editor.can().chain().focus().undo().run(),
        canRedo: editor.can().chain().focus().redo().run(),
        undo: () => { editor.chain().focus().undo().run() },
        redo: () => { editor.chain().focus().redo().run() },
      })
    }

    emitHistoryState()
    editor.on('transaction', emitHistoryState)

    return () => {
      editor.off('transaction', emitHistoryState)
      onHistoryChange(null)
    }
  }, [editor, onHistoryChange])

  const buttons = useMemo<ToolbarButton[]>(() => [
    {
      key: 'bold',
      label: 'Bold',
      icon: Bold,
      isActive: (instance) => instance.isActive('bold'),
      canRun: (instance) => instance.can().chain().focus().toggleBold().run(),
      run: (instance) => { instance.chain().focus().toggleBold().run() },
    },
    {
      key: 'italic',
      label: 'Italic',
      icon: Italic,
      isActive: (instance) => instance.isActive('italic'),
      canRun: (instance) => instance.can().chain().focus().toggleItalic().run(),
      run: (instance) => { instance.chain().focus().toggleItalic().run() },
    },
    {
      key: 'heading-1',
      label: 'Heading 1',
      icon: Heading1,
      isActive: (instance) => instance.isActive('heading', { level: 1 }),
      canRun: (instance) => instance.can().chain().focus().toggleHeading({ level: 1 }).run(),
      run: (instance) => { instance.chain().focus().toggleHeading({ level: 1 }).run() },
    },
    {
      key: 'heading-2',
      label: 'Heading 2',
      icon: Heading2,
      isActive: (instance) => instance.isActive('heading', { level: 2 }),
      canRun: (instance) => instance.can().chain().focus().toggleHeading({ level: 2 }).run(),
      run: (instance) => { instance.chain().focus().toggleHeading({ level: 2 }).run() },
    },
    {
      key: 'bullet-list',
      label: 'Bulleted list',
      icon: List,
      isActive: (instance) => instance.isActive('bulletList'),
      canRun: (instance) => instance.can().chain().focus().toggleBulletList().run(),
      run: (instance) => { instance.chain().focus().toggleBulletList().run() },
    },
    {
      key: 'ordered-list',
      label: 'Numbered list',
      icon: ListOrdered,
      isActive: (instance) => instance.isActive('orderedList'),
      canRun: (instance) => instance.can().chain().focus().toggleOrderedList().run(),
      run: (instance) => { instance.chain().focus().toggleOrderedList().run() },
    },
    {
      key: 'code-block',
      label: 'Code block',
      icon: Code2,
      isActive: (instance) => instance.isActive('codeBlock'),
      canRun: (instance) => instance.can().chain().focus().toggleCodeBlock().run(),
      run: (instance) => { instance.chain().focus().toggleCodeBlock().run() },
    },
  ], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: C.bgBase }}>
      <style>{`
        .lambda-richtext-surface {
          min-height: 100%;
          outline: none;
          color: ${C.textPrimary};
          font-size: 15px;
          line-height: 1.75;
          padding: 28px 32px 120px;
          font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        }
        .lambda-richtext-surface p.is-editor-empty:first-child::before {
          color: ${C.textMuted};
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .lambda-richtext-surface h1,
        .lambda-richtext-surface h2,
        .lambda-richtext-surface h3 {
          color: ${C.textPrimary};
          letter-spacing: -0.02em;
          margin: 1.2em 0 0.45em;
          line-height: 1.2;
        }
        .lambda-richtext-surface h1 {
          font-size: 2rem;
        }
        .lambda-richtext-surface h2 {
          font-size: 1.55rem;
        }
        .lambda-richtext-surface h3 {
          font-size: 1.25rem;
        }
        .lambda-richtext-surface p,
        .lambda-richtext-surface ul,
        .lambda-richtext-surface ol,
        .lambda-richtext-surface pre {
          margin: 0.8em 0;
        }
        .lambda-richtext-surface ul,
        .lambda-richtext-surface ol {
          padding-left: 1.5em;
        }
        .lambda-richtext-surface code {
          background: ${C.bgActive};
          border-radius: 6px;
          color: ${C.textPrimary};
          font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace;
          font-size: 0.92em;
          padding: 0.18em 0.38em;
        }
        .lambda-richtext-surface pre {
          background: ${C.bgRaised};
          border: 1px solid ${C.border};
          border-radius: 14px;
          overflow-x: auto;
          padding: 16px 18px;
        }
        .lambda-richtext-surface pre code {
          background: transparent;
          border-radius: 0;
          padding: 0;
        }
        .lambda-richtext-surface blockquote {
          border-left: 3px solid ${C.accent};
          color: ${C.textSecondary};
          margin: 1em 0;
          padding-left: 1em;
        }
      `}</style>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '10px 12px',
        borderBottom: `1px solid ${C.borderFaint}`,
        background: C.bgRaised,
      }}>
        {buttons.map((button) => {
          const Icon = button.icon
          const active = editor ? button.isActive?.(editor) : false
          const canRun = editor ? (button.canRun?.(editor) ?? true) : false
          const disabled = readOnly || !editor || !canRun
          return (
            <button
              key={button.key}
              type="button"
              aria-label={button.label}
              title={button.label}
              disabled={disabled}
              onClick={() => {
                if (!editor || disabled) return
                button.run(editor)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                borderRadius: 9,
                border: `1px solid ${active ? C.accentBorder : C.border}`,
                background: active ? C.accentSubtle : C.bgBase,
                color: active ? C.accent : C.textSecondary,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <Icon size={15} />
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
