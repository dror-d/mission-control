import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { bridgeTokenUsageSummary } from '@/lib/mycelium-bridge'
import { logger } from '@/lib/logger'

/**
 * GET /api/bridge/cost
 * Returns per-agent and grand-total token usage from the bridge.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const summary = await bridgeTokenUsageSummary()
    return NextResponse.json(summary)
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/bridge/cost error')
    return NextResponse.json(
      { error: error?.message ?? 'Failed to fetch token usage' },
      { status: 502 },
    )
  }
}
