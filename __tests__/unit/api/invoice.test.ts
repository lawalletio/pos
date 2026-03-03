import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('POST /api/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeRequest(body?: unknown) {
    return new Request('http://localhost/api/invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : 'bad json {{{',
    })
  }

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/invoice', {
      method: 'POST',
      body: 'bad json {{{',
    })
    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when callback is missing', async () => {
    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(makeRequest({ amount: 1000 }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('MISSING_CALLBACK')
  })

  it('returns 400 for invalid amount', async () => {
    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(makeRequest({ callback: 'https://example.com/cb', amount: -5 }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_AMOUNT')
  })

  it('returns invoice on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pr: 'lnbc210n1...', routes: [] }),
    })

    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(makeRequest({
      callback: 'https://example.com/lnurlp/callback',
      amount: 21000,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pr).toBe('lnbc210n1...')
  })

  it('returns 400 when LNURL callback returns ERROR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ERROR', reason: 'Amount too low' }),
    })

    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(makeRequest({
      callback: 'https://example.com/lnurlp/callback',
      amount: 1,
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Amount too low')
  })

  it('returns 502 when callback is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'))

    const { POST } = await import('@/app/api/invoice/route')
    const res = await POST(makeRequest({
      callback: 'https://example.com/cb',
      amount: 21000,
    }))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.code).toBe('UNREACHABLE')
  })

  it('includes nostr param in callback URL when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pr: 'lnbc1...' }),
    })

    const { POST } = await import('@/app/api/invoice/route')
    await POST(makeRequest({
      callback: 'https://example.com/cb',
      amount: 1000,
      nostr: 'encoded-zap-request',
    }))

    const calledUrl = mockFetch.mock.calls[0]![0] as string
    expect(calledUrl).toContain('nostr=')
    expect(calledUrl).toContain('encoded-zap-request')
  })
})
