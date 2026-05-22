import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeSessionsGet } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

/**
 * GET /api/bridge/sessions/[id]
 * Returns full session detail including messages, tasks, and token usage.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  if (!id?.trim())
    return NextResponse.json({ error: 'session id is required' }, { status: 400 })

  try {
    const result = await bridgeSessionsGet(id)
    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error, session_id: id }, 'GET /api/bridge/sessions/[id] error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to get session' },
      { status: 502 },
    )
  }
}
