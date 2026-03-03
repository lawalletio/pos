/**
 * Raw Nostr relay subscription for zap receipts (NIP-57).
 * Uses WebSocket directly for full control over REQ/CLOSE messages.
 */

export interface NostrFilter {
  kinds?: number[]
  '#p'?: string[]
  '#e'?: string[]
  since?: number
  authors?: string[]
}

export interface NostrSubscription {
  /** Stop the subscription and close all connections */
  close: () => void
}

type EventCallback = (event: Record<string, unknown>) => void

/**
 * Subscribe to Nostr events across multiple relays.
 * Sends a REQ message with the given filter and calls onEvent for each matching event.
 * Returns a handle to close the subscription.
 */
export function subscribeToRelays(
  relays: string[],
  filter: NostrFilter,
  onEvent: EventCallback,
): NostrSubscription {
  const subId = 'pos-zap-' + Math.random().toString(36).slice(2, 10)
  const sockets: WebSocket[] = []
  let closed = false

  // Build the REQ message per NIP-01
  const reqMessage = JSON.stringify(['REQ', subId, filter])
  const closeMessage = JSON.stringify(['CLOSE', subId])

  console.log(`[NIP-57 WS] Opening subscription ${subId} on ${relays.length} relays`)
  console.log(`[NIP-57 WS] Filter:`, JSON.stringify(filter))

  for (const relay of relays) {
    try {
      const ws = new WebSocket(relay)

      ws.onopen = () => {
        if (closed) {
          ws.close()
          return
        }
        console.log(`[NIP-57 WS] Connected to ${relay}, sending REQ`)
        ws.send(reqMessage)
      }

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string)
          // NIP-01: ["EVENT", subscription_id, event_object]
          if (Array.isArray(data) && data[0] === 'EVENT' && data[1] === subId && data[2]) {
            console.log(`[NIP-57 WS] Received EVENT from ${relay}:`, data[2].id?.slice(0, 8))
            onEvent(data[2])
          }
          // EOSE = End of Stored Events — subscription stays open for new events
          if (Array.isArray(data) && data[0] === 'EOSE' && data[1] === subId) {
            console.log(`[NIP-57 WS] EOSE from ${relay} — listening for new events...`)
          }
        } catch {
          // Ignore parse errors
        }
      }

      ws.onerror = (err) => {
        console.warn(`[NIP-57 WS] Error on ${relay}:`, err)
      }

      ws.onclose = () => {
        console.log(`[NIP-57 WS] Disconnected from ${relay}`)
      }

      sockets.push(ws)
    } catch (err) {
      console.warn(`[NIP-57 WS] Failed to connect to ${relay}:`, err)
    }
  }

  return {
    close: () => {
      if (closed) return
      closed = true
      console.log(`[NIP-57 WS] Closing subscription ${subId}`)
      for (const ws of sockets) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(closeMessage)
          }
          ws.close()
        } catch {
          // Ignore close errors
        }
      }
      sockets.length = 0
    },
  }
}
