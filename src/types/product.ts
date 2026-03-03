// NIP-15 Product — Nostr kind:30018
export interface ProductSpec {
  spec: string
  value: string
}

export interface Product {
  id: string          // event d-tag / product identifier
  stallId: string
  name: string
  description: string
  images: string[]
  currency: string    // ISO 4217 or "SAT"
  price: number
  quantity: number    // -1 = unlimited
  specs: ProductSpec[]
  shipping: string[]  // shipping option ids
  categories: string[] // from NIP-15 event `t` tags
  pubkey?: string
  createdAt?: number
}
