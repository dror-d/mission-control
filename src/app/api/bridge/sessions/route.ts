import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { bridgeSessionsSend } from '@/lib/mycelium-bridge'

/** Allow up to 60 s for slow free-tier LLM responses. */
export const maxDuration = 90

/**
 * POST /api/bridge/sessions
 * Sends a message to a Mycelium Bridge agent and returns the full response.
 *
 * Body: { agent_id: string, message: string, session_id?: string }
 * Response: { task_id, session_id, response_text, status, error? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()

    if (!body.agent_id?.trim())
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })
    if (!body.message?.trim())
      return NextResponse.json({ error: 'message is required' }, { status: 400 })

    const result = await bridgeSessionsSend({
      agent_id: body.agent_id,
      session_id: body.session_id || undefined,
      message: body.message,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/bridge/sessions error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to send message to bridge agent' },
      { status: 502 },
    )
  }
}
