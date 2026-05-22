/**
 * Bridge knowledge search proxy.
 *
 * GET /api/bridge/knowledge/search?q=<query>&scopes=shared,agent:x&limit=10 → knowledge_search RPC
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeKnowledgeSearch } from '@/lib/mycelium-bridge'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const query = request.nextUrl.searchParams.get('q') ?? ''
  if (!query) {
    return NextResponse.json({ error: 'q query parameter is required' }, { status: 400 })
  }

  const scopesParam = request.nextUrl.searchParams.get('scopes')
  const scopes = scopesParam ? scopesParam.split(',') : ['shared']
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10)

  try {
    const results = await bridgeKnowledgeSearch(query, scopes, limit)
    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: 'Failed to search knowledge base on bridge' }, { status: 502 })
  }
}
