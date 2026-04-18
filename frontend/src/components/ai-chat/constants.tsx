import { RefreshCw, AlignLeft, Sparkles, Languages, Calculator } from 'lucide-react'
import type { ActiveAction, ActionRequest, ActionType, ChatMessage } from './types'

export const ACTION_DEFS: Record<ActionType, Omit<ActiveAction, 'type'>> = {
  simplify: {
    label: 'Simplify',
    icon: <RefreshCw size={11} />,
    color: '#60a5fa',
    placeholder: 'Paste text to simplify, or leave empty to use the full document',
  },
  summarize: {
    label: 'Summarize',
    icon: <AlignLeft size={11} />,
    color: '#f472b6',
    placeholder: 'Paste text to summarize, or leave empty to use the full document',
  },
  suggest: {
    label: 'AI edit',
    icon: <Sparkles size={11} />,
    color: '#a78bfa',
    placeholder: 'What to improve? (optional)',
  },
  translate: {
    label: 'Translate',
    icon: <Languages size={11} />,
    color: '#34d399',
    placeholder: 'Target language (e.g. Spanish, French…)',
  },
  equation: {
    label: 'Equation',
    icon: <Calculator size={11} />,
    color: '#fbbf24',
    placeholder: 'Describe the equation…',
  },
}

export const AVAILABLE_ACTIONS: ActionType[] = ['suggest', 'translate', 'equation']

export const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const isActionType = (value: unknown): value is ActionType => (
  value === 'equation'
  || value === 'translate'
  || value === 'suggest'
  || value === 'simplify'
  || value === 'summarize'
)

export const inferActionType = (actionType?: unknown, suggestInstruction?: unknown, actionLabel?: unknown): ActionType | undefined => {
  if (isActionType(actionType)) return actionType
  if (typeof suggestInstruction === 'string') return 'suggest'
  if (typeof actionLabel !== 'string') return undefined

  const normalized = actionLabel.toLowerCase()
  if (normalized.startsWith('equation')) return 'equation'
  if (normalized.startsWith('translate')) return 'translate'
  if (normalized.startsWith('simplify')) return 'simplify'
  if (normalized.startsWith('summarize')) return 'summarize'
  return undefined
}

export const getActionPrompt = (request: ActionRequest, variationRequest = '') => {
  if (variationRequest.trim()) return variationRequest.trim()
  if (request.type === 'equation') return request.description
  if (request.type === 'translate') return request.language
  if (request.type === 'suggest') return request.instruction
  return request.text.trim() || 'Full document'
}

export const mapStoredMessage = (message: any): ChatMessage => ({
  id: message.id,
  role: message.role,
  content: message.content || '',
  diff: message.diff || undefined,
  actionType: inferActionType(message.action_type, undefined, undefined),
  actionPrompt: message.action_prompt || undefined,
  retryAction: message.retry_action || undefined,
  quotes: message.quotes || undefined,
  sources: message.sources || undefined,
  toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
  fromUser: message.from_user || undefined,
  accepted: Array.isArray(message.accepted) ? message.accepted : undefined,
  rejected: Array.isArray(message.rejected) ? message.rejected : undefined,
  provider: message.provider || undefined,
  model: message.model || undefined,
  status: message.status || undefined,
  error: message.error || undefined,
})
