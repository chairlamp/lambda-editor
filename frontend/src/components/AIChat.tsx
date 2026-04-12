import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bot, Loader2, RefreshCw, AlignLeft,
  X, FileText, MapPin,
  ArrowRight, Square,
} from 'lucide-react'
import { aiChatApi, streamAI } from '../services/api'
import api from '../services/api'
import { useStore } from '../store/useStore'
import { RoomSocket } from '../services/socket'
import DiffView, { DiffChange } from './DiffView'
import type { AIChatProps as Props, QuoteItem, EquationLocation, ActionRequest, ChatMessage, ActionType, ActiveAction } from './ai-chat/types'
import { ACTION_DEFS, AVAILABLE_ACTIONS, genId, inferActionType, getActionPrompt, mapStoredMessage } from './ai-chat/constants'
import { chip, textareaStyle, closeBtnStyle, userBubble, actionBubble, botBubble, quoteBlockStyle } from './ai-chat/styles'
import MarkdownMessage from './ai-chat/MarkdownMessage'

export default function AIChat({
  socket,
  ydoc,
  onInsertText,
  onClose,
  readOnly,
  pendingQuote,
  onQuoteConsumed,
  pendingEquationLocation,
  isPickingEquationLocation,
  onRequestEquationLocation,
  onCancelEquationLocation,
  currentDocTitle,
}: Props) {
  const selectedTextFromQuotes = (items: QuoteItem[]) => items[items.length - 1]?.text?.trim() || ''
  const disclosureKey = 'ai-disclosure-accepted:v2'
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null)
  const [equationLocation, setEquationLocation] = useState<EquationLocation | null>(null)
  const [retryAction, setRetryAction] = useState<ActionRequest | null>(null)
  const [quotes, setQuotes] = useState<QuoteItem[]>([])
  const [aiDisclosureAccepted, setAiDisclosureAccepted] = useState<boolean>(() => {
    if (localStorage.getItem(disclosureKey) === 'true') return true
    return sessionStorage.getItem('ai-disclosure-accepted:v1') === 'true'
  })
  const [accepted, setAccepted] = useState<Map<string, Set<string>>>(new Map())
  const [rejected, setRejected] = useState<Map<string, Set<string>>>(new Map())
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Track server action IDs separately so streamed updates can resume the right message.
  const streamingMsgRef = useRef(new Map<string, string>())
  const actionRequestRef = useRef(new Map<string, ActionRequest>())
  // AbortController for the active SSE stream so the user can stop generation.
  const abortControllerRef = useRef<AbortController | null>(null)
  const { currentDoc, updateDocContent, user } = useStore()
  const effectiveEquationLocation = equationLocation ?? pendingEquationLocation ?? null
  const canReviewDiffs = !readOnly
  const canInvokeAI = !readOnly

  // Read the latest socket inside callbacks without forcing every handler to resubscribe.
  const socketRef = useRef<RoomSocket | null>(null)
  useEffect(() => { socketRef.current = socket }, [socket])

  const broadcast = useCallback((data: Record<string, unknown>) => {
    socketRef.current?.sendAiChat(data)
  }, [])

  // Pull editor quotes into chat state so the editor can clear its transient selection UI.
  useEffect(() => {
    if (!pendingQuote) return
    setQuotes((prev) => [...prev, { ...pendingQuote, filename: currentDocTitle || 'document' }])
    onQuoteConsumed?.()
  }, [pendingQuote])

  // Mirror picked locations locally so action retries do not depend on editor state surviving.
  useEffect(() => {
    if (!pendingEquationLocation) return
    setEquationLocation(pendingEquationLocation)
  }, [pendingEquationLocation])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!currentDoc?.id || !currentDoc.project_id) {
      setMessages([])
      return
    }

    let cancelled = false
    streamingMsgRef.current.clear()
    actionRequestRef.current.clear()
    setMessages([])
    setAccepted(new Map())
    setRejected(new Map())
    setRetryAction(null)

    aiChatApi.history(currentDoc.project_id, currentDoc.id)
      .then((res) => {
        if (cancelled) return
        const nextMessages = (Array.isArray(res.data) ? res.data : []).map(mapStoredMessage)
        setMessages(nextMessages)
        setAccepted(new Map(nextMessages
          .filter((message) => message.accepted?.length)
          .map((message) => [message.id, new Set(message.accepted)])))
        setRejected(new Map(nextMessages
          .filter((message) => message.rejected?.length)
          .map((message) => [message.id, new Set(message.rejected)])))
        nextMessages.forEach((message) => {
          if (message.retryAction && message.id.endsWith('-diff')) {
            actionRequestRef.current.set(message.id.replace(/-diff$/, ''), message.retryAction)
          }
        })
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })

    return () => { cancelled = true }
  }, [currentDoc?.id, currentDoc?.project_id])

  // Rebuild remote chat activity locally so every collaborator sees the same AI timeline.
  useEffect(() => {
    if (!socket) return
    const off = socket.on('ai_chat', (msg: any) => {
      const event = msg.event as string
      const actionId = msg.action_id as string
      const fromUser = msg.username as string

      if (event === 'user_msg') {
        const actionType = inferActionType(msg.action_type, msg.suggest_instruction, msg.action_label)
        setMessages((prev) => prev.some((m) => m.id === actionId) ? prev : [...prev, {
          id: actionId,
          role: 'user',
          content: msg.content || '',
          fromUser,
          actionType,
          actionPrompt: msg.action_prompt,
          suggestInstruction: msg.suggest_instruction,
          actionLabel: msg.action_label,
          actionColor: msg.action_color,
          quotes: msg.quotes,
        }])

      } else if (event === 'chunk') {
        const chunk = msg.content as string
        const existingMsgId = streamingMsgRef.current.get(actionId)
        if (existingMsgId) {
          setMessages((prev) => prev.map((m) =>
            m.id === existingMsgId ? { ...m, content: m.content + chunk } : m
          ))
        } else {
          const msgId = `${actionId}-res`
          streamingMsgRef.current.set(actionId, msgId)
          setMessages((prev) => [...prev, {
            id: msgId, role: 'assistant', content: chunk, streaming: true, fromUser,
          }])
        }

      } else if (event === 'done') {
        const existingMsgId = streamingMsgRef.current.get(actionId)
        if (existingMsgId) {
          streamingMsgRef.current.delete(actionId)
          setMessages((prev) => prev.map((m) =>
            m.id === existingMsgId ? { ...m, streaming: false } : m
          ))
        }

      } else if (event === 'diff') {
        const retryRequest = (msg.action_request as ActionRequest | undefined) ?? actionRequestRef.current.get(actionId)
        setMessages((prev) => prev.some((m) => m.id === `${actionId}-diff`) ? prev : [...prev, {
          id: `${actionId}-diff`,
          role: 'assistant', content: '', streaming: false,
          diff: msg.diff, toolCalls: msg.tool_calls || msg.diff?.tool_calls || undefined, fromUser, retryAction: retryRequest,
        }])
      } else if (event === 'agent_result') {
        setMessages((prev) => prev.some((m) => m.id === `${actionId}-res`) ? prev : [...prev, {
          id: `${actionId}-res`,
          role: 'assistant',
          content: msg.content || '',
          sources: msg.sources || undefined,
          toolCalls: msg.tool_calls || undefined,
          fromUser,
        }])
      }
    })
    return () => off()
  }, [socket])

  const addUserMsg = (msg: Omit<ChatMessage, 'id'>, id: string) => {
    setMessages((prev) => [...prev, { ...msg, id }])
  }

  const startStreamingMsg = (id: string, firstChunk: string) => {
    setMessages((prev) => [...prev, {
      id, role: 'assistant', content: firstChunk, streaming: true,
    }])
  }

  const appendChunk = (id: string, chunk: string) => {
    setMessages((prev) => prev.map((m) =>
      m.id === id ? { ...m, content: m.content + chunk } : m
    ))
  }

  const finalizeMsg = (id: string) => {
    setMessages((prev) => prev.map((m) =>
      m.id === id ? { ...m, streaming: false } : m
    ))
    setLoading(false)
  }

  const addDiff = (
    id: string,
    diff: { explanation: string; changes: DiffChange[]; tool_calls?: string[] },
    retryRequest?: ActionRequest,
    toolCalls?: ChatMessage['toolCalls'],
  ) => {
    setMessages((prev) => [...prev, {
      id, role: 'assistant', content: '', streaming: false, diff, retryAction: retryRequest, toolCalls,
    }])
  }

  const addAssistantMsg = (id: string, content: string, sources?: ChatMessage['sources'], toolCalls?: ChatMessage['toolCalls']) => {
    setMessages((prev) => [...prev, {
      id,
      role: 'assistant',
      content,
      streaming: false,
      sources,
      toolCalls,
    }])
  }

  const renderToolCalls = (toolCalls?: ChatMessage['toolCalls']) => {
    if (!toolCalls || toolCalls.length === 0) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '100%' }}>
        {toolCalls.map((toolName, index) => (
          <span
            key={`${toolName}-${index}`}
            style={{
              fontSize: 10,
              color: '#cbd5e1',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: 999,
              padding: '3px 7px',
              textTransform: 'lowercase',
            }}
          >
            {toolName}
          </span>
        ))}
      </div>
    )
  }

  const stopGeneration = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  // Share chunks as they arrive so collaborators do not wait for the final response.
  const runStream = async (
    endpoint: string,
    payload: Record<string, unknown>,
    aid: string,
  ) => {
    const controller = new AbortController()
    abortControllerRef.current = controller
    const responseId = `${aid}-res`
    let started = false
    await streamAI(
      endpoint,
      payload,
      (chunk) => {
        if (!started) {
          started = true
          startStreamingMsg(responseId, chunk)
        } else {
          appendChunk(responseId, chunk)
        }
        broadcast({ event: 'chunk', content: chunk, action_id: aid })
      },
      () => {
        abortControllerRef.current = null
        finalizeMsg(responseId)
        broadcast({ event: 'done', action_id: aid })
      },
      (err) => {
        abortControllerRef.current = null
        const errorChunk = `**Error:** ${err}`
        if (!started) startStreamingMsg(responseId, errorChunk)
        else appendChunk(responseId, errorChunk)
        finalizeMsg(responseId)
        broadcast({ event: 'done', action_id: aid })
      },
      controller.signal,
    )
  }

  const sendMessage = async () => {
    if (loading || !canInvokeAI || !aiDisclosureAccepted) return
    if (activeAction) { await submitAction(); return }
    if (retryAction) { await submitRetryAction(); return }
    const text = input.trim()
    if (!text && quotes.length === 0) return

    const currentQuotes = [...quotes]
    setInput('')
    setQuotes([])
    setLoading(true)

    const aid = genId()
    const quotesContext = currentQuotes.map((q) =>
      `[Quote from ${q.filename}:${q.lineStart}-${q.lineEnd}]\n${q.text}`
    ).join('\n\n')
    const fullPrompt = quotesContext ? `${quotesContext}\n\n${text}` : text

    addUserMsg({ role: 'user', content: text, quotes: currentQuotes }, aid)
    broadcast({ event: 'user_msg', content: text, quotes: currentQuotes, action_id: aid })
    try {
      const res = await aiChatApi.agent(currentDoc?.project_id || '', currentDoc?.id || '', {
        prompt: fullPrompt,
        document_context: currentDoc?.content ?? '',
        action_id: aid,
      })
      addAssistantMsg(
        `${aid}-res`,
        res.data.content || '',
        res.data.sources || undefined,
        Array.isArray(res.data.tools_used) ? res.data.tools_used : undefined,
      )
      broadcast({
        event: 'agent_result',
        action_id: aid,
        content: res.data.content || '',
        sources: res.data.sources || undefined,
        tool_calls: Array.isArray(res.data.tools_used) ? res.data.tools_used : undefined,
      })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      addAssistantMsg(`${aid}-res`, `**Error:** ${typeof detail === 'string' ? detail : 'Agent request failed.'}`)
    } finally {
      setLoading(false)
    }
  }

  const runDiffAction = async (request: ActionRequest, currentQuotes: QuoteItem[], variationRequest = '') => {
    const aid = genId()
    const actionPrompt = getActionPrompt(request, variationRequest)
    addUserMsg({ role: 'user', content: '', quotes: currentQuotes, actionType: request.type, actionPrompt }, aid)
    broadcast({ event: 'user_msg', action_type: request.type, action_prompt: actionPrompt, quotes: currentQuotes, action_id: aid })
    actionRequestRef.current.set(aid, request)
    setLoading(true)

    try {
      let res
      if (request.type === 'equation') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/equation-suggestions`, {
          description: request.description,
          document_content: currentDoc?.content || '',
          location: request.location,
          variation_request: variationRequest,
          action_id: aid,
        })
      } else if (request.type === 'translate') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/translation-suggestions`, {
          language: request.language,
          text: request.text,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
        })
      } else if (request.type === 'suggest') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/change-suggestions`, {
          instruction: request.instruction,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
        })
      } else {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/rewrite-suggestions`, {
          text: request.text,
          style: request.type,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
        })
      }
      const toolCalls = Array.isArray(res.data.tool_calls) ? res.data.tool_calls : undefined
      addDiff(`${aid}-diff`, res.data, request, toolCalls)
      broadcast({ event: 'diff', diff: res.data, tool_calls: toolCalls, action_id: aid, action_request: request })
    } catch {
      const explanation = request.type === 'equation'
        ? 'Could not generate equation.'
        : request.type === 'translate'
          ? 'Could not translate.'
          : request.type === 'suggest'
            ? 'Could not fetch suggestions.'
            : `Could not ${request.type}.`
      const fallbackDiff = { explanation, changes: [] }
      addDiff(`${aid}-diff`, fallbackDiff, request)
    } finally {
      setLoading(false)
    }
  }

  const submitAction = async () => {
    if (!activeAction || loading || !canInvokeAI || !aiDisclosureAccepted) return
    const val = input.trim()
    const loc = effectiveEquationLocation
    const selectedText = selectedTextFromQuotes(quotes)
    if (activeAction.type === 'equation') {
      if (!val) return
      if (!loc) {
        setEquationLocation(null)
        onRequestEquationLocation?.()
        return
      }
    } else if (activeAction.type === 'translate' && (!val || !selectedText)) {
      return
    } else if ((activeAction.type === 'simplify' || activeAction.type === 'summarize') && !val && !(currentDoc?.content?.slice(-3000))) {
      return
    }

    const currentQuotes = [...quotes]
    setInput('')
    setEquationLocation(null)
    setQuotes([])
    setActiveAction(null)
    setRetryAction(null)
    onCancelEquationLocation?.()

    if (activeAction.type === 'summarize') {
      const text = val || currentDoc?.content?.slice(-3000) || ''
      const aid = genId()
      const actionPrompt = text === (currentDoc?.content?.slice(-3000) || '') && !val ? 'Full document' : val
      addUserMsg({ role: 'user', content: '', quotes: currentQuotes, actionType: 'summarize', actionPrompt }, aid)
      broadcast({ event: 'user_msg', action_type: 'summarize', action_prompt: actionPrompt, quotes: currentQuotes, action_id: aid })
      setLoading(true)
      await runStream(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/rewrites`, {
        text,
        style: 'summarize',
        document_context: currentDoc?.content ?? '',
        action_id: aid,
      }, aid)
      return
    }

    const request: ActionRequest = activeAction.type === 'equation'
      ? { type: 'equation', description: val, location: loc! }
      : activeAction.type === 'translate'
        ? { type: 'translate', language: val, text: selectedText }
        : activeAction.type === 'suggest'
          ? { type: 'suggest', instruction: val || 'Suggest improvements for this LaTeX document' }
          : { type: activeAction.type, text: val || currentDoc?.content?.slice(-3000) || '' }

    await runDiffAction(request, currentQuotes)
  }

  const submitRetryAction = async () => {
    if (!retryAction || loading || !aiDisclosureAccepted) return
    const variationRequest = input.trim()
    const currentQuotes = [...quotes]
    setInput('')
    setQuotes([])
    setRetryAction(null)
    setActiveAction(null)
    await runDiffAction(retryAction, currentQuotes, variationRequest)
  }

  const activateAction = (type: ActionType) => {
    const nextAction = activeAction?.type === type ? null : { type, ...ACTION_DEFS[type] }
    setActiveAction(nextAction)
    setRetryAction(null)
    setEquationLocation(null)
    onCancelEquationLocation?.()
    textareaRef.current?.focus()
  }

  // Apply accepted diffs through Yjs so reviews become collaborative edits instead of local patches.
  const applyChange = useCallback((change: DiffChange) => {
    if (!ydoc) return
    const ytext = ydoc.getText('content')
    const content = ytext.toString()
    const idx = content.indexOf(change.old_text)
    if (idx === -1) return
    ydoc.transact(() => {
      ytext.delete(idx, change.old_text.length)
      ytext.insert(idx, change.new_text)
    })
  }, [ydoc])

  const persistReviewState = useCallback((messageId: string, nextAccepted: Set<string>, nextRejected: Set<string>) => {
    if (!canReviewDiffs || !currentDoc?.id || !currentDoc.project_id) return
    void aiChatApi.updateReviewState(
      currentDoc.project_id,
      currentDoc.id,
      messageId,
      [...nextAccepted],
      [...nextRejected],
    )
  }, [canReviewDiffs, currentDoc?.id, currentDoc?.project_id])

  const handleAccept = useCallback((id: string, change: DiffChange) => {
    if (!canReviewDiffs) return
    applyChange(change)
    setAccepted((prev) => {
      const m = new Map(prev)
      const nextAccepted = new Set([...(m.get(id) ?? []), change.id])
      m.set(id, nextAccepted)
      const nextRejected = new Set(rejected.get(id) ?? [])
      nextRejected.delete(change.id)
      persistReviewState(id, nextAccepted, nextRejected)
      return m
    })
    setRejected((prev) => {
      const m = new Map(prev)
      const nextRejected = new Set(m.get(id) ?? [])
      nextRejected.delete(change.id)
      if (nextRejected.size > 0) m.set(id, nextRejected)
      else m.delete(id)
      return m
    })
  }, [applyChange, canReviewDiffs, persistReviewState, rejected])

  const handleReject = useCallback((id: string, changeId: string) => {
    if (!canReviewDiffs) return
    setRejected((prev) => {
      const m = new Map(prev)
      const nextRejected = new Set([...(m.get(id) ?? []), changeId])
      m.set(id, nextRejected)
      const nextAccepted = new Set(accepted.get(id) ?? [])
      nextAccepted.delete(changeId)
      persistReviewState(id, nextAccepted, nextRejected)
      return m
    })
    setAccepted((prev) => {
      const m = new Map(prev)
      const nextAccepted = new Set(m.get(id) ?? [])
      nextAccepted.delete(changeId)
      if (nextAccepted.size > 0) m.set(id, nextAccepted)
      else m.delete(id)
      return m
    })
  }, [accepted, canReviewDiffs, persistReviewState])

  const handleAcceptAll = useCallback((id: string, changes: DiffChange[]) => {
    if (!canReviewDiffs || !ydoc) return
    const ytext = ydoc.getText('content')
    ydoc.transact(() => {
      for (const change of changes) {
        const content = ytext.toString()
        const idx = content.indexOf(change.old_text)
        if (idx === -1) continue
        ytext.delete(idx, change.old_text.length)
        ytext.insert(idx, change.new_text)
      }
    })
    const nextAccepted = new Set(changes.map((c) => c.id))
    const nextRejected = new Set<string>()
    setAccepted((prev) => { const m = new Map(prev); m.set(id, nextAccepted); return m })
    setRejected((prev) => { const m = new Map(prev); m.delete(id); return m })
    persistReviewState(id, nextAccepted, nextRejected)
  }, [canReviewDiffs, ydoc, persistReviewState])

  const handleRejectAll = useCallback((id: string, changes: DiffChange[]) => {
    if (!canReviewDiffs) return
    const nextAccepted = new Set<string>()
    const nextRejected = new Set(changes.map((c) => c.id))
    setRejected((prev) => { const m = new Map(prev); m.set(id, nextRejected); return m })
    setAccepted((prev) => { const m = new Map(prev); m.delete(id); return m })
    persistReviewState(id, nextAccepted, nextRejected)
  }, [canReviewDiffs, persistReviewState])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#12122a', fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ padding: '8px 12px', background: '#16213e', borderBottom: '1px solid #1e2a4a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Bot size={15} color="#818cf8" />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#c7d2fe' }}>AI Assistant</span>
          {loading && <Loader2 size={12} color="#818cf8" style={{ animation: 'spin 1s linear infinite', marginLeft: 4 }} />}
          <div style={{ flex: 1 }} />
          {loading && (
            <button
              onClick={stopGeneration}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: '#7f1d1d40', border: '1px solid #7f1d1d',
                borderRadius: 5, color: '#f87171', fontSize: 11,
                padding: '3px 8px', cursor: 'pointer',
              }}
              title="Stop generation"
            >
              <Square size={10} fill="#f87171" /> Stop
            </button>
          )}
          {onClose && (
            <button onClick={onClose} style={closeBtnStyle} title="Close"><X size={12} /></button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '7px 10px', borderBottom: '1px solid #1e1e3a', flexShrink: 0 }}>
        {AVAILABLE_ACTIONS.map((type) => {
          const def = ACTION_DEFS[type]
          const active = activeAction?.type === type
          return (
            <button
              key={type}
              onClick={() => !loading && canInvokeAI && activateAction(type)}
              style={{
                ...chip,
                color: def.color,
                borderColor: active ? def.color : '#2a2a4a',
                background: active ? `${def.color}18` : 'transparent',
                opacity: loading || !canInvokeAI ? 0.4 : 1,
                cursor: loading || !canInvokeAI ? 'default' : 'pointer',
              }}
              disabled={loading || !canInvokeAI}
            >
              {def.icon} {def.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!aiDisclosureAccepted && canInvokeAI && (
          <div style={{
            background: '#1f2a44', border: '1px solid #2f4f7f', borderRadius: 10,
            padding: 12, color: '#dbeafe', fontSize: 12, lineHeight: 1.6,
          }}>
            Selected document content may be sent to a third-party AI provider. By continuing, you confirm that AI requests should use only the selected content and necessary context unless you explicitly request broader scope.
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  localStorage.setItem(disclosureKey, 'true')
                  setAiDisclosureAccepted(true)
                }}
                style={{ background: '#60a5fa', color: '#0f172a', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                I Understand
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ color: '#3a3a6a', fontSize: 12, textAlign: 'center', marginTop: 48, lineHeight: 1.8 }}>
            {canInvokeAI ? 'Ask anything. Chat can now use web search, research, and translation tools.' : 'AI actions are unavailable in viewer mode.'}
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === 'user'
          const messageActionType = inferActionType(m.actionType, m.suggestInstruction, m.actionLabel)
          const authorName = isUser
            ? (m.fromUser || user?.username || 'You')
            : 'Lambda AI Chatbot'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 3 }}>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: isUser ? '#818cf8' : '#4ade80',
                paddingLeft: isUser ? 0 : 2,
                paddingRight: isUser ? 2 : 0,
              }}>
                {authorName}
              </span>

              {isUser ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, maxWidth: '90%' }}>
                  {m.quotes && m.quotes.map((q, qi) => (
                    <div key={qi} style={quoteBlockStyle}>
                      <div style={{ fontSize: 10, color: '#818cf8', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={9} /> {q.filename}:{q.lineStart}–{q.lineEnd}
                      </div>
                      <pre style={{ fontSize: 11, color: '#9ca3af', margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                        {q.text.length > 150 ? q.text.slice(0, 150) + '…' : q.text}
                      </pre>
                    </div>
                  ))}
                  {messageActionType ? (
                    <div
                      title={ACTION_DEFS[messageActionType].label}
                      style={{
                        ...actionBubble,
                        color: ACTION_DEFS[messageActionType].color,
                        borderColor: `${ACTION_DEFS[messageActionType].color}60`,
                        background: `${ACTION_DEFS[messageActionType].color}12`,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <span style={{ display: 'flex', flexShrink: 0 }}>
                          {ACTION_DEFS[messageActionType].icon}
                        </span>
                        {m.actionPrompt && (
                          <span style={{ fontSize: 12, color: '#dbeafe', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.actionPrompt}
                          </span>
                        )}
                      </span>
                    </div>
                  ) : m.content ? (
                    <div style={userBubble}>{m.content}</div>
                  ) : null}
                </div>
              ) : m.diff ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {renderToolCalls(m.toolCalls)}
                  <DiffView
                    explanation={m.diff.explanation}
                    changes={m.diff.changes}
                    accepted={accepted.get(m.id) ?? new Set()}
                    rejected={rejected.get(m.id) ?? new Set()}
                    onAccept={(c) => handleAccept(m.id, c)}
                    onReject={(id) => handleReject(m.id, id)}
                    onAcceptAll={() => handleAcceptAll(m.id, m.diff!.changes)}
                    onRejectAll={() => handleRejectAll(m.id, m.diff!.changes)}
                    canReview={canReviewDiffs}
                    onAskDifferent={m.retryAction ? () => {
                      if (canReviewDiffs) handleRejectAll(m.id, m.diff!.changes)
                      setRetryAction(m.retryAction!)
                      setActiveAction(null)
                      setEquationLocation(null)
                      onCancelEquationLocation?.()
                      textareaRef.current?.focus()
                    } : undefined}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '100%' }}>
                  <div style={botBubble}>
                    <MarkdownMessage content={m.content} onInsertText={onInsertText} />
                    {m.streaming && <span style={{ opacity: 0.4, fontSize: 12 }}>▊</span>}
                  </div>
                  {renderToolCalls(m.toolCalls)}
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '100%' }}>
                      {m.sources.map((source, index) => (
                        <a
                          key={`${m.id}-source-${index}`}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11,
                            color: '#93c5fd',
                            background: '#172033',
                            border: '1px solid #274060',
                            borderRadius: 999,
                            padding: '4px 8px',
                            textDecoration: 'none',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={source.url}
                        >
                          {source.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '8px 10px', borderTop: '1px solid #1e1e3a', flexShrink: 0 }}>
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {quotes.map((q, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: '#1e1e3a', border: '1px solid #4f46e5', borderRadius: 6,
                padding: '3px 8px', fontSize: 11, color: '#818cf8',
              }}>
                <FileText size={9} />
                {q.filename}:{q.lineStart}–{q.lineEnd}
                <button
                  onClick={() => setQuotes((prev) => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, display: 'flex', marginLeft: 2 }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{
          background: '#1a1a35',
          border: `1px solid ${activeAction ? activeAction.color + '60' : retryAction ? ACTION_DEFS[retryAction.type].color + '60' : '#2a2a4a'}`,
          borderRadius: 8, overflow: 'hidden',
        }}>
          {retryAction && !activeAction && (
            <div style={{ borderBottom: '1px solid #2a2a4a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 4px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: ACTION_DEFS[retryAction.type].color, fontSize: 11, fontWeight: 600 }}>
                  <ArrowRight size={11} /> Continue
                </span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {ACTION_DEFS[retryAction.type].label}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setRetryAction(null)}
                  style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={11} />
                </button>
              </div>
            </div>
          )}
          {activeAction && (
            <div style={{ borderBottom: '1px solid #2a2a4a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 4px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: activeAction.color, fontSize: 11, fontWeight: 600 }}>
                  {activeAction.icon} {activeAction.label}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => {
                  setActiveAction(null)
                  setRetryAction(null)
                  setEquationLocation(null)
                  onCancelEquationLocation?.()
                }}
                  style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={11} />
                </button>
              </div>
              {activeAction.type === 'equation' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 6px' }}>
                  <MapPin size={10} color="#fbbf24" style={{ flexShrink: 0 }} />
                  {effectiveEquationLocation ? (
                    <>
                      <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, flexShrink: 0 }}>
                        Line {effectiveEquationLocation.line}
                      </span>
                      <span style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {(() => {
                          const displayText = effectiveEquationLocation.text.trim() || '(empty line)'
                          return displayText.length > 36 ? displayText.slice(0, 36) + '…' : displayText
                        })()}
                      </span>
                      <button
                        onClick={() => {
                          setEquationLocation(null)
                          onRequestEquationLocation?.()
                        }}
                        title="Pick a different location"
                        style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <RefreshCw size={10} />
                      </button>
                      <button
                        onClick={() => {
                          setEquationLocation(null)
                          onCancelEquationLocation?.()
                        }}
                        style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : isPickingEquationLocation ? (
                    <>
                      <span style={{ fontSize: 11, color: '#fde68a', flex: 1 }}>
                        Click a line in the editor to place the equation
                      </span>
                      <button
                        onClick={() => onCancelEquationLocation?.()}
                        style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onRequestEquationLocation?.()}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        fontSize: 11, color: '#fbbf2499', display: 'flex', alignItems: 'center', gap: 4,
                        textDecoration: 'underline dotted',
                      }}
                    >
                      Click in the editor to set insertion point <span style={{ color: '#f87171' }}>*</span>
                    </button>
                  )}
                </div>
              )}
              {activeAction.type === 'translate' && (
                <div style={{ padding: '0 10px 6px', fontSize: 11, color: selectedTextFromQuotes(quotes) ? '#86efac' : '#fca5a5' }}>
                  {selectedTextFromQuotes(quotes)
                    ? 'Selected passage ready. Enter the target language.'
                    : 'Quote a passage from the editor first, then enter the target language.'}
                </div>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
              if (e.key === 'Escape' && (activeAction || retryAction)) {
                setActiveAction(null)
                setRetryAction(null)
                setEquationLocation(null)
                onCancelEquationLocation?.()
              }
            }}
            placeholder={
              !canInvokeAI
                ? 'AI actions require editor access'
                : retryAction
                  ? 'How should it be different? Leave empty for another alternative'
                  : activeAction?.placeholder ?? 'Message…'
            }
            disabled={loading || !canInvokeAI || !aiDisclosureAccepted}
            rows={2}
            style={textareaStyle}
          />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
