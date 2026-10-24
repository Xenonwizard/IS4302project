/**
 * Seeds the local blockchain with realistic accounts, vaulted slabs, and marketplace listings.
 * Run automatically during deployment so the chain is fully populated without relying on browser storage.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  keccak256,
  toBytes,
} from "viem";
import { hardhat } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";

const dir = join(root, "ignition", "deployments", "chain-31337");
const addresses = JSON.parse(readFileSync(join(dir, "deployed_addresses.json"), "utf8"));

const mockUSDCAddress = addresses["PokechainModule#MockUSDC"];
const accountRegistryAddress = addresses["PokechainModule#AccountRegistry"];
const slabVaultAddress = addresses["PokechainModule#SlabVault"];
const slabMarketAddress = addresses["PokechainModule#SlabMarket"];

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(RPC),
});

function getWallet(accountAddress) {
  return createWalletClient({
    account: accountAddress,
    chain: hardhat,
    transport: http(RPC),
  });
}

const OPERATOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TEST1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ASH = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const MISTY = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const BROCK = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";

const ACCOUNTS = [
  { address: TEST1, handle: "test1" },
  { address: TEST2, handle: "test2" },
  { address: ASH, handle: "ash" },
  { address: MISTY, handle: "misty" },
  { address: BROCK, handle: "brock" },
];

const SEED_SLABS = [
  {
    recipient: TEST1,
    grader: "PSA",
    certNumber: "11111111",
    title: "2006 Pokémon Crystal Guardians #99/100 Alakazam ★ - Holo Star (PSA 9.5 MINT+)",
    image: "https://images.pokemontcg.io/ex14/99_hires.png",
    custodianRef: "SolanaMintAlakazamStar99",
    declaredValueCents: 324400,
    listPriceUsdc: 3244, // Listed
  },
  {
    recipient: TEST1,
    grader: "PSA",
    certNumber: "22222222",
    title: "1999 Pokémon Base #4/102 Charizard - Holo (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/base1/4_hires.png",
    custodianRef: "SolanaMintCharizardBase4",
    declaredValueCents: 450000,
    listPriceUsdc: 0, // Unlisted in test1's vault
  },
  {
    recipient: TEST2,
    grader: "PSA",
    certNumber: "33333333",
    title: "2004 Pokémon Team Rocket Returns #15/109 Dark Dragonite (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/ex7/15_hires.png",
    custodianRef: "SolanaMintDarkDragonite15",
    declaredValueCents: 115000,
    listPriceUsdc: 1150, // Listed
  },
  {
    recipient: TEST2,
    grader: "PSA",
    certNumber: "44444444",
    title: "2002 Pokémon Neo Destiny #106/105 Shining Celebi (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/neo4/106_hires.png",
    custodianRef: "SolanaMintShiningCelebi106",
    declaredValueCents: 180000,
    listPriceUsdc: 0, // Unlisted in test2's vault
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "55555555",
    title: "2003 Pokémon Skyridge #146/144 Charizard - Rare Secret (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/ecard3/146_hires.png",
    custodianRef: "SolanaMintCharizardSkyridge146",
    declaredValueCents: 850000,
    listPriceUsdc: 8500, // Listed
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "66666666",
    title: "2011 Pokémon Call of Legends #20/95 Rayquaza - Holo (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/col1/20_hires.png",
    custodianRef: "SolanaMintRayquazaCol20",
    declaredValueCents: 220000,
    listPriceUsdc: 2200, // Listed
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "77777777",
    title: "2007 Pokémon Power Keepers #102/108 Vaporeon ★ - Holo Star (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/ex16/102_hires.png",
    custodianRef: "SolanaMintVaporeonStar102",
    declaredValueCents: 140000,
    listPriceUsdc: 1400, // Listed
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "88888888",
    title: "2003 Pokémon Skyridge #11/144 Gyarados (PSA 9.5 MINT+)",
    image: "https://images.pokemontcg.io/ecard3/11_hires.png",
    custodianRef: "SolanaMintGyaradosSkyridge11",
    declaredValueCents: 195000,
    listPriceUsdc: 1950, // Listed
  },
  {
    recipient: BROCK,
    grader: "BGS",
    certNumber: "99999999",
    title: "2007 Pokémon Power Keepers #101/108 Jolteon ★ - Holo Star (BGS 10 PRISTINE)",
    image: "https://images.pokemontcg.io/ex16/101_hires.png",
    custodianRef: "SolanaMintJolteonStar101",
    declaredValueCents: 520000,
    listPriceUsdc: 5200, // Listed
  },
  {
    recipient: BROCK,
    grader: "PSA",
    certNumber: "10101010",
    title: "2004 Pokémon Team Rocket Returns #106/109 Rocket's Zapdos ex (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/ex7/106_hires.png",
    custodianRef: "SolanaMintZapdosEx106",
    declaredValueCents: 345000,
    listPriceUsdc: 3450, // Listed
  },
  {
    recipient: BROCK,
    grader: "CGC",
    certNumber: "12121212",
    title: "2000 Pokémon Neo Genesis #9/111 Lugia - Holo (CGC 10 PRISTINE)",
    image: "https://images.pokemontcg.io/neo1/9_hires.png",
    custodianRef: "SolanaMintLugiaNeo9",
    declaredValueCents: 1450000,
    listPriceUsdc: 14500, // Listed
  },
  {
    recipient: BROCK,
    grader: "PSA",
    certNumber: "13131313",
    title: "2025 Pokémon Prismatic Evolutions #161/131 Umbreon ex (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    custodianRef: "SolanaMintUmbreonEx161",
    declaredValueCents: 280000,
    listPriceUsdc: 2800, // Listed
  },
];

async function seed() {
  console.log("\n🌱 Seeding on-chain demo accounts, vaulted slabs, and marketplace listings...");

  const registryAbi = parseAbi([
    "function register(string handle) external",
    "function isActive(address account) external view returns (bool)",
    "function accountOf(address account) external view returns ((string handle, uint8 status, uint256 registeredAt, uint256 closedAt, uint256 custodyBalance))",
  ]);

  const usdcAbi = parseAbi([
    "function faucet(uint256 amount) external",
    "function balanceOf(address account) external view returns (uint256)",
  ]);

  const vaultAbi = parseAbi([
    "struct SeedParams { address recipient; string grader; string certNumber; string title; string image; string custodianRef; uint64 declaredValueCents; bytes32 evidenceHash; }",
    "function seedSlab(SeedParams calldata p) external returns (uint256 tokenId)",
    "function tokenOfCert(bytes32 key) external view returns (uint256)",
    "function certKey(string grader, string certNumber) external pure returns (bytes32)",
    "function nextTokenId() external view returns (uint256)",
  ]);

  const marketAbi = parseAbi([
    "function list(uint256 tokenId, uint256 price) external",
    "function isListed(uint256 tokenId) external view returns (bool)",
    "function getActiveListings() external view returns ((uint256 tokenId, address seller, string sellerHandle, uint256 price, uint64 listedAt, string grader, string certNumber, string title, string image)[])",
  ]);

  // 1. Register Accounts & grant test USDC
  for (const acct of ACCOUNTS) {
    const active = await publicClient.readContract({
      address: accountRegistryAddress,
      abi: registryAbi,
      functionName: "isActive",
      args: [acct.address],
    });

    if (!active) {
      const wallet = getWallet(acct.address);
      const hash = await wallet.writeContract({
        address: accountRegistryAddress,
        abi: registryAbi,
        functionName: "register",
        args: [acct.handle],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ Registered account @${acct.handle} (${acct.address.slice(0, 8)}…)`);
    }

    const bal = await publicClient.readContract({
      address: mockUSDCAddress,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [acct.address],
    });

    if (bal < parseUnits("10000", 6)) {
      const wallet = getWallet(acct.address);
      const hash = await wallet.writeContract({
        address: mockUSDCAddress,
        abi: usdcAbi,
        functionName: "faucet",
        args: [parseUnits("100000", 6)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ Granted 100,000 USDC faucet to @${acct.handle}`);
    }
  }

  // 2. Seed Slabs into SlabVault
  const operatorWallet = getWallet(OPERATOR);
  const tokenMap = new Map(); // certNumber -> tokenId

  for (const slab of SEED_SLABS) {
    const certKey = await publicClient.readContract({
      address: slabVaultAddress,
      abi: vaultAbi,
      functionName: "certKey",
      args: [slab.grader, slab.certNumber],
    });

    const existingToken = await publicClient.readContract({
      address: slabVaultAddress,
      abi: vaultAbi,
      functionName: "tokenOfCert",
      args: [certKey],
    });

    let tokenId = existingToken;

    if (existingToken === 0n) {
      const evidenceHash = keccak256(toBytes(`evidence-${slab.grader}-${slab.certNumber}`));
      const hash = await operatorWallet.writeContract({
        address: slabVaultAddress,
        abi: vaultAbi,
        functionName: "seedSlab",
        args: [
          {
            recipient: slab.recipient,
            grader: slab.grader,
            certNumber: slab.certNumber,
            title: slab.title,
            image: slab.image,
            custodianRef: slab.custodianRef,
            declaredValueCents: BigInt(slab.declaredValueCents),
            evidenceHash,
          },
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      tokenId = await publicClient.readContract({
        address: slabVaultAddress,
        abi: vaultAbi,
        functionName: "tokenOfCert",
        args: [certKey],
      });
      console.log(`  ✓ Minted Token #${tokenId} for ${slab.title.slice(0, 36)}… (Owner: ${slab.recipient.slice(0, 8)}…)`);
    }

    tokenMap.set(slab.certNumber, tokenId);

    // 3. List on SlabMarket if listPriceUsdc > 0
    if (slab.listPriceUsdc > 0 && tokenId > 0n) {
      const alreadyListed = await publicClient.readContract({
        address: slabMarketAddress,
        abi: marketAbi,
        functionName: "isListed",
        args: [tokenId],
      });

      if (!alreadyListed) {
        const ownerWallet = getWallet(slab.recipient);
        const priceUnits = parseUnits(String(slab.listPriceUsdc), 6);
        const hash = await ownerWallet.writeContract({
          address: slabMarketAddress,
          abi: marketAbi,
          functionName: "list",
          args: [tokenId, priceUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ✓ Listed Token #${tokenId} on SlabMarket for $${slab.listPriceUsdc.toLocaleString()} USDC`);
      }
    }
  }

  const active = await publicClient.readContract({
    address: slabMarketAddress,
    abi: marketAbi,
    functionName: "getActiveListings",
  });
  console.log(`\n🎉 Seeding complete: ${active.length} active marketplace listings on-chain!\n`);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
