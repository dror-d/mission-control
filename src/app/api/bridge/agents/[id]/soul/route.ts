/**
 * Bridge soul document proxy routes.
 *
 * GET  /api/bridge/agents/[id]/soul  → agents_get_soul RPC
 * PUT  /api/bridge/agents/[id]/soul  → agents_set_soul RPC
 *
 * The agent [id] here is the bridge agent ID (slug), not an MC DB integer.
 * These routes use the same response shape as the existing MC soul routes
 * so UI panels can call either without changing their rendering logic.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeAgentsGetSoul, bridgeAgentsSetSoul } from '@/lib/mycelium-bridge'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  try {
    const result = await bridgeAgentsGetSoul(id)
    return NextResponse.json({
      agent: { id, name: id },
      soul_content: result.soul_document,
      source: 'bridge' as const,
      available_templates: [],
      updated_at: Math.floor(Date.now() / 1000),
    })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to fetch soul from bridge' }, { status: 502 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await request.json()
  const { soul_content } = body

  if (typeof soul_content !== 'string') {
    return NextResponse.json({ error: 'soul_content is required' }, { status: 400 })
  }

  try {
    await bridgeAgentsSetSoul(id, soul_content)
    const now = Math.floor(Date.now() / 1000)
    return NextResponse.json({
      success: true,
      message: `Soul updated for ${id}`,
      soul_content,
      saved_to_workspace: false,
      updated_at: now,
    })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update soul on bridge' }, { status: 502 })
  }
}
