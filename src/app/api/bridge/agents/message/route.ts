import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { bridgeAgentMessage } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

/** Allow up to 90 s for slow free-tier LLM responses. */
export const maxDuration = 90

/**
 * POST /api/bridge/agents/message
 * Sends a synchronous agent-to-agent message and returns the target agent's response.
 *
 * Body: { from_agent_id, to_agent_id, message, session_id? }
 * Response: { response_text, session_id, task_id, input_tokens, output_tokens }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()

    if (!body.from_agent_id?.trim())
      return NextResponse.json({ error: 'from_agent_id is required' }, { status: 400 })
    if (!body.to_agent_id?.trim())
      return NextResponse.json({ error: 'to_agent_id is required' }, { status: 400 })
    if (!body.message?.trim())
      return NextResponse.json({ error: 'message is required' }, { status: 400 })

    const result = await bridgeAgentMessage({
      from_agent_id: body.from_agent_id,
      to_agent_id:   body.to_agent_id,
      message:       body.message,
      session_id:    body.session_id || undefined,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/bridge/agents/message error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to send agent message' },
      { status: 502 },
    )
  }
}
