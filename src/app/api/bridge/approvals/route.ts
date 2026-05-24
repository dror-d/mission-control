import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeApprovalsList, bridgeApprovalRespond } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

/**
 * GET /api/bridge/approvals
 * Returns all currently pending tool-approval requests from the bridge.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const approvals = await bridgeApprovalsList()
    return NextResponse.json({ approvals })
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/bridge/approvals error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to fetch approvals' },
      { status: 502 },
    )
  }
}

/**
 * POST /api/bridge/approvals
 * Body: { id: string, approved: boolean }
 * Resolves a pending bridge tool-call approval.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string; approved?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved (boolean) is required' }, { status: 400 })
  }

  try {
    await bridgeApprovalRespond(body.id, body.approved)
    return NextResponse.json({ ok: true, id: body.id, approved: body.approved })
  } catch (error: any) {
    logger.error({ err: error, id: body.id }, 'POST /api/bridge/approvals error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to resolve approval' },
      { status: 502 },
    )
  }
}
