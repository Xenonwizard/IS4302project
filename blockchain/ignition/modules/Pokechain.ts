import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the three contracts and wires them together. Ignition records every step in
 * ignition/deployments/chain-<id>/, so a deploy that fails halfway resumes where it stopped.
 *
 *   MockUSDC         test dollars (6 decimals, EIP-2612 permit, public faucet)
 *   AccountRegistry  handles, custody balances, account close
 *   SlabVault        ERC-721 per physical slab, custody trail, encrypted hand-off to the custodian
 *   TradeEscrow      slabs + cash swaps between two collectors, settled atomically
 */
export default buildModule("PokechainModule", (m) => {
  // The deployer is also the vault operator: the server key that mints and ships slabs.
  const operator = m.getAccount(0);

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

  return { usdc, accounts, slabVault, tradeEscrow };
});
