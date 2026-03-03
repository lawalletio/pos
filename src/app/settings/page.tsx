'use client'

import { useState, useEffect, useCallback } from 'react'
import Navbar from '@/components/shared/Navbar'
import { useSettingsStore } from '@/stores/settings'
import { useCurrencyStore } from '@/stores/currency'
import { DEFAULT_RELAYS } from '@/config/constants'

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'

// ─── types ────────────────────────────────────────────────────────────────────

interface RelayStatus {
  url: string
  connected: boolean
  checking: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function checkRelay(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        ws.close()
        resolve(false)
      }, 3000)
      ws.onopen = () => {
        clearTimeout(timer)
        ws.close()
        resolve(true)
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
    } catch {
      resolve(false)
    }
  })
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)

  // Listen for SW updates
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        setUpdateAvailable(true)
      }
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)

    const reg = navigator.serviceWorker.getRegistration()
    reg.then((registration) => {
      if (!registration) return
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true)
          }
        })
      })
    })

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage)
    }
  }, [])

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      // Clear all SW caches
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      // Clear IndexedDB (Dexie pos-cache)
      if ('indexedDB' in window) {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase('pos-cache')
          req.onsuccess = () => resolve()
          req.onerror = () => reject(req.error)
          req.onblocked = () => resolve()
        })
      }
      // Unregister service worker
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((r) => r.unregister()))
      }
      window.location.reload()
    } catch {
      setClearingCache(false)
    }
  }

  // settings store
  const {
    activeCurrencies,
    defaultCurrency,
    relays,
    display,
    addRelay,
    removeRelay,
    resetRelays,
    setDefaultCurrency,
    setActiveCurrencies,
    setDisplay,
  } = useSettingsStore()

  // currency store (keep in sync)
  const currencyStore = useCurrencyStore()

  // available currencies from /api/rates
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [currencySearch, setCurrencySearch] = useState('')
  const [loadingCurrencies, setLoadingCurrencies] = useState(false)

  // relay state
  const [relayStatuses, setRelayStatuses] = useState<RelayStatus[]>([])
  const [newRelayInput, setNewRelayInput] = useState('')
  const [relayError, setRelayError] = useState('')

  // ── fetch available currencies ────────────────────────────────────────────

  useEffect(() => {
    setLoadingCurrencies(true)
    fetch('/api/rates')
      .then((r) => r.json())
      .then((data) => {
        if (data.rates) {
          const codes = ['SAT', ...Object.keys(data.rates).sort()]
          setAvailableCurrencies(codes)
        }
      })
      .catch(() => {
        // fallback list
        setAvailableCurrencies([
          'SAT', 'ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN', 'COP',
          'GBP', 'JPY', 'CHF', 'PEN', 'UYU', 'BOB', 'PYG',
        ])
      })
      .finally(() => setLoadingCurrencies(false))
  }, [])

  // ── check relay connections ───────────────────────────────────────────────

  const refreshRelayStatuses = useCallback(async () => {
    const initial = relays.map((url) => ({ url, connected: false, checking: true }))
    setRelayStatuses(initial)

    const updated = await Promise.all(
      relays.map(async (url) => ({
        url,
        connected: await checkRelay(url),
        checking: false,
      }))
    )
    setRelayStatuses(updated)
  }, [relays])

  useEffect(() => {
    refreshRelayStatuses()
  }, [refreshRelayStatuses])

  // ── currency actions ──────────────────────────────────────────────────────

  const handleAddCurrency = (code: string) => {
    if (activeCurrencies.includes(code)) return
    const updated = [...activeCurrencies, code]
    setActiveCurrencies(updated)
    currencyStore.addCurrency(code)
  }

  const handleRemoveCurrency = (code: string) => {
    if (code === 'SAT') return // SAT always required
    const updated = activeCurrencies.filter((c) => c !== code)
    setActiveCurrencies(updated)
    currencyStore.removeCurrency(code)
    // If removing the default, switch to SAT
    if (defaultCurrency === code) {
      setDefaultCurrency('SAT')
      currencyStore.setDefaultCurrency('SAT')
    }
  }

  const handleMoveCurrency = (code: string, direction: 'up' | 'down') => {
    const idx = activeCurrencies.indexOf(code)
    if (idx === -1) return
    const newArr = [...activeCurrencies]
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= newArr.length) return
    const tmp = newArr[idx]!
    newArr[idx] = newArr[swapWith]!
    newArr[swapWith] = tmp
    setActiveCurrencies(newArr)
    currencyStore.setActiveCurrencies(newArr)
  }

  const handleSetDefault = (code: string) => {
    setDefaultCurrency(code)
    currencyStore.setDefaultCurrency(code)
  }

  // ── relay actions ─────────────────────────────────────────────────────────

  const handleAddRelay = () => {
    setRelayError('')
    const url = newRelayInput.trim()
    if (!url) return
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      setRelayError('Relay URL must start with wss:// or ws://')
      return
    }
    if (relays.includes(url)) {
      setRelayError('Relay already in list')
      return
    }
    addRelay(url)
    setNewRelayInput('')
  }

  // ── filter currencies ─────────────────────────────────────────────────────

  const filteredAvailable = availableCurrencies.filter((c) => {
    if (activeCurrencies.includes(c)) return false
    if (!currencySearch) return true
    return c.toLowerCase().includes(currencySearch.toLowerCase())
  })

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#060a12] text-white">
      <Navbar title="Settings" />

      {/* ── Update banner ──────────────────────────────────────────────── */}
      {updateAvailable && (
        <div className="bg-[#f7931a]/10 border-b border-[#f7931a]/30 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-[#f7931a]">⚡ New version available</span>
          <button
            onClick={handleClearCache}
            className="text-sm font-medium text-[#f7931a] hover:text-white transition underline"
          >
            Tap to update
          </button>
        </div>
      )}

      <div className="px-4 py-6 space-y-8 max-w-lg mx-auto pb-20">

        {/* ── Active Currencies ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Active Currencies
            </h2>
            <span className="text-xs text-zinc-600">{activeCurrencies.length} active</span>
          </div>

          <div className="space-y-2">
            {activeCurrencies.map((code, idx) => (
              <div
                key={code}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3"
              >
                {/* left: order controls + code + badges */}
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => handleMoveCurrency(code, 'up')}
                      disabled={idx === 0}
                      className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 text-xs leading-none"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMoveCurrency(code, 'down')}
                      disabled={idx === activeCurrencies.length - 1}
                      className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 text-xs leading-none"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <span className="font-medium text-white">{code}</span>
                  {code === defaultCurrency && (
                    <span className="text-xs bg-[#f7931a]/20 text-[#f7931a] px-2 py-0.5 rounded">
                      default
                    </span>
                  )}
                  {code === 'SAT' && (
                    <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
                      required
                    </span>
                  )}
                </div>

                {/* right: set default + remove */}
                <div className="flex items-center gap-2">
                  {code !== defaultCurrency && (
                    <button
                      onClick={() => handleSetDefault(code)}
                      className="text-xs text-zinc-500 hover:text-[#f7931a] transition"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCurrency(code)}
                    disabled={code === 'SAT'}
                    className="text-zinc-600 hover:text-red-400 transition disabled:opacity-20 text-sm ml-1"
                    aria-label={`Remove ${code}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Add Currency ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Add Currency
          </h2>

          <input
            type="text"
            value={currencySearch}
            onChange={(e) => setCurrencySearch(e.target.value)}
            placeholder="Search currencies (e.g. EUR, BRL…)"
            className="w-full rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#f7931a] transition"
          />

          {loadingCurrencies ? (
            <p className="text-xs text-zinc-600">Loading currencies…</p>
          ) : filteredAvailable.length === 0 ? (
            <p className="text-xs text-zinc-600">
              {currencySearch ? 'No matches' : 'All currencies already active'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {filteredAvailable.map((code) => (
                <button
                  key={code}
                  onClick={() => handleAddCurrency(code)}
                  className="rounded-lg border border-zinc-800 bg-[#0f1729] px-3 py-2.5 text-sm text-zinc-400 hover:border-[#f7931a] hover:text-[#f7931a] transition text-left"
                >
                  + {code}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-600">
            {availableCurrencies.length > 1
              ? `${availableCurrencies.length} currencies available via yadio.io`
              : '126 currencies available via yadio.io'}
          </p>
        </section>

        {/* ── Nostr Relays ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Nostr Relays
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshRelayStatuses}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                ↻ Check
              </button>
              <button
                onClick={() => resetRelays()}
                className="text-xs text-zinc-500 hover:text-[#f7931a] transition"
              >
                Reset defaults
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {relays.map((url) => {
              const status = relayStatuses.find((r) => r.url === url)
              return (
                <div
                  key={url}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`
                        flex-shrink-0 w-2 h-2 rounded-full transition-colors
                        ${status?.checking
                          ? 'bg-yellow-500 animate-pulse'
                          : status?.connected
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }
                      `}
                    />
                    <span className="text-sm text-zinc-300 font-mono truncate">{url}</span>
                  </div>
                  <button
                    onClick={() => removeRelay(url)}
                    className="flex-shrink-0 text-zinc-600 hover:text-red-400 transition text-sm ml-2"
                    aria-label={`Remove ${url}`}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          {/* Add relay input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newRelayInput}
              onChange={(e) => {
                setNewRelayInput(e.target.value)
                setRelayError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddRelay()}
              placeholder="wss://relay.example.com"
              className="flex-1 rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#f7931a] transition font-mono"
            />
            <button
              onClick={handleAddRelay}
              className="px-4 py-2.5 rounded-lg bg-[#f7931a] text-black font-medium text-sm hover:bg-[#e8891a] transition"
            >
              Add
            </button>
          </div>
          {relayError && (
            <p className="text-xs text-red-400">{relayError}</p>
          )}
        </section>

        {/* ── Display Preferences ───────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Display Preferences
          </h2>

          {/* Default currency */}
          <div className="rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm text-zinc-300">Default Currency</span>
              <p className="text-xs text-zinc-600 mt-0.5">Used when no currency is selected</p>
            </div>
            <select
              value={defaultCurrency}
              onChange={(e) => handleSetDefault(e.target.value)}
              className="bg-[#060a12] border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#f7931a] transition"
            >
              {activeCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Show Bitcoin Block toggle */}
          <div className="rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm text-zinc-300">Show Bitcoin Block</span>
              <p className="text-xs text-zinc-600 mt-0.5">Display current block height</p>
            </div>
            <ToggleSwitch
              checked={display.showBlockHeight}
              onChange={(v) => setDisplay({ showBlockHeight: v })}
            />
          </div>

          {/* QR Fullscreen toggle */}
          <div className="rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm text-zinc-300">QR Fullscreen Mode</span>
              <p className="text-xs text-zinc-600 mt-0.5">Expand QR to full screen on payment</p>
            </div>
            <ToggleSwitch
              checked={display.showQRFullscreen}
              onChange={(v) => setDisplay({ showQRFullscreen: v })}
            />
          </div>
        </section>

        {/* ── Cache & App ───────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            App
          </h2>

          <div className="rounded-lg border border-zinc-800 bg-[#0f1729] px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm text-zinc-300">Version</span>
              <p className="text-xs text-zinc-600 mt-0.5">v{APP_VERSION}</p>
            </div>
          </div>

          <button
            onClick={handleClearCache}
            disabled={clearingCache}
            className="w-full rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-950/50 hover:text-red-300 hover:border-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {clearingCache ? (
              <>
                <span className="animate-spin">↻</span>
                Clearing…
              </>
            ) : (
              <>
                🗑️ Clear Cache &amp; Reload
              </>
            )}
          </button>
          <p className="text-xs text-zinc-600">
            Clears all cached data and reloads the app. Use if you&apos;re seeing an outdated version.
          </p>
        </section>

      </div>
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        relative w-10 h-6 rounded-full transition-colors duration-200
        ${checked ? 'bg-[#f7931a]' : 'bg-zinc-700'}
      `}
    >
      <span
        className={`
          absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200
          ${checked ? 'translate-x-4' : 'translate-x-0.5'}
        `}
      />
    </button>
  )
}
