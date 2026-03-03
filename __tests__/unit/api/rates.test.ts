import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Need to reset module between tests to clear in-memory cache
describe('GET /api/rates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeRequest(url = 'http://localhost/api/rates') {
    return new Request(url)
  }

  it('returns rates from yadio on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        BTC: { USD: 100000, ARS: 90000000 },
        timestamp: 1700000000,
      }),
    })

    const { GET } = await import('@/app/api/rates/route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rates).toBeDefined()
    expect(body.rates.USD).toBeCloseTo(100000 / 100_000_000)
    expect(body.rates.ARS).toBeCloseTo(90000000 / 100_000_000)
  })

  it('filters currencies when ?currencies= is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        BTC: { USD: 100000, ARS: 90000000, EUR: 95000 },
        timestamp: 1700000000,
      }),
    })

    const { GET } = await import('@/app/api/rates/route')
    const res = await GET(makeRequest('http://localhost/api/rates?currencies=USD,EUR'))
    const body = await res.json()

    expect(body.rates.USD).toBeDefined()
    expect(body.rates.EUR).toBeDefined()
    expect(body.rates.ARS).toBeUndefined()
  })

  it('returns 502 when yadio is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { GET } = await import('@/app/api/rates/route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.code).toBe('RATES_UNAVAILABLE')
  })

  it('returns 502 when yadio returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })

    const { GET } = await import('@/app/api/rates/route')
    const res = await GET(makeRequest())

    expect(res.status).toBe(502)
  })

  it('returns CORS headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ BTC: { USD: 100000 }, timestamp: 1700000000 }),
    })

    const { GET } = await import('@/app/api/rates/route')
    const res = await GET(makeRequest())

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
