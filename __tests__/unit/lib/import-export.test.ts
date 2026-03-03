import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  convertOldMenuToNIP15,
  convertNIP15ToOldMenu,
  downloadJSON,
  readJSONFile,
  type OldProductData,
  type OldCategory,
} from '@/lib/import-export'
import type { Product } from '@/types/product'
import type { Stall } from '@/types/stall'

const oldCategories: OldCategory[] = [
  { id: 1, name: 'Bebidas' },
  { id: 2, name: 'Comidas' },
]

const oldProducts: OldProductData[] = [
  {
    id: 1,
    category_id: 1,
    name: 'Agua',
    description: 'Agua mineral',
    price: { value: 500, currency: 'ARS' },
    image: 'https://example.com/agua.jpg',
  },
  {
    id: 2,
    category_id: 2,
    name: 'Empanada',
    description: 'De carne',
    price: { value: 1000, currency: 'ARS' },
  },
]

describe('convertOldMenuToNIP15', () => {
  it('generates stall with correct id from name', () => {
    const { stall } = convertOldMenuToNIP15(oldProducts, oldCategories, 'La Crypta')
    expect(stall.id).toBe('la-crypta')
    expect(stall.name).toBe('La Crypta')
  })

  it('infers currency from first product', () => {
    const { stall } = convertOldMenuToNIP15(oldProducts, oldCategories, 'Test')
    expect(stall.currency).toBe('ARS')
  })

  it('converts products with proper ids', () => {
    const { products } = convertOldMenuToNIP15(oldProducts, oldCategories, 'Tienda')
    expect(products).toHaveLength(2)
    expect(products[0]!.id).toContain('tienda')
    expect(products[0]!.name).toBe('Agua')
  })

  it('maps categories correctly', () => {
    const { categories } = convertOldMenuToNIP15(oldProducts, oldCategories, 'Tienda')
    const allCats = Array.from(categories.values()).flat()
    expect(allCats).toContain('Bebidas')
    expect(allCats).toContain('Comidas')
  })

  it('handles product with image', () => {
    const { products } = convertOldMenuToNIP15(oldProducts, oldCategories, 'Tienda')
    expect(products[0]!.images).toContain('https://example.com/agua.jpg')
    expect(products[1]!.images).toHaveLength(0)
  })

  it('handles empty products array', () => {
    const { products, stall } = convertOldMenuToNIP15([], oldCategories, 'Empty')
    expect(products).toHaveLength(0)
    expect(stall.currency).toBe('SAT') // default
  })
})

describe('convertNIP15ToOldMenu', () => {
  const stall: Stall = {
    id: 'test-stall',
    name: 'Test Stall',
    description: '',
    currency: 'ARS',
    shipping: [],
  }

  const products: Product[] = [
    {
      id: 'test-stall-agua',
      stallId: 'test-stall',
      name: 'Agua',
      description: 'Mineral',
      images: ['https://example.com/agua.jpg'],
      currency: 'ARS',
      price: 500,
      quantity: -1,
      specs: [],
      shipping: [],
    },
    {
      id: 'test-stall-empanada',
      stallId: 'test-stall',
      name: 'Empanada',
      description: 'Carne',
      images: [],
      currency: 'ARS',
      price: 1000,
      quantity: -1,
      specs: [],
      shipping: [],
    },
  ]

  const catMap = new Map<string, string[]>([
    ['test-stall-agua', ['Bebidas']],
    ['test-stall-empanada', ['Comidas']],
  ])

  it('converts to old format with same count', () => {
    const { products: old } = convertNIP15ToOldMenu(stall, products, catMap)
    expect(old).toHaveLength(2)
  })

  it('maps categories properly', () => {
    const { categories } = convertNIP15ToOldMenu(stall, products, catMap)
    expect(categories.map((c) => c.name)).toContain('Bebidas')
    expect(categories.map((c) => c.name)).toContain('Comidas')
  })

  it('includes image in old format', () => {
    const { products: old } = convertNIP15ToOldMenu(stall, products, catMap)
    expect(old[0]!.image).toBe('https://example.com/agua.jpg')
  })

  it('provides default category when none given', () => {
    const { categories } = convertNIP15ToOldMenu(stall, products)
    expect(categories.length).toBeGreaterThanOrEqual(1)
    expect(categories[0]!.name).toBe('General')
  })
})

describe('downloadJSON', () => {
  it('creates a link element and clicks it', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()

    Object.defineProperty(window, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })

    const mockAnchor = { href: '', download: '', click }
    vi.spyOn(document, 'createElement').mockReturnValueOnce(mockAnchor as unknown as HTMLElement)

    downloadJSON({ hello: 'world' }, 'test.json')

    expect(createObjectURL).toHaveBeenCalled()
    expect(mockAnchor.download).toBe('test.json')
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})

describe('readJSONFile', () => {
  it('resolves with parsed JSON', async () => {
    const json = { name: 'test' }
    const mockFile = new File([JSON.stringify(json)], 'test.json', { type: 'application/json' })

    const result = await readJSONFile<{ name: string }>(mockFile)
    expect(result.name).toBe('test')
  })

  it('rejects on invalid JSON', async () => {
    const mockFile = new File(['not json!!!'], 'bad.json', { type: 'application/json' })
    await expect(readJSONFile(mockFile)).rejects.toThrow('Invalid JSON file')
  })
})
