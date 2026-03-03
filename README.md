# ⚡ Lightning POS

**Bitcoin Lightning Point of Sale powered by Nostr**

A mobile-first, open-source POS terminal for merchants who accept Bitcoin Lightning payments. Built on Nostr marketplace standards (NIP-15) with real-time payment confirmation via zaps (NIP-57).

> Built by [La Crypta](https://lacrypta.ar) — *Fix the money, fix the world.*

---

## Features

- **⚡ Lightning Payments** — Generate invoices via LNURL, confirm via zap receipts (NIP-57)
- **🛒 Dynamic Menus** — Products pulled live from Nostr marketplace events (NIP-15)
- **💱 Multi-Currency** — SAT, ARS, USD with real-time exchange rates (yadio.io)
- **📱 NFC Payments** — Web NFC API + Android bridge for LaWallet card payments
- **🔧 Admin Panel** — Manage stalls and products without leaving the app
- **📊 Sales History** — Track orders and payment receipts
- **📲 PWA Ready** — Installable as a native app on mobile devices
- **🔑 Nostr-native** — NIP-07 browser extension or ephemeral key signing

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | [Next.js 15](https://nextjs.org) (App Router) |
| UI Components | [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://radix-ui.com) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Nostr | [NDK](https://github.com/nostr-dev-kit/ndk) (Nostr Dev Kit) |
| State | [Zustand](https://zustand-demo.pmnd.rs) |
| Payments | LNURL + NIP-57 zaps |
| Rates | [yadio.io](https://yadio.io) API |

---

## Quick Start

```bash
git clone https://github.com/lacrypta/lightning-pos.git
cd lightning-pos
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and configure your Lightning Address in Settings.

---

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
# Nostr relay (default: wss://relay.lacrypta.ar)
NEXT_PUBLIC_RELAY_URL=wss://relay.lacrypta.ar

# Additional relays (comma-separated)
NEXT_PUBLIC_EXTRA_RELAYS=wss://relay.damus.io,wss://nostr-pub.wellorder.net

# Currency API (default: https://api.yadio.io)
NEXT_PUBLIC_CURRENCY_API=https://api.yadio.io

# LaWallet API (for NFC payments)
NEXT_PUBLIC_LAWALLET_API=https://api.lawallet.ar

# Default currency: SAT | ARS | USD
NEXT_PUBLIC_DEFAULT_CURRENCY=SAT
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full deployment configuration.

---

## Architecture

```
src/
├── app/                 # Next.js App Router pages
│   ├── pos/             # POS terminal (numpad + menu mode)
│   ├── admin/           # Admin panel (stalls, products, sales)
│   ├── settings/        # Merchant settings
│   └── api/             # API routes (rates, invoice, lnurl, nip05)
├── components/
│   ├── pos/             # POS-specific UI (ProductCard, CategoryFilter, Cart)
│   └── shared/          # Shared components (Navbar, CurrencySelector)
├── lib/
│   ├── nostr/           # Nostr helpers (marketplace parsing, zap requests)
│   ├── lnurl/           # LNURL resolution and invoice generation
│   ├── currency/        # Exchange rate fetching
│   └── nfc/             # NFC payment handlers (web + android)
├── stores/              # Zustand state (pos, settings, nostr, currency, nfc)
├── hooks/               # React hooks (useStall, useProducts, useCurrency, etc.)
├── types/               # TypeScript types
└── config/              # App constants and defaults
```

### Payment Flow

```
1. Merchant sets Lightning Address in Settings
2. Customer selects products (menu mode) or enters amount (numpad mode)
3. App resolves LNURL → fetches invoice from LNURL callback
4. QR code displayed with bolt11 invoice
5. App subscribes to Nostr relay for zap receipt (kind:9735)
6. Payment confirmed → success screen
```

---

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
npm test         # Vitest unit tests
```

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on:
- Vercel (recommended)
- Self-hosting with Node.js or Bun
- Custom domain setup

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes (tests welcome!)
4. Open a PR with a clear description

Please keep PRs focused. Read [SPEC.md](./SPEC.md) for the full design specification.

---

## License

MIT © [La Crypta](https://lacrypta.ar)

---

## Credits

- **[La Crypta](https://lacrypta.ar)** — Argentina's largest Bitcoin community
- **[LaWallet](https://lawallet.ar)** — Lightning wallet infrastructure
- Built on the shoulders of [lawalletio/mobile-pos](https://github.com/lawalletio/mobile-pos)
- Powered by [Nostr](https://nostr.com) NIP-15 marketplace protocol
