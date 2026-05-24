/**
 * GET /api/bridge/knowledge/graph?scope=  → knowledge_graph RPC
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeKnowledgeGraph } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const scope = request.nextUrl.searchParams.get('scope') ?? undefined

  try {
    const graph = await bridgeKnowledgeGraph(scope)
    return NextResponse.json(graph)
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/bridge/knowledge/graph error')
    return NextResponse.json({ error: 'Failed to fetch knowledge graph' }, { status: 502 })
  }
}
