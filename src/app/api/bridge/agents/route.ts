import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { bridgeAgentsCreate, bridgeAgentsList, MyceliumAgentParams } from '@/lib/mycelium-bridge'

/**
 * GET /api/bridge/agents
 * Returns Mycelium agents from the bridge.  Never throws — if the bridge is
 * unavailable an empty list is returned so the panel degrades gracefully.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const agents = await bridgeAgentsList()
    return NextResponse.json({ agents })
  } catch (error) {
    logger.warn({ err: error }, 'GET /api/bridge/agents: bridge unavailable')
    return NextResponse.json({ agents: [] })
  }
}

/**
 * POST /api/bridge/agents
 * Creates a persistent Mycelium agent via the bridge agents_create RPC.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = (await request.json()) as MyceliumAgentParams

    if (!body.id?.trim())
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    if (!body.name?.trim())
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!body.provider?.trim())
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    if (!body.model?.trim())
      return NextResponse.json({ error: 'model is required' }, { status: 400 })

    const agent = await bridgeAgentsCreate(body)
    return NextResponse.json({ agent }, { status: 201 })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/bridge/agents error')
    const message = error?.message ?? 'Failed to create bridge agent'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
