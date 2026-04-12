import axios, { type InternalAxiosRequestConfig } from 'axios'

import { useStore, type User } from '../store/useStore'

const api = axios.create({ baseURL: '/api', withCredentials: true })
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
    refreshRequest = axios.post('/api/tokens/refresh', undefined, { withCredentials: true })
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
    `/api/projects/${projectId}/documents/${docId}/download`,
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
  }) => api.post(`/projects/${projectId}/documents/${docId}/ai/messages`, payload),
  history: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/ai/messages`),
  updateReviewState: (projectId: string, docId: string, messageId: string, accepted: string[], rejected: string[]) =>
    api.patch(`/projects/${projectId}/documents/${docId}/ai/messages/${messageId}`, { accepted, rejected }),
}

// Parse streamed `data:` frames so chat UIs can render long responses incrementally.
export async function streamAI(
  endpoint: string,
  body: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  const makeRequest = () => fetch(`/api${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  let res = await makeRequest()

  if (res.status === 401) {
    try {
      await refreshAuthSession()
      res = await makeRequest()
    } catch {
      onError('Request failed: 401')
      return
    }
  }

  if (!res.ok) {
    onError(`Request failed: ${res.status}`)
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') { onDone(); return }
        onChunk(data)
      }
    }
  }
  onDone()
}
