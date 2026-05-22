/**
 * Bridge provider management proxy routes.
 *
 * GET    /api/bridge/providers          → providers_list RPC
 * POST   /api/bridge/providers          → providers_create RPC
 * PUT    /api/bridge/providers          → providers_update RPC
 * DELETE /api/bridge/providers?id=<id>  → providers_delete RPC
 *
 * Body for POST: { name, type, api_key, model, priority? }
 * Body for PUT:  { id, name?, api_key?, model?, priority?, enabled? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  bridgeProvidersList,
  bridgeProvidersCreate,
  bridgeProvidersUpdate,
  bridgeProvidersDelete,
} from '@/lib/mycelium-bridge'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const providers = await bridgeProvidersList()
    return NextResponse.json({ providers })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to list providers from bridge' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { name, type, api_key, model, priority } = body

  if (!name || !type || !api_key || !model) {
    return NextResponse.json({ error: 'name, type, api_key, and model are required' }, { status: 400 })
  }

  try {
    const provider = await bridgeProvidersCreate({ name, type, api_key, model, priority })
    return NextResponse.json({ success: true, provider })
  } catch (err: any) {
    if (err?.message?.includes('conflict') || err?.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'Provider name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create provider on bridge' }, { status: 502 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const provider = await bridgeProvidersUpdate(body)
    return NextResponse.json({ success: true, provider })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update provider on bridge' }, { status: 502 })
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
    await bridgeProvidersDelete(id)
    return NextResponse.json({ success: true, id })
  } catch (err: any) {
    if (err?.message?.includes('not_found')) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to delete provider on bridge' }, { status: 502 })
  }
}
