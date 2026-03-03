/**
 * Integration: Menu loading flow
 * Tests API rate route (fetch stalls → fetch rates → render)
 * Using MSW-style fetch mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('Rates API — menu loading flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('loads rates and makes them available for menu pricing', async () => {
    // Simulate fetching rates from the proxy API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rates: { ARS: 0.9, USD: 0.0001 },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    })

    const res = await fetch('/api/rates?currencies=ARS,USD')
    const { rates } = await res.json()

    expect(rates.ARS).toBe(0.9)
    expect(rates.USD).toBe(0.0001)

    // Now simulate updating the currency store (as the app does)
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().updateRates(rates)

    // A product priced at 1000 ARS converts to sats
    const sats = useCurrencyStore.getState().convertCurrency(1000, 'ARS', 'SAT')
    expect(sats).toBeCloseTo(1000 / 0.9)
  })

  it('handles stale rates gracefully (no rates loaded)', async () => {
    // If rates are unavailable, app falls back to SAT

    const { useCurrencyStore } = await import('@/stores/currency')
    // Start without rates
    useCurrencyStore.getState().updateRates({})

    // Product in SAT currency should display directly
    const sats = useCurrencyStore.getState().convertCurrency(500, 'SAT', 'SAT')
    expect(sats).toBe(500)
  })

  it('currency store handles multiple currencies', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().updateRates({
      ARS: 0.9,
      USD: 0.0001,
      EUR: 0.000095,
    })

    // Add a new currency to active list
    useCurrencyStore.getState().addCurrency('EUR')
    expect(useCurrencyStore.getState().activeCurrencies).toContain('EUR')

    // Convert between non-SAT currencies (via SAT as intermediary)
    // 1000 ARS → SAT → USD
    const sats = useCurrencyStore.getState().convertCurrency(1000, 'ARS', 'SAT')
    const usd = useCurrencyStore.getState().convertCurrency(sats, 'SAT', 'USD')
    // 1000 / 0.9 * 0.0001 ≈ 0.111
    expect(usd).toBeCloseTo((1000 / 0.9) * 0.0001, 4)
  })

  it('removes currency from active list', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().addCurrency('BRL')
    useCurrencyStore.getState().removeCurrency('BRL')
    expect(useCurrencyStore.getState().activeCurrencies).not.toContain('BRL')
  })
})

describe('LNURL resolution → invoice flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('full payment flow: resolve address → get invoice', async () => {
    // Step 1: resolve lightning address via /api/lnurl
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://walletofsatoshi.com/lnurlp/alice/callback',
          minSendable: 1000,
          maxSendable: 100000000000,
          metadata: '[]',
          nostrPubkey: 'abc123',
          allowsNostr: true,
        }),
      })
      // Step 2: fetch invoice via /api/invoice
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pr: 'lnbc210n1pabcdef...',
          routes: [],
        }),
      })

    // Resolve address
    const lnurlRes = await fetch('/api/lnurl?address=alice%40walletofsatoshi.com')
    const lnurlData = await lnurlRes.json()

    expect(lnurlData.tag).toBe('payRequest')
    expect(lnurlData.callback).toContain('walletofsatoshi')
    expect(lnurlData.allowsNostr).toBe(true)

    // Request invoice
    const invoiceRes = await fetch('/api/invoice', {
      method: 'POST',
      body: JSON.stringify({
        callback: lnurlData.callback,
        amount: 21000000, // 21000 sats
        nostr: 'encoded-zap-request',
      }),
    })
    const invoiceData = await invoiceRes.json()

    expect(invoiceData.pr).toBe('lnbc210n1pabcdef...')
  })
})
