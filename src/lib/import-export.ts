import type { Stall } from '@/types/stall'
import type { Product } from '@/types/product'

// ---------- Old JSON format (from original POS) ----------

export interface OldCategory {
  id: number
  name: string
}

export interface OldProductPrice {
  value: number
  currency: string
}

export interface OldProductData {
  id: number
  category_id: number
  name: string
  description: string
  price: OldProductPrice
  image?: string
}

// ---------- Import: Old JSON → NIP-15 ----------

export function convertOldMenuToNIP15(
  products: OldProductData[],
  categories: OldCategory[],
  stallName: string,
): { stall: Stall; products: Product[]; categories: Map<string, string[]> } {
  const stallId = stallName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const categoryMap = new Map<number, string>()
  categories.forEach((cat) => categoryMap.set(cat.id, cat.name))

  // Infer currency from first product
  const firstProduct = products[0]
  const currency = firstProduct?.price.currency ?? 'SAT'

  const stall: Stall = {
    id: stallId,
    name: stallName,
    description: '',
    currency,
    shipping: [{ id: 'local', name: 'En el lugar', cost: 0, regions: ['event'] }],
  }

  const productCategoryMap = new Map<string, string[]>()

  const nip15Products: Product[] = products.map((p) => {
    const productId = `${stallId}-${p.id}`
    const categoryName = categoryMap.get(p.category_id) ?? 'General'

    productCategoryMap.set(productId, [categoryName])

    return {
      id: productId,
      stallId,
      name: p.name,
      description: p.description ?? '',
      images: p.image ? [p.image] : [],
      currency: p.price.currency,
      price: p.price.value,
      quantity: -1,
      specs: [],
      shipping: [],
      categories: [categoryName],
    }
  })

  return { stall, products: nip15Products, categories: productCategoryMap }
}

// ---------- Export: NIP-15 → Old JSON ----------

export function convertNIP15ToOldMenu(
  stall: Stall,
  products: Product[],
  categoriesByProduct?: Map<string, string[]>,
): { products: OldProductData[]; categories: OldCategory[] } {
  // Collect unique categories
  const categorySet = new Set<string>()
  products.forEach((p) => {
    const cats = categoriesByProduct?.get(p.id) ?? []
    cats.forEach((c) => categorySet.add(c))
  })

  const categoryList = Array.from(categorySet)
  const categoryIndexMap = new Map<string, number>()
  const oldCategories: OldCategory[] = categoryList.map((name, i) => {
    const id = i + 1
    categoryIndexMap.set(name, id)
    return { id, name }
  })

  if (oldCategories.length === 0) {
    oldCategories.push({ id: 1, name: 'General' })
  }
  const defaultCategoryId = oldCategories[0]!.id

  const oldProducts: OldProductData[] = products.map((p, i) => {
    const cats = categoriesByProduct?.get(p.id) ?? []
    const firstCat = cats[0]
    const categoryId = firstCat ? (categoryIndexMap.get(firstCat) ?? defaultCategoryId) : defaultCategoryId

    return {
      id: i + 1,
      category_id: categoryId,
      name: p.name,
      description: p.description,
      price: { value: p.price, currency: p.currency || stall.currency },
      image: p.images[0],
    }
  })

  return { products: oldProducts, categories: oldCategories }
}

// ---------- File helpers ----------

export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function readJSONFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const result = JSON.parse(e.target?.result as string) as T
        resolve(result)
      } catch {
        reject(new Error('Invalid JSON file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
