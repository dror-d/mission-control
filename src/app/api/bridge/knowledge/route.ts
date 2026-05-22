/**
 * Bridge knowledge base proxy routes.
 *
 * GET    /api/bridge/knowledge?scope=&limit=&offset=  → knowledge_list RPC
 * POST   /api/bridge/knowledge                        → knowledge_save RPC (upsert)
 * DELETE /api/bridge/knowledge?id=<id>                → knowledge_delete RPC
 *
 * Body for POST: { id?, title, slug?, scope?, content }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  bridgeKnowledgeList,
  bridgeKnowledgeSave,
  bridgeKnowledgeDelete,
} from '@/lib/mycelium-bridge'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const scope = request.nextUrl.searchParams.get('scope') ?? undefined
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10)

  try {
    const docs = await bridgeKnowledgeList(scope, limit, offset)
    return NextResponse.json({ docs })
  } catch {
    return NextResponse.json({ error: 'Failed to list knowledge docs from bridge' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, title, slug, scope, content } = body

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  try {
    const doc = await bridgeKnowledgeSave({ id, title, slug, scope, content })
    return NextResponse.json({ success: true, doc })
  } catch {
    return NextResponse.json({ error: 'Failed to save knowledge doc on bridge' }, { status: 502 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })
  }

  try {
    await bridgeKnowledgeDelete(id)
    return NextResponse.json({ success: true, id })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Knowledge doc not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to delete knowledge doc on bridge' }, { status: 502 })
  }
}
