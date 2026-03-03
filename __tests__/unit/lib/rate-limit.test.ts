import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('allows first request', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    expect(checkRateLimit('1.2.3.4')).toBe(true)
  })

  it('allows requests up to limit', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 5; i++) checkRateLimit('10.0.0.1', 5)
    // The 6th should be blocked
    expect(checkRateLimit('10.0.0.1', 5)).toBe(false)
  })

  it('different IPs have independent counters', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 5; i++) checkRateLimit('192.168.1.1', 5)
    // Different IP should still be allowed
    expect(checkRateLimit('192.168.1.2', 5)).toBe(true)
  })
})
