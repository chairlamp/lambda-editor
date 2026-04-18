import { create } from 'zustand'
import type { ThemeMode } from '../design'

export interface User {
  id: string
  email: string
  username: string
}

export interface Project {
  id: string
  title: string
  description: string
  owner_id: string
  my_role: 'owner' | 'editor' | 'viewer'
  main_doc_id?: string | null
}

export interface Document {
  id: string
  title: string
  path: string
  kind: 'latex' | 'text' | 'uploaded'
  content?: string
  owner_id: string
  project_id: string
  source_filename?: string | null
  mime_type?: string | null
  file_size?: number | null
  content_revision?: number
  updated_at?: string
  compile_success?: boolean | null
  compile_pdf_base64?: string | null
  compile_log?: string | null
}

export interface Presence {
  user_id: string
  username: string
  color: string
  read_only?: boolean
}

export type SaveStatus = 'idle' | 'saving' | 'saved'

export interface TypingUser {
  user_id: string
  username: string
}

const THEME_STORAGE_KEY = 'theme'

function getInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}

  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

interface AppState {
  user: User | null
  token: string | null
  authReady: boolean
  theme: ThemeMode
  projects: Project[]
  currentProject: Project | null
  documents: Document[]
  currentDoc: Document | null
  presence: Presence[]
  isConnected: boolean
  compiledPdf: string | null
  compileLog: string
  isCompiling: boolean
  saveStatus: SaveStatus
  typingUsers: TypingUser[]

  setUser: (user: User | null, token: string | null) => void
  setAuthReady: (ready: boolean) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setProjects: (projects: Project[]) => void
  setCurrentProject: (p: Project | null) => void
  setDocuments: (docs: Document[]) => void
  upsertDocument: (doc: Document) => void
  removeDocument: (docId: string) => void
  setCurrentDoc: (doc: Document | null) => void
  updateDocContent: (content: string) => void
  updateDocSyncState: (data: { content?: string; title?: string; content_revision?: number; updated_at?: string }) => void
  updateDocTitle: (title: string) => void
  setPresence: (presence: Presence[]) => void
  setConnected: (v: boolean) => void
  setCompiledPdf: (pdf: string | null, log: string) => void
  setCompiling: (v: boolean) => void
  setSaveStatus: (status: SaveStatus) => void
  setTypingUser: (user: TypingUser, isTyping: boolean) => void
  clearTypingUsers: () => void
  logout: () => void
}

export const useStore = create<AppState>((set) => ({
  user: (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  })(),
  token: localStorage.getItem('token'),
  authReady: false,
  theme: getInitialTheme(),
  projects: [],
  currentProject: null,
  documents: [],
  currentDoc: null,
  presence: [],
  isConnected: false,
  compiledPdf: null,
  compileLog: '',
  isCompiling: false,
  saveStatus: 'idle',
  typingUsers: [],

  setUser: (user, token) => {
    if (user && token) {
      localStorage.setItem('user', JSON.stringify(user))
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
    set({ user, token })
  },
  setAuthReady: (authReady) => set({ authReady }),
  setTheme: (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    set({ theme })
  },
  toggleTheme: () => set((s) => {
    const theme = s.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    return { theme }
  }),
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setDocuments: (documents) => set({ documents }),
  upsertDocument: (doc) => set((s) => {
    const existing = s.documents.find((d) => d.id === doc.id)
    const documents = existing
      ? s.documents.map((d) => d.id === doc.id ? { ...d, ...doc } : d)
      : [doc, ...s.documents]
    return {
      documents,
      currentDoc: s.currentDoc?.id === doc.id ? { ...s.currentDoc, ...doc } : s.currentDoc,
    }
  }),
  removeDocument: (docId) => set((s) => ({
    documents: s.documents.filter((d) => d.id !== docId),
    currentDoc: s.currentDoc?.id === docId ? null : s.currentDoc,
  })),
  setCurrentDoc: (currentDoc) => set({ currentDoc }),
  updateDocContent: (content) =>
    set((s) => s.currentDoc ? { currentDoc: { ...s.currentDoc, content } } : {}),
  updateDocSyncState: (data) =>
    set((s) => s.currentDoc ? { currentDoc: { ...s.currentDoc, ...data } } : {}),
  updateDocTitle: (title) =>
    set((s) => s.currentDoc ? { currentDoc: { ...s.currentDoc, title } } : {}),
  setPresence: (presence) => set({ presence }),
  setConnected: (isConnected) => set({ isConnected }),
  setCompiledPdf: (compiledPdf, compileLog) => set({ compiledPdf, compileLog }),
  setCompiling: (isCompiling) => set({ isCompiling }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setTypingUser: (user, isTyping) => set((s) => {
    if (isTyping) {
      const already = s.typingUsers.some((u) => u.user_id === user.user_id)
      return already ? {} : { typingUsers: [...s.typingUsers, user] }
    }
    return { typingUsers: s.typingUsers.filter((u) => u.user_id !== user.user_id) }
  }),
  clearTypingUsers: () => set({ typingUsers: [] }),
  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({
      user: null,
      token: null,
      authReady: true,
      projects: [],
      currentProject: null,
      documents: [],
      currentDoc: null,
    })
  },
}))
