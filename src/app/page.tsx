'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { usePOSStore } from '@/stores/pos'
import { useNostrStore } from '@/stores/nostr'
import { useSettingsStore } from '@/stores/settings'

export default function SetupPage() {
  const [lightningAddress, setLightningAddress] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const setDestination = usePOSStore((s) => s.setDestination)
  const setMerchantPubkey = useNostrStore((s) => s.setMerchantPubkey)
  const setLightningAddressSetting = useSettingsStore((s) => s.setLightningAddress)

  const isValid = lightningAddress.includes('@') && lightningAddress.length > 3

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isLoading) return

    setIsLoading(true)

    try {
      // 1. Resolve NIP-05 to get merchant pubkey
      const nip05Res = await fetch(`/api/nip05?address=${encodeURIComponent(lightningAddress)}`)
      const nip05Data = await nip05Res.json()

      if (!nip05Res.ok || !nip05Data.pubkey) {
        toast.error(nip05Data.error || 'No se pudo resolver la identidad Nostr (NIP-05)')
        setIsLoading(false)
        return
      }

      // 2. Validate LUD-16 and check NIP-57 support
      const lnurlRes = await fetch(`/api/lnurl?address=${encodeURIComponent(lightningAddress)}`)
      const lnurlData = await lnurlRes.json()

      if (!lnurlRes.ok) {
        toast.error(lnurlData.error || 'Lightning Address no válida o no soportada')
        setIsLoading(false)
        return
      }

      // 3. Store results
      setDestination(lightningAddress)
      setMerchantPubkey(nip05Data.pubkey)
      setLightningAddressSetting(lightningAddress)

      toast.success(`✅ Configurado: ${lightningAddress}`)

      // 4. Navigate to POS
      router.push('/pos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión. Intenta de nuevo.')
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#060a12] text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <div className="text-5xl">⚡</div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Lightning POS</h1>
          <p className="text-sm text-zinc-400">Bitcoin Lightning · Powered by Nostr</p>
        </div>

        {/* Setup Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="lightning-address" className="text-sm font-medium text-zinc-300">
              Lightning Address
            </label>
            <input
              id="lightning-address"
              type="text"
              inputMode="email"
              placeholder="tu@lawallet.ar"
              value={lightningAddress}
              onChange={(e) => setLightningAddress(e.target.value.trim())}
              disabled={isLoading}
              className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition disabled:opacity-50"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {lightningAddress.length > 0 && !isValid && (
              <p className="text-xs text-red-400">Debe tener formato usuario@dominio</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-[#f7931a] px-4 py-3 font-semibold text-black hover:bg-[#e8851a] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            disabled={!isValid || isLoading}
          >
            {isLoading ? (
              <>
                <span className="animate-spin">⚡</span>
                <span>Verificando...</span>
              </>
            ) : (
              'Comenzar'
            )}
          </button>
        </form>

        {/* Dev Navigation — subtle */}
        <div className="pt-4 border-t border-zinc-800/50">
          <p className="text-[10px] text-zinc-700 text-center mb-2 uppercase tracking-widest">Dev</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { href: '/pos', label: '⚡ POS' },
              { href: '/settings', label: '⚙️' },
              { href: '/admin', label: '🔧' },
              { href: '/pos/test-order', label: '📄' },
            ].map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="rounded-md border border-zinc-800 bg-[#0a0f1a] px-1 py-1.5 text-[10px] text-center text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition"
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-zinc-700">
          Your keys, your sats. No custodian.
        </p>
      </div>

      {/* Footer */}
      <footer className="fixed bottom-3 left-0 right-0 text-center">
        <p className="text-[11px] text-zinc-500 font-mono">v{process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'} · NIP-15 · La Crypta</p>
      </footer>
    </main>
  )
}
