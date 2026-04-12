import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FileImage, FolderPlus, Folder as FolderIcon, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { docsApi } from '../services/api'
import { ProjectSocket } from '../services/socket'
import { Document, useStore } from '../store/useStore'
import { C } from '../design'

interface Props {
  projectId?: string
}

interface FolderItem {
  id: string
  path: string
  owner_id: string
  project_id: string
}

interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  doc?: Document
  children?: TreeNode[]
}

function fileIcon(doc: Document) {
  return doc.kind === 'uploaded'
    ? <FileImage size={12} color={C.textMuted} />
    : <FileCode2 size={12} color={C.textMuted} />
}

function buildTree(documents: Document[], folders: FolderItem[]): TreeNode[] {
  const root = new Map<string, TreeNode>()

  const ensureFolder = (folderPath: string) => {
    const parts = folderPath.split('/').filter(Boolean)
    let cursor = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      if (!cursor.has(part)) {
        cursor.set(part, { name: part, path: currentPath, type: 'folder', children: [] })
      }
      const node = cursor.get(part)!
      cursor = new Map((node.children || []).map((child) => [child.name, child]))
      node.children = Array.from(cursor.values())
    }
  }

  const getFolderNode = (folderPath: string): TreeNode | undefined => {
    const parts = folderPath.split('/').filter(Boolean)
    let nodes = Array.from(root.values())
    let found: TreeNode | undefined
    for (const part of parts) {
      found = nodes.find((node) => node.type === 'folder' && node.name === part)
      if (!found) return undefined
      nodes = found.children || []
    }
    return found
  }

  for (const folder of folders) ensureFolder(folder.path)
  for (const doc of documents) {
    const parts = doc.path.split('/').filter(Boolean)
    const filename = parts.pop() || doc.title
    const parentPath = parts.join('/')
    if (parentPath) ensureFolder(parentPath)
    const fileNode: TreeNode = { name: filename, path: doc.path, type: 'file', doc }
    if (!parentPath) {
      root.set(`file:${doc.id}`, fileNode)
    } else {
      const parent = getFolderNode(parentPath)
      if (parent) {
        parent.children = [...(parent.children || []), fileNode]
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => node.type === 'folder' ? { ...node, children: sortNodes(node.children || []) } : node)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

  return sortNodes(Array.from(root.values()))
}

export default function FileTree({ projectId }: Props) {
  const { documents, token, setDocuments, upsertDocument, removeDocument } = useStore()
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newFolderPath, setNewFolderPath] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { docId } = useParams<{ docId?: string }>()
  const currentDocIdRef = useRef<string | undefined>(docId)

  useEffect(() => {
    currentDocIdRef.current = docId
  }, [docId])

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    Promise.all([docsApi.list(projectId), docsApi.listFolders(projectId)])
      .then(([docsRes, foldersRes]) => {
        setDocuments(docsRes.data)
        setFolders(foldersRes.data)
      })
      .finally(() => setLoading(false))
  }, [projectId, setDocuments])

  useEffect(() => {
    if (!projectId || !token) return
    const socket = new ProjectSocket(projectId, token)
    const offs = [
      socket.on('document_created', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_updated', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_deleted', (msg) => {
        const doc = msg.document as Document | undefined
        if (!doc) return
        removeDocument(doc.id)
        if (currentDocIdRef.current === doc.id) navigate(`/projects/${projectId}`)
      }),
      socket.on('folder_created', (msg) => {
        const folder = msg.folder as FolderItem | undefined
        if (!folder) return
        setFolders((prev) => prev.some((item) => item.path === folder.path) ? prev : [...prev, folder])
        setExpanded((prev) => ({ ...prev, [folder.path]: true }))
      }),
    ]
    socket.connect()
    return () => {
      offs.forEach((off) => off())
      socket.destroy()
    }
  }, [projectId, token, navigate, upsertDocument, removeDocument])

  useEffect(() => {
    if (renamingDocId) renameInputRef.current?.focus()
  }, [renamingDocId])

  const nodes = useMemo(() => buildTree(documents, folders), [documents, folders])

  const createFile = async () => {
    if (!projectId || !newPath.trim()) return
    const res = await docsApi.create(projectId, newPath.trim(), '')
    upsertDocument(res.data)
    setCreatingFile(false)
    setNewPath('')
    navigate(`/projects/${projectId}/docs/${res.data.id}`)
  }

  const createFolder = async () => {
    if (!projectId || !newFolderPath.trim()) return
    const res = await docsApi.createFolder(projectId, newFolderPath.trim())
    setFolders((prev) => prev.some((item) => item.path === res.data.path) ? prev : [...prev, res.data])
    setExpanded((prev) => ({ ...prev, [res.data.path]: true }))
    setCreatingFolder(false)
    setNewFolderPath('')
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!projectId || !files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const res = await docsApi.upload(projectId, file)
        upsertDocument(res.data)
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const deleteDoc = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!projectId || !confirm('Delete this file?')) return
    await docsApi.delete(projectId, id)
    removeDocument(id)
    if (docId === id) navigate(`/projects/${projectId}`)
  }

  const startRename = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation()
    setRenamingDocId(doc.id)
    setRenameValue(doc.title)
  }

  const commitRename = async (doc: Document) => {
    const trimmed = renameValue.trim()
    setRenamingDocId(null)
    if (!projectId || !trimmed || trimmed === doc.title) return
    const parts = doc.path.split('/').filter(Boolean)
    parts[parts.length - 1] = trimmed
    const path = parts.join('/')
    const res = await docsApi.update(projectId, doc.id, { path })
    upsertDocument(res.data)
  }

  const moveDocToFolder = async (doc: Document, folderPath: string) => {
    if (!projectId) return
    const destination = folderPath ? `${folderPath}/${doc.title}` : doc.title
    if (destination === doc.path) return
    const res = await docsApi.update(projectId, doc.id, { path: destination })
    upsertDocument(res.data)
  }

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    if (node.type === 'folder') {
      const isOpen = expanded[node.path] ?? true
      return (
        <div key={node.path}>
          <div
            onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !isOpen }))}
            onDragOver={(e) => { e.preventDefault(); setDragOverPath(node.path) }}
            onDragLeave={() => setDragOverPath((current) => current === node.path ? null : current)}
            onDrop={async (e) => {
              e.preventDefault()
              const docIdFromDrop = e.dataTransfer.getData('application/x-doc-id')
              const doc = documents.find((item) => item.id === docIdFromDrop)
              setDragOverPath(null)
              if (doc) await moveDocToFolder(doc, node.path)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: `5px 10px 5px ${10 + depth * 13}px`,
              color: C.textSecondary, cursor: 'pointer', fontSize: 12,
              background: dragOverPath === node.path ? C.bgActive : 'transparent',
              borderRadius: 5, margin: '1px 4px',
            }}
          >
            <span style={{ color: C.textMuted, flexShrink: 0 }}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
            <FolderIcon size={12} color={C.yellow} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </div>
          {isOpen && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const doc = node.doc!
    const isActive = docId === doc.id
    return (
      <div
        key={doc.id}
        onClick={() => navigate(`/projects/${projectId}/docs/${doc.id}`)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-doc-id', doc.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: `5px 10px 5px ${22 + depth * 13}px`,
          color: isActive ? C.textPrimary : C.textSecondary,
          background: isActive ? C.bgActive : 'transparent',
          borderLeft: `2px solid ${isActive ? C.accent : 'transparent'}`,
          cursor: 'pointer', fontSize: 12,
          borderRadius: '0 5px 5px 0', margin: '1px 0',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.bgHover }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ flexShrink: 0 }}>{fileIcon(doc)}</span>
        {renamingDocId === doc.id ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename(doc)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void commitRename(doc)
              if (e.key === 'Escape') setRenamingDocId(null)
            }}
            style={{
              flex: 1, background: C.bgBase,
              border: `1px solid ${C.accent}`, borderRadius: 3,
              padding: '1px 5px', color: C.textPrimary, fontSize: 12, outline: 'none', minWidth: 0,
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => startRename(e, doc)}
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {node.name}
          </span>
        )}
        <button
          onClick={(e) => deleteDoc(e, doc.id)}
          style={{
            background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer',
            padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0,
          }}
          className="delete-btn"
        >
          <Trash2 size={10} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgSurface }}>
      <style>{`
        div:hover .delete-btn { opacity: 1 !important; }
      `}</style>

      <div style={{
        padding: '8px 10px 8px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.borderFaint}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Files
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={() => setCreatingFolder((v) => !v)} title="New folder" style={actionBtn}>
            <FolderPlus size={13} />
          </button>
          <button onClick={() => setCreatingFile((v) => !v)} title="New file" style={actionBtn}>
            <Plus size={13} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="Upload files" style={actionBtn}>
            {uploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple onChange={(e) => void uploadFiles(e.target.files)} style={{ display: 'none' }} />
      </div>

      {creatingFile && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.borderFaint}` }}>
          <input
            autoFocus value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFile()
              if (e.key === 'Escape') setCreatingFile(false)
            }}
            placeholder="filename.tex"
            style={inputSt}
          />
        </div>
      )}

      {creatingFolder && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.borderFaint}` }}>
          <input
            autoFocus value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFolder()
              if (e.key === 'Escape') setCreatingFolder(false)
            }}
            placeholder="sections/intro"
            style={inputSt}
          />
        </div>
      )}

      <div
        style={{ flex: 1, overflow: 'auto', paddingTop: 4, background: dragOverPath === '' ? C.bgHover : 'transparent' }}
        onDragOver={(e) => { e.preventDefault(); setDragOverPath('') }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragOverPath((current) => current === '' ? null : current)
        }}
        onDrop={async (e) => {
          e.preventDefault()
          const docIdFromDrop = e.dataTransfer.getData('application/x-doc-id')
          const doc = documents.find((item) => item.id === docIdFromDrop)
          setDragOverPath(null)
          if (doc) await moveDocToFolder(doc, '')
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Loader2 size={14} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: '20px 12px', color: C.textMuted, fontSize: 12, textAlign: 'center' }}>
            No files yet
          </div>
        ) : (
          nodes.map((node) => renderNode(node))
        )}
      </div>
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer',
  padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4,
  transition: 'color 0.12s',
}

const inputSt: React.CSSProperties = {
  width: '100%', background: C.bgBase,
  border: `1px solid ${C.border}`, borderRadius: 5,
  padding: '5px 8px', color: C.textPrimary, fontSize: 12, outline: 'none',
  boxSizing: 'border-box',
}
