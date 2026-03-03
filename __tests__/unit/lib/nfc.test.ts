import { describe, it, expect } from 'vitest'

// web.ts is a TODO stub — NFC is a hardware feature tested at integration level
describe('nfc/web module', () => {
  it('module can be imported', async () => {
    const mod = await import('@/lib/nfc/web')
    expect(mod).toBeDefined()
  })
})
