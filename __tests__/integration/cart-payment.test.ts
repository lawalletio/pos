/**
 * Integration: Cart → Payment flow
 * Tests cart operations and zap request generation for the payment flow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Product } from '@/types/product'

vi.mock('nostr-tools', async () => {
  const actual = await vi.importActual<typeof import('nostr-tools')>('nostr-tools')
  return {
    ...actual,
    generateSecretKey: vi.fn(() => new Uint8Array(32).fill(1)),
    finalizeEvent: vi.fn((template: Record<string, unknown>) => ({
      ...template,
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      sig: 'mock-sig',
    })),
  }
})

const mockProduct = (overrides?: Partial<Product>): Product => ({
  id: 'stall1-product1',
  stallId: 'stall1',
  name: 'Empanada',
  description: 'De carne',
  images: [],
  currency: 'ARS',
  price: 1000,
  quantity: -1,
  specs: [],
  shipping: [],
  ...overrides,
})

describe('Cart store', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('starts with empty cart', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    expect(usePOSStore.getState().cart).toHaveLength(0)
    expect(usePOSStore.getState().getTotal()).toBe(0)
  })

  it('adds product to cart', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    usePOSStore.getState().addToCart(mockProduct())

    const { cart } = usePOSStore.getState()
    expect(cart).toHaveLength(1)
    expect(cart[0]!.product.name).toBe('Empanada')
    expect(cart[0]!.quantity).toBe(1)
  })

  it('increments quantity when same product added twice', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    const p = mockProduct()
    usePOSStore.getState().addToCart(p)
    usePOSStore.getState().addToCart(p)

    const { cart } = usePOSStore.getState()
    expect(cart).toHaveLength(1)
    expect(cart[0]!.quantity).toBe(2)
  })

  it('calculates total correctly', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    usePOSStore.getState().addToCart(mockProduct({ price: 1000 }))
    usePOSStore.getState().addToCart(mockProduct({ id: 'stall1-p2', price: 2500 }))

    expect(usePOSStore.getState().getTotal()).toBe(3500)
  })

  it('removes product from cart', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    usePOSStore.getState().addToCart(mockProduct())
    usePOSStore.getState().removeFromCart('stall1-product1')

    expect(usePOSStore.getState().cart).toHaveLength(0)
  })

  it('updates quantity', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    usePOSStore.getState().addToCart(mockProduct())
    usePOSStore.getState().updateQuantity('stall1-product1', 5)

    expect(usePOSStore.getState().cart[0]!.quantity).toBe(5)
  })

  it('removes product when quantity updated to 0', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().clearCart()
    usePOSStore.getState().addToCart(mockProduct())
    usePOSStore.getState().updateQuantity('stall1-product1', 0)

    expect(usePOSStore.getState().cart).toHaveLength(0)
  })

  it('sets destination lightning address', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().setDestination('merchant@walletofsatoshi.com')
    expect(usePOSStore.getState().destination).toBe('merchant@walletofsatoshi.com')
  })

  it('clears cart and orderId on clearCart', async () => {
    const { usePOSStore } = await import('@/stores/pos')
    usePOSStore.getState().addToCart(mockProduct())
    usePOSStore.getState().setOrderId('order-abc')
    usePOSStore.getState().clearCart()

    expect(usePOSStore.getState().cart).toHaveLength(0)
    expect(usePOSStore.getState().orderId).toBeNull()
  })
})

describe('Zap request for payment', () => {
  it('creates a valid zap request for payment', async () => {
    const { createZapRequest } = await import('@/lib/nostr/zap')
    const result = await createZapRequest({
      amount: 21_000_000, // 21000 sats in msats
      recipientPubkey: 'merchant-pubkey-hex',
      relays: ['wss://relay.lacrypta.ar'],
      content: 'POS order #123',
      eventId: 'order-event-id',
    })

    const event = JSON.parse(decodeURIComponent(result))
    expect(event.kind).toBe(9734)

    const pTag = event.tags.find((t: string[]) => t[0] === 'p')
    const amountTag = event.tags.find((t: string[]) => t[0] === 'amount')
    const relaysTag = event.tags.find((t: string[]) => t[0] === 'relays')
    const eTag = event.tags.find((t: string[]) => t[0] === 'e')

    expect(pTag?.[1]).toBe('merchant-pubkey-hex')
    expect(amountTag?.[1]).toBe('21000000')
    expect(relaysTag).toBeTruthy()
    expect(eTag?.[1]).toBe('order-event-id')
  })
})

describe('Currency store conversions', () => {
  it('converts SAT to ARS given rate', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().updateRates({ ARS: 0.5, USD: 0.0001 })

    const ars = useCurrencyStore.getState().convertCurrency(1000, 'SAT', 'ARS')
    expect(ars).toBeCloseTo(500)
  })

  it('converts ARS to SAT', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().updateRates({ ARS: 0.5 })

    const sats = useCurrencyStore.getState().convertCurrency(500, 'ARS', 'SAT')
    expect(sats).toBeCloseTo(1000)
  })

  it('returns 0 when rate is missing', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    useCurrencyStore.getState().updateRates({})

    const result = useCurrencyStore.getState().convertCurrency(100, 'XYZ', 'SAT')
    expect(result).toBe(0)
  })

  it('same currency returns same amount', async () => {
    const { useCurrencyStore } = await import('@/stores/currency')
    expect(useCurrencyStore.getState().convertCurrency(500, 'SAT', 'SAT')).toBe(500)
  })
})
