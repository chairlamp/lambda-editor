import type React from 'react'
import { C } from '../../design'

export const chip: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
  borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent',
  color: C.textSecondary, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer',
}

export const textareaStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none',
  padding: '8px 10px', color: C.textPrimary, fontSize: 13, outline: 'none',
  resize: 'none', fontFamily: 'inherit', lineHeight: '1.5',
  boxSizing: 'border-box', display: 'block', minHeight: 52,
}

export const closeBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 5, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textMuted, cursor: 'pointer', flexShrink: 0,
}

export const userBubble: React.CSSProperties = {
  padding: '9px 13px', borderRadius: 10, fontSize: 13,
  background: C.accentSubtle, color: C.textPrimary,
  border: `1px solid ${C.accentBorder}`,
  lineHeight: 1.55, maxWidth: '100%', wordBreak: 'break-word',
}

export const actionBubble: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: 30, maxWidth: '100%', padding: '6px 10px',
  borderRadius: 8, border: `1px solid ${C.borderFaint}`,
  background: C.bgRaised, flexShrink: 0,
}

export const botBubble: React.CSSProperties = {
  padding: '9px 13px', borderRadius: 10, fontSize: 13,
  background: C.bgCard, color: C.textPrimary,
  lineHeight: 1.65, maxWidth: '100%', wordBreak: 'break-word',
  border: `1px solid ${C.borderFaint}`,
}

export const quoteBlockStyle: React.CSSProperties = {
  background: C.bgBase, border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '6px 10px', maxWidth: '100%',
}
