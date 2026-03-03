import { NextRequest, NextResponse } from 'next/server'

/**
 * LUD-21 Payment Verification Proxy
 * 
 * Receives a verify URL (from the LNURL-pay invoice response)
 * and checks if the payment has been settled.
 */

export async function POST(req: NextRequest) {
  try {
    const { verify } = await req.json()

    if (!verify || typeof verify !== 'string') {
      return NextResponse.json(
        { error: 'Missing verify URL' },
        { status: 400 }
      )
    }

    // Validate URL
    let verifyUrl: URL
    try {
      verifyUrl = new URL(verify)
      if (!['https:', 'http:'].includes(verifyUrl.protocol)) {
        throw new Error('Invalid protocol')
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid verify URL' },
        { status: 400 }
      )
    }

    const res = await fetch(verifyUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      return NextResponse.json({
        settled: false,
        reason: `Verify endpoint returned ${res.status}`,
      })
    }

    const data = await res.json()

    // LUD-21 response format: { status: "OK", settled: true/false, preimage: "...", pr: "..." }
    return NextResponse.json({
      settled: data.settled === true,
      preimage: data.preimage || null,
      pr: data.pr || null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Verification failed', settled: false },
      { status: 500 }
    )
  }
}
