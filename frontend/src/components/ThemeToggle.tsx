import { Moon, Sun } from 'lucide-react'
import { C } from '../design'
import { useStore } from '../store/useStore'

interface Props {
  compact?: boolean
}

export default function ThemeToggle({ compact = false }: Props) {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const nextLabel = theme === 'dark' ? 'Light mode' : 'Dark mode'

  return (
    <button
      onClick={toggleTheme}
      title={nextLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '7px 10px' : '7px 12px',
        borderRadius: 7,
        border: `1px solid ${C.border}`,
        background: C.bgCard,
        color: C.textSecondary,
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 500,
        fontFamily: 'inherit',
      }}
    >
      {theme === 'dark' ? <Sun size={13} color={C.yellow} /> : <Moon size={13} color={C.accent} />}
      {!compact && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
