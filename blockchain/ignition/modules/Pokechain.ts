import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the three contracts and wires them together. Ignition records every step in
 * ignition/deployments/chain-<id>/, so a deploy that fails halfway resumes where it stopped.
 *
 *   MockUSDC         test dollars (6 decimals, EIP-2612 permit, public faucet)
 *   AccountRegistry  handles, custody balances, account close
 *   SlabVault        ERC-721 per physical slab, custody trail
 */
export default buildModule("PokechainModule", (m) => {
  // The deployer is also the vault operator: the server key that mints and ships slabs.
  const operator = m.getAccount(0);
  const collector1 = m.getAccount(1);
  const collector2 = m.getAccount(2);

  const usdc = m.contract("MockUSDC");
  const accounts = m.contract("AccountRegistry", [usdc]);
  const slabVault = m.contract("SlabVault", [accounts, operator]);
  const slabMarket = m.contract("SlabMarket", [slabVault, usdc, accounts]);

  m.call(accounts, "setSlabVault", [slabVault]);
  m.call(slabVault, "setMarketplace", [slabMarket]);

  // Seed default test USDC balance for Hardhat test collectors (accounts #1 and #2)
  m.call(usdc, "faucet", [BigInt(100_000) * BigInt(1_000_000)], { from: collector1, id: "seed_collector1" });
  m.call(usdc, "faucet", [BigInt(100_000) * BigInt(1_000_000)], { from: collector2, id: "seed_collector2" });

  return { usdc, accounts, slabVault, slabMarket };
});
