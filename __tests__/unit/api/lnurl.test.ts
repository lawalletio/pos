import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('GET /api/lnurl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeRequest(address?: string) {
    const url = address
      ? `http://localhost/api/lnurl?address=${encodeURIComponent(address)}`
      : 'http://localhost/api/lnurl'
    return new Request(url)
  }

  const validLnurlResponse = {
    tag: 'payRequest',
    callback: 'https://walletofsatoshi.com/lnurlp/alice/callback',
    minSendable: 1000,
    maxSendable: 100000000,
    metadata: '[]',
    nostrPubkey: 'abc123',
    allowsNostr: true,
  }

  it('returns 400 when address is missing', async () => {
    const { GET } = await import('@/app/api/lnurl/route')
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('MISSING_PARAM')
  })

  it('returns 400 for invalid address format', async () => {
    const { GET } = await import('@/app/api/lnurl/route')
    const res = await GET(makeRequest('notavalidemail'))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_FORMAT')
  })

  it('resolves valid lightning address', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validLnurlResponse,
    })

    const { GET } = await import('@/app/api/lnurl/route')
    const res = await GET(makeRequest('alice@walletofsatoshi.com'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.tag).toBe('payRequest')
    expect(body.callback).toBe(validLnurlResponse.callback)
  })

  it('returns 502 when upstream is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const { GET } = await import('@/app/api/lnurl/route')
    const res = await GET(makeRequest('alice@example.com'))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.code).toBe('UNREACHABLE')
  })

  it('returns 400 when tag is not payRequest', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag: 'withdrawRequest' }),
    })

    const { GET } = await import('@/app/api/lnurl/route')
    const res = await GET(makeRequest('alice@example.com'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('NOT_LNURL_PAY')
  })
})
