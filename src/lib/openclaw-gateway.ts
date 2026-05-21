import WebSocket from 'ws'
import { APP_VERSION } from './version'
import { config } from './config'
import { buildGatewayWebSocketUrl } from './gateway-url'
import { getDetectedGatewayToken } from './gateway-runtime'

const GATEWAY_PROTOCOL_VERSION = 3
const GATEWAY_CLIENT_ID = process.env.GATEWAY_CLIENT_ID || 'gateway-client'
const GATEWAY_SCOPES = ['operator.admin', 'operator.write', 'operator.read']

interface GatewayFrame {
  type?: string
  event?: string
  method?: string
  id?: string
  params?: unknown
  payload?: any
  ok?: boolean
  result?: any
  error?: { message?: string; code?: string; details?: any; [key: string]: any } | string
  expectFinal?: boolean
}

interface CallGatewayOptions {
  expectFinal?: boolean
}

export function parseGatewayJsonOutput(raw: string): unknown | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const objectStart = trimmed.indexOf('{')
  const arrayStart = trimmed.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0

  let start = -1
  let end = -1

  if (hasObject && hasArray) {
    if (objectStart < arrayStart) {
      start = objectStart
      end = trimmed.lastIndexOf('}')
    } else {
      start = arrayStart
      end = trimmed.lastIndexOf(']')
    }
  } else if (hasObject) {
    start = objectStart
    end = trimmed.lastIndexOf('}')
  } else if (hasArray) {
    start = arrayStart
    end = trimmed.lastIndexOf(']')
  }

  if (start < 0 || end < start) return null

  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
  options: CallGatewayOptions = {},
): Promise<T> {
  const boundedTimeoutMs = Math.max(1000, Math.floor(timeoutMs))
  const url = buildGatewayWebSocketUrl({
    host: config.gatewayHost,
    port: config.gatewayPort,
  })
  const token = getDetectedGatewayToken()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let connected = false
    let connectSent = false
    const requestId = `mc-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const connectId = `${requestId}-connect`
    const ws = new WebSocket(url)

    const cleanup = () => {
      clearTimeout(timeout)
      clearTimeout(connectFallback)
      ws.removeAllListeners()
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch {
        // ignore close races
      }
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const fail = (message: string, cause?: unknown) => {
      const error = cause instanceof Error ? cause : new Error(message)
      if (!(cause instanceof Error) && cause !== undefined) {
        ;(error as any).cause = cause
      }
      finish(() => reject(error))
    }

    const sendFrame = (frame: GatewayFrame) => {
      ws.send(JSON.stringify(frame))
    }

    const sendConnect = (_nonce?: string) => {
      if (connectSent || settled || ws.readyState !== WebSocket.OPEN) return
      connectSent = true
      sendFrame({
        type: 'req',
        method: 'connect',
        id: connectId,
        params: {
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          client: {
            id: GATEWAY_CLIENT_ID,
            displayName: 'Mission Control',
            version: APP_VERSION,
            platform: 'server',
            mode: 'backend',
            instanceId: `mc-server-${process.pid}`,
          },
          role: 'operator',
          scopes: GATEWAY_SCOPES,
          caps: ['tool-events'],
          auth: token ? { token } : undefined,
        },
      })
    }

    const sendRequest = () => {
      const frame: GatewayFrame = {
        type: 'req',
        method,
        id: requestId,
        params: params ?? {},
      }
      if (options.expectFinal) frame.expectFinal = true
      sendFrame(frame)
    }

    const timeout = setTimeout(() => {
      fail(`Gateway method ${method} timed out after ${boundedTimeoutMs}ms`)
    }, boundedTimeoutMs)

    const connectFallback = setTimeout(() => {
      sendConnect()
    }, 100)

    ws.on('open', () => {
      // Newer gateways send connect.challenge first. The short fallback above
      // covers older/test gateways that accept connect immediately.
    })

    ws.on('message', (raw) => {
      let frame: GatewayFrame
      try {
        frame = JSON.parse(raw.toString()) as GatewayFrame
      } catch {
        return
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        connectSent = false
        sendConnect(frame.payload?.nonce)
        return
      }

      if (frame.type === 'res' && frame.id === connectId) {
        if (!frame.ok) {
          fail(`Gateway connect failed: ${formatGatewayError(frame.error)}`, frame.error)
          return
        }
        connected = true
        sendRequest()
        return
      }

      if (frame.type === 'res' && frame.id === requestId) {
        if (!frame.ok) {
          fail(`Gateway method ${method} failed: ${formatGatewayError(frame.error)}`, frame.error)
          return
        }
        const payload = frame.result ?? frame.payload ?? null
        if (options.expectFinal && String(payload?.status || '').toLowerCase() === 'accepted') {
          return
        }
        finish(() => resolve(payload as T))
        return
      }

      if (!connected && frame.type === 'status') {
        connected = true
        sendRequest()
      }
    })

    ws.on('error', (err) => {
      fail(`Gateway websocket error for method ${method}: ${err.message}`, err)
    })

    ws.on('close', () => {
      if (!settled) fail(`Gateway websocket closed before method ${method} completed`)
    })
  })
}

function formatGatewayError(error: GatewayFrame['error']): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  return error.message || error.code || JSON.stringify(error)
}

// ── streaming collector ────────────────────────────────────────────────────────

/** Returned by callOpenClawGatewayCollectEvents after a sessions_send completes. */
export interface GatewayStreamResult {
  task_id: string
  session_id: string
  response_text: string
  status: 'completed' | 'failed'
  error?: string
}

/**
 * Like callOpenClawGateway but keeps the WebSocket connection open after the
 * initial response so it can collect streaming event frames.
 *
 * Intended for sessions_send: receives {task_id, session_id}, then accumulates
 * session.message deltas until task.updated carries status completed or failed.
 */
export async function callOpenClawGatewayCollectEvents(
  method: string,
  params: unknown,
  timeoutMs = 30000,
): Promise<GatewayStreamResult> {
  const boundedTimeoutMs = Math.max(5000, Math.floor(timeoutMs))
  const url = buildGatewayWebSocketUrl({
    host: config.gatewayHost,
    port: config.gatewayPort,
  })
  const token = getDetectedGatewayToken()

  return new Promise<GatewayStreamResult>((resolve, reject) => {
    let settled = false
    let connected = false
    let connectSent = false
    const requestId = `mc-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const connectId = `${requestId}-connect`
    const ws = new WebSocket(url)
    let taskId: string | null = null
    let sessionId: string | null = null
    let responseText = ''

    const cleanup = () => {
      clearTimeout(timeout)
      clearTimeout(connectFallback)
      ws.removeAllListeners()
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch {
        // ignore close races
      }
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const fail = (message: string, cause?: unknown) => {
      const error = cause instanceof Error ? cause : new Error(message)
      if (!(cause instanceof Error) && cause !== undefined) {
        ;(error as any).cause = cause
      }
      finish(() => reject(error))
    }

    const sendFrame = (frame: GatewayFrame) => {
      ws.send(JSON.stringify(frame))
    }

    const sendConnect = (_nonce?: string) => {
      if (connectSent || settled || ws.readyState !== WebSocket.OPEN) return
      connectSent = true
      sendFrame({
        type: 'req',
        method: 'connect',
        id: connectId,
        params: {
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          client: {
            id: GATEWAY_CLIENT_ID,
            displayName: 'Mission Control',
            version: APP_VERSION,
            platform: 'server',
            mode: 'backend',
            instanceId: `mc-server-${process.pid}`,
          },
          role: 'operator',
          scopes: GATEWAY_SCOPES,
          caps: ['tool-events'],
          auth: token ? { token } : undefined,
        },
      })
    }

    const sendRequest = () => {
      sendFrame({ type: 'req', method, id: requestId, params: params ?? {} })
    }

    const timeout = setTimeout(() => {
      fail(`Gateway method ${method} timed out after ${boundedTimeoutMs}ms`)
    }, boundedTimeoutMs)

    const connectFallback = setTimeout(() => {
      sendConnect()
    }, 100)

    ws.on('open', () => {})

    ws.on('message', (raw) => {
      let frame: GatewayFrame
      try {
        frame = JSON.parse(raw.toString()) as GatewayFrame
      } catch {
        return
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        connectSent = false
        sendConnect(frame.payload?.nonce)
        return
      }

      if (frame.type === 'res' && frame.id === connectId) {
        if (!frame.ok) {
          fail(`Gateway connect failed: ${formatGatewayError(frame.error)}`, frame.error)
          return
        }
        connected = true
        sendRequest()
        return
      }

      // Initial RPC response — extract task_id/session_id and keep listening.
      if (frame.type === 'res' && frame.id === requestId) {
        if (!frame.ok) {
          fail(`Gateway method ${method} failed: ${formatGatewayError(frame.error)}`, frame.error)
          return
        }
        const payload = frame.result ?? frame.payload ?? null
        taskId = payload?.task_id ?? null
        sessionId = payload?.session_id ?? null
        if (!taskId) {
          // Not a streaming dispatch — resolve immediately.
          finish(() =>
            resolve({ task_id: '', session_id: '', response_text: '', status: 'completed' }),
          )
        }
        // Keep connection open to collect event frames.
        return
      }

      // Collect streaming events once we have a task_id.
      if (frame.type === 'event' && taskId) {
        if (frame.event === 'session.message') {
          const p = frame.payload as { delta?: string; done?: boolean } | null
          if (p?.delta) responseText += p.delta
          return
        }

        if (frame.event === 'task.updated') {
          const p = frame.payload as {
            task_id?: string
            status?: string
            error?: string
          } | null
          if (p?.task_id !== taskId) return
          if (p?.status === 'completed') {
            finish(() =>
              resolve({
                task_id: taskId!,
                session_id: sessionId!,
                response_text: responseText,
                status: 'completed',
              }),
            )
            return
          }
          if (p?.status === 'failed') {
            finish(() =>
              resolve({
                task_id: taskId!,
                session_id: sessionId!,
                response_text: responseText,
                status: 'failed',
                error: p.error || 'Provider error',
              }),
            )
            return
          }
        }
      }

      if (!connected && frame.type === 'status') {
        connected = true
        sendRequest()
      }
    })

    ws.on('error', (err) => {
      fail(`Gateway websocket error for method ${method}: ${err.message}`, err)
    })

    ws.on('close', () => {
      if (!settled) fail(`Gateway websocket closed before method ${method} completed`)
    })
  })
}
