/**
 * Bridge working memory proxy routes.
 *
 * GET    /api/bridge/agents/[id]/memory  → agents_get_memory RPC
 * PUT    /api/bridge/agents/[id]/memory  → agents_set_memory / agents_append_memory RPC
 * DELETE /api/bridge/agents/[id]/memory  → agents_set_memory RPC with empty string
 *
 * The agent [id] here is the bridge agent ID (slug), not an MC DB integer.
 * Body for PUT: { working_memory: string, append?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  bridgeAgentsGetMemory,
  bridgeAgentsSetMemory,
  bridgeAgentsAppendMemory,
} from '@/lib/mycelium-bridge'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  try {
    const result = await bridgeAgentsGetMemory(id)
    return NextResponse.json({
      agent: { id, name: id },
      working_memory: result.working_memory,
      source: 'bridge' as const,
      updated_at: Math.floor(Date.now() / 1000),
      size: result.size,
    })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to fetch memory from bridge' }, { status: 502 })
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
  const { working_memory, append } = body

  if (typeof working_memory !== 'string') {
    return NextResponse.json({ error: 'working_memory is required' }, { status: 400 })
  }

  try {
    if (append) {
      await bridgeAgentsAppendMemory(id, working_memory)
    } else {
      await bridgeAgentsSetMemory(id, working_memory)
    }
    const now = Math.floor(Date.now() / 1000)
    return NextResponse.json({
      success: true,
      message: `Memory ${append ? 'appended' : 'updated'} for ${id}`,
      working_memory,
      saved_to_workspace: false,
      updated_at: now,
      size: working_memory.length,
    })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (err?.message?.includes('payload_too_large')) {
      return NextResponse.json({ error: 'Working memory exceeds 512KB limit' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Failed to update memory on bridge' }, { status: 502 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  try {
    await bridgeAgentsSetMemory(id, '')
    const now = Math.floor(Date.now() / 1000)
    return NextResponse.json({
      success: true,
      message: `Working memory cleared for ${id}`,
      working_memory: '',
      updated_at: now,
    })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to clear memory on bridge' }, { status: 502 })
  }
}
