# Pokechain

A working marketplace web app for **graded Pokémon card slabs** (PSA / CGC / BGS / SGC), built as
a study of [courtyard.io](https://courtyard.io)'s marketplace: physical slabs held in a vault,
ownership mirrored as an ERC-721 token, and **live trade rooms** where collectors bid in chat.

Card data and images are real (from the [Pokémon TCG API](https://pokemontcg.io)); everything
else — owners, grades, asks, bids, sales — is generated dummy data.

**Account and slab onboarding / offboarding run on-chain.** Users sign up with a wallet
(RainbowKit + MetaMask), and their handle is registered in a Solidity `AccountRegistry`. They
deposit and withdraw test USDC (EIP-2612 permit) and can close the account. Slabs are minted as
ERC-721s in `SlabVault` once Collector Crypt (simulated) has vaulted them and its Solana NFT is in
Pokechain's escrow. They can be transferred between collectors. Withdrawn slabs keep their token,
locked, so a lost parcel can be reported and traced across Polygon, Solana and Collector Crypt. See
**[docs/blockchain-onboarding.md](docs/blockchain-onboarding.md)** for the full explanation. Trading
(offers, negotiation rooms) still lives in React context and `localStorage`.

The name lives in one file, [`src/lib/brand.ts`](src/lib/brand.ts).

> Non-commercial school project (IS4302). Pokémon and its card artwork belong to Nintendo,
> Creatures Inc. and GAME FREAK. Card scans are loaded from the Pokémon TCG API image CDN.

## Running it

```bash
npm run setup     # app + blockchain/ dependencies
npm run chain     # terminal 1: local Hardhat chain, deploys the contracts (leave running)
npm run dev       # terminal 2: the app
```

Then open http://localhost:3000 and sign up with **Hardhat test collector #1** (or MetaMask).
`npm run contracts:test` runs the Solidity tests. `docs/postman/` has the Postman collection that
plays Pokechain's warehouse, Collector Crypt and the carrier. Node 20+ is required (Next 16). `./dev.sh` pins the Homebrew
Node build if `npm run dev` complains about the version. The dev server needs internet access to
fetch card images.

```bash
npm run build && npm start   # production build
npx tsc --noEmit             # type check
npm run lint                 # eslint
```

## Routes

| Route | What it does |
| --- | --- |
| `/` | Hero carousel, deal / fresh / grail rails, live trade rooms, browse by era, how-it-works |
| `/marketplace` | 176 slabs, text search, 6 sort modes, filters (era, grade, grader, rarity, set, year, price, FMV, deals), density toggle, load-more, shareable URL state |
| `/asset/[id]` | 3D slab viewer (tilt, turntable spin, card front, card back), buy now, make an offer, live trade room, cart, offers (owners can accept), market value, comps by grader and grade, population report, on-chain details, comments, activity |
| `/trades` | Your trade rooms, rooms live now, and your lost-item reports |
| `/trades/[id]` | Live trade room chat for one slab: bid with cash and/or vault slabs, owner accepts, Report lost |
| `/vault` | Collection, my listings, offers made, orders, watchlist; list for sale, delist, open trade room, request shipping |
| `/checkout`, `/checkout/success` | Cart review, payment method, order receipt with tx hash |
| `/profile/[username]` | Any seller's public collection and activity |
| `/submit` | Slab submission: `requestSubmission` on-chain, then tracked through Pokechain → Collector Crypt → Solana check → mint |
| `/trace/[tokenId]` | One slab's journey across Polygon, Solana and Collector Crypt |
| `/account` | On-chain account record, event history (`eth_getLogs`), close account |

## User flows that work

1. **Sign up** (handle only, or "continue with a wallet"). New users start with a $2,500 balance.
2. **Browse → filter → cart → checkout**: the fee is applied, balance debited, the slab moves into
   your vault and leaves the marketplace.
3. **Buy now** from the asset page, same settlement.
4. **Bid in a live trade room**: other collectors (simulated) chat and outbid each other, sometimes
   adding a slab of their own. Bid with cash, slabs from your vault, or both. The owner counters
   or accepts; on accept the slab lands in your vault and the cash and slabs you bid leave it.
5. **Sell in a trade room**: from a slab you own, open a room. Bids arrive in the chat and
   **Accept bid** settles: the slab leaves your vault and the cash (plus any slabs) comes in.
6. **Report lost**: from any trade room, file a report for a slab you should have received, a
   slab you sent, or a payment. It gets a case id, posts to the room, and is listed on `/trades`.
7. **List from the vault**, **make an offer**, **accept an offer** on a slab you own, and
   **request shipping**.
8. **Reset demo data** in the user menu wipes `localStorage`.

## The 3D slab

`src/components/slab/Slab.tsx` renders the real hi-res card scan inside a CSS 3D slab:

- **Thickness**: seven translucent rims are stacked in `translateZ` behind the face, so the
  acrylic edge shows when the slab turns, and a back face carries the grader's barcode, a
  hologram sticker and a card back.
- **Pointer lighting**: pointer position becomes CSS variables (`--px`, `--py`, `--hyp`) that
  move a specular glare, a reflection streak across the case, and on holo cards a rainbow foil
  layer blended with `color-dodge`. The foil is strongest at steep angles, as with real foil.
- **Weight**: tilt eases toward the pointer through a damped `requestAnimationFrame` loop that
  writes styles directly, so a grid of slabs never re-renders on mouse move.
- **Grader labels**: PSA (white with red frame), CGC (blue, gold for Pristine 10), BGS (silver,
  gold for 9.5, black for 10, with subgrades) and SGC (black tuxedo insert).
- **Contact shadow** that slides opposite the tilt; honours `prefers-reduced-motion`.

## How the data works

| File | Role |
| --- | --- |
| `src/data/pokemon-cards.json` | 176 real cards from the Pokémon TCG API: set, number, rarity, image URLs and the raw TCGplayer market price at build time |
| `src/lib/catalog.ts` | Turns each card into a listing: grader, grade, graded FMV (raw price × era- and grade-based premium), ask, owner, offers, sales, activity |
| `src/lib/trade.ts` | Trade room seeding, bid valuation, and the simulated crowd and owner |
| `src/lib/store.tsx` | Session, cart, vault, orders, offers, trade rooms, settlement, lost-item reports + `localStorage` |
| `src/lib/filters.ts` | Filter model, matching and sorting |
| `src/lib/rng.ts` / `pools.ts` | Seeded PRNG, handles, grade labels, comment and note text |

Generation is seeded, so the server and browser render identical markup. Anything time-relative
is rendered client-side only.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react · `next/image`.

Blockchain: Solidity 0.8.28 · OpenZeppelin 5 · Hardhat 3 + Ignition · viem · wagmi 2 · RainbowKit ·
MetaMask · Polygon (local Hardhat or Amoy) · Solana DAS API (simulated Collector Crypt vault NFTs).

## On-chain

What is on-chain now, and how to demo it: [`docs/blockchain-onboarding.md`](docs/blockchain-onboarding.md).
The wider plan (escrowed trades, indexing, IPFS, attestations): [`docs/blockchain-stack.md`](docs/blockchain-stack.md).
