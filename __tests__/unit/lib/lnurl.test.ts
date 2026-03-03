import { describe, it, expect } from 'vitest'

// lnurl/resolve.ts and lnurl/invoice.ts are TODO stubs.
// The actual logic lives in /api/lnurl and /api/invoice routes.
describe('lnurl resolve module', () => {
  it('module can be imported', async () => {
    const mod = await import('@/lib/lnurl/resolve')
    expect(mod).toBeDefined()
  })
})

describe('lnurl invoice module', () => {
  it('module can be imported', async () => {
    const mod = await import('@/lib/lnurl/invoice')
    expect(mod).toBeDefined()
  })
})
