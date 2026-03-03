'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { connectNDK } from '@/lib/nostr/ndk'
import type NDK from '@nostr-dev-kit/ndk'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

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
  /** Recipient's pubkey (the merchant being paid) */
  recipientPubkey: string
  /** The LNURL server's nostrPubkey — zap receipts must be signed by this key */
  lnurlNostrPubkey: string
  /** The bolt11 invoice — used to match the exact payment */
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
  const subRef = useRef<ReturnType<NDK['subscribe']> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (subRef.current) {
      subRef.current.stop()
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
    async (params: StartWaitingParams) => {
      const {
        recipientPubkey,
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

      try {
        const ndk = await connectNDK()

        // NIP-57: Subscribe to kind:9735 (zap receipts) tagged with the recipient's pubkey
        // The zap receipt is published by the LNURL server to the relays from the zap request
        const filter: NDKFilter = {
          kinds: [9735],
          '#p': [recipientPubkey],
          since: Math.floor(Date.now() / 1000) - 10,
        }

        console.log('[NIP-57] Subscribing for zap receipts:', {
          recipientPubkey: recipientPubkey.slice(0, 8) + '...',
          lnurlNostrPubkey: lnurlNostrPubkey.slice(0, 8) + '...',
          amountMsat,
          relays: ndk.explicitRelayUrls,
        })

        const sub = ndk.subscribe(filter, { closeOnEose: false })
        subRef.current = sub

        sub.on('event', (event: NDKEvent) => {
          console.log('[NIP-57] Received kind:9735 event:', event.id)

          // NIP-57 Validation (Appendix F):

          // 1. The zap receipt's pubkey MUST be the LNURL server's nostrPubkey
          if (event.pubkey !== lnurlNostrPubkey) {
            console.log('[NIP-57] Rejected: pubkey mismatch', event.pubkey, '!=', lnurlNostrPubkey)
            return
          }

          // 2. Extract the bolt11 from the zap receipt
          const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')
          const receiptBolt11 = bolt11Tag?.[1]

          // 3. Match the bolt11 to our invoice
          if (receiptBolt11 && bolt11) {
            // Compare bolt11 invoices (case-insensitive since bolt11 is bech32)
            if (receiptBolt11.toLowerCase() !== bolt11.toLowerCase()) {
              console.log('[NIP-57] Rejected: bolt11 mismatch (different invoice)')
              return
            }
          }

          // 4. Extract and validate the zap request from the description tag
          const descriptionTag = event.tags.find((t) => t[0] === 'description')
          let zapRequestAmount: number | undefined
          if (descriptionTag?.[1]) {
            try {
              const zapRequest = JSON.parse(descriptionTag[1])
              const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === 'amount')
              if (amountTag?.[1]) {
                zapRequestAmount = parseInt(amountTag[1], 10)
              }
            } catch {
              console.log('[NIP-57] Warning: could not parse zap request description')
            }
          }

          // 5. Validate amount if present in zap request
          if (zapRequestAmount !== undefined && amountMsat > 0) {
            if (zapRequestAmount !== amountMsat) {
              console.log('[NIP-57] Rejected: amount mismatch', zapRequestAmount, '!=', amountMsat)
              return
            }
          }

          // All validations passed — payment confirmed!
          const preimageTag = event.tags.find((t) => t[0] === 'preimage')

          const zapReceipt: ZapReceipt = {
            id: event.id ?? '',
            pubkey: event.pubkey ?? '',
            amount: zapRequestAmount ?? amountMsat,
            bolt11: receiptBolt11,
            preimage: preimageTag?.[1],
            description: descriptionTag?.[1],
            createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
          }

          console.log('[NIP-57] ✅ Payment confirmed via zap receipt:', zapReceipt.id)

          cleanup()
          setReceipt(zapReceipt)
          setStatus('confirmed')

          // Vibrate if available
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([100, 50, 100])
          }

          playSuccessSound()
        })

        console.log('[NIP-57] Subscription active, waiting for zap receipts...')
      } catch (err) {
        console.error('[NIP-57] Error starting subscription:', err)
        cleanup()
        setStatus('error')
      }
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
