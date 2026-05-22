import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeContextPreview } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

/**
 * POST /api/bridge/context-preview
 * Dry-run context assembly for a Mycelium agent without calling the LLM.
 *
 * Body: { agent_id: string, session_id?: string, message?: string }
 * Response: BridgeContextPreviewResult
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()

    if (!body.agent_id?.trim())
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })

    const result = await bridgeContextPreview({
      agent_id: body.agent_id,
      session_id: body.session_id || undefined,
      message: body.message || undefined,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/bridge/context-preview error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to get context preview' },
      { status: 502 },
    )
  }
}
