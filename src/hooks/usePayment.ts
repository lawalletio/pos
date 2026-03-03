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

interface UsePaymentReturn {
  status: PaymentStatus
  receipt: ZapReceipt | null
  startWaiting: (recipientPubkey: string, timeoutMs?: number) => void
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
    async (recipientPubkey: string, timeoutMs = 5 * 60 * 1000) => {
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

        const filter: NDKFilter = {
          kinds: [9735],
          '#p': [recipientPubkey],
          since: Math.floor(Date.now() / 1000) - 10,
        }

        const sub = ndk.subscribe(filter, { closeOnEose: false })
        subRef.current = sub

        sub.on('event', (event: NDKEvent) => {
          // Parse zap receipt
          const amountTag = event.tags.find((t) => t[0] === 'amount')
          const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')
          const preimageTag = event.tags.find((t) => t[0] === 'preimage')
          const descriptionTag = event.tags.find((t) => t[0] === 'description')

          const zapReceipt: ZapReceipt = {
            id: event.id ?? '',
            pubkey: event.pubkey ?? '',
            amount: amountTag ? parseInt(amountTag[1] ?? '0', 10) : 0,
            bolt11: bolt11Tag?.[1],
            preimage: preimageTag?.[1],
            description: descriptionTag?.[1],
            createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
          }

          cleanup()
          setReceipt(zapReceipt)
          setStatus('confirmed')

          // Vibrate if available
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([100, 50, 100])
          }

          // Play sound
          playSuccessSound()
        })
      } catch {
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
