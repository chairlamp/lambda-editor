import { useEffect, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authApi } from '../services/api'
import { useStore } from '../store/useStore'
import { C } from '../design'
import ThemeToggle from '../components/ThemeToggle'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { token, authReady, setUser } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const nextPath = searchParams.get('next') || '/projects'

  useEffect(() => {
    if (authReady && token) {
      navigate(nextPath, { replace: true })
    }
  }, [authReady, navigate, nextPath, token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let res
      if (mode === 'register') {
        res = await authApi.register(email, username, password)
      } else {
        res = await authApi.login(email, password)
      }
      const { user } = res.data
      setUser(user, 'session')
      navigate(nextPath, { replace: true })
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: C.bgBase,
      backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(124,106,246,0.07), transparent)',
      position: 'relative',
    }}>
      <div style={{ position: 'fixed', top: 18, right: 18 }}>
        <ThemeToggle />
      </div>
      <div style={{ width: 400, animation: 'fadeIn 0.3s ease' }}>
        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14, marginBottom: 14,
            background: 'linear-gradient(135deg, rgba(124,106,246,0.2), rgba(157,123,232,0.08))',
            border: '1px solid rgba(124,106,246,0.2)',
            fontSize: 26, fontWeight: 700, color: C.lambda,
          }}>
            λ
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: C.textPrimary, letterSpacing: '-0.025em' }}>
            Lambda Editor
          </h1>
          <p style={{ color: C.textMuted, fontSize: 13, marginTop: 4 }}>
            Collaborative LaTeX with AI
          </p>
        </div>

        {/* Auth card */}
        <div style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '26px 26px 22px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}>
          {/* Tab switcher */}
          <div style={{
            display: 'flex', gap: 2, marginBottom: 22,
            background: C.bgBase, borderRadius: 8, padding: 3,
          }}>
            {(['login', 'register'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError('') }} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                background: mode === m ? C.bgRaised : 'transparent',
                color: mode === m ? C.textPrimary : C.textMuted,
                cursor: 'pointer', fontSize: 13, fontWeight: mode === m ? 500 : 400,
                transition: 'all 0.15s',
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.35)' : 'none',
                fontFamily: 'inherit',
              }}>
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelSt}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required style={inputSt} placeholder="you@example.com" />
            </div>

            {mode === 'register' && (
              <div>
                <label style={labelSt}>Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  required style={inputSt} placeholder="username" />
              </div>
            )}

            <div>
              <label style={labelSt}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required style={inputSt} placeholder="••••••••" />
            </div>

            {error && (
              <div style={{
                background: C.redSubtle, border: `1px solid rgba(248,113,113,0.2)`,
                borderRadius: 7, padding: '9px 12px', color: C.red, fontSize: 12.5, lineHeight: 1.45,
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '10px', borderRadius: 8, border: 'none', marginTop: 2,
              background: loading ? 'rgba(124,106,246,0.5)' : C.accent,
              color: '#fff', fontSize: 13, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s', fontFamily: 'inherit',
            }}>
              {loading && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 5, fontWeight: 500,
}
const inputSt: React.CSSProperties = {
  width: '100%', background: C.bgBase,
  border: `1px solid ${C.border}`,
  borderRadius: 7, padding: '9px 12px', color: C.textPrimary, fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
