import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the three contracts and wires them together. Ignition records every step in
 * ignition/deployments/chain-<id>/, so a deploy that fails halfway resumes where it stopped.
 *
 *   MockUSDC         test dollars (6 decimals, EIP-2612 permit, public faucet)
 *   AccountRegistry  handles, custody balances, account close
 *   SlabVault        ERC-721 per physical slab, custody trail, encrypted hand-off to the custodian
 *   TradeEscrow      slabs + cash swaps between two collectors, settled atomically
 *   LostAndFound     escrowed bounties for lost slabs, paid to the finder once the slab is back
 */
export default buildModule("PokechainModule", (m) => {
  // The deployer is also the vault operator: the server key that mints and ships slabs.
  const operator = m.getAccount(0);
  const collector1 = m.getAccount(1);
  const collector2 = m.getAccount(2);

  const usdc = m.contract("MockUSDC");
  const accounts = m.contract("AccountRegistry", [usdc]);
  const slabVault = m.contract("SlabVault", [accounts, operator]);
  m.call(accounts, "setSlabVault", [slabVault]);
  // Collector Crypt's address: forwarded parcel details are encrypted to the key it publishes.
  // Local: Hardhat account #9 (ignition/parameters/local.json). Amoy: set it in amoy.json.
  m.call(slabVault, "setCustodian", [m.getParameter("custodian")]);
  // Offers lock slabs and cash here; both contracts let it move them for agreed trades.
  const tradeEscrow = m.contract("TradeEscrow", [accounts, slabVault]);
  m.call(accounts, "setTradeEscrow", [tradeEscrow]);
  m.call(slabVault, "setTradeEscrow", [tradeEscrow]);

  // Fixed-price listings: SlabMarket settles a sale and is the only other contract SlabVault lets move a slab.
  const slabMarket = m.contract("SlabMarket", [slabVault, usdc, accounts]);
  m.call(accounts, "setSlabMarket", [slabMarket]);
  m.call(slabVault, "setMarketplace", [slabMarket]);

  // Fully funded loan offers lock cash here; accepted loans hold the slab until repayment or default.
  const loanEscrow = m.contract("LoanEscrow", [accounts, slabVault, slabMarket]);
  m.call(accounts, "setLoanEscrow", [loanEscrow]);
  m.call(slabVault, "setLoanEscrow", [loanEscrow]);
  m.call(slabMarket, "setLoanEscrow", [loanEscrow]);

  // Lost-slab bounties are escrowed here; it closes lost reports on SlabVault for a finder's claim.
  const lostAndFound = m.contract("LostAndFound", [accounts, slabVault, operator]);
  m.call(accounts, "setLostAndFound", [lostAndFound]);
  m.call(slabVault, "setLostAndFound", [lostAndFound]);

  // Seed default test USDC balance for Hardhat test collectors (accounts #1 and #2)
  m.call(usdc, "faucet", [BigInt(100_000) * BigInt(1_000_000)], { from: collector1, id: "seed_collector1" });
  m.call(usdc, "faucet", [BigInt(100_000) * BigInt(1_000_000)], { from: collector2, id: "seed_collector2" });

  return { usdc, accounts, slabVault, tradeEscrow, slabMarket, loanEscrow, lostAndFound };
});
