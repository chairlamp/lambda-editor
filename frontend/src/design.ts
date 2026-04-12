// Shared design tokens — import these in every component instead of magic strings.

export const C = {
  // Backgrounds — layered from darkest to lightest
  bgBase:    '#09090d',   // page
  bgSurface: '#0e0e16',   // sidebar, file tree
  bgRaised:  '#12121a',   // toolbar, panel headers
  bgCard:    '#14141e',   // cards, modals
  bgHover:   '#1a1a25',   // hover
  bgActive:  '#1f1f2d',   // active / selected row

  // Borders
  borderFaint:  'rgba(255,255,255,0.04)',
  border:       'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',

  // Text
  textPrimary:   '#ececf1',
  textSecondary: '#8b8b9d',
  textMuted:     '#494957',
  textDisabled:  '#2f2f3d',

  // Accent (violet-indigo)
  accent:       '#7c6af6',
  accentHover:  '#6a5ada',
  accentSubtle: 'rgba(124,106,246,0.10)',
  accentBorder: 'rgba(124,106,246,0.30)',

  // Status
  green:       '#34d399',
  greenSubtle: 'rgba(52,211,153,0.10)',
  red:         '#f87171',
  redSubtle:   'rgba(248,113,113,0.10)',
  yellow:      '#fbbf24',
  yellowSubtle:'rgba(251,191,36,0.10)',
  blue:        '#60a5fa',
  blueSubtle:  'rgba(96,165,250,0.10)',

  // Brand
  lambda: '#9d7be8',
} as const

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
