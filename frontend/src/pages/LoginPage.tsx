import { useEffect, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../services/api'
import { useStore } from '../store/useStore'

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
      height: '100vh', background: '#0f0f23',
    }}>
      <div style={{
        background: '#16213e', borderRadius: 12, padding: 36,
        width: 380, border: '1px solid #1e1e3a',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#818cf8' }}>λ Editor</div>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
            Collaborative LaTeX Editor with AI
          </p>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#0f0f23', borderRadius: 6, padding: 4 }}>
          {(['login', 'register'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError('') }} style={{
              flex: 1, padding: '6px 0', borderRadius: 4, border: 'none',
              background: mode === m ? '#4f46e5' : 'transparent',
              color: mode === m ? '#fff' : '#9ca3af',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required style={inputStyle} placeholder="you@example.com"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label style={labelStyle}>Username</label>
              <input
                value={username} onChange={(e) => setUsername(e.target.value)}
                required style={inputStyle} placeholder="username"
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required style={inputStyle} placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ background: '#2d1b1b', border: '1px solid #7f1d1d', borderRadius: 6, padding: '8px 12px', color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            padding: '10px', borderRadius: 6, border: 'none',
            background: loading ? '#3a3a6a' : '#4f46e5',
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
          }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4, fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f0f23', border: '1px solid #2a2a4a',
  borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
}
