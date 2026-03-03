'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { subscribeToRelays, type NostrSubscription } from '@/lib/nostr/subscribe'
import { DEFAULT_RELAYS } from '@/config/constants'

export type PaymentStatus = 'idle' | 'waiting' | 'confirmed' | 'expired' | 'error'

export interface ZapReceipt {
  id: string
  pubkey: string
  amount: number // in millisats
  bolt11?: string
  preimage?: string
  description?: string
  createdAt: number
}

export interface StartWaitingParams {
  /** The random event ID from the zap request #e tag — used to filter the exact zap receipt */
  zapEventId: string
  /** The LNURL server's nostrPubkey — zap receipts must be signed by this key */
  lnurlNostrPubkey: string
  /** The bolt11 invoice — used for extra validation */
  bolt11: string
  /** Amount in millisats — used for validation */
  amountMsat: number
  /** Timeout in ms (default 5 min) */
  timeoutMs?: number
}

interface UsePaymentReturn {
  status: PaymentStatus
  receipt: ZapReceipt | null
  startWaiting: (params: StartWaitingParams) => void
  reset: () => void
  forceConfirm: (receipt: ZapReceipt) => void
}

export function usePayment(orderId: string | null): UsePaymentReturn {
  const [status, setStatus] = useState<PaymentStatus>('idle')
  const [receipt, setReceipt] = useState<ZapReceipt | null>(null)
  const subRef = useRef<NostrSubscription | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (subRef.current) {
      subRef.current.close()
      subRef.current = null
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    cleanup()
    setStatus('idle')
    setReceipt(null)
  }, [cleanup])

  const startWaiting = useCallback(
    (params: StartWaitingParams) => {
      const {
        zapEventId,
        lnurlNostrPubkey,
        bolt11,
        amountMsat,
        timeoutMs = 5 * 60 * 1000,
      } = params

      if (!orderId) return

      cleanup()
      setStatus('waiting')
      setReceipt(null)

      // Set expiry timer
      timerRef.current = setTimeout(() => {
        cleanup()
        setStatus('expired')
      }, timeoutMs)

      console.log('[NIP-57] Starting zap receipt detection:', {
        zapEventId: zapEventId.slice(0, 12) + '...',
        lnurlNostrPubkey: lnurlNostrPubkey.slice(0, 12) + '...',
        amountMsat,
        bolt11: bolt11.slice(0, 30) + '...',
        relays: DEFAULT_RELAYS,
      })

      // Subscribe for kind:9735 with #e matching our random zap event ID
      // This is the most precise filter — only matches our exact payment
      const filter = {
        kinds: [9735],
        '#e': [zapEventId],
        since: Math.floor(Date.now() / 1000) - 10,
      }

      const sub = subscribeToRelays(DEFAULT_RELAYS, filter, (event) => {
        console.log('[NIP-57] Received kind:9735 event:', {
          id: (event.id as string)?.slice(0, 12),
          pubkey: (event.pubkey as string)?.slice(0, 12),
        })

        // === NIP-57 Validation (Appendix F) ===

        // 1. Zap receipt pubkey MUST be the LNURL server's nostrPubkey
        if (event.pubkey !== lnurlNostrPubkey) {
          console.log('[NIP-57] ❌ Rejected: pubkey mismatch. Expected:', lnurlNostrPubkey.slice(0, 12), 'Got:', (event.pubkey as string)?.slice(0, 12))
          return
        }

        const tags = event.tags as string[][]

        // 2. Extract bolt11 from receipt and match to our invoice
        const bolt11Tag = tags.find((t) => t[0] === 'bolt11')
        const receiptBolt11 = bolt11Tag?.[1]

        if (receiptBolt11 && bolt11) {
          if (receiptBolt11.toLowerCase() !== bolt11.toLowerCase()) {
            console.log('[NIP-57] ❌ Rejected: bolt11 mismatch (different invoice)')
            return
          }
        }

        // 3. Parse zap request from description tag and validate amount
        const descriptionTag = tags.find((t) => t[0] === 'description')
        let zapRequestAmount: number | undefined
        if (descriptionTag?.[1]) {
          try {
            const zapRequest = JSON.parse(descriptionTag[1])
            const amountTag = (zapRequest.tags as string[][])?.find((t) => t[0] === 'amount')
            if (amountTag?.[1]) {
              zapRequestAmount = parseInt(amountTag[1], 10)
            }
          } catch {
            console.log('[NIP-57] ⚠️ Could not parse zap request from description')
          }
        }

        // 4. Validate amount matches
        if (zapRequestAmount !== undefined && amountMsat > 0) {
          if (zapRequestAmount !== amountMsat) {
            console.log('[NIP-57] ❌ Rejected: amount mismatch.', zapRequestAmount, '!=', amountMsat)
            return
          }
        }

        // === All validations passed ===
        const preimageTag = tags.find((t) => t[0] === 'preimage')

        const zapReceipt: ZapReceipt = {
          id: (event.id as string) ?? '',
          pubkey: (event.pubkey as string) ?? '',
          amount: zapRequestAmount ?? amountMsat,
          bolt11: receiptBolt11,
          preimage: preimageTag?.[1],
          description: descriptionTag?.[1],
          createdAt: (event.created_at as number) ?? Math.floor(Date.now() / 1000),
        }

        console.log('[NIP-57] ✅ Payment confirmed via zap receipt:', zapReceipt.id.slice(0, 12))

        cleanup()
        setReceipt(zapReceipt)
        setStatus('confirmed')

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([100, 50, 100])
        }
        playSuccessSound()
      })

      subRef.current = sub
    },
    [orderId, cleanup]
  )

  const forceConfirm = useCallback((zapReceipt: ZapReceipt) => {
    cleanup()
    setReceipt(zapReceipt)
    setStatus('confirmed')
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([100, 50, 100])
    }
    playSuccessSound()
  }, [cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  return { status, receipt, startWaiting, reset, forceConfirm }
}

function playSuccessSound() {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime) // C5
    oscillator.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1) // E5
    oscillator.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2) // G5
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.5)
  } catch {
    // Audio not available — ignore
  }
}
