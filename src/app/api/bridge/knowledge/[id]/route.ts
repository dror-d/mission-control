/**
 * GET /api/bridge/knowledge/[id]  → knowledge_get RPC (single doc)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeKnowledgeGet } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  try {
    const doc = await bridgeKnowledgeGet(id)
    return NextResponse.json({ doc })
  } catch (error: any) {
    logger.error({ err: error, id }, 'GET /api/bridge/knowledge/[id] error')
    if (error?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Knowledge doc not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to fetch knowledge doc' }, { status: 502 })
  }
}
