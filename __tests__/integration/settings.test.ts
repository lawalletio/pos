/**
 * Integration: Settings persistence
 * Tests that settings can be saved and read back from the store (zustand).
 * The persist middleware serializes to localStorage; happy-dom provides it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Provide a working localStorage stub for zustand persist middleware
const localStorageData: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => localStorageData[key] ?? null,
  setItem: (key: string, value: string) => { localStorageData[key] = value },
  removeItem: (key: string) => { delete localStorageData[key] },
  clear: () => { Object.keys(localStorageData).forEach((k) => delete localStorageData[k]) },
  length: 0,
  key: () => null,
}
vi.stubGlobal('localStorage', localStorageMock)

describe('Settings store persistence', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  it('saves and retrieves lightning address', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const store = useSettingsStore.getState()

    store.setLightningAddress('alice@walletofsatoshi.com')
    expect(useSettingsStore.getState().lightningAddress).toBe('alice@walletofsatoshi.com')
  })

  it('saves and retrieves merchant name', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const store = useSettingsStore.getState()

    store.setMerchantName('La Crypta')
    expect(useSettingsStore.getState().merchantName).toBe('La Crypta')
  })

  it('adds and removes relays', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const store = useSettingsStore.getState()
    const initialCount = store.relays.length

    store.addRelay('wss://new-relay.example.com')
    expect(useSettingsStore.getState().relays).toHaveLength(initialCount + 1)
    expect(useSettingsStore.getState().relays).toContain('wss://new-relay.example.com')

    store.removeRelay('wss://new-relay.example.com')
    expect(useSettingsStore.getState().relays).toHaveLength(initialCount)
  })

  it('does not add duplicate relays', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const store = useSettingsStore.getState()
    const url = 'wss://duplicate.example.com'

    store.addRelay(url)
    store.addRelay(url) // second time should be ignored
    const count = useSettingsStore.getState().relays.filter((r) => r === url).length
    expect(count).toBe(1)
  })

  it('resets relays to defaults', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const { DEFAULT_RELAYS } = await import('@/config/constants')
    const store = useSettingsStore.getState()

    store.setRelays(['wss://custom.example.com'])
    store.resetRelays()
    expect(useSettingsStore.getState().relays).toEqual(DEFAULT_RELAYS)
  })

  it('sets stall id', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setStallId('my-stall-123')
    expect(useSettingsStore.getState().stallId).toBe('my-stall-123')
  })

  it('sets default currency', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setDefaultCurrency('ARS')
    expect(useSettingsStore.getState().defaultCurrency).toBe('ARS')
  })

  it('updates display preferences', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setDisplay({ theme: 'dark', showQRFullscreen: true })
    const { display } = useSettingsStore.getState()
    expect(display.theme).toBe('dark')
    expect(display.showQRFullscreen).toBe(true)
  })

  it('full reset returns to initial state', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const store = useSettingsStore.getState()

    store.setLightningAddress('alice@example.com')
    store.setMerchantName('Test')
    store.reset()

    const after = useSettingsStore.getState()
    expect(after.lightningAddress).toBe('')
    expect(after.merchantName).toBe('')
  })
})
