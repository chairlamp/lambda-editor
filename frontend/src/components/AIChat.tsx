import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bot, Loader2, RefreshCw, AlignLeft,
  X, FileText, MapPin,
  ArrowRight, Square, History, PlusSquare,
} from 'lucide-react'
import { aiChatApi, streamAI } from '../services/api'
import api from '../services/api'
import { useStore } from '../store/useStore'
import { RoomSocket } from '../services/socket'
import { C } from '../design'
import DiffView, { DiffChange } from './DiffView'
import type { AIChatProps as Props, QuoteItem, EquationLocation, ActionRequest, ChatMessage, ActionType, ActiveAction, ChatThreadSummary } from './ai-chat/types'
import { ACTION_DEFS, AVAILABLE_ACTIONS, genId, inferActionType, getActionPrompt, mapStoredMessage, mapStoredThread } from './ai-chat/constants'
import { chip, textareaStyle, closeBtnStyle, userBubble, actionBubble, botBubble, quoteBlockStyle } from './ai-chat/styles'
import MarkdownMessage from './ai-chat/MarkdownMessage'

type ActiveRequestState = {
  actionId: string
  responseId: string
  kind: 'assistant' | 'diff'
  retryRequest?: ActionRequest
}

const genThreadId = () => `thread-${genId()}`

const createDraftThread = (threadId: string): ChatThreadSummary => {
  const now = new Date().toISOString()
  return {
    id: threadId,
    title: 'New chat',
    preview: 'Start a fresh conversation for this document.',
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    localOnly: true,
  }
}

const toTimestamp = (value?: string) => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

const sortThreads = (threads: ChatThreadSummary[]) => [...threads].sort((a, b) => (
  toTimestamp(b.updatedAt ?? b.createdAt) - toTimestamp(a.updatedAt ?? a.createdAt)
))

const formatThreadTime = (value?: string) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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
  const [showHistory, setShowHistory] = useState(false)
  const [threadSummaries, setThreadSummaries] = useState<ChatThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState('')
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null)
  const [equationLocation, setEquationLocation] = useState<EquationLocation | null>(null)
  const [retryAction, setRetryAction] = useState<ActionRequest | null>(null)
  const [quotes, setQuotes] = useState<QuoteItem[]>([])
  const [, setDriftCheckVersion] = useState(0)
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
  // AbortController for the active AI request so the user can stop generation consistently.
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeRequestRef = useRef<ActiveRequestState | null>(null)
  const activeThreadIdRef = useRef('')
  const cancelEquationLocationRef = useRef(onCancelEquationLocation)
  const { currentDoc, user } = useStore()
  const effectiveEquationLocation = equationLocation ?? pendingEquationLocation ?? null
  const canReviewDiffs = !readOnly
  const canInvokeAI = !readOnly

  // Read the latest socket inside callbacks without forcing every handler to resubscribe.
  const socketRef = useRef<RoomSocket | null>(null)
  useEffect(() => { socketRef.current = socket }, [socket])
  useEffect(() => { activeThreadIdRef.current = activeThreadId }, [activeThreadId])
  useEffect(() => { cancelEquationLocationRef.current = onCancelEquationLocation }, [onCancelEquationLocation])

  const broadcast = useCallback((data: Record<string, unknown>) => {
    socketRef.current?.sendAiChat({
      ...data,
      thread_id: activeThreadIdRef.current,
    })
  }, [])

  const clearActiveRequest = () => {
    abortControllerRef.current = null
    activeRequestRef.current = null
  }

  const isAbortError = (err: any) => (
    err?.name === 'AbortError'
    || err?.name === 'CanceledError'
    || err?.code === 'ERR_CANCELED'
    || err?.message === 'canceled'
  )

  const refreshDriftChecks = useCallback(() => {
    setDriftCheckVersion((prev) => prev + 1)
  }, [])

  const getCurrentDocumentContent = useCallback(() => {
    if (ydoc) {
      return ydoc.getText('content').toString()
    }
    return currentDoc?.content || ''
  }, [currentDoc?.content, ydoc])

  useEffect(() => {
    if (!ydoc) return
    const ytext = ydoc.getText('content')
    const handleDocumentUpdate = () => {
      setDriftCheckVersion((prev) => prev + 1)
    }
    ytext.observe(handleDocumentUpdate)
    return () => ytext.unobserve(handleDocumentUpdate)
  }, [ydoc])

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

  const resetComposerState = useCallback(() => {
    setInput('')
    setQuotes([])
    setRetryAction(null)
    setActiveAction(null)
    setEquationLocation(null)
    cancelEquationLocationRef.current?.()
  }, [])

  const refreshThreadSummaries = useCallback(async () => {
    if (!currentDoc?.id || !currentDoc.project_id) {
      setThreadSummaries([])
      return [] as ChatThreadSummary[]
    }

    const res = await aiChatApi.threads(currentDoc.project_id, currentDoc.id)
    const serverThreads = (Array.isArray(res.data) ? res.data : []).map(mapStoredThread)
    setThreadSummaries((prev) => {
      const activeDraft = prev.find((thread) => (
        thread.localOnly
        && thread.id === activeThreadIdRef.current
        && !serverThreads.some((serverThread) => serverThread.id === thread.id)
      ))
      return sortThreads(activeDraft ? [activeDraft, ...serverThreads] : serverThreads)
    })
    return serverThreads
  }, [currentDoc?.id, currentDoc?.project_id])

  useEffect(() => {
    if (!currentDoc?.id || !currentDoc.project_id) {
      setMessages([])
      setThreadSummaries([])
      setActiveThreadId('')
      return
    }

    let cancelled = false
    clearActiveRequest()
    streamingMsgRef.current.clear()
    actionRequestRef.current.clear()
    setLoading(false)
    setShowHistory(false)
    setMessages([])
    setAccepted(new Map())
    setRejected(new Map())
    resetComposerState()

    const bootstrapThreads = async () => {
      try {
        const nextThreads = await refreshThreadSummaries()
        if (cancelled) return
        setActiveThreadId(nextThreads[0]?.id || genThreadId())
      } catch {
        if (!cancelled) {
          setThreadSummaries([])
          setActiveThreadId(genThreadId())
        }
      }
    }

    void bootstrapThreads()
    return () => { cancelled = true }
  }, [currentDoc?.id, currentDoc?.project_id, refreshThreadSummaries, resetComposerState])

  useEffect(() => {
    if (!currentDoc?.id || !currentDoc.project_id || !activeThreadId) {
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

    aiChatApi.history(currentDoc.project_id, currentDoc.id, activeThreadId)
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
  }, [activeThreadId, currentDoc?.id, currentDoc?.project_id])

  // Rebuild remote chat activity locally so every collaborator sees the same AI timeline.
  useEffect(() => {
    if (!socket) return
    const off = socket.on('ai_chat', (msg: any) => {
      const event = msg.event as string
      const actionId = msg.action_id as string
      const fromUser = msg.username as string
      const eventThreadId = typeof msg.thread_id === 'string' && msg.thread_id.trim()
        ? msg.thread_id.trim()
        : currentDoc?.id || ''

      if (eventThreadId && activeThreadIdRef.current && eventThreadId !== activeThreadIdRef.current) {
        if (event === 'user_msg' || event === 'done' || event === 'cancelled' || event === 'diff' || event === 'agent_result') {
          void refreshThreadSummaries()
        }
        return
      }

      if (event === 'user_msg') {
        const actionType = inferActionType(msg.action_type, msg.suggest_instruction, msg.action_label)
        setMessages((prev) => prev.some((m) => m.id === actionId) ? prev : [...prev, {
          id: actionId,
          threadId: eventThreadId,
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
            id: msgId, threadId: eventThreadId, role: 'assistant', content: chunk, streaming: true, fromUser,
          }])
        }

      } else if (event === 'done') {
        const existingMsgId = streamingMsgRef.current.get(actionId)
        if (existingMsgId) {
          streamingMsgRef.current.delete(actionId)
          setMessages((prev) => prev.map((m) =>
            m.id === existingMsgId
              ? { ...m, streaming: false, status: msg.status || m.status || 'completed', error: msg.error || m.error }
              : m
          ))
        }

      } else if (event === 'cancelled') {
        const responseKind = msg.response_kind === 'diff' ? 'diff' : 'res'
        const responseId = (msg.response_id as string | undefined) || `${actionId}-${responseKind}`
        const retryRequest = (msg.action_request as ActionRequest | undefined) ?? actionRequestRef.current.get(actionId)
        const cancellationMessage = typeof msg.error === 'string' && msg.error ? msg.error : 'Cancelled by user'
        if (streamingMsgRef.current.get(actionId) === responseId) {
          streamingMsgRef.current.delete(actionId)
        }
        setMessages((prev) => {
          const existing = prev.find((message) => message.id === responseId)
          if (existing) {
            return prev.map((message) => (
              message.id === responseId
                ? {
                    ...message,
                    streaming: false,
                    status: 'cancelled',
                    error: cancellationMessage,
                    content: responseKind === 'res' && !message.content ? cancellationMessage : message.content,
                    diff: responseKind === 'diff' ? (message.diff ?? { explanation: cancellationMessage, changes: [] }) : message.diff,
                    retryAction: responseKind === 'diff' ? (message.retryAction ?? retryRequest) : message.retryAction,
                  }
                : message
            ))
          }

          if (responseKind === 'diff') {
            return [...prev, {
              id: responseId,
              threadId: eventThreadId,
              role: 'assistant',
              content: '',
              streaming: false,
              diff: { explanation: cancellationMessage, changes: [] },
              retryAction: retryRequest,
              fromUser,
              status: 'cancelled',
              error: cancellationMessage,
            }]
          }

          return [...prev, {
            id: responseId,
            threadId: eventThreadId,
            role: 'assistant',
            content: cancellationMessage,
            streaming: false,
            fromUser,
            status: 'cancelled',
            error: cancellationMessage,
          }]
        })

      } else if (event === 'diff') {
        const retryRequest = (msg.action_request as ActionRequest | undefined) ?? actionRequestRef.current.get(actionId)
        setMessages((prev) => prev.some((m) => m.id === `${actionId}-diff`) ? prev : [...prev, {
          id: `${actionId}-diff`,
          threadId: eventThreadId,
          role: 'assistant', content: '', streaming: false,
          diff: msg.diff,
          toolCalls: msg.tool_calls || msg.diff?.tool_calls || undefined,
          fromUser,
          retryAction: retryRequest,
          provider: msg.provider || undefined,
          model: msg.model || undefined,
          status: msg.status || undefined,
          error: msg.error || undefined,
        }])
      } else if (event === 'agent_result') {
        const responseId = `${actionId}-res`
        const nextMessage: ChatMessage = {
          id: responseId,
          threadId: eventThreadId,
          role: 'assistant',
          content: msg.content || '',
          sources: msg.sources || undefined,
          toolCalls: msg.tool_calls || undefined,
          fromUser,
          provider: msg.provider || undefined,
          model: msg.model || undefined,
          status: msg.status || undefined,
          error: msg.error || undefined,
        }
        setMessages((prev) => {
          const existing = prev.find((message) => message.id === responseId)
          if (!existing) return [...prev, nextMessage]
          return prev.map((message) => (
            message.id === responseId ? { ...message, ...nextMessage } : message
          ))
        })
      }
    })
    return () => off()
  }, [currentDoc?.id, refreshThreadSummaries, socket])

  const addUserMsg = (msg: Omit<ChatMessage, 'id'>, id: string) => {
    setMessages((prev) => [...prev, { ...msg, id, threadId: activeThreadIdRef.current }])
  }

  const startStreamingMsg = (id: string, firstChunk: string, meta?: Pick<ChatMessage, 'provider' | 'model' | 'status' | 'error'>) => {
    setMessages((prev) => [...prev, {
      id, threadId: activeThreadIdRef.current, role: 'assistant', content: firstChunk, streaming: true, ...meta,
    }])
  }

  const appendChunk = (id: string, chunk: string) => {
    setMessages((prev) => prev.map((m) =>
      m.id === id ? { ...m, content: m.content + chunk } : m
    ))
  }

  const finalizeMsg = (id: string, meta?: Pick<ChatMessage, 'status' | 'error'>) => {
    setMessages((prev) => prev.map((m) =>
      m.id === id ? { ...m, streaming: false, ...meta } : m
    ))
    setLoading(false)
  }

  const addDiff = (
    id: string,
    diff: { explanation: string; changes: DiffChange[]; tool_calls?: string[] },
    retryRequest?: ActionRequest,
    toolCalls?: ChatMessage['toolCalls'],
    meta?: Pick<ChatMessage, 'provider' | 'model' | 'status' | 'error'>,
  ) => {
    setMessages((prev) => [...prev, {
      id, threadId: activeThreadIdRef.current, role: 'assistant', content: '', streaming: false, diff, retryAction: retryRequest, toolCalls, ...meta,
    }])
  }

  const addAssistantMsg = (
    id: string,
    content: string,
    sources?: ChatMessage['sources'],
    toolCalls?: ChatMessage['toolCalls'],
    meta?: Pick<ChatMessage, 'provider' | 'model' | 'status' | 'error'>,
  ) => {
    setMessages((prev) => [...prev, {
      id,
      threadId: activeThreadIdRef.current,
      role: 'assistant',
      content,
      streaming: false,
      sources,
      toolCalls,
      ...meta,
    }])
  }

  const upsertAssistantMsg = (message: ChatMessage) => {
    setMessages((prev) => {
      const nextMessage = { ...message, threadId: message.threadId || activeThreadIdRef.current }
      const existing = prev.find((entry) => entry.id === message.id)
      if (!existing) return [...prev, nextMessage]
      return prev.map((entry) => (
        entry.id === message.id
          ? { ...entry, ...nextMessage, streaming: false }
          : entry
      ))
    })
  }

  const markCancelled = (
    responseId: string,
    kind: ActiveRequestState['kind'],
    retryRequest?: ActionRequest,
  ) => {
    const cancellationMessage = 'Cancelled by user'
    setMessages((prev) => {
      const existing = prev.find((message) => message.id === responseId)
      if (existing) {
        return prev.map((message) => (
          message.id === responseId
            ? {
                ...message,
                streaming: false,
                status: 'cancelled',
                error: cancellationMessage,
                content: kind === 'assistant' && !message.content ? cancellationMessage : message.content,
                diff: kind === 'diff' ? (message.diff ?? { explanation: cancellationMessage, changes: [] }) : message.diff,
                retryAction: kind === 'diff' ? (message.retryAction ?? retryRequest) : message.retryAction,
              }
            : message
        ))
      }

      if (kind === 'diff') {
        return [...prev, {
          id: responseId,
          threadId: activeThreadIdRef.current,
          role: 'assistant',
          content: '',
          streaming: false,
          diff: { explanation: cancellationMessage, changes: [] },
          retryAction: retryRequest,
          status: 'cancelled',
          error: cancellationMessage,
        }]
      }

      return [...prev, {
        id: responseId,
        threadId: activeThreadIdRef.current,
        role: 'assistant',
        content: cancellationMessage,
        streaming: false,
        status: 'cancelled',
        error: cancellationMessage,
      }]
    })
    setLoading(false)
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
              color: C.textPrimary,
              background: C.bgSurface,
              border: `1px solid ${C.borderStrong}`,
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

  const renderAuditMeta = (message: ChatMessage) => {
    const values = [message.provider, message.model, message.status].filter(Boolean) as string[]
    if (values.length === 0 && !message.error) return null

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '100%' }}>
        {values.map((value, index) => (
          <span
            key={`${message.id}-audit-${value}-${index}`}
            style={{
              fontSize: 10,
              color: C.textMuted,
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: '3px 7px',
            }}
          >
            {value}
          </span>
        ))}
        {message.error && (
          <span
            style={{
              fontSize: 10,
              color: C.red,
              background: C.redSubtle,
              border: `1px solid ${C.red}`,
              borderRadius: 999,
              padding: '3px 7px',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={message.error}
          >
            {message.error}
          </span>
        )}
      </div>
    )
  }

  const stopGeneration = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  const openThread = useCallback((threadId: string) => {
    if (!threadId || loading) return
    resetComposerState()
    setAccepted(new Map())
    setRejected(new Map())
    setMessages([])
    setShowHistory(false)
    setActiveThreadId(threadId)
  }, [loading, resetComposerState])

  const startNewChat = useCallback(() => {
    if (loading) return
    const threadId = genThreadId()
    setThreadSummaries((prev) => sortThreads([
      createDraftThread(threadId),
      ...prev.filter((thread) => !thread.localOnly && thread.id !== threadId),
    ]))
    openThread(threadId)
  }, [loading, openThread])

  const hydrateAssistantMessage = useCallback(async (responseId: string) => {
    if (!currentDoc?.project_id || !currentDoc?.id || !activeThreadIdRef.current) return
    try {
      const res = await aiChatApi.history(currentDoc.project_id, currentDoc.id, activeThreadIdRef.current)
      const stored = (Array.isArray(res.data) ? res.data : []).find((message: any) => message.id === responseId)
      if (!stored) return
      const message = mapStoredMessage(stored)
      if (message.role !== 'assistant') return
      upsertAssistantMsg({ ...message, streaming: false })
    } catch {
      // Best-effort metadata hydration should not interrupt the active chat flow.
    }
  }, [currentDoc?.id, currentDoc?.project_id])

  // Share chunks as they arrive so collaborators do not wait for the final response.
  const runStream = async (
    endpoint: string,
    payload: Record<string, unknown>,
    aid: string,
  ): Promise<'completed' | 'failed' | 'cancelled'> => {
    const controller = new AbortController()
    abortControllerRef.current = controller
    const responseId = `${aid}-res`
    activeRequestRef.current = { actionId: aid, responseId, kind: 'assistant' }
    let started = false
    let outcome: 'completed' | 'failed' | 'cancelled' = 'completed'
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
      },
      () => {
        clearActiveRequest()
        finalizeMsg(responseId, { status: 'completed' })
      },
      (err) => {
        outcome = 'failed'
        clearActiveRequest()
        const errorChunk = `**Error:** ${err}`
        if (!started) startStreamingMsg(responseId, errorChunk, { status: 'failed', error: err })
        else appendChunk(responseId, errorChunk)
        finalizeMsg(responseId, { status: 'failed', error: err })
      },
      () => {
        outcome = 'cancelled'
        clearActiveRequest()
        markCancelled(responseId, 'assistant')
      },
      controller.signal,
    )
    return outcome
  }

  const sendMessage = async () => {
    if (loading || !canInvokeAI || !aiDisclosureAccepted) return
    if (activeAction) { await submitAction(); return }
    if (retryAction) { await submitRetryAction(); return }
    const text = input.trim()
    if (!text && quotes.length === 0) return
    const threadId = activeThreadIdRef.current
    if (!threadId) return

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
    const responseId = `${aid}-res`
    const outcome = await runStream(
      `/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/message-streams`,
      {
        prompt: fullPrompt,
        document_context: currentDoc?.content ?? '',
        action_id: aid,
        thread_id: threadId,
      },
      aid,
    )

    if (outcome !== 'cancelled') {
      await hydrateAssistantMessage(responseId)
    }
    await refreshThreadSummaries()
  }

  const runDiffAction = async (request: ActionRequest, currentQuotes: QuoteItem[], variationRequest = '') => {
    const threadId = activeThreadIdRef.current
    if (!threadId) return
    const aid = genId()
    const actionPrompt = getActionPrompt(request, variationRequest)
    addUserMsg({ role: 'user', content: '', quotes: currentQuotes, actionType: request.type, actionPrompt }, aid)
    broadcast({ event: 'user_msg', action_type: request.type, action_prompt: actionPrompt, quotes: currentQuotes, action_id: aid })
    actionRequestRef.current.set(aid, request)
    setLoading(true)
    const responseId = `${aid}-diff`
    const controller = new AbortController()
    abortControllerRef.current = controller
    activeRequestRef.current = { actionId: aid, responseId, kind: 'diff', retryRequest: request }

    try {
      let res
      if (request.type === 'equation') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/equation-suggestions`, {
          description: request.description,
          document_content: currentDoc?.content || '',
          location: request.location,
          variation_request: variationRequest,
          action_id: aid,
          thread_id: threadId,
        }, { signal: controller.signal })
      } else if (request.type === 'translate') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/translation-suggestions`, {
          language: request.language,
          text: request.text,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
          thread_id: threadId,
        }, { signal: controller.signal })
      } else if (request.type === 'suggest') {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/change-suggestions`, {
          instruction: request.instruction,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
          thread_id: threadId,
        }, { signal: controller.signal })
      } else {
        res = await api.post(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/rewrite-suggestions`, {
          text: request.text,
          style: request.type,
          document_content: currentDoc?.content || '',
          variation_request: variationRequest,
          action_id: aid,
          thread_id: threadId,
        }, { signal: controller.signal })
      }
      const toolCalls = Array.isArray(res.data.tool_calls) ? res.data.tool_calls : undefined
      const meta = {
        provider: res.data.provider || undefined,
        model: res.data.model || undefined,
        status: res.data.status || undefined,
      }
      addDiff(responseId, res.data, request, toolCalls, meta)
      broadcast({
        event: 'diff',
        diff: res.data,
        tool_calls: toolCalls,
        action_id: aid,
        action_request: request,
        ...meta,
      })
    } catch (err: any) {
      if (isAbortError(err)) {
        markCancelled(responseId, 'diff', request)
        broadcast({
          event: 'cancelled',
          action_id: aid,
          response_id: responseId,
          response_kind: 'diff',
          action_request: request,
          status: 'cancelled',
          error: 'Cancelled by user',
        })
        return
      }
      const detail = err?.response?.data?.detail
      const error = typeof detail === 'string' ? detail : undefined
      const explanation = request.type === 'equation'
        ? 'Could not generate equation.'
        : request.type === 'translate'
          ? 'Could not translate.'
          : request.type === 'suggest'
          ? 'Could not fetch suggestions.'
            : `Could not ${request.type}.`
      const fallbackDiff = { explanation: error || explanation, changes: [] }
      addDiff(responseId, fallbackDiff, request, undefined, { status: 'failed', error })
      broadcast({
        event: 'diff',
        diff: fallbackDiff,
        action_id: aid,
        action_request: request,
        status: 'failed',
        error,
      })
    } finally {
      clearActiveRequest()
      setLoading(false)
      await refreshThreadSummaries()
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
      const outcome = await runStream(`/projects/${currentDoc?.project_id}/documents/${currentDoc?.id}/ai/rewrites`, {
        text,
        style: 'summarize',
        document_context: currentDoc?.content ?? '',
        action_id: aid,
        thread_id: activeThreadIdRef.current,
      }, aid)
      if (outcome !== 'cancelled') {
        await hydrateAssistantMessage(`${aid}-res`)
      }
      await refreshThreadSummaries()
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

  const detectConflictedChanges = useCallback((changes: DiffChange[]) => {
    const content = getCurrentDocumentContent()
    return new Set(
      changes
        .filter((change) => change.old_text && content.indexOf(change.old_text) === -1)
        .map((change) => change.id),
    )
  }, [getCurrentDocumentContent])

  // Apply accepted diffs through Yjs so reviews become collaborative edits instead of local patches.
  const applyChange = useCallback((change: DiffChange) => {
    if (!ydoc) return false
    const ytext = ydoc.getText('content')
    const content = getCurrentDocumentContent()
    const idx = content.indexOf(change.old_text)
    if (idx === -1) return false
    ydoc.transact(() => {
      ytext.delete(idx, change.old_text.length)
      ytext.insert(idx, change.new_text)
    })
    return true
  }, [getCurrentDocumentContent, ydoc])

  const applyChanges = useCallback((changes: DiffChange[]) => {
    if (!ydoc) return { appliedIds: [] as string[], conflictedIds: changes.map((change) => change.id) }

    const ytext = ydoc.getText('content')
    const appliedIds: string[] = []
    const conflictedIds: string[] = []
    ydoc.transact(() => {
      for (const change of changes) {
        const content = ytext.toString()
        const idx = content.indexOf(change.old_text)
        if (change.old_text && idx === -1) {
          conflictedIds.push(change.id)
          continue
        }
        ytext.delete(idx, change.old_text.length)
        ytext.insert(idx, change.new_text)
        appliedIds.push(change.id)
      }
    })
    return { appliedIds, conflictedIds }
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
    if (!applyChange(change)) {
      refreshDriftChecks()
      return
    }
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
  }, [applyChange, canReviewDiffs, persistReviewState, refreshDriftChecks, rejected])

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
    const { appliedIds, conflictedIds } = applyChanges(changes)
    if (conflictedIds.length > 0) refreshDriftChecks()
    if (appliedIds.length === 0) return

    const nextAccepted = new Set([...(accepted.get(id) ?? []), ...appliedIds])
    const nextRejected = new Set(rejected.get(id) ?? [])
    appliedIds.forEach((changeId) => nextRejected.delete(changeId))
    setAccepted((prev) => { const m = new Map(prev); m.set(id, nextAccepted); return m })
    setRejected((prev) => {
      const m = new Map(prev)
      if (nextRejected.size > 0) m.set(id, nextRejected)
      else m.delete(id)
      return m
    })
    persistReviewState(id, nextAccepted, nextRejected)
  }, [accepted, applyChanges, canReviewDiffs, persistReviewState, refreshDriftChecks, rejected, ydoc])

  const handleRejectAll = useCallback((id: string, changes: DiffChange[]) => {
    if (!canReviewDiffs) return
    const nextAccepted = new Set<string>()
    const nextRejected = new Set(changes.map((c) => c.id))
    setRejected((prev) => { const m = new Map(prev); m.set(id, nextRejected); return m })
    setAccepted((prev) => { const m = new Map(prev); m.delete(id); return m })
    persistReviewState(id, nextAccepted, nextRejected)
  }, [canReviewDiffs, persistReviewState])

  const activeThreadSummary = threadSummaries.find((thread) => thread.id === activeThreadId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgSurface, fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ padding: '8px 12px', background: C.bgRaised, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Bot size={15} color={C.accent} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.textPrimary }}>AI Assistant</span>
            <span style={{ fontSize: 10, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
              {activeThreadSummary?.title || 'New chat'}
            </span>
          </div>
          {loading && <Loader2 size={12} color={C.accent} style={{ animation: 'spin 1s linear infinite', marginLeft: 4 }} />}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setShowHistory((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: showHistory ? C.accentSubtle : C.bgCard,
              border: `1px solid ${showHistory ? C.accentBorder : C.border}`,
              borderRadius: 6,
              color: showHistory ? C.accent : C.textSecondary,
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 8px',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
            disabled={loading}
            title="View conversation history"
          >
            <History size={12} /> History
          </button>
          <button
            onClick={startNewChat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.textSecondary,
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 8px',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
            disabled={loading}
            title="Start a new chat thread"
          >
            <PlusSquare size={12} /> New chat
          </button>
          {loading && (
            <button
              onClick={stopGeneration}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: C.redSubtle, border: `1px solid ${C.red}`,
                borderRadius: 5, color: C.red, fontSize: 11,
                padding: '3px 8px', cursor: 'pointer',
              }}
              title="Stop generation"
            >
              <Square size={10} fill={C.red} /> Stop
            </button>
          )}
          {onClose && (
            <button onClick={onClose} style={closeBtnStyle} title="Close"><X size={12} /></button>
          )}
        </div>
      </div>

      {showHistory && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {threadSummaries.length === 0 ? (
              <div style={{ fontSize: 11, color: C.textMuted, padding: '6px 4px' }}>
                No previous chats yet.
              </div>
            ) : (
              threadSummaries.map((thread) => {
                const active = thread.id === activeThreadId
                return (
                  <button
                    key={thread.id}
                    onClick={() => openThread(thread.id)}
                    style={{
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: `1px solid ${active ? C.accentBorder : C.border}`,
                      background: active ? C.accentSubtle : C.bgRaised,
                      cursor: loading ? 'default' : 'pointer',
                      opacity: loading ? 0.5 : 1,
                    }}
                    disabled={loading}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: active ? C.accent : C.textPrimary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {thread.title}
                      </span>
                      <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
                        {formatThreadTime(thread.updatedAt || thread.createdAt)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: C.textSecondary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {thread.preview}
                      </span>
                      <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
                        {thread.messageCount} msg{thread.messageCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '7px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
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
                borderColor: active ? def.color : C.border,
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
            background: C.blueSubtle, border: `1px solid ${C.blue}`, borderRadius: 10,
            padding: 12, color: C.textPrimary, fontSize: 12, lineHeight: 1.6,
          }}>
            Selected document content may be sent to a third-party AI provider. By continuing, you confirm that AI requests should use only the selected content and necessary context unless you explicitly request broader scope.
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  localStorage.setItem(disclosureKey, 'true')
                  setAiDisclosureAccepted(true)
                }}
                style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                I Understand
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 48, lineHeight: 1.8 }}>
            {canInvokeAI ? 'Ask anything. Chat can now use web search, research, and translation tools.' : 'AI actions are unavailable in viewer mode.'}
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === 'user'
          const messageActionType = inferActionType(m.actionType, m.suggestInstruction, m.actionLabel)
          const diffConflicts = m.diff ? detectConflictedChanges(m.diff.changes) : new Set<string>()
          const authorName = isUser
            ? (m.fromUser || user?.username || 'You')
            : 'Lambda AI Chatbot'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 3 }}>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: isUser ? C.accent : C.green,
                paddingLeft: isUser ? 0 : 2,
                paddingRight: isUser ? 2 : 0,
              }}>
                {authorName}
              </span>

              {isUser ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, maxWidth: '90%' }}>
                  {m.quotes && m.quotes.map((q, qi) => (
                    <div key={qi} style={quoteBlockStyle}>
                      <div style={{ fontSize: 10, color: C.accent, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={9} /> {q.filename}:{q.lineStart}–{q.lineEnd}
                      </div>
                      <pre style={{ fontSize: 11, color: C.textSecondary, margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
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
                          <span style={{ fontSize: 12, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.actionPrompt}
                          </span>
                        )}
                      </span>
                    </div>
                  ) : m.content ? (
                    <div style={userBubble}>{m.content}</div>
                  ) : null}
                  {renderAuditMeta(m)}
                </div>
              ) : m.diff ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {renderAuditMeta(m)}
                  {renderToolCalls(m.toolCalls)}
                  <DiffView
                    explanation={m.diff.explanation}
                    changes={m.diff.changes}
                    accepted={accepted.get(m.id) ?? new Set()}
                    rejected={rejected.get(m.id) ?? new Set()}
                    conflicted={diffConflicts}
                    onAccept={(c) => handleAccept(m.id, c)}
                    onReject={(id) => handleReject(m.id, id)}
                    onAcceptAll={() => handleAcceptAll(m.id, m.diff!.changes)}
                    onRejectAll={() => handleRejectAll(m.id, m.diff!.changes)}
                    canReview={canReviewDiffs}
                    onRefreshConflicts={refreshDriftChecks}
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
                  {renderAuditMeta(m)}
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
                            color: C.blue,
                            background: C.blueSubtle,
                            border: `1px solid ${C.border}`,
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

      <div style={{ padding: '8px 10px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {quotes.map((q, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: C.accentSubtle, border: `1px solid ${C.accentBorder}`, borderRadius: 6,
                padding: '3px 8px', fontSize: 11, color: C.accent,
              }}>
                <FileText size={9} />
                {q.filename}:{q.lineStart}–{q.lineEnd}
                <button
                  onClick={() => setQuotes((prev) => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0, display: 'flex', marginLeft: 2 }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{
          background: C.bgCard,
          border: `1px solid ${activeAction ? activeAction.color + '60' : retryAction ? ACTION_DEFS[retryAction.type].color + '60' : C.border}`,
          borderRadius: 8, overflow: 'hidden',
        }}>
          {retryAction && !activeAction && (
            <div style={{ borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 4px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: ACTION_DEFS[retryAction.type].color, fontSize: 11, fontWeight: 600 }}>
                  <ArrowRight size={11} /> Continue
                </span>
                <span style={{ fontSize: 11, color: C.textMuted }}>
                  {ACTION_DEFS[retryAction.type].label}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setRetryAction(null)}
                  style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={11} />
                </button>
              </div>
            </div>
          )}
          {activeAction && (
            <div style={{ borderBottom: `1px solid ${C.border}` }}>
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
                  style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={11} />
                </button>
              </div>
              {activeAction.type === 'equation' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 6px' }}>
                  <MapPin size={10} color={C.yellow} style={{ flexShrink: 0 }} />
                  {effectiveEquationLocation ? (
                    <>
                      <span style={{ fontSize: 11, color: C.yellow, fontWeight: 600, flexShrink: 0 }}>
                        Line {effectiveEquationLocation.line}
                      </span>
                      <span style={{ fontSize: 11, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
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
                        style={{ background: 'none', border: 'none', color: C.yellow, cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <RefreshCw size={10} />
                      </button>
                      <button
                        onClick={() => {
                          setEquationLocation(null)
                          onCancelEquationLocation?.()
                        }}
                        style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : isPickingEquationLocation ? (
                    <>
                      <span style={{ fontSize: 11, color: C.yellow, flex: 1 }}>
                        Click a line in the editor to place the equation
                      </span>
                      <button
                        onClick={() => onCancelEquationLocation?.()}
                        style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onRequestEquationLocation?.()}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        fontSize: 11, color: C.yellow, display: 'flex', alignItems: 'center', gap: 4,
                        textDecoration: 'underline dotted',
                      }}
                    >
                      Click in the editor to set insertion point <span style={{ color: C.red }}>*</span>
                    </button>
                  )}
                </div>
              )}
              {activeAction.type === 'translate' && (
                <div style={{ padding: '0 10px 6px', fontSize: 11, color: selectedTextFromQuotes(quotes) ? C.green : C.red }}>
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
