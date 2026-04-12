type MessageHandler = (msg: Record<string, unknown>) => void

export class RoomSocket {
  private ws: WebSocket | null = null
  private handlers: Map<string, MessageHandler[]> = new Map()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private reconnectDelayMs = 1000

  constructor(
    private roomId: string,
    private token: string
  ) {}

  connect() {
    if (this.destroyed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    const url = `ws://${window.location.hostname}:8000/ws/${this.roomId}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectDelayMs = 1000
      this.emit('connected', {})
      this.pingInterval = setInterval(() => this.send({ type: 'ping' }), 20000)
    }

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        this.emit(msg.type, msg)
        this.emit('*', msg)
      } catch {}
    }

    this.ws.onclose = () => {
      this.ws = null
      this.emit('disconnected', {})
      if (this.pingInterval) clearInterval(this.pingInterval)
      this.pingInterval = null
      if (!this.destroyed) {
        const nextDelay = this.reconnectDelayMs
        this.emit('reconnecting', { delay_ms: nextDelay })
        this.reconnectTimer = setTimeout(() => this.connect(), nextDelay)
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30000)
      }
    }

    this.ws.onerror = () => this.ws?.close()
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type)!.push(handler)
    return () => this.off(type, handler)
  }

  off(type: string, handler: MessageHandler) {
    const arr = this.handlers.get(type)
    if (arr) {
      const idx = arr.indexOf(handler)
      if (idx !== -1) arr.splice(idx, 1)
    }
  }

  private emit(type: string, msg: Record<string, unknown>) {
    this.handlers.get(type)?.forEach((h) => h(msg))
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  sendCursor(position: { lineNumber: number; column: number }, selection?: unknown) {
    this.send({ type: 'cursor', position, selection })
  }

  sendTitle(title: string) {
    this.send({ type: 'title', title })
  }

  sendAiChat(data: Record<string, unknown>) {
    this.send({ type: 'ai_chat', ...data })
  }

  sendTyping(isTyping: boolean) {
    this.send({ type: 'typing', is_typing: isTyping })
  }

  sendCompileResult(data: { success: boolean; pdf_base64: string | null; log: string }) {
    this.send({ type: 'compile_result', ...data })
  }

  destroy() {
    this.destroyed = true
    if (this.pingInterval) clearInterval(this.pingInterval)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.pingInterval = null
    this.ws?.close()
    this.ws = null
    this.handlers.clear()
  }

  isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export class ProjectSocket {
  private ws: WebSocket | null = null
  private handlers: Map<string, MessageHandler[]> = new Map()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(
    private projectId: string,
    private token: string
  ) {}

  connect() {
    if (this.destroyed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    const url = `ws://${window.location.hostname}:8000/ws/project/${this.projectId}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.emit('connected', {})
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping')
      }, 20000)
    }

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        this.emit(msg.type, msg)
        this.emit('*', msg)
      } catch {}
    }

    this.ws.onclose = () => {
      this.ws = null
      this.emit('disconnected', {})
      if (this.pingInterval) clearInterval(this.pingInterval)
      this.pingInterval = null
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    }

    this.ws.onerror = () => this.ws?.close()
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type)!.push(handler)
    return () => this.off(type, handler)
  }

  off(type: string, handler: MessageHandler) {
    const arr = this.handlers.get(type)
    if (arr) {
      const idx = arr.indexOf(handler)
      if (idx !== -1) arr.splice(idx, 1)
    }
  }

  private emit(type: string, msg: Record<string, unknown>) {
    this.handlers.get(type)?.forEach((h) => h(msg))
  }

  destroy() {
    this.destroyed = true
    if (this.pingInterval) clearInterval(this.pingInterval)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.pingInterval = null
    this.ws?.close()
    this.ws = null
    this.handlers.clear()
  }
}
