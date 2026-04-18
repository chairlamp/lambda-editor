// Shared design tokens. Values are applied via CSS variables so the same
// components can render in both light and dark themes.

export type ThemeMode = 'dark' | 'light'

type ThemePalette = {
  bgBase: string
  bgSurface: string
  bgRaised: string
  bgCard: string
  bgHover: string
  bgActive: string
  borderFaint: string
  border: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDisabled: string
  accent: string
  accentHover: string
  accentSubtle: string
  accentBorder: string
  green: string
  greenSubtle: string
  red: string
  redSubtle: string
  yellow: string
  yellowSubtle: string
  blue: string
  blueSubtle: string
  lambda: string
}

export const themes: Record<ThemeMode, ThemePalette> = {
  dark: {
    bgBase: '#09090d',
    bgSurface: '#0e0e16',
    bgRaised: '#12121a',
    bgCard: '#14141e',
    bgHover: '#1a1a25',
    bgActive: '#1f1f2d',
    borderFaint: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.07)',
    borderStrong: 'rgba(255,255,255,0.12)',
    textPrimary: '#ececf1',
    textSecondary: '#8b8b9d',
    textMuted: '#494957',
    textDisabled: '#2f2f3d',
    accent: '#7c6af6',
    accentHover: '#6a5ada',
    accentSubtle: 'rgba(124,106,246,0.10)',
    accentBorder: 'rgba(124,106,246,0.30)',
    green: '#34d399',
    greenSubtle: 'rgba(52,211,153,0.10)',
    red: '#f87171',
    redSubtle: 'rgba(248,113,113,0.10)',
    yellow: '#fbbf24',
    yellowSubtle: 'rgba(251,191,36,0.10)',
    blue: '#60a5fa',
    blueSubtle: 'rgba(96,165,250,0.10)',
    lambda: '#9d7be8',
  },
  light: {
    bgBase: '#f5f7fc',
    bgSurface: '#eef2f9',
    bgRaised: '#ffffff',
    bgCard: '#ffffff',
    bgHover: '#eef3ff',
    bgActive: '#e5ecfb',
    borderFaint: 'rgba(15,23,42,0.05)',
    border: 'rgba(15,23,42,0.11)',
    borderStrong: 'rgba(15,23,42,0.18)',
    textPrimary: '#172033',
    textSecondary: '#48546d',
    textMuted: '#6b7285',
    textDisabled: '#a4abbd',
    accent: '#5a57e4',
    accentHover: '#4846c8',
    accentSubtle: 'rgba(90,87,228,0.10)',
    accentBorder: 'rgba(90,87,228,0.24)',
    green: '#059669',
    greenSubtle: 'rgba(5,150,105,0.10)',
    red: '#dc2626',
    redSubtle: 'rgba(220,38,38,0.10)',
    yellow: '#ca8a04',
    yellowSubtle: 'rgba(202,138,4,0.10)',
    blue: '#2563eb',
    blueSubtle: 'rgba(37,99,235,0.10)',
    lambda: '#7c64d9',
  },
}

const tokenName: Record<keyof ThemePalette, string> = {
  bgBase: 'bg-base',
  bgSurface: 'bg-surface',
  bgRaised: 'bg-raised',
  bgCard: 'bg-card',
  bgHover: 'bg-hover',
  bgActive: 'bg-active',
  borderFaint: 'border-faint',
  border: 'border',
  borderStrong: 'border-strong',
  textPrimary: 'text-primary',
  textSecondary: 'text-secondary',
  textMuted: 'text-muted',
  textDisabled: 'text-disabled',
  accent: 'accent',
  accentHover: 'accent-hover',
  accentSubtle: 'accent-subtle',
  accentBorder: 'accent-border',
  green: 'green',
  greenSubtle: 'green-subtle',
  red: 'red',
  redSubtle: 'red-subtle',
  yellow: 'yellow',
  yellowSubtle: 'yellow-subtle',
  blue: 'blue',
  blueSubtle: 'blue-subtle',
  lambda: 'lambda',
}

export const C = Object.fromEntries(
  Object.entries(tokenName).map(([key, cssName]) => [key, `var(--c-${cssName})`]),
) as Record<keyof ThemePalette, string>

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return

  const palette = themes[mode]
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode

  for (const [key, value] of Object.entries(palette) as [keyof ThemePalette, string][]) {
    root.style.setProperty(`--c-${tokenName[key]}`, value)
  }

  document.body.style.background = palette.bgBase
  document.body.style.color = palette.textPrimary
  document.body.style.margin = '0'
  document.body.style.fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

export function getMonacoTheme(mode: ThemeMode) {
  return mode === 'light' ? 'vs' : 'vs-dark'
}

// Reusable style fragments
export const S = {
  input: {
    width: '100%',
    background: C.bgBase,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    padding: '8px 12px',
    color: C.textPrimary,
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  },

  card: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '16px 20px',
  },

  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: C.textSecondary,
    cursor: 'pointer',
    flexShrink: 0 as const,
    transition: 'all 0.12s',
  },

  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 7,
    border: 'none',
    background: C.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.12s',
  },

  ghostBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 7,
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: C.textSecondary,
    fontSize: 13,
    cursor: 'pointer',
  },

  label: {
    display: 'block' as const,
    fontSize: 11,
    fontWeight: 500,
    color: C.textSecondary,
    marginBottom: 5,
    letterSpacing: '0.02em',
  },
} as const
