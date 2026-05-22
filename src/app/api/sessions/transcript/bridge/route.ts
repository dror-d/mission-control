import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { bridgeSessionsGet } from '@/lib/mycelium-bridge'

/**
 * GET /api/sessions/transcript/bridge?session_id=<id>
 * Returns the message transcript for a Mycelium Bridge session.
 * Messages are mapped to SessionTranscriptMessage format for the chat UI.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('session_id')

    if (!sessionId?.trim()) {
      return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }

    const detail = await bridgeSessionsGet(sessionId)

    const messages = (detail.messages ?? []).map((m) => ({
      role: (m.role === 'user' || m.role === 'assistant') ? m.role : 'system',
      parts: [{ type: 'text', text: m.content }],
      timestamp: new Date(m.created_at * 1000).toISOString(),
    }))

    return NextResponse.json({ messages })
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/sessions/transcript/bridge error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to load bridge session transcript' },
      { status: 502 },
    )
  }
}
