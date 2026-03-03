'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle, Copy, Printer, RefreshCw, RotateCcw, Wifi, WifiOff, X } from 'lucide-react'
import Navbar from '@/components/shared/Navbar'
import { usePOSStore } from '@/stores/pos'
import { useNostrStore } from '@/stores/nostr'
import { useCurrencyStore } from '@/stores/currency'
import { usePayment } from '@/hooks/usePayment'
import { useNFC } from '@/hooks/useNFC'
import { usePrint } from '@/hooks/usePrint'
import { createZapRequest } from '@/lib/nostr/zap'
import { showError, showSuccess, showWarning } from '@/lib/toast'
import { DEFAULT_RELAYS } from '@/config/constants'
import { supportsNip57, ProxyNotAvailableError, createProxyWallet } from '@/lib/proxy/lncurl'

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatSats(sats: number): string {
  return `${Math.round(sats).toLocaleString('es-AR')} SAT`
}

function formatFiat(amount: number, currency: string): string {
  if (currency === 'SAT') return formatSats(amount)
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency === 'ARS' ? 'ARS' : currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function useCountdown(seconds: number, active: boolean) {
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    if (!active) return
    setRemaining(seconds)
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [seconds, active])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  return { remaining, display: `${mm}:${ss}` }
}

// ─── main ─────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ orderId: string }>
}

type PageState = 'loading' | 'ready' | 'expired' | 'error'

export default function OrderPage({ params }: Props) {
  const { orderId } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Stores
  const { cart, destination, getTotal, clearCart } = usePOSStore()
  const merchantPubkey = useNostrStore((s) => s.merchantPubkey)
  const { convertCurrency, defaultCurrency } = useCurrencyStore()

  // Invoice state
  const [pageState, setPageState] = useState<PageState>('loading')
  const [invoice, setInvoice] = useState<string | null>(null)
  const [amountSats, setAmountSats] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [lnurlData, setLnurlData] = useState<{
    callback: string
    nostrPubkey?: string
    allowsNostr?: boolean
  } | null>(null)
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null)
  const [forceChecking, setForceChecking] = useState(false)
  const verifyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // LUD-21 verify polling
  const stopVerifyPolling = useCallback(() => {
    if (verifyIntervalRef.current) {
      clearInterval(verifyIntervalRef.current)
      verifyIntervalRef.current = null
    }
  }, [])

  const startVerifyPolling = useCallback((url: string, sats: number) => {
    stopVerifyPolling()
    verifyIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verify: url }),
        })
        const data = await res.json()
        if (data.settled) {
          stopVerifyPolling()
          forceConfirm({
            id: 'verify-poll-' + Date.now(),
            pubkey: '',
            amount: sats * 1000,
            preimage: data.preimage || undefined,
            createdAt: Math.floor(Date.now() / 1000),
          })
          showSuccess('¡Pago verificado!')
        }
      } catch {
        // Silent fail — will retry next interval
      }
    }, 3000) // Poll every 3 seconds
  }, [stopVerifyPolling, forceConfirm])

  // Hooks
  const { status: payStatus, receipt, startWaiting, reset: resetPayment, forceConfirm } = usePayment(orderId)
  const { isAvailable: nfcAvailable, isReading: nfcReading, startReading, stopReading } = useNFC()
  const { isPrintAvailable, print } = usePrint()

  // Countdown (5 min)
  const TIMEOUT_SECS = 5 * 60
  const { remaining: timeRemaining, display: timeDisplay } = useCountdown(
    TIMEOUT_SECS,
    pageState === 'ready'
  )

  // Amount from URL params (free amount mode) or from cart
  const urlAmount = searchParams.get('amount') // in sats
  const urlCurrency = searchParams.get('currency') ?? 'SAT'

  // Compute total in sats
  const computeAmountSats = useCallback((): number => {
    if (urlAmount) {
      const amount = parseFloat(urlAmount)
      return urlCurrency === 'SAT' ? Math.round(amount) : Math.round(convertCurrency(amount, urlCurrency, 'SAT'))
    }
    const cartTotal = getTotal() // in product currency (SAT assumed for now)
    return Math.max(1, Math.round(cartTotal))
  }, [urlAmount, urlCurrency, getTotal, convertCurrency])

  // Fetch LNURL data
  const fetchLnurl = useCallback(async () => {
    if (!destination) return null
    const res = await fetch(`/api/lnurl?address=${encodeURIComponent(destination)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'LNURL resolution failed')
    return data as { callback: string; nostrPubkey?: string; allowsNostr?: boolean }
  }, [destination])

  // Generate invoice
  const generateInvoice = useCallback(async () => {
    setPageState('loading')
    setInvoice(null)
    resetPayment()

    try {
      let lnurl = lnurlData
      if (!lnurl) {
        lnurl = await fetchLnurl()
        if (!lnurl) throw new Error('No se encontró la Lightning Address configurada')
        setLnurlData(lnurl)
      }

      const sats = computeAmountSats()
      setAmountSats(sats)
      const milliSats = sats * 1000

      // Check NIP-57 support; attempt proxy if missing
      const nip57Supported = supportsNip57(lnurl)

      if (!nip57Supported) {
        // Destination doesn't support zaps — try proxy wallet, fall back gracefully
        try {
          // This will throw ProxyNotAvailableError until lncurl.lol is integrated
          const proxy = await createProxyWallet()

          const proxyInvoice = await proxy.invoiceCallback(milliSats)
          setInvoice(proxyInvoice)
          setPageState('ready')

          proxy.onPayment(async () => {
            const forwarded = await proxy.forward(destination!, milliSats)
            if (forwarded) {
              showSuccess('Pago reenviado al destino')
            } else {
              showError('Error al reenviar el pago')
            }
            proxy.dispose()
          })

          // No NWC pubkey for payment monitoring — rely on proxy callback
          return
        } catch (e) {
          if (e instanceof ProxyNotAvailableError) {
            // Proxy not yet available — fall through to direct LNURL (no zap)
            console.warn('[OrderPage] Proxy unavailable, using direct LNURL (no NIP-57)')
          } else {
            throw e
          }
        }
      }

      // Build zap request if supported
      let zapRequestEncoded: string | undefined
      if (nip57Supported && lnurl.nostrPubkey && merchantPubkey) {
        try {
          zapRequestEncoded = await createZapRequest({
            amount: milliSats,
            recipientPubkey: lnurl.nostrPubkey,
            relays: DEFAULT_RELAYS,
            content: `POS payment — order ${orderId}`,
          })
        } catch {
          // non-fatal — proceed without zap request
        }
      }

      // Request invoice
      const invoiceRes = await fetch('/api/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback: lnurl.callback,
          amount: milliSats,
          nostr: zapRequestEncoded,
        }),
      })

      const invoiceData = await invoiceRes.json()
      if (!invoiceRes.ok) throw new Error(invoiceData.error ?? 'Failed to generate invoice')

      const bolt11 = invoiceData.pr as string
      setInvoice(bolt11)
      const invoiceVerifyUrl = invoiceData.verify as string | undefined
      if (invoiceVerifyUrl) setVerifyUrl(invoiceVerifyUrl)
      setPageState('ready')

      // Start LUD-21 verify polling (every 3 seconds) if verify URL available
      if (invoiceVerifyUrl) {
        startVerifyPolling(invoiceVerifyUrl, sats)
      }

      // Start NIP-57 payment subscription
      if (lnurl.nostrPubkey) {
        await startWaiting(lnurl.nostrPubkey, TIMEOUT_SECS * 1000)
      }

      // Start NFC if available
      if (nfcAvailable) {
        startReading().catch(() => {
          /* non-fatal */
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error generando el invoice'
      setErrorMsg(msg)
      setPageState('error')
      showError(msg)
    }
  }, [
    lnurlData,
    fetchLnurl,
    computeAmountSats,
    merchantPubkey,
    orderId,
    startWaiting,
    nfcAvailable,
    startReading,
    resetPayment,
  ])

  // On mount
  useEffect(() => {
    generateInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle timeout
  useEffect(() => {
    if (pageState === 'ready' && timeRemaining === 0) {
      setPageState('expired')
      stopReading()
      stopVerifyPolling()
      showWarning('El invoice expiró')
    }
  }, [timeRemaining, pageState, stopReading, stopVerifyPolling])

  // Handle payment confirmed
  useEffect(() => {
    if (payStatus === 'confirmed') {
      stopReading()
      stopVerifyPolling()
    }
  }, [payStatus, stopReading, stopVerifyPolling])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopVerifyPolling()
  }, [stopVerifyPolling])

  // Force check payment via LUD-21 verify
  const forceCheck = useCallback(async () => {
    if (forceChecking) return
    setForceChecking(true)
    try {
      if (verifyUrl) {
        // LUD-21: use verify URL from invoice response
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verify: verifyUrl }),
        })
        const data = await res.json()
        if (data.settled) {
          stopReading()
          forceConfirm({
            id: 'verify-' + Date.now(),
            pubkey: '',
            amount: amountSats * 1000,
            preimage: data.preimage || undefined,
            createdAt: Math.floor(Date.now() / 1000),
          })
          showSuccess('¡Pago verificado!')
          return
        }
      }
      showWarning('Pago aún no detectado')
    } catch {
      showError('Error al verificar el pago')
    } finally {
      setForceChecking(false)
    }
  }, [forceChecking, verifyUrl, amountSats, stopReading, forceConfirm])

  // Copy invoice
  const copyInvoice = useCallback(() => {
    if (!invoice) return
    navigator.clipboard.writeText(invoice).then(() => showSuccess('Invoice copiado')).catch(() => {})
  }, [invoice])

  // Handle print
  const handlePrint = useCallback(() => {
    if (!isPrintAvailable || !destination) return
    print({
      title: 'Recibo de Pago',
      items: cart.map((item) => ({
        name: item.product.name,
        qty: item.quantity,
        price: item.product.price,
        currency: item.product.currency,
      })),
      total: { value: amountSats, currency: 'SAT' },
      orderId,
      timestamp: Date.now(),
      destination,
    })
  }, [isPrintAvailable, print, cart, amountSats, orderId, destination])

  // New sale
  const handleNewSale = useCallback(() => {
    clearCart()
    resetPayment()
    router.push('/pos')
  }, [clearCart, resetPayment, router])

  // Display amount
  const displayCurrency = defaultCurrency === 'SAT' ? 'ARS' : defaultCurrency
  const displayAmount = convertCurrency(amountSats, 'SAT', displayCurrency)

  // ─── render: success ────────────────────────────────────────────────────────
  if (payStatus === 'confirmed') {
    return (
      <div className="min-h-screen bg-[#060a12] text-white flex flex-col">
        <Navbar title="Pago" backHref="/pos" />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 space-y-6">
          {/* Checkmark animation */}
          <div className="relative w-28 h-28 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
            <div className="relative w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center">
              <CheckCircle className="text-green-400 w-14 h-14" strokeWidth={1.5} />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-3xl font-bold text-green-400">¡Pago confirmado!</p>
            <p className="text-zinc-400 text-sm">
              {receipt ? `${(receipt.amount / 1000).toLocaleString()} SAT recibidos` : formatSats(amountSats)}
            </p>
          </div>

          <div className="flex flex-col w-full max-w-xs gap-3">
            <button
              onClick={handleNewSale}
              className="w-full rounded-xl bg-[#f7931a] px-4 py-3.5 font-bold text-black text-lg active:bg-[#e8851a] transition"
            >
              Nueva Venta
            </button>
            {isPrintAvailable && (
              <button
                onClick={handlePrint}
                className="w-full rounded-xl border border-zinc-700 bg-[#0f1729] px-4 py-3 font-medium text-white flex items-center justify-center gap-2 active:bg-zinc-800 transition"
              >
                <Printer size={18} />
                Imprimir Recibo
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── render: expired ────────────────────────────────────────────────────────
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen bg-[#060a12] text-white flex flex-col">
        <Navbar title="Pago" backHref="/pos" />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 space-y-6">
          <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center">
            <X className="text-zinc-400 w-10 h-10" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-2xl font-bold text-white">Invoice expirado</p>
            <p className="text-zinc-500 text-sm">El tiempo de pago venció</p>
          </div>
          <div className="flex flex-col w-full max-w-xs gap-3">
            <button
              onClick={() => { void generateInvoice() }}
              className="w-full rounded-xl bg-[#f7931a] px-4 py-3.5 font-bold text-black text-lg active:bg-[#e8851a] transition flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              Regenerar Invoice
            </button>
            <button
              onClick={handleNewSale}
              className="w-full rounded-xl border border-zinc-700 bg-[#0f1729] px-4 py-3 text-zinc-400 transition active:bg-zinc-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── render: error ──────────────────────────────────────────────────────────
  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-[#060a12] text-white flex flex-col">
        <Navbar title="Pago" backHref="/pos" />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 space-y-6">
          <div className="w-20 h-20 rounded-full bg-red-900/30 border border-red-800 flex items-center justify-center">
            <X className="text-red-400 w-10 h-10" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-2xl font-bold text-white">Error</p>
            <p className="text-zinc-400 text-sm max-w-xs">{errorMsg}</p>
          </div>
          <div className="flex flex-col w-full max-w-xs gap-3">
            <button
              onClick={() => { void generateInvoice() }}
              className="w-full rounded-xl bg-[#f7931a] px-4 py-3.5 font-bold text-black text-lg active:bg-[#e8851a] transition flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              Reintentar
            </button>
            <button
              onClick={() => router.push('/pos')}
              className="w-full rounded-xl border border-zinc-700 bg-[#0f1729] px-4 py-3 text-zinc-400 transition active:bg-zinc-800"
            >
              Volver al POS
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── render: loading ────────────────────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-[#060a12] text-white flex flex-col">
        <Navbar title="Pago" backHref="/pos" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-2 border-[#f7931a] border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Generando invoice...</p>
        </div>
      </div>
    )
  }

  // ─── render: ready (QR) ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#060a12] text-white flex flex-col">
      <Navbar title="Pago" backHref="/pos" />

      <div className="flex-1 flex flex-col items-center px-6 py-6 gap-5">
        {/* QR code */}
        <button
          onClick={copyInvoice}
          className="rounded-2xl bg-white p-4 active:opacity-80 transition shadow-lg shadow-black/40"
          title="Toca para copiar"
        >
          {invoice && (
            <QRCodeSVG
              value={invoice.toUpperCase()}
              size={224}
              level="M"
              marginSize={0}
            />
          )}
        </button>

        {/* Copy hint */}
        <button
          onClick={copyInvoice}
          className="flex items-center gap-1.5 text-xs text-zinc-500 active:text-zinc-300 transition"
        >
          <Copy size={12} />
          <span>Toca el QR o aquí para copiar el invoice</span>
        </button>

        {/* Amount */}
        <div className="text-center space-y-0.5">
          <p className="text-4xl font-bold text-[#f7931a]">{formatSats(amountSats)}</p>
          {displayCurrency !== 'SAT' && displayAmount > 0 && (
            <p className="text-sm text-zinc-400">
              ≈ {formatFiat(displayAmount, displayCurrency)}
            </p>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 text-zinc-400">
          <div className="w-2 h-2 rounded-full bg-[#f7931a] animate-pulse" />
          <p className="text-sm">Esperando pago...</p>
        </div>

        {/* Force Check */}
        <button
          onClick={forceCheck}
          disabled={forceChecking}
          className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#0f1729] px-5 py-2.5 text-sm text-zinc-400 hover:border-[#f7931a]/50 hover:text-[#f7931a] active:bg-[#0f1729]/80 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={forceChecking ? 'animate-spin' : ''} />
          {forceChecking ? 'Verificando...' : 'Verificar pago'}
        </button>

        {/* NFC indicator */}
        {nfcAvailable && (
          <div className="w-full max-w-xs rounded-xl border border-zinc-800 bg-[#0f1729] px-4 py-3 flex items-center justify-center gap-2">
            {nfcReading ? (
              <>
                <Wifi size={16} className="text-[#f7931a] animate-pulse" />
                <p className="text-sm text-zinc-300">NFC activo — acercá la tarjeta</p>
              </>
            ) : (
              <>
                <WifiOff size={16} className="text-zinc-600" />
                <p className="text-sm text-zinc-500">NFC no activo</p>
              </>
            )}
          </div>
        )}

        {/* Timer + order info */}
        <div className="w-full max-w-xs text-center space-y-1">
          <p className={`text-sm font-mono font-medium ${timeRemaining < 60 ? 'text-red-400' : 'text-zinc-400'}`}>
            Expira en {timeDisplay}
          </p>
          <p className="text-xs text-zinc-700 truncate">Orden: {orderId}</p>
        </div>

        {/* Cancel */}
        <button
          onClick={() => router.push('/pos')}
          className="text-sm text-zinc-600 hover:text-zinc-400 transition mt-auto"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
