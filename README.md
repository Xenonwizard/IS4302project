# Slabyard

A fully working marketplace web app for **graded trading-card slabs** (PSA / CGC / BGS / SGC),
built as a study of [courtyard.io](https://courtyard.io)'s marketplace: physical cards held in a
vault, ownership mirrored as an ERC-721 token, packs that pay out a real slab.

Everything runs on generated dummy data — no backend, no API keys, no wallet needed. All state
(login, cart, vault, orders, offers, watchlist) is held in React context and persisted to
`localStorage`, so flows behave like the real thing across reloads.

The name lives in one file, [`src/lib/brand.ts`](src/lib/brand.ts) — change `BRAND.name` and it
propagates everywhere.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Node 20+ is required (Next 16).

> On this machine `nvm` defaults to Node 18, which Next 16 rejects. `./dev.sh` pins the Homebrew
> Node 25 build if `npm run dev` complains about the version.

```bash
npm run build && npm start   # production build
npx tsc --noEmit             # type check
npm run lint                 # eslint
```

## Routes

| Route | What it does |
| --- | --- |
| `/` | Hero carousel, live "just pulled" feed, deal / fresh / grail rails, category tiles, how-it-works |
| `/marketplace` | 168-listing grid, text search, 6 sort modes, 10 filter groups, density toggle, page size, load-more, shareable URL state |
| `/asset/[id]` | Slab viewer (rotate, card front, card back), buy now, make offer, propose trade, add to cart, top offers, market value + confidence, comparable sales by grader **and** grade, population report, on-chain details, comments, activity history |
| `/packs` | Pack catalogue grouped into Limited / Pokémon / Sports / One Piece / Wildcard |
| `/packs/[slug]` | Rip flow with published odds, animated reveal, instant relist, session pull history |
| `/events/[slug]` | Live event page: countdown, rules, pool preview, rewards, event leaders |
| `/leaderboard` | Monthly podium, current vs previous month, your rank, points rules |
| `/vault` | Collection, my listings, offers made, orders, watchlist; list for sale, delist, request shipping |
| `/checkout`, `/checkout/success` | Cart review, payment method, vault-or-ship delivery, order receipt with tx hash |
| `/profile/[username]` | Any seller's public collection and activity |
| `/submit` | "Submit my collectibles" intake with a three-step explainer |

## User flows that actually work

1. **Sign up** (handle only, or "continue with a wallet") → session persists.
2. **Browse → filter → add to cart → checkout** → fee is applied, balance is debited, points are
   awarded, the slab moves into your vault and disappears from the marketplace.
3. **Buy now** from the asset page → same settlement, with a modal that shows the tx hash.
4. **Rip a pack** → weighted roll against published odds → reveal → keep or relist in one click.
5. **List from the vault** → the slab reappears on the marketplace at your ask price.
6. **Make an offer** → tracked under Vault → Offers made, and shown on the listing.
7. **Propose a trade** → pick slabs from your vault plus a cash adjustment, see the value gap.
8. **Request shipping** → the vault entry switches to "Shipping requested".
9. **Reset demo data** in the user menu wipes `localStorage` and restores the pristine catalogue.

## How the fake data works

| File | Role |
| --- | --- |
| `src/lib/rng.ts` | `mulberry32` PRNG + string hashing, so every value is deterministic |
| `src/lib/pools.ts` | Source material: sets with card counts, subjects, brands and players **with the years they were actually printed**, grade labels per grader, handles, notes |
| `src/lib/catalog.ts` | Builds 168 listings, packs, events, leaderboards, comparable sales, population reports and the weighted pack roll |
| `src/lib/store.tsx` | Session, cart, vault, orders, offers, watchlist, toasts + `localStorage` persistence |
| `src/lib/filters.ts` | Filter model, matching and sorting |

Because generation is seeded, the server and the browser render identical markup — no hydration
mismatches. Anything time-relative (`TimeAgo`, `Countdown`) is rendered client-side only.

Era rules keep the data plausible: Shadowless and 1st Edition only appear on pre-2004 Pokémon,
Silver Prizm only on Panini Prizm, Refractors only on Chrome, a Rookie Card only inside a player's
first two seasons, and foil treatments never land on 1993 Magic cards.

## Card artwork

There are no image assets. `src/components/slab/Slab.tsx` draws the graded case, the grader's label
(each of PSA / CGC / BGS / SGC has its own colours and wordmark), the barcode and the cert number,
and `CardArt.tsx` draws the card face procedurally — frame style per category, seeded rays, blobs,
a holo sweep and one of four creature silhouettes. Everything scales with CSS container query
units (`cqw`), so the same component is legible at 40px and at 400px.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react. No other runtime
dependencies.

## Next step: putting it on a chain

See [`docs/blockchain-stack.md`](docs/blockchain-stack.md) for the recommended free/open-source
toolchain and how each piece maps onto the flows above.

---

Dummy data throughout. Listings, prices, users, sales, certs and transaction hashes are generated,
not real.
