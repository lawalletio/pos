import { describe, it, expect } from 'vitest'

// nip05.ts is a TODO stub. We test expected behavior via API route which
// handles NIP-05 verification.
describe('nip05 module', () => {
  it('module can be imported', async () => {
    const mod = await import('@/lib/nostr/nip05')
    expect(mod).toBeDefined()
  })
})
