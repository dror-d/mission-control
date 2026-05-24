import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { bridgeAgentsUpdate, bridgeAgentsDelete, MyceliumAgentUpdateParams } from '@/lib/mycelium-bridge'

/**
 * PUT /api/bridge/agents/[id]
 * Updates a Mycelium agent via the bridge agents_update RPC.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const { id } = await params

  try {
    const body = (await request.json()) as Omit<MyceliumAgentUpdateParams, 'id'>
    const agent = await bridgeAgentsUpdate({ ...body, id })
    return NextResponse.json({ agent })
  } catch (error: any) {
    logger.error({ err: error }, `PUT /api/bridge/agents/${id} error`)
    const message = error?.message ?? 'Failed to update bridge agent'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/**
 * DELETE /api/bridge/agents/[id]
 * Deletes a Mycelium agent via the bridge agents_delete RPC.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const { id } = await params

  try {
    await bridgeAgentsDelete(id)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    logger.error({ err: error }, `DELETE /api/bridge/agents/${id} error`)
    const message = error?.message ?? 'Failed to delete bridge agent'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
