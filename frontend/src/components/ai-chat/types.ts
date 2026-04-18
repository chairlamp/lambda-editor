import type React from 'react'
import type { Doc } from 'yjs'
import type { DiffChange } from '../DiffView'

export interface AIChatProps {
  socket: import('../../services/socket').RoomSocket | null
  ydoc?: Doc | null
  onInsertText?: (text: string) => void
  onClose?: () => void
  readOnly?: boolean
  pendingQuote?: { lineStart: number; lineEnd: number; text: string } | null
  onQuoteConsumed?: () => void
  pendingEquationLocation?: { line: number; text: string; beforeText: string; afterText: string } | null
  isPickingEquationLocation?: boolean
  onRequestEquationLocation?: () => void
  onCancelEquationLocation?: () => void
  currentDocTitle?: string
}

export interface QuoteItem {
  lineStart: number
  lineEnd: number
  text: string
  filename: string
}

export interface SourceItem {
  title: string
  url: string
}

export interface EquationLocation {
  line: number
  text: string
  beforeText: string
  afterText: string
}

export type ActionRequest =
  | { type: 'equation'; description: string; location: EquationLocation }
  | { type: 'translate'; language: string; text: string }
  | { type: 'suggest'; instruction: string }
  | { type: 'simplify' | 'summarize'; text: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  diff?: { explanation: string; changes: DiffChange[] }
  actionType?: ActionType
  actionPrompt?: string
  retryAction?: ActionRequest
  suggestInstruction?: string
  actionLabel?: string
  actionColor?: string
  quotes?: QuoteItem[]
  sources?: SourceItem[]
  toolCalls?: string[]
  fromUser?: string
  accepted?: string[]
  rejected?: string[]
  provider?: string
  model?: string
  status?: string
  error?: string
}

export type ActionType = 'equation' | 'translate' | 'suggest' | 'simplify' | 'summarize'

export interface ActiveAction {
  type: ActionType
  label: string
  icon: React.ReactNode
  color: string
  placeholder: string
}
