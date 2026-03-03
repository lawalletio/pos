import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

interface InvoiceRequest {
  callback: string
  amount: number
  nostr?: string
  lnurl?: string
}

interface InvoiceResponse {
  pr: string
  routes?: unknown[]
  verify?: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests', code: 'RATE_LIMITED' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  let body: InvoiceRequest
  try {
    body = (await request.json()) as InvoiceRequest
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const { callback, amount, nostr, lnurl } = body

  if (!callback || typeof callback !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid callback URL', code: 'MISSING_CALLBACK' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  // Validate callback is a proper https URL
  let callbackUrl: URL
  try {
    callbackUrl = new URL(callback)
    if (callbackUrl.protocol !== 'https:' && callbackUrl.protocol !== 'http:') {
      throw new Error('Invalid protocol')
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid callback URL format', code: 'INVALID_CALLBACK' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'Amount must be a positive integer (millisatoshis)', code: 'INVALID_AMOUNT' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  // Build callback URL with params
  callbackUrl.searchParams.set('amount', String(amount))
  if (nostr && typeof nostr === 'string') {
    callbackUrl.searchParams.set('nostr', nostr)
  }
  if (lnurl && typeof lnurl === 'string') {
    callbackUrl.searchParams.set('lnurl', lnurl)
  }

  let invoiceData: InvoiceResponse
  try {
    const res = await fetch(callbackUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Callback returned ${res.status}`, code: 'UPSTREAM_ERROR' },
        { status: 502, headers: CORS_HEADERS }
      )
    }

    const data = (await res.json()) as Record<string, unknown>

    // Check for LNURL error response
    if (data.status === 'ERROR') {
      return NextResponse.json(
        { error: (data.reason as string) ?? 'Upstream error', code: 'LNURL_ERROR' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!data.pr || typeof data.pr !== 'string') {
      return NextResponse.json(
        { error: 'No invoice returned from callback', code: 'INVALID_RESPONSE' },
        { status: 502, headers: CORS_HEADERS }
      )
    }

    invoiceData = {
      pr: data.pr,
      routes: Array.isArray(data.routes) ? data.routes : [],
      ...(data.verify && typeof data.verify === 'string' ? { verify: data.verify } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: `Could not fetch invoice: ${message}`, code: 'UNREACHABLE' },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  return NextResponse.json(invoiceData, { headers: CORS_HEADERS })
}
