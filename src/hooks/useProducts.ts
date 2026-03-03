'use client'

import { useEffect, useRef, useState } from 'react'
import type { NDKSubscription } from '@nostr-dev-kit/ndk'
import { getNDK } from '@/lib/nostr/ndk'
import { parseProductEvent, extractCategories } from '@/lib/nostr/marketplace'
import { getFromCache, saveToCache } from '@/lib/cache/indexeddb'
import type { Product } from '@/types/product'

export function useProducts(merchantPubkey: string | null, stallId?: string) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const subRef = useRef<NDKSubscription | null>(null)

  useEffect(() => {
    if (!merchantPubkey) {
      setProducts([])
      setCategories([])
      return
    }

    setIsLoading(true)
    setError(null)
    setProducts([])
    setCategories([])

    let stopped = false
    const relayProducts: Map<string, Product> = new Map()

    const start = async () => {
      try {
        // 1. Load from cache immediately (stale-while-revalidate)
        const cached = await getFromCache(merchantPubkey)
        if (!stopped && cached.products.length > 0) {
          // Migrate legacy cached products that may not have `categories`
          const migrated = cached.products.map((p) =>
            p.categories ? p : { ...p, categories: [] }
          )
          const filtered = stallId
            ? migrated.filter((p) => p.stallId === stallId)
            : migrated
          setProducts(filtered)

          // Derive categories from cached products
          const cats = new Set<string>()
          filtered.forEach((p) => p.categories?.forEach((c) => cats.add(c)))
          if (cats.size > 0) setCategories(Array.from(cats))

          setIsLoading(false)
        }

        // 2. Subscribe to relay — use `since` if we have a lastSync
        const ndk = getNDK()
        await ndk.connect()

        const filter: Record<string, unknown> = {
          kinds: [30018 as number],
          authors: [merchantPubkey],
        }
        if (cached.lastSync) {
          filter.since = cached.lastSync
        }

        const sub = ndk.subscribe(filter as Parameters<typeof ndk.subscribe>[0], {
          closeOnEose: false,
        })
        subRef.current = sub

        sub.on('event', (event) => {
          if (stopped) return
          const product = parseProductEvent(event)
          if (!product) return
          if (stallId && product.stallId !== stallId) return

          const cats = extractCategories(event)
          relayProducts.set(product.id, product)

          setProducts((prev) => {
            const exists = prev.find((p) => p.id === product.id)
            if (exists) return prev.map((p) => (p.id === product.id ? product : p))
            return [...prev, product]
          })

          if (cats.length > 0) {
            setCategories((prev) => {
              const next = [...prev]
              cats.forEach((c) => {
                if (!next.includes(c)) next.push(c)
              })
              return next
            })
          }
        })

        sub.on('eose', () => {
          if (stopped) return
          setIsLoading(false)

          // Merge relay results with cached products and persist
          const mergedMap = new Map<string, Product>(
            cached.products.map((p) => [p.id, p])
          )
          relayProducts.forEach((p, id) => mergedMap.set(id, p))
          const mergedProducts = Array.from(mergedMap.values())

          if (mergedProducts.length > 0) {
            // We need stalls too — preserve whatever was cached
            void getFromCache(merchantPubkey).then((c) => {
              void saveToCache(merchantPubkey, c.stalls, mergedProducts)
            }).catch(() => {/* non-fatal */})
          }
        })
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : 'Failed to fetch products')
          setIsLoading(false)
        }
      }
    }

    start()

    const timeout = setTimeout(() => {
      if (!stopped) setIsLoading(false)
    }, 10000)

    return () => {
      stopped = true
      clearTimeout(timeout)
      subRef.current?.stop()
      subRef.current = null
    }
  }, [merchantPubkey, stallId])

  return { products, categories, isLoading, error }
}
