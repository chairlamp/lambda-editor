import axios, { type InternalAxiosRequestConfig } from 'axios'

import { API_BASE_URL, apiUrl } from '../config'
import { useStore, type User } from '../store/useStore'

const api = axios.create({ baseURL: API_BASE_URL, withCredentials: true })
let refreshRequest: Promise<void> | null = null

function markAuthenticated(user: User) {
  useStore.getState().setUser(user, 'session')
}

function clearAuth(redirectToLogin = true) {
  useStore.getState().logout()
  if (!redirectToLogin || window.location.pathname === '/login') return

  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.href = `/login?next=${encodeURIComponent(next)}`
}

export async function refreshAuthSession(): Promise<void> {
  if (!refreshRequest) {
    refreshRequest = axios.post(apiUrl('/tokens/refresh'), undefined, { withCredentials: true })
      .then((res) => {
        markAuthenticated(res.data.user)
      })
      .catch((err) => {
        clearAuth(window.location.pathname !== '/login')
        throw err
      })
      .finally(() => {
        refreshRequest = null
      })
  }

  return refreshRequest
}

// Handle expired sessions in one place so feature code can treat 401s uniformly.
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err.response?.status
    const originalRequest = err.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    const url = originalRequest?.url ?? ''

    if (status !== 401) {
      return Promise.reject(err)
    }

    if (url === '/tokens' || url === '/users') {
      return Promise.reject(err)
    }

    if (url === '/tokens/refresh') {
      clearAuth(window.location.pathname !== '/login')
      return Promise.reject(err)
    }

    if (url === '/sessions/me') {
      clearAuth(false)
      return Promise.reject(err)
    }

    if (!originalRequest || originalRequest._retry) {
      clearAuth(window.location.pathname !== '/login')
      return Promise.reject(err)
    }

    originalRequest._retry = true
    try {
      await refreshAuthSession()
      return api(originalRequest)
    } catch {
      return Promise.reject(err)
    }
  }
)

export default api

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post('/users', { email, username, password }),
  login: (email: string, password: string) =>
    api.post('/tokens', { email, password }),
  refresh: () => api.post('/tokens/refresh'),
  logout: () => api.delete('/sessions/me'),
  me: () => api.get('/users/me'),
}

export const projectsApi = {
  list: () => api.get('/projects'),
  create: (title: string, description = '') => api.post('/projects', { title, description }),
  get: (id: string) => api.get(`/projects/${id}`),
  update: (id: string, data: { title?: string; description?: string }) =>
    api.patch(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  join: (invite_token: string) => api.post('/projects/memberships', { invite_token }),
  listMembers: (id: string) => api.get(`/projects/${id}/members`),
  updateMemberRole: (projectId: string, userId: string, role: string) =>
    api.patch(`/projects/${projectId}/members/${userId}`, { role }),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
  addMember: (projectId: string, usernameOrEmail: string, role: string) =>
    api.post(`/projects/${projectId}/members`, { username_or_email: usernameOrEmail, role }),
  listInvites: (id: string) => api.get(`/projects/${id}/invites`),
  createInvite: (id: string, role: string, label: string) =>
    api.post(`/projects/${id}/invites`, { role, label }),
  deleteInvite: (projectId: string, inviteId: string) =>
    api.delete(`/projects/${projectId}/invites/${inviteId}`),
}

export const docsApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/documents`),
  listFolders: (projectId: string) => api.get(`/projects/${projectId}/documents/folders`),
  createFolder: (projectId: string, path: string) =>
    api.post(`/projects/${projectId}/documents/folders`, { path }),
  create: (projectId: string, path: string, content = '') =>
    api.post(`/projects/${projectId}/documents`, { path, content }),
  upload: (projectId: string, file: File, path?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (path?.trim()) formData.append('path', path.trim())
    return api.post(`/projects/${projectId}/documents/uploaded-documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  get: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}`),
  update: (projectId: string, docId: string, data: { title?: string; path?: string; content?: string }) =>
    api.patch(`/projects/${projectId}/documents/${docId}`, data),
  delete: (projectId: string, docId: string) =>
    api.delete(`/projects/${projectId}/documents/${docId}`),
  downloadUrl: (projectId: string, docId: string) =>
    apiUrl(`/projects/${projectId}/documents/${docId}/download`),
}

export const versionsApi = {
  list: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/versions`),
  create: (projectId: string, docId: string, label = '') =>
    api.post(`/projects/${projectId}/documents/${docId}/versions`, { label }),
  get: (projectId: string, docId: string, versionId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/versions/${versionId}`),
  restore: (projectId: string, docId: string, versionId: string) =>
    api.post(`/projects/${projectId}/documents/${docId}/versions/${versionId}/restorations`),
}

export const compileApi = {
  compile: (content: string, projectId: string, docId: string, outputFormat = 'pdf') => api.post(`/projects/${projectId}/documents/${docId}/compilations`, {
    content,
    output_format: outputFormat,
  }),
}

export const aiChatApi = {
  agent: (projectId: string, docId: string, payload: {
    prompt: string
    document_context?: string
    action_id?: string
  }, signal?: AbortSignal) => api.post(`/projects/${projectId}/documents/${docId}/ai/messages`, payload, { signal }),
  history: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/ai/messages`),
  updateReviewState: (projectId: string, docId: string, messageId: string, accepted: string[], rejected: string[]) =>
    api.patch(`/projects/${projectId}/documents/${docId}/ai/messages/${messageId}`, { accepted, rejected }),
}

// Parse streamed SSE frames so chat UIs can render long responses incrementally.
// Pass an AbortController signal to allow the caller to cancel mid-stream.
//
// The server JSON-encodes chunk payloads so newlines survive SSE framing, and
// surfaces failures as an explicit `event: error` frame. Parsing follows the
// SSE spec: frames are separated by blank lines, and multi-line `data:` fields
// are concatenated with newlines before being decoded.
export async function streamAI(
  endpoint: string,
  body: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onCancelled: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const makeRequest = () => fetch(apiUrl(endpoint), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })

  let res: Response
  try {
    res = await makeRequest()
  } catch (err: any) {
    if (err?.name === 'AbortError') { onCancelled(); return }
    onError(`Request failed: ${err?.message ?? 'network error'}`)
    return
  }

  if (res.status === 401) {
    try {
      await refreshAuthSession()
      res = await makeRequest()
    } catch {
      onError('Request failed: 401')
      return
    }
  }

  if (!res.ok || !res.body) {
    onError(`Request failed: ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let dataLines: string[] = []

  const dispatch = (): boolean => {
    if (dataLines.length === 0 && !event) return false
    const raw = dataLines.join('\n')
    const currentEvent = event
    event = ''
    dataLines = []

    if (currentEvent === 'error') {
      let message = raw
      try { message = JSON.parse(raw) } catch { /* fall back to raw */ }
      onError(message || 'stream error')
      return true // stop consuming further frames
    }

    if (raw === '[DONE]') { onDone(); return true }

    try {
      onChunk(JSON.parse(raw))
    } catch {
      // Tolerate older/plain frames so unit tests and legacy callers still work.
      onChunk(raw)
    }
    return false
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE lines can end with \n, \r, or \r\n; normalize before splitting.
      const normalized = buffer.replace(/\r\n?/g, '\n')
      const lines = normalized.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === '') {
          if (dispatch()) return
          continue
        }
        if (line.startsWith(':')) continue // SSE comment — used as keep-alive
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const rawValue = colon === -1 ? '' : line.slice(colon + 1)
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
        if (field === 'data') dataLines.push(value)
        else if (field === 'event') event = value
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') { onCancelled(); return }
    onError(`Stream interrupted: ${err?.message ?? 'unknown error'}`)
    return
  }
  onDone()
}
