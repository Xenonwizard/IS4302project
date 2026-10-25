# Pokechain

A working marketplace web app for **graded Pokémon card slabs** (PSA / CGC / BGS / SGC), built as
a study of [courtyard.io](https://courtyard.io)'s marketplace: physical slabs held in a vault,
ownership mirrored as an ERC-721 token, and **live trade rooms** where collectors bid in chat.

Card data and images are real (from the [Pokémon TCG API](https://pokemontcg.io)); everything
else — owners, grades, asks, bids, sales — is generated dummy data.

**Account and slab onboarding / offboarding run on-chain.** Users sign up with a wallet
(RainbowKit + MetaMask), and their handle is registered in a Solidity `AccountRegistry`. They
deposit and withdraw test USDC (EIP-2612 permit) and can close the account. A slab's ERC-721 in
`SlabVault` is **minted the moment it is submitted**, pending and locked, so a parcel lost in the post
is already a token that can be reported. It unlocks once Collector Crypt (simulated) has vaulted the
slab and its Solana NFT is in Pokechain's escrow. Collectors then **trade slabs and cash both ways**
in `TradeEscrow` ("3 Pikachus + $50 for your 2 Articunos"). The offer is made **inside a chat** while the two
talk, weighed with each slab's market value or its owner's stated value, locked in escrow, and settled in
one transaction, or not at all. Withdrawn slabs keep their token, locked, for tracing across
Polygon, Solana and Collector Crypt. See **[docs/blockchain-onboarding.md](docs/blockchain-onboarding.md)**
for the full explanation. Offers on the simulated catalogue sellers still live in `localStorage`.

The name lives in one file, [`src/lib/brand.ts`](src/lib/brand.ts).

> Non-commercial school project (IS4302). Pokémon and its card artwork belong to Nintendo,
> Creatures Inc. and GAME FREAK. Card scans are loaded from the Pokémon TCG API image CDN.

## Running it

**Requires Node.js 22.13 or newer** (Hardhat 3 needs it; check with `node -v`). Works on macOS,
Windows and Linux. With nvm, run `nvm use` in the project folder: `.nvmrc` picks Node 24.

```bash
npm run setup     # once, and again after pulling: installs the app and blockchain/ dependencies
npm run dev:all   # local blockchain + the app together in one terminal
```

Or run them in separate terminals:

```bash
npm run chain     # terminal 1: local blockchain + deploys the contracts. Leave it running.
npm run dev       # terminal 2: the app
```

`npm run chain` deploys the contracts and then **seeds a demo** (`blockchain/scripts/seed.mjs`): five
accounts with vaulted slabs, 10 of them listed on the marketplace. Hardhat test collector **#1 is @test1**
and **#2 is @test2** (the ones you can log in as, no MetaMask needed); @ash, @misty and @brock own the rest.

To try a trade: open http://localhost:3000 → **Log in** → **Connect wallet** → **Hardhat test collector
#1** → **Negotiation rooms** → **Chat** next to **@test2** → type a message → **Make a trade offer**. Pick
slabs from both vaults, add cash, and choose for each slab whether it counts at its **market** or
**stated** value; the balance panel shows who comes out ahead. Then sign out, log in with #2, open the
chat, and **Accept**, **Counter** or **Decline**. (Cash in a trade comes from your Pokechain account:
deposit some in **Wallet** first. A slab you have listed for sale can't go into an offer until you
cancel the listing.)

**Chain log** (bottom left) → **Reset chain + demo data** puts the seeded demo back. To sign up a new
account instead, use MetaMask or reset to an empty chain with `curl -X POST "localhost:3000/api/dev/reset?clean=1"`.
`docs/postman/` has the Postman collection that plays Pokechain's warehouse, Collector Crypt and the
carrier. The dev server needs internet access to fetch card images. (`./dev.sh` is a macOS helper that
pins Homebrew's Node; you don't need it.)

Tests:

```bash
npm run contracts:test
```
```bash
npm run test:unit
```
```bash
npm run test:smoke
```

`contracts:test` runs the Solidity unit and fuzz tests (68, including trade cash conservation);
`test:unit` checks the encryption round-trip; `test:smoke` clicks through each role in Chrome, including
a lost parcel and two-browser trades in a chat (it starts the chain and the app if they aren't running,
and resets to an empty chain first, except the seeded-demo test). `test:unit` also checks the trade balance maths.

### Who uses it

| Role | Sees | Can do |
| --- | --- | --- |
| **Collector** (wallet account) | Home, Marketplace, Vault, Negotiation rooms, Wallet, Account, Submit | Open/close an account, deposit/withdraw USDC, submit slabs with photos (NFT minted at once), report a parcel lost on the way in or out, trade slabs + cash with another collector in a chat (offer, accept, counter, decline, withdraw; each slab counted at market or stated value), transfer, withdraw a slab, trace it |
| **Pokechain operator** (server key, simulated warehouse) | The submission tracker buttons, Postman | Receive a slab, forward it to Collector Crypt (encrypted), confirm it vaulted, ship redemptions, close lost reports. No power over trades |
| **Collector Crypt** (simulated custodian) | **/collector-crypt** | Publish its encryption key, read incoming parcels by decrypting them, vault slabs (Postman) |
| **Anyone** | **/trace/[tokenId]**, the chain itself | Verify a slab's history, evidence and custody without trusting Pokechain |

### Real vs simulated

**Real:** the Solidity contracts on a real EVM chain (local Hardhat, or Polygon Amoy), wallet
signatures, EIP-2612 permits, every on-chain read and event, the keccak256 evidence and commitments,
and the X25519 + XChaCha20-Poly1305 encryption.
Trades between collectors are real too: `TradeEscrow` holds the offer and swaps both sides on-chain. The stated
value of a slab is on-chain (`declaredValueCents`); the **market value** is the marketplace's estimate for the
card and grade (seeded from the Pokémon TCG price data, not a live feed), and the balance maths is off-chain, in
the browser: the contract moves whatever the offer names.
**Simulated (labelled in the UI):** Collector Crypt's API and Solana NFTs (mock routes with the real
Solana DAS request shapes), the carrier (including "parcel found"), Pokechain's warehouse actions (the
operator buttons), the seeded demo accounts and slabs (`seedSlab`, operator-only), and the Hardhat test wallets that stand in for MetaMask locally.

### Can't sign up or log in?

| What you see | Cause | Fix |
| --- | --- | --- |
| Page loads but **nothing responds**: *Log in* / *Sign up* do nothing, no banner, and the address bar shows an IP like `192.168.x.x:3000` | The dev server only serves its JavaScript to `localhost`; and the blockchain is looked up on *your own* computer at `127.0.0.1:8545` | Run `npm run chain` and `npm run dev` on your own computer and open **http://localhost:3000** (not someone else's IP) |
| Yellow banner: *"The local blockchain isn't running"*; Open account is greyed out | `npm run chain` isn't running, or it exited | Start it in a second terminal and leave it open. If it exits, read its error (usually the Node version) |
| `npm run chain` says *needs Node.js 22.13 or newer* | Node 20 or older | Install Node 22 LTS (`nvm install 22`), then `npm run setup` again |
| *Pokechain needs Node.js 22.13 or newer*, or `SyntaxError: Unexpected token import` / `?` | The terminal is on a very old Node (nvm's default, e.g. 8.17) | `nvm use` in the project folder (or `nvm alias default 24` once, so every new terminal starts on Node 24) |
| `npm run chain` says *Cannot find module* / *hardhat: not found* | `blockchain/` dependencies not installed | `npm run setup` |
| *Something is already listening on 8545* | An old chain is still running | Close the other terminal (or the process on port 8545) and run `npm run chain` again |
| Signed in on an old session, odd balances, or slabs that don't exist | Browser data from an earlier chain | Chain log panel → **Reset chain + demo data**, or use a private window |
| You can't **Sign up** with collector #1 or #2 (*already has an active account*) | The seeded demo already opened them as **@test1** / **@test2** | Use **Log in** instead, or reset to an empty chain: `curl -X POST "localhost:3000/api/dev/reset?clean=1"` |
| A trade offer won't send: *"isn't in the vault"* or *"isn't owned by that collector"* | The slab is still pending, withdrawn, or locked in another open offer | Pick another slab, or withdraw the other offer in its chat first |
| One of *your* slabs is greyed out in the trade builder: *"Listed for sale"* | A slab listed on the marketplace can't be locked in an offer | Cancel the listing in the Vault first (their listed slabs can still be asked for) |
| MetaMask: wrong network, or transactions stuck | MetaMask isn't on the local chain, or remembers an old one | Use **Hardhat test collector #1**; or in MetaMask approve *Add network* (127.0.0.1:8545, chain 31337) and Settings → Advanced → **Clear activity tab data** |
| Account page shows nothing after `git pull` | The contracts changed | Stop `npm run chain`, run `npm run setup`, start `npm run chain` again, then reset demo data |

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
| `/trades` | Collectors to chat with, your chats, and your lost-item reports |
| `/trades/[id]` | A chat about one slab. With a collector: messages plus multi-slab trade offers (TradeEscrow) with the market / stated balance. With a (simulated) catalogue seller: bid with cash and/or vault slabs, Report lost |
| `/vault` | Collection, my listings, offers made, orders, watchlist; list for sale, delist, open trade room, request shipping |
| `/checkout`, `/checkout/success` | Cart review, payment method, order receipt with tx hash |
| `/profile/[username]` | Any seller's public collection and activity |
| `/submit` | Slab submission: `requestSubmission` mints the NFT (pending, locked), then it is tracked through Pokechain → Collector Crypt → Solana check → `confirmVaulted` |
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
9. **Trade on-chain with another collector, in a chat** (Negotiation rooms → **Chat** with a collector, or
   **Make an offer** on a slab a collector has listed): chat, then **Make a trade offer** with slabs and
   cash on both sides. Each slab counts at its **market value** (the marketplace estimate for that card and
   grade) or its **stated value** (what its owner declared at submission, recorded on-chain). The balance
   shows what you give, what you get, who is ahead and by how much, and the same trade at all-market and
   all-stated values; slabs whose stated value is over 20% off market are flagged. Only you see your
   balance. The offer is locked in `TradeEscrow` and the other collector accepts, counters or declines in
   the chat; both Vaults and balances update from the chain. Their slab that is listed for sale is
   delisted (its own transaction) when they accept.

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
| `src/lib/negotiation.ts` | Chat offers and the simulated catalogue buyer or seller |
| `src/lib/valuation.ts` | The trade balance: market vs stated value per slab, who is ahead, the verdict (unit-tested) |
| `src/lib/chain/slabValue.ts` | Market value of a tokenised slab (from its cert, same estimate as the submit form) and the chat's anchor listing |
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
