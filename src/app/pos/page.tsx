'use client'

import { useState, useCallback, useId, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useNostrStore } from '@/stores/nostr'
import { useSettingsStore } from '@/stores/settings'
import { usePOSStore } from '@/stores/pos'
import { useStall } from '@/hooks/useStall'
import { useProducts } from '@/hooks/useProducts'
import { useCurrency } from '@/hooks/useCurrency'
import Numpad from '@/components/pos/Numpad'
import MenuView from '@/components/pos/MenuView'
import CartSheet from '@/components/pos/Cart'

export default function POSPage() {
  const router = useRouter()
  const uniqueId = useId()

  const merchantPubkey = useNostrStore((s) => s.merchantPubkey)
  const activeCurrencies = useSettingsStore((s) => s.activeCurrencies)
  const defaultCurrency = useSettingsStore((s) => s.defaultCurrency)
  const lightningAddress = useSettingsStore((s) => s.lightningAddress)

  const { cart, addToCart, updateQuantity, clearCart, getTotal, getItemCount } = usePOSStore()
  const { convert } = useCurrency()

  const [mode, setMode] = useState<'numpad' | 'menu'>('numpad')
  const [selectedCurrency, setSelectedCurrency] = useState(defaultCurrency || 'SAT')
  const [cartOpen, setCartOpen] = useState(false)
  const [cents, setCents] = useState(0)

  const { stalls, isLoading: stallsLoading } = useStall(merchantPubkey)
  const { products, categories, isLoading: productsLoading } = useProducts(
    merchantPubkey,
    stalls[0]?.id
  )

  const isLoading = stallsLoading || productsLoading
  const hasProducts = products.length > 0

  // Numpad handlers
  const handleNumpadInput = useCallback((digit: string) => {
    setCents((prev) => {
      if (digit === '00') {
        const val = prev * 100
        if (val > 9999999999) return prev
        return val
      }
      const str = prev.toString() + digit
      const val = parseInt(str, 10)
      if (val > 9999999999) return prev
      return val
    })
  }, [])

  const handleBackspace = useCallback(() => {
    setCents((prev) => {
      const str = prev.toString().slice(0, -1)
      return str ? parseInt(str, 10) : 0
    })
  }, [])

  const handleReset = useCallback(() => {
    setCents(0)
  }, [])

  const getItemQty = (productId: string) => {
    return cart.find((c) => c.product.id === productId)?.quantity ?? 0
  }

  // Checkout
  const handleCheckout = useCallback(() => {
    const orderId = `order-${Date.now()}-${uniqueId.replace(/:/g, '')}`
    usePOSStore.getState().setOrderId(orderId)
    router.push(`/pos/${orderId}`)
  }, [router, uniqueId])

  const handleFreeCheckout = useCallback(() => {
    if (cents === 0) return
    const orderId = `free-${Date.now()}`
    usePOSStore.getState().setOrderId(orderId)
    const amount = selectedCurrency === 'SAT' ? cents : cents / 100
    router.push(`/pos/${orderId}?amount=${amount}&currency=${selectedCurrency}`)
  }, [cents, selectedCurrency, router])

  const itemCount = useMemo(() => getItemCount(), [cart])
  const totalSats = useMemo(() => getTotal(), [cart])
  const currencyChips = useMemo(
    () => activeCurrencies.length > 0 ? activeCurrencies : ['SAT', 'ARS', 'USD'],
    [activeCurrencies]
  )
  const showMenuTab = hasProducts && !isLoading

  // Format display amount for numpad
  const getNumpadDisplay = () => {
    if (selectedCurrency === 'SAT') {
      return cents.toLocaleString('es-AR')
    }
    return (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const getCurrencySymbol = () => {
    if (selectedCurrency === 'SAT') return ''
    if (selectedCurrency === 'ARS') return '$'
    if (selectedCurrency === 'USD') return 'US$'
    return '$'
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const secondaryDisplay = useMemo(() => {
    if (cents === 0) return ''
    const amount = selectedCurrency === 'SAT' ? cents : cents / 100
    if (selectedCurrency === 'SAT') {
      const ars = convert(amount, 'SAT', 'ARS')
      if (ars > 0) return `≈ $${Math.round(ars).toLocaleString('es-AR')} ARS`
      return ''
    }
    const sats = convert(amount, selectedCurrency, 'SAT')
    if (sats > 0) return `≈ ${Math.round(sats).toLocaleString('es-AR')} sats`
    return ''
  }, [cents, selectedCurrency, convert])

  // Charge button label for numpad
  const getChargeLabel = () => {
    if (cents === 0) return 'Cobrar'
    if (selectedCurrency === 'SAT') return `Cobrar ${cents.toLocaleString('es-AR')} SAT`
    return `Cobrar $${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
  }

  return (
    <div className="h-dvh flex flex-col bg-[#09090b] text-white overflow-hidden" style={{ fontFamily: 'var(--font-geist), sans-serif' }}>

      {/* ── Navbar ── */}
      <nav className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
          <span className="text-sm">
            {mode === 'numpad' ? 'Modo CAJA' : 'Menú'}
          </span>
        </button>

        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[#f7931a] text-xs">⚡</span>
          <span className="text-zinc-600 text-xs truncate max-w-[140px]" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
            {lightningAddress || '—'}
          </span>
        </div>

        <button
          onClick={() => router.push('/settings')}
          className="text-zinc-600 hover:text-zinc-400 transition p-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </nav>

      {/* ── Mode Toggle (only if products exist) ── */}
      {showMenuTab && (
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex bg-[#18181b] rounded-lg p-0.5">
            <button
              onClick={() => setMode('numpad')}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                mode === 'numpad' ? 'bg-[#27272a] text-white' : 'text-zinc-500'
              }`}
            >
              CAJA
            </button>
            <button
              onClick={() => setMode('menu')}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all relative ${
                mode === 'menu' ? 'bg-[#27272a] text-white' : 'text-zinc-500'
              }`}
            >
              MENÚ
              {itemCount > 0 && mode !== 'menu' && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#f7931a] text-black text-[9px] font-bold flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* ════════════════════════════════════════════
            NUMPAD MODE
            Layout: Amount → Currency pills → Charge → Keyboard (bottom)
            ════════════════════════════════════════════ */}
        <div
          className={`flex-1 flex flex-col transition-opacity duration-200 ${
            mode === 'numpad' ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
          }`}
        >
          {/* Amount display — top, centered, expands to fill */}
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div
              className="text-5xl font-bold tracking-tight text-white leading-none"
              style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
            >
              {getCurrencySymbol() && (
                <span className="text-zinc-500 text-3xl">{getCurrencySymbol()}</span>
              )}
              {getCurrencySymbol() ? ' ' : ''}{getNumpadDisplay()}
            </div>
            <div
              className="text-sm text-zinc-500 mt-2 h-5"
              style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
            >
              {secondaryDisplay}
            </div>
          </div>

          {/* Currency pills — between amount and charge */}
          <div className="flex justify-center gap-1.5 px-4 pb-3 flex-shrink-0">
            {currencyChips.map((c) => (
              <button
                key={c}
                onClick={() => {
                  if (c === selectedCurrency) return
                  if (cents > 0) {
                    // Convert current amount to new currency
                    const currentAmount = selectedCurrency === 'SAT' ? cents : cents / 100
                    const converted = convert(currentAmount, selectedCurrency, c)
                    if (converted > 0) {
                      if (c === 'SAT') {
                        setCents(Math.round(converted))
                      } else {
                        setCents(Math.round(converted * 100))
                      }
                    } else {
                      setCents(0)
                    }
                  }
                  setSelectedCurrency(c)
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  c === selectedCurrency
                    ? 'bg-[#f7931a]/15 text-[#f7931a] border border-[#f7931a]/30'
                    : 'bg-[#18181b] text-zinc-500 border border-transparent'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Charge button — ABOVE keyboard */}
          <div className="px-4 pb-3 flex-shrink-0">
            <button
              onClick={handleFreeCheckout}
              disabled={cents === 0}
              className={`w-full rounded-xl py-4 font-bold text-lg transition-all ${
                cents > 0
                  ? 'bg-[#f7931a] text-black active:bg-[#e8851a] animate-pulse-subtle'
                  : 'bg-[#18181b] text-zinc-600 cursor-not-allowed'
              }`}
            >
              {getChargeLabel()} ⚡
            </button>
          </div>

          {/* Keyboard — pinned to bottom */}
          <div className="flex-shrink-0">
            <Numpad
              currency={selectedCurrency}
              onInput={handleNumpadInput}
              onBackspace={handleBackspace}
              onReset={handleReset}
            />
          </div>
        </div>

        {/* ════════════════════════════════════════════
            MENU MODE
            Layout: Categories → Products (scrollable) → Footer cart bar
            ════════════════════════════════════════════ */}
        {showMenuTab && (
          <div
            className={`flex-1 flex flex-col min-h-0 transition-opacity duration-200 ${
              mode === 'menu' ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
            }`}
          >
            <MenuView
              products={products}
              categories={categories}
              selectedCurrency={selectedCurrency}
              convert={convert}
              getItemQty={getItemQty}
              onAdd={addToCart}
              onRemove={(productId) => updateQuantity(productId, getItemQty(productId) - 1)}
              isLoading={isLoading}
            />

            {/* Footer cart bar */}
            <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0 border-t border-zinc-800/50">
              {itemCount > 0 && (
                <button
                  onClick={clearCart}
                  className="flex items-center gap-1.5 h-11 rounded-xl bg-[#18181b] text-zinc-500 px-3 active:bg-[#27272a] transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                  <span className="text-xs font-medium">{itemCount}</span>
                </button>
              )}
              <button
                onClick={itemCount > 0 ? () => setCartOpen(true) : undefined}
                disabled={itemCount === 0}
                className={`flex-1 flex items-center justify-between rounded-xl py-3.5 px-5 font-bold text-base transition-all ${
                  itemCount > 0
                    ? 'bg-[#f7931a] text-black active:bg-[#e8851a] animate-pulse-subtle'
                    : 'bg-[#18181b] text-zinc-600 cursor-not-allowed'
                }`}
              >
                <span>{itemCount > 0 ? 'Ver carrito' : 'Cobrar'}</span>
                {itemCount > 0 && (
                  <span style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
                    {formatMenuTotal(totalSats, selectedCurrency, convert)}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cart Sheet */}
      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => { setCartOpen(false); handleCheckout() }}
        selectedCurrency={selectedCurrency}
      />
    </div>
  )
}

function formatMenuTotal(totalSats: number, currency: string, convert: (a: number, f: string, t: string) => number): string {
  if (currency === 'SAT') return `${Math.round(totalSats).toLocaleString('es-AR')} SAT`
  const amount = convert(totalSats, 'SAT', currency)
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}
