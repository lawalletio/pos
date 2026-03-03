import { generateSecretKey, finalizeEvent } from 'nostr-tools'

export interface ZapRequestParams {
  amount: number // in millisats
  recipientPubkey: string
  relays: string[]
  content?: string
}

export interface ZapRequestResult {
  /** URL-encoded JSON of the signed zap request event */
  encoded: string
  /** The random hex event ID used in the #e tag — use this to subscribe for the zap receipt */
  zapEventId: string
}

/**
 * Creates a NIP-57 zap request (kind:9734) with a random #e tag for precise receipt matching.
 * Returns the encoded event and the zapEventId to subscribe for.
 */
export async function createZapRequest(params: ZapRequestParams): Promise<ZapRequestResult> {
  const { amount, recipientPubkey, relays, content = '' } = params

  // Generate a random 32-byte hex ID for the #e tag
  // This allows subscribing for the exact zap receipt with #e filter
  const randomBytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(randomBytes)
  const zapEventId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  // Use NIP-07 if available, otherwise use ephemeral key
  const useNip07 =
    typeof window !== 'undefined' &&
    'nostr' in window &&
    typeof (window as { nostr?: unknown }).nostr === 'object'

  const tags: string[][] = [
    ['p', recipientPubkey],
    ['e', zapEventId],
    ['amount', String(amount)],
    ['relays', ...relays],
  ]

  const eventTemplate = {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  }

  let signedEvent: ReturnType<typeof finalizeEvent>

  if (useNip07) {
    try {
      const nip07 = ((window as unknown) as { nostr: { signEvent: (e: typeof eventTemplate) => Promise<ReturnType<typeof finalizeEvent>> } }).nostr
      signedEvent = await nip07.signEvent(eventTemplate)
    } catch {
      signedEvent = signWithEphemeralKey(eventTemplate)
    }
  } else {
    signedEvent = signWithEphemeralKey(eventTemplate)
  }

  return {
    // Return raw JSON string — the API route's searchParams.set handles URL encoding
    encoded: JSON.stringify(signedEvent),
    zapEventId,
  }
}

function signWithEphemeralKey(
  eventTemplate: { kind: number; created_at: number; tags: string[][]; content: string }
): ReturnType<typeof finalizeEvent> {
  const sk = generateSecretKey()
  return finalizeEvent(eventTemplate, sk)
}
