@AGENTS.md

# Pokechain (IS4302)

Marketplace for graded Pokémon card slabs: Next.js 16 app in `src/`, Hardhat 3 contracts in
`blockchain/` (AccountRegistry, SlabVault, TradeEscrow). The README explains the flows;
`docs/blockchain-onboarding.md` explains the on-chain design.

## Start it

Node 22.13+ is required (`.nvmrc` pins 24, and `dev.sh` puts Homebrew Node first on PATH).

```bash
npm run setup     # after every pull: installs the app and blockchain/ dependencies
npm run dev:all   # chain on :8545 + app on :3000 in one terminal
```

In the desktop app, start `pokechain-chain` and then `slabyard-dev` from `.claude/launch.json` with
the browser pane instead of running them from Bash. The app needs the chain: if pages show a yellow
"chain and checkout disagree" banner or contract calls fail, the chain isn't running or is stale.
Leave the chain running across `git pull`; it redeploys and reseeds itself when contracts change.

- Log in as **test1 wallet** (@test1) or **test2 wallet** (@test2) without MetaMask. @ash,
  @misty and @brock own the other seeded slabs.
- Intake demo: `/intake` in a second tab, or the curl commands in the README.

## Tests

```bash
npm run test:smoke:quick   # Playwright, stops at the first failure: use this while iterating
npm run test:smoke         # full run before calling it done
npm run test:unit
npm run contracts:test     # Hardhat tests in blockchain/
```

Run only the specs a change touches while iterating (`npx playwright test tests/smoke/<file>`).
Run the full suite once at the end.

## Definition of done

Don't call a change done until all of these are true:

1. **Clicked through in the browser.** Start the dev server (`.claude/launch.json`), then for every role the
   change touches, do the main flow like a user would. Reload to check the data stayed.
2. **Clean console and server logs.** No errors, no duplicate-key warnings, no 4xx/5xx responses you didn't
   expect.
3. **Smoke tests pass:** `npm run test:smoke`. Add or extend a test for every new flow.
4. **The reply says** what changed, how to run it, how to test it, and what wasn't verified.
