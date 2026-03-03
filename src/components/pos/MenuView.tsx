'use client'

import { useState, useMemo } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import type { Product } from '@/types/product'
import ProductRow from './ProductCard'

interface MenuViewProps {
  products: Product[]
  categories: string[]
  selectedCurrency: string
  convert: (amount: number, from: string, to: string) => number
  getItemQty: (productId: string) => number
  onAdd: (product: Product) => void
  onRemove: (productId: string) => void
  isLoading: boolean
}

type SortOption = 'name' | 'price-asc' | 'price-desc'

function formatPrice(amount: number, currency: string): string {
  if (currency === 'SAT') return `${Math.round(amount).toLocaleString('es-AR')}`
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function MenuView({
  products,
  categories,
  selectedCurrency,
  convert,
  getItemQty,
  onAdd,
  onRemove,
  isLoading,
}: MenuViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>('name')
  const [showSort, setShowSort] = useState(false)

  const sortLabel: Record<SortOption, string> = {
    name: 'Nombre',
    'price-asc': 'Precio ↑',
    'price-desc': 'Precio ↓',
  }

  // Client-side filter + sort (instant, no re-fetch)
  const filteredProducts = useMemo(() => {
    let list = [...products]

    // Category filter
    if (selectedCategory) {
      list = list.filter((p) => p.categories.includes(selectedCategory))
    }

    // Text search (name)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }

    // Sort
    list.sort((a, b) => {
      if (sortOption === 'name') return a.name.localeCompare(b.name)
      const priceA = convert(a.price, a.currency, 'SAT')
      const priceB = convert(b.price, b.currency, 'SAT')
      return sortOption === 'price-asc' ? priceA - priceB : priceB - priceA
    })

    return list
  }, [products, selectedCategory, searchQuery, sortOption, convert])

  if (isLoading && products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-600 text-sm">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Category chips ────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="flex-none overflow-x-auto scrollbar-hide px-4 py-2">
          <div className="flex gap-2 w-max">
            {/* All chip */}
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === null
                  ? 'bg-[#f7931a] text-black'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Todos
            </button>

            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setSelectedCategory((prev) => (prev === cat ? null : cat))
                }
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-[#f7931a] text-black'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search + sort bar ────────────────────────────────── */}
      <div className="flex-none flex items-center gap-2 px-4 pb-2">
        {/* Search input */}
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full bg-zinc-800 text-white text-sm pl-8 pr-8 py-2 rounded-xl border border-zinc-700 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSort((v) => !v)}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition whitespace-nowrap"
          >
            {sortLabel[sortOption]}
            <ChevronDown size={12} className={`transition-transform ${showSort ? 'rotate-180' : ''}`} />
          </button>

          {showSort && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowSort(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
                {(Object.keys(sortLabel) as SortOption[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSortOption(opt)
                      setShowSort(false)
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-xs whitespace-nowrap transition-colors ${
                      sortOption === opt
                        ? 'text-[#f7931a] bg-zinc-800'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {sortLabel[opt]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Product list ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-1">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-zinc-600">
            <Search size={24} strokeWidth={1.5} />
            <p className="text-sm">Sin resultados</p>
          </div>
        ) : (
          filteredProducts.map((product) => {
            const displayPrice = formatPrice(
              convert(product.price, product.currency, selectedCurrency),
              selectedCurrency
            )
            const qty = getItemQty(product.id)
            const unavailable = product.quantity === 0

            return (
              <ProductRow
                key={product.id}
                product={product}
                quantity={qty}
                displayPrice={displayPrice}
                onAdd={() => onAdd(product)}
                onRemove={() => onRemove(product.id)}
                unavailable={unavailable}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
