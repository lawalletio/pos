'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import Navbar from '@/components/shared/Navbar'
import NostrLogin from '@/components/shared/NostrLogin'
import ProductCard from '@/components/pos/ProductCard'
import { useNostrStore } from '@/stores/nostr'
import { useStall } from '@/hooks/useStall'
import { useProducts } from '@/hooks/useProducts'
import { connectNDK } from '@/lib/nostr/ndk'
import { publishStall, publishProduct } from '@/lib/nostr/marketplace'
import {
  convertNIP15ToOldMenu,
  convertOldMenuToNIP15,
  downloadJSON,
  readJSONFile,
  type OldProductData,
  type OldCategory,
} from '@/lib/import-export'
import type { Stall } from '@/types/stall'
import type { Product } from '@/types/product'

const CURRENCIES = ['ARS', 'SAT', 'USD', 'BRL', 'EUR', 'CLP', 'MXN', 'COP', 'PEN', 'UYU']

// ---------- Menu Preview Modal ----------

interface PreviewModalProps {
  stall: Stall
  products: Product[]
  onClose: () => void
}

function PreviewModal({ stall, products, onClose }: PreviewModalProps) {
  // Group by category using product tags stored in a local map
  // For preview we just show all products grouped by currency
  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
    const group = p.currency
    if (!acc[group]) acc[group] = []
    acc[group]!.push(p)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#060a12] border border-zinc-800 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg">{stall.name}</h2>
            <p className="text-xs text-zinc-500">Preview as POS (read-only)</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">✕</button>
        </div>

        {products.length === 0 && (
          <p className="text-center text-zinc-500 py-8 text-sm">No products yet</p>
        )}

        {Object.entries(grouped).map(([currency, prods]) => (
          <div key={currency} className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{currency}</p>
            {prods.map((p) => (
              <div key={p.id} className={p.quantity === 0 ? 'opacity-40' : ''}>
                <ProductCard
                  product={p}
                  quantity={0}
                  displayPrice={`${p.price.toLocaleString()} ${p.currency}`}
                  onAdd={() => {}}
                  onRemove={() => {}}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}


// ---------- Stall Form ----------

interface StallFormData {
  id: string
  name: string
  description: string
  currency: string
}

// ---------- Main Page ----------

export default function StallDetailPage() {
  const params = useParams()
  const router = useRouter()
  const stallId = params.stallId as string
  const isNew = stallId === 'new'

  const { merchantPubkey } = useNostrStore()
  const { stalls } = useStall(merchantPubkey)
  const { products } = useProducts(merchantPubkey, isNew ? undefined : stallId)

  const existingStall = stalls.find((s) => s.id === stallId)

  const [form, setForm] = useState<StallFormData>({
    id: isNew ? `stall-${Date.now()}` : stallId,
    name: '',
    description: '',
    currency: 'ARS',
  })

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [importing, setImporting] = useState(false)

  // Product categories state (local, from `t` tags via extractCategories — stored per product)
  const [productCategories, setProductCategories] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    if (existingStall) {
      setForm({
        id: existingStall.id,
        name: existingStall.name,
        description: existingStall.description,
        currency: existingStall.currency,
      })
    }
  }, [existingStall])

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSaveError('Name is required')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const ndk = await connectNDK()
      const stall: Stall = {
        id: form.id,
        name: form.name,
        description: form.description,
        currency: form.currency,
        shipping: existingStall?.shipping ?? [
          { id: 'local', name: 'En el lugar', cost: 0, regions: ['event'] },
        ],
      }
      await publishStall(stall, ndk)
      setSaveSuccess(true)
      if (isNew) {
        router.replace(`/admin/stalls/${form.id}`)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish stall')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteStall = async () => {
    if (!existingStall || !confirm(`Delete stall "${existingStall.name}"?`)) return
    setDeleting(true)
    try {
      // We publish a kind:5 for the stall event — we need the event ID
      // Since NDK doesn't easily expose event ID from replaceable events here,
      // we'll use the d-tag format for deletion
      const ndk = await connectNDK()
      const { signAndPublish } = await import('@/lib/nostr/marketplace')
      await signAndPublish({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['a', `30017:${merchantPubkey}:${existingStall.id}`]],
        content: 'deleted',
      }, ndk)
      router.replace('/admin/stalls')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleAvailability = async (product: Product) => {
    try {
      const ndk = await connectNDK()
      const updated: Product = {
        ...product,
        quantity: product.quantity === 0 ? -1 : 0,
      }
      const cats = productCategories.get(product.id) ?? []
      await publishProduct(updated, cats, ndk)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update availability')
    }
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!confirm(`Delete product "${product.name}"?`)) return
    try {
      const ndk = await connectNDK()
      const { signAndPublish } = await import('@/lib/nostr/marketplace')
      await signAndPublish({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['a', `30018:${merchantPubkey}:${product.id}`]],
        content: 'deleted',
      }, ndk)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete product')
    }
  }

  const handleExport = () => {
    const stall: Stall = existingStall ?? {
      id: form.id,
      name: form.name,
      description: form.description,
      currency: form.currency,
      shipping: [],
    }
    const { products: oldProducts, categories } = convertNIP15ToOldMenu(stall, products, productCategories)
    downloadJSON({ products: oldProducts, categories }, `${stall.id}-menu.json`)
  }

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const data = await readJSONFile<{ products: OldProductData[]; categories: OldCategory[] }>(file)
      const stallName = form.name || file.name.replace('.json', '')
      const converted = convertOldMenuToNIP15(data.products ?? [], data.categories ?? [], stallName)

      setProductCategories(converted.categories)

      const ndk = await connectNDK()
      await publishStall(converted.stall, ndk)

      for (const p of converted.products) {
        const cats = converted.categories.get(p.id) ?? []
        await publishProduct(p, cats, ndk)
      }

      toast.success(`Imported ${converted.products.length} products into stall "${converted.stall.name}"`)
      router.replace(`/admin/stalls/${converted.stall.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }, [form.name, router])

  if (!merchantPubkey) {
    return (
      <div className="min-h-screen bg-[#060a12] text-white">
        <Navbar title="Stall" backHref="/admin/stalls" />
        <div className="px-4 py-6 max-w-lg mx-auto">
          <div className="rounded-xl border border-zinc-800 bg-[#0f1729] p-6 space-y-4">
            <p className="text-center text-zinc-400">Connect with Nostr to manage stalls</p>
            <NostrLogin />
          </div>
        </div>
      </div>
    )
  }

  const stallProductList = isNew ? [] : products

  return (
    <div className="min-h-screen bg-[#060a12] text-white">
      <Navbar title={isNew ? 'New Stall' : `Edit: ${form.name || stallId}`} backHref="/admin/stalls" />

      {showPreview && (
        <PreviewModal
          stall={{ id: form.id, name: form.name, description: form.description, currency: form.currency, shipping: [] }}
          products={stallProductList}
          onClose={() => setShowPreview(false)}
        />
      )}

      <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
        {/* Stall Form */}
        <div className="rounded-xl border border-zinc-800 bg-[#0f1729] p-4 space-y-4">
          <h2 className="font-semibold text-sm text-zinc-400 uppercase tracking-wider">Stall Info (kind:30017)</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">ID</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              disabled={!isNew}
              className="w-full rounded-lg border border-zinc-700 bg-[#060a12] px-4 py-2.5 text-sm font-mono text-white disabled:opacity-50 focus:border-[#f7931a] focus:outline-none transition"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Barra"
              className="w-full rounded-lg border border-zinc-700 bg-[#060a12] px-4 py-2.5 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full rounded-lg border border-zinc-700 bg-[#060a12] px-4 py-2.5 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Currency</label>
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-[#060a12] px-4 py-2.5 text-white focus:border-[#f7931a] focus:outline-none transition"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {saveError && (
            <p className="rounded-lg border border-red-800/50 bg-red-900/10 px-3 py-2 text-xs text-red-400">{saveError}</p>
          )}
          {saveSuccess && (
            <p className="rounded-lg border border-green-800/50 bg-green-900/10 px-3 py-2 text-xs text-green-400">Published successfully!</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-[#f7931a] px-4 py-3 font-semibold text-black hover:bg-[#e8851a] disabled:opacity-50 transition"
            >
              {saving ? 'Publishing...' : isNew ? 'Publish Stall' : 'Save Changes'}
            </button>
            {!isNew && (
              <button
                onClick={handleDeleteStall}
                disabled={deleting}
                className="rounded-lg border border-zinc-700 px-4 py-3 text-sm text-red-400 hover:border-red-500 disabled:opacity-50 transition"
              >
                {deleting ? '...' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        {/* Products */}
        {!isNew && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Products ({stallProductList.length})
              </h3>
              <Link
                href={`/admin/products/new?stallId=${stallId}`}
                className="text-xs text-[#f7931a] hover:underline"
              >
                + Add Product
              </Link>
            </div>

            {stallProductList.length === 0 && (
              <div className="rounded-lg border border-zinc-800 bg-[#0f1729] p-6 text-center text-zinc-500 text-sm">
                No products yet. Add your first one!
              </div>
            )}

            {stallProductList.map((product) => {
              const isUnavailable = product.quantity === 0
              return (
                <div
                  key={product.id}
                  className={`rounded-lg border bg-[#0f1729] px-4 py-3 ${isUnavailable ? 'border-zinc-800 opacity-60' : 'border-zinc-800'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/admin/products/${product.id}?stallId=${stallId}`}
                          className="font-medium hover:text-[#f7931a] transition"
                        >
                          {product.name}
                        </Link>
                        {isUnavailable && (
                          <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Agotado</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {product.price.toLocaleString()} {product.currency}
                        {product.specs.length > 0 && ` · ${product.specs.map((s) => s.value).join(', ')}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Availability toggle */}
                      <button
                        onClick={() => handleToggleAvailability(product)}
                        className={`relative w-10 h-5 rounded-full transition ${isUnavailable ? 'bg-zinc-700' : 'bg-green-600'}`}
                        title={isUnavailable ? 'Mark as available' : 'Mark as unavailable'}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isUnavailable ? 'left-0.5' : 'left-5'}`}
                        />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteProduct(product)}
                        className="text-zinc-600 hover:text-red-400 transition text-sm"
                        title="Delete product"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {stallProductList.length > 0 && (
              <Link
                href={`/admin/products/new?stallId=${stallId}`}
                className="block w-full rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-center text-sm text-zinc-500 hover:border-[#f7931a] hover:text-[#f7931a] transition"
              >
                + Add Product
              </Link>
            )}
          </div>
        )}

        {/* Actions */}
        {!isNew && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowPreview(true)}
              className="rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-sm text-zinc-300 hover:border-[#f7931a] hover:text-[#f7931a] transition"
            >
              👁️ Preview as POS
            </button>
            <button
              onClick={handleExport}
              className="rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-sm text-zinc-300 hover:border-[#f7931a] hover:text-[#f7931a] transition"
            >
              📤 Export JSON
            </button>
          </div>
        )}

        {/* Import */}
        <div className="rounded-lg border border-dashed border-zinc-700 bg-[#0f1729] p-4 text-center space-y-2">
          <p className="text-sm text-zinc-500">Import from old JSON format</p>
          <label className={`inline-block cursor-pointer rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-[#f7931a] hover:text-[#f7931a] transition ${importing ? 'opacity-50' : ''}`}>
            {importing ? 'Importing...' : '📥 Import JSON'}
            <input
              type="file"
              accept=".json"
              className="hidden"
              disabled={importing}
              onChange={handleImport}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
