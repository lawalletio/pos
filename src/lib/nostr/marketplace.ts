import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import type { EventTemplate } from 'nostr-tools'
import type { Stall, StallShipping } from '@/types/stall'
import type { Product, ProductSpec } from '@/types/product'

// ---------- Parsers ----------

export function parseStallEvent(event: NDKEvent): Stall | null {
  try {
    const content = JSON.parse(event.content)
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] ?? content.id ?? event.id

    const shipping: StallShipping[] = (content.shipping ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      cost: Number(s.cost ?? 0),
      regions: Array.isArray(s.regions) ? s.regions.map(String) : [],
    }))

    return {
      id: dTag,
      name: String(content.name ?? ''),
      description: String(content.description ?? ''),
      currency: String(content.currency ?? 'SAT'),
      shipping,
      pubkey: event.pubkey,
      createdAt: event.created_at,
    }
  } catch {
    return null
  }
}

export function parseProductEvent(event: NDKEvent): Product | null {
  try {
    const content = JSON.parse(event.content)
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] ?? content.id ?? event.id

    const specs: ProductSpec[] = (content.specs ?? []).map((s: unknown[]) => ({
      spec: String(s[0] ?? ''),
      value: String(s[1] ?? ''),
    }))

    const categories = event.tags
      .filter((t) => t[0] === 't' && t[1])
      .map((t) => t[1] as string)

    return {
      id: dTag,
      stallId: String(content.stall_id ?? ''),
      name: String(content.name ?? ''),
      description: String(content.description ?? ''),
      images: Array.isArray(content.images) ? content.images.map(String) : [],
      currency: String(content.currency ?? 'SAT'),
      price: Number(content.price ?? 0),
      quantity: content.quantity !== undefined ? Number(content.quantity) : -1,
      specs,
      shipping: Array.isArray(content.shipping) ? content.shipping.map(String) : [],
      categories,
      pubkey: event.pubkey,
      createdAt: event.created_at,
    }
  } catch {
    return null
  }
}

export function extractCategories(event: NDKEvent): string[] {
  return event.tags
    .filter((t) => t[0] === 't' && t[1])
    .map((t) => t[1] as string)
}

// ---------- Helper: sign + publish ----------

export async function signAndPublish(template: EventTemplate, ndk: NDK): Promise<void> {
  if (typeof window === 'undefined' || !window.nostr) {
    throw new Error('No Nostr extension found')
  }
  // window.nostr (NIP-07) returns a full signed event; cast away NDK's narrow type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signFn = window.nostr.signEvent as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed: any = await signFn(template)
  const ndkEvent = new NDKEvent(ndk)
  ndkEvent.kind = signed.kind
  ndkEvent.created_at = signed.created_at
  ndkEvent.content = signed.content
  ndkEvent.tags = signed.tags
  ndkEvent.sig = signed.sig
  ndkEvent.pubkey = signed.pubkey
  ndkEvent.id = signed.id
  await ndkEvent.publish()
}

// ---------- Publishers ----------

export async function publishStall(stall: Stall, ndk: NDK): Promise<void> {
  const content = {
    id: stall.id,
    name: stall.name,
    description: stall.description,
    currency: stall.currency,
    shipping: stall.shipping.length > 0 ? stall.shipping : [
      { id: 'local', name: 'En el lugar', cost: 0, regions: ['event'] },
    ],
  }

  const template: EventTemplate = {
    kind: 30017,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', stall.id]],
    content: JSON.stringify(content),
  }

  await signAndPublish(template, ndk)
}

export async function publishProduct(
  product: Product,
  categories: string[],
  ndk: NDK,
): Promise<void> {
  const content = {
    id: product.id,
    stall_id: product.stallId,
    name: product.name,
    description: product.description,
    images: product.images,
    currency: product.currency,
    price: product.price,
    quantity: product.quantity === -1 ? null : product.quantity,
    specs: product.specs.map((s) => [s.spec, s.value]),
    shipping: product.shipping,
  }

  const tags: string[][] = [['d', product.id]]
  categories.forEach((cat) => tags.push(['t', cat]))

  const template: EventTemplate = {
    kind: 30018,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  }

  await signAndPublish(template, ndk)
}

export async function deleteEvent(eventId: string, ndk: NDK): Promise<void> {
  const template: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', eventId]],
    content: 'deleted',
  }
  await signAndPublish(template, ndk)
}

// ---------- Zap receipt parser ----------

export interface ZapReceipt {
  id: string
  amount: number // sats
  timestamp: number
  payerPubkey: string | null
  bolt11: string | null
  description: string | null
}

export function parseZapReceiptEvent(event: NDKEvent): ZapReceipt | null {
  try {
    const bolt11 = event.tags.find((t) => t[0] === 'bolt11')?.[1] ?? null
    const payerPubkey = event.tags.find((t) => t[0] === 'P')?.[1] ?? null

    let amount = 0
    const descTag = event.tags.find((t) => t[0] === 'description')?.[1]
    if (descTag) {
      try {
        const desc = JSON.parse(descTag) as Record<string, unknown>
        const amountMsat = Number(desc.amount ?? 0)
        amount = Math.floor(amountMsat / 1000)
      } catch {
        // ignore
      }
    }

    return {
      id: event.id ?? '',
      amount,
      timestamp: event.created_at ?? 0,
      payerPubkey,
      bolt11,
      description: descTag ?? null,
    }
  } catch {
    return null
  }
}
