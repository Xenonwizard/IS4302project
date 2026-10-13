# Making it real: the free / open-source blockchain stack

The demo fakes several things that a chain can actually do. This is the shortest credible path from
the current app to something you can defend in a viva, using only free tiers and OSS.

| Faked today | What replaces it |
| --- | --- |
| `listing.tokenId` / `contract` | An ERC-721 `SlabVault` contract, one token per physical slab |
| Buy now / offers | Seaport orders, or your own escrow contract |
| Trade room bids and settlement | An escrow contract that holds bid cash and slabs until the owner accepts |
| Lost-item reports | An on-chain dispute record checked against custody attestations |
| Marketplace queries | Ponder or a Graph subgraph indexing your events |
| Card metadata | IPFS (Pinata / web3.storage) pinned JSON + images |
| Grading certificate | An EAS attestation signed by the vault operator |

## 1. Contracts — Foundry (+ OpenZeppelin)

**Foundry** (`forge`, `cast`, `anvil`) is the fastest OSS toolchain and its fuzz testing is what
will earn marks on a module like IS4302.

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge init contracts && cd contracts
forge install OpenZeppelin/openzeppelin-contracts
anvil                      # local chain, 10 funded accounts
forge test -vvv --gas-report
```

Use **OpenZeppelin Contracts** for `ERC721`, `ERC2981` (royalties), `AccessControl` and
`ReentrancyGuard` — never hand-roll these. Hardhat 3 is the reasonable alternative if you prefer
writing tests in TypeScript.

Three contracts cover the whole app:

1. `SlabVault` — `ERC721` + `ERC2981`. `mintSlab(to, certHash, tokenURI)` is called when a
   submission is verified; `requestRedemption(tokenId)` burns (or locks) the token and emits
   `RedemptionRequested`, which is your "ship it to me" flow.
2. `SlabMarket` — listings, offers and trades. Escrow the token (or use an approval-based pull
   pattern), settle in USDC, take a 2% fee, emit `Listed` / `Sold` / `OfferMade` / `TradeExecuted`.
3. `TradeEscrow` — backs the live trade rooms. `placeBid(tokenId, cash, slabIds)` escrows
   the bidder's USDC and slab tokens; `acceptBid(bidId)` (owner only) swaps everything atomically
   and refunds every other bidder; `withdrawBid(bidId)` returns escrow before acceptance. Emits
   `BidPlaced` / `TradeSettled`. The chat itself stays off-chain; only bids touch the contract.

## 2. Lost-item disputes

A trade can settle on-chain while the physical slab goes missing in the vault or in transit. The
Report lost flow maps onto:

- `openDispute(tradeId, item, evidenceHash)` — records the claim on-chain and can freeze the
  token (block transfers) until resolved.
- Custody **EAS attestations** (section 8) — the vault attests each check-in and check-out, so a
  dispute is resolved by comparing the attestation trail with the `TradeSettled` event.
- `resolveDispute(id, outcome)` from the operator Safe — refunds from escrow or insurance, or
  releases the freeze.

## 3. Orders — Seaport, or your own escrow

**Seaport** (OpenSea's protocol, MIT licensed) gives you signed off-chain orders with on-chain
settlement: listings cost the seller nothing to create, and offers/trades ("criteria" and
multi-item orders) come for free. It is heavier to learn than a 200-line escrow contract — for a
course project, write the escrow yourself and cite Seaport as the production choice.

**Reservoir** is a free aggregation/indexing API on top of Seaport if you want order books without
running infrastructure.

## 4. Chain and money — Polygon Amoy testnet

Match the demo (`BRAND.chain = "Polygon"`): cheap, EVM-identical, and the free faucet is reliable.
Use Circle's testnet **USDC** so prices stay in dollars like the UI shows. Add **Permit2** or
EIP-2612 `permit` so a purchase is one signature instead of approve-then-buy.

For gasless UX, **account abstraction** (ERC-4337) with **Pimlico** or **ZeroDev** has a free tier
and a paymaster that sponsors gas — that is how you deliver the "gasless settlement" the checkout
screen promises.

## 5. Wallet and reads — viem + wagmi + RainbowKit

```bash
npm i viem wagmi @tanstack/react-query @rainbow-me/rainbowkit
```

- **viem** — typed RPC client; replaces ethers.js.
- **wagmi** — React hooks (`useReadContract`, `useWriteContract`, `useWaitForTransactionReceipt`).
- **RainbowKit** or **ConnectKit** — the connect-wallet modal; drops straight into `AuthModal`.
- `wagmi generate` reads your Foundry artifacts and emits fully typed hooks, so the contract ABI
  and the React code cannot drift apart.

## 6. Indexing — Ponder (or The Graph)

Do not query the chain directly for a 176-item grid with ten filter groups; index events into
Postgres and query that.

- **Ponder** — OSS, TypeScript, runs locally, defines schema + event handlers in the same language
  as this app. The easiest fit here.
- **The Graph** — subgraphs in AssemblyScript, free hosted service for testnets, the more
  recognisable name in a report.

Either one gives `/marketplace` a real API: listings, sales history (your `salesFor()` comparables
become genuine `Sold` events) and per-user vault contents.

## 7. Metadata and files — IPFS

Pin the card image and the metadata JSON (name, grader, grade, cert number, set, year) with
**Pinata** or **web3.storage** free tiers, and set `tokenURI` to `ipfs://<cid>`. **Helia** is the
JS IPFS client if you want to pin from a script. Keep the cert-number hash in the metadata so the
"Verify certification" button can check the on-chain hash against the grader's public registry.

## 8. Custody and attestations

- **Safe** (multisig) as the vault operator address — a single hot key holding every collector's
  slab is the obvious criticism of this business model, and a 2-of-3 Safe is the answer.
- **EAS (Ethereum Attestation Service)** — attest "cert #605965812 was physically verified by the
  vault on date X". Free, OSS, and it turns your authenticity guarantee into something checkable.

## 9. Testing, security, observability

| Tool | Use |
| --- | --- |
| `forge test` / `forge fuzz` / `forge coverage` | Unit, fuzz and invariant tests |
| **Slither** | Static analysis, catches the classic reentrancy / access-control bugs |
| **Mythril** or **Echidna** | Symbolic execution / property-based fuzzing if you want depth |
| **Tenderly** (free tier) | Transaction simulation and debugging traces |
| **Blockscout** | Self-hostable OSS explorer; link tx hashes from the UI to it |
| **Anvil** forking | `anvil --fork-url <amoy-rpc>` to test against real state |

## 10. Suggested order of work

1. `SlabVault` (ERC-721) + Foundry tests + deploy to Anvil.
2. Swap `src/lib/store.tsx` writes for wagmi writes behind the same function names
   (`buyNow`, `makeOffer`, `listFromVault`, `placeBid`, `settleTrade`) — the UI does not need to change.
3. `SlabMarket` escrow, then wire `/checkout` and the offer modal to it.
4. `TradeEscrow`, then wire `/trades/[id]` bids and accepts to it.
5. Ponder indexer, then replace the static catalogue import in `/marketplace`.
6. IPFS metadata + EAS attestations, then make "Verify certification" and lost-item disputes real.

Steps 1–2 alone are a defensible project; the rest is upside.
