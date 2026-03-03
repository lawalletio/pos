'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Navbar from '@/components/shared/Navbar'
import NostrLogin from '@/components/shared/NostrLogin'
import { useNostrStore } from '@/stores/nostr'
import { useProducts } from '@/hooks/useProducts'
import { connectNDK } from '@/lib/nostr/ndk'
import { publishProduct } from '@/lib/nostr/marketplace'
import type { Product } from '@/types/product'

const CURRENCIES = ['ARS', 'SAT', 'USD', 'BRL', 'EUR', 'CLP', 'MXN', 'COP', 'PEN', 'UYU']

function generateProductId(name: string, stallId: string): string {
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return `${stallId}-${slug}-${Date.now().toString(36)}`
}

export default function ProductEditPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()

  const productId = params.productId as string
  const isNew = productId === 'new'
  const stallId = searchParams.get('stallId') ?? ''

  const { merchantPubkey } = useNostrStore()
  const { products } = useProducts(merchantPubkey)

  const existingProduct = !isNew ? products.find((p) => p.id === productId) : undefined

  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    currency: 'ARS',
    quantity: '',
    imageUrl: '',
  })
  const [categories, setCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (existingProduct) {
      setForm({
        name: existingProduct.name,
        description: existingProduct.description,
        price: String(existingProduct.price),
        currency: existingProduct.currency,
        quantity: existingProduct.quantity === -1 ? '' : String(existingProduct.quantity),
        imageUrl: existingProduct.images[0] ?? '',
      })
      // We don't have category data from product object directly (it's in event tags)
      // For edit mode, start with empty categories
    }
  }, [existingProduct])

  const handleAddCategory = () => {
    const cat = newCategory.trim()
    if (cat && !categories.includes(cat)) {
      setCategories((prev) => [...prev, cat])
    }
    setNewCategory('')
  }

  const handleRemoveCategory = (cat: string) => {
    setCategories((prev) => prev.filter((c) => c !== cat))
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    if (!form.price || isNaN(Number(form.price))) {
      setError('Valid price is required')
      return
    }
    if (isNew && !stallId) {
      setError('Stall ID is required')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const ndk = await connectNDK()
      const id = isNew ? generateProductId(form.name, stallId) : productId

      const product: Product = {
        id,
        stallId: isNew ? stallId : (existingProduct?.stallId ?? stallId),
        name: form.name.trim(),
        description: form.description.trim(),
        images: form.imageUrl ? [form.imageUrl] : [],
        currency: form.currency,
        price: Number(form.price),
        quantity: form.quantity === '' ? -1 : Number(form.quantity),
        specs: existingProduct?.specs ?? [],
        shipping: existingProduct?.shipping ?? [],
        categories: existingProduct?.categories ?? categories,
      }

      await publishProduct(product, categories, ndk)
      setSuccess(true)

      if (isNew) {
        const backHref = stallId ? `/admin/stalls/${stallId}` : '/admin/stalls'
        setTimeout(() => router.replace(backHref), 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish product')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existingProduct || !confirm(`Delete product "${existingProduct.name}"?`)) return
    setDeleting(true)
    try {
      const ndk = await connectNDK()
      const { signAndPublish } = await import('@/lib/nostr/marketplace')
      await signAndPublish({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['a', `30018:${merchantPubkey}:${existingProduct.id}`]],
        content: 'deleted',
      }, ndk)

      const backHref = existingProduct.stallId ? `/admin/stalls/${existingProduct.stallId}` : '/admin/stalls'
      router.replace(backHref)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const backHref = stallId ? `/admin/stalls/${stallId}` : '/admin/stalls'

  if (!merchantPubkey) {
    return (
      <div className="min-h-screen bg-[#060a12] text-white">
        <Navbar title="Product" backHref={backHref} />
        <div className="px-4 py-6 max-w-lg mx-auto">
          <div className="rounded-xl border border-zinc-800 bg-[#0f1729] p-6 space-y-4">
            <p className="text-center text-zinc-400">Connect with Nostr to manage products</p>
            <NostrLogin />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#060a12] text-white">
      <Navbar title={isNew ? 'New Product' : 'Edit Product'} backHref={backHref} />

      <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
        <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="space-y-4">

          {/* Name */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Product Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Cerveza IPA"
              className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition resize-none"
            />
          </div>

          {/* Price + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-300">Price *</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-300">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white focus:border-[#f7931a] focus:outline-none transition"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Categories (t tags)</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <span key={cat} className="flex items-center gap-1 rounded-full bg-[#f7931a]/20 text-[#f7931a] px-3 py-1 text-sm">
                  {cat}
                  <button
                    type="button"
                    onClick={() => handleRemoveCategory(cat)}
                    className="text-[#f7931a]/60 hover:text-[#f7931a] ml-1"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory() } }}
                placeholder="Add category"
                className="flex-1 rounded-lg border border-zinc-700 bg-[#0f1729] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none transition"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-[#f7931a] hover:text-[#f7931a] transition"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Quantity</label>
            <input
              type="number"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="∞ unlimited (leave empty)"
              className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition"
            />
            <p className="text-xs text-zinc-600">Leave empty for unlimited. Set to 0 to mark as unavailable.</p>
          </div>

          {/* Image URL */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300">Image URL</label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              placeholder="https://nostr.build/..."
              className="w-full rounded-lg border border-zinc-700 bg-[#0f1729] px-4 py-3 text-white placeholder-zinc-600 focus:border-[#f7931a] focus:outline-none focus:ring-1 focus:ring-[#f7931a] transition"
            />
            {form.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.imageUrl}
                alt="preview"
                className="mt-2 w-full h-32 object-cover rounded-lg border border-zinc-800"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
          </div>

          {/* Errors / Success */}
          {error && (
            <p className="rounded-lg border border-red-800/50 bg-red-900/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}
          {success && (
            <p className="rounded-lg border border-green-800/50 bg-green-900/10 px-3 py-2 text-xs text-green-400">
              Published successfully! {isNew ? 'Redirecting...' : ''}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {!isNew && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg border border-zinc-700 px-4 py-3 text-sm text-red-400 hover:border-red-500 disabled:opacity-50 transition"
              >
                {deleting ? '...' : 'Delete'}
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-[#f7931a] px-4 py-3 font-semibold text-black hover:bg-[#e8851a] disabled:opacity-50 transition"
            >
              {saving ? 'Publishing...' : isNew ? 'Publish Product (kind:30018)' : 'Save Changes'}
            </button>
          </div>
        </form>

        {/* NIP-15 event data */}
        {existingProduct && (
          <div className="rounded-lg border border-zinc-800 bg-[#0f1729] p-4 space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">NIP-15 Event Data</p>
            <pre className="text-xs text-zinc-500 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify({
                kind: 30018,
                tags: [['d', existingProduct.id], ...categories.map((c) => ['t', c])],
                content: {
                  id: existingProduct.id,
                  stall_id: existingProduct.stallId,
                  name: existingProduct.name,
                  currency: existingProduct.currency,
                  price: existingProduct.price,
                  quantity: existingProduct.quantity === -1 ? null : existingProduct.quantity,
                },
              }, null, 2)}
            </pre>
          </div>
        )}

        <p className="text-center text-xs text-zinc-600">
          Product ID: {isNew ? '(auto-generated on publish)' : productId}
        </p>
      </div>
    </div>
  )
}
