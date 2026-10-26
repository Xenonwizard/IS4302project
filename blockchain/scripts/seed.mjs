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
    listPriceUsdc: 3244, // Listed
  },
  {
    recipient: TEST1,
    grader: "PSA",
    certNumber: "22222222",
    title: "1999 Pokémon Base #4/102 Charizard - Holo (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/base1/4_hires.png",
    custodianRef: "SolanaMintCharizardBase4",
    listPriceUsdc: 0, // Unlisted in test1's vault
  },
  {
    recipient: TEST2,
    grader: "PSA",
    certNumber: "33333333",
    title: "2004 Pokémon Team Rocket Returns #15/109 Dark Dragonite (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/ex7/15_hires.png",
    custodianRef: "SolanaMintDarkDragonite15",
    listPriceUsdc: 1150, // Listed
  },
  {
    recipient: TEST2,
    grader: "PSA",
    certNumber: "44444444",
    title: "2002 Pokémon Neo Destiny #106/105 Shining Celebi (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/neo4/106_hires.png",
    custodianRef: "SolanaMintShiningCelebi106",
    listPriceUsdc: 0, // Unlisted in test2's vault
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "55555555",
    title: "2003 Pokémon Skyridge #146/144 Charizard - Rare Secret (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/ecard3/146_hires.png",
    custodianRef: "SolanaMintCharizardSkyridge146",
    listPriceUsdc: 8500, // Listed
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "66666666",
    title: "2011 Pokémon Call of Legends #20/95 Rayquaza - Holo (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/col1/20_hires.png",
    custodianRef: "SolanaMintRayquazaCol20",
    listPriceUsdc: 2200, // Listed
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "77777777",
    title: "2007 Pokémon Power Keepers #102/108 Vaporeon ★ - Holo Star (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/ex16/102_hires.png",
    custodianRef: "SolanaMintVaporeonStar102",
    listPriceUsdc: 1400, // Listed
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "88888888",
    title: "2003 Pokémon Skyridge #11/144 Gyarados (PSA 9.5 MINT+)",
    image: "https://images.pokemontcg.io/ecard3/11_hires.png",
    custodianRef: "SolanaMintGyaradosSkyridge11",
    listPriceUsdc: 1950, // Listed
  },
  {
    recipient: BROCK,
    grader: "BGS",
    certNumber: "99999999",
    title: "2007 Pokémon Power Keepers #101/108 Jolteon ★ - Holo Star (BGS 10 PRISTINE)",
    image: "https://images.pokemontcg.io/ex16/101_hires.png",
    custodianRef: "SolanaMintJolteonStar101",
    listPriceUsdc: 5200, // Listed
  },
  {
    recipient: BROCK,
    grader: "PSA",
    certNumber: "10101010",
    title: "2004 Pokémon Team Rocket Returns #106/109 Rocket's Zapdos ex (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/ex7/106_hires.png",
    custodianRef: "SolanaMintZapdosEx106",
    listPriceUsdc: 3450, // Listed
  },
  {
    recipient: BROCK,
    grader: "CGC",
    certNumber: "12121212",
    title: "2000 Pokémon Neo Genesis #9/111 Lugia - Holo (CGC 10 PRISTINE)",
    image: "https://images.pokemontcg.io/neo1/9_hires.png",
    custodianRef: "SolanaMintLugiaNeo9",
    listPriceUsdc: 14500, // Listed
  },
  {
    recipient: BROCK,
    grader: "PSA",
    certNumber: "13131313",
    title: "2025 Pokémon Prismatic Evolutions #161/131 Umbreon ex (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    custodianRef: "SolanaMintUmbreonEx161",
    listPriceUsdc: 2800, // Listed
    saleTo: TEST1,
  },
  // Local demo comparables: repeated printings with varied grades so the comparison panel has
  // real SlabMarket listings and CardPurchased events to read. These are fictional test records.
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "14141414",
    title: "2003 Pokémon Skyridge #11/144 Gyarados (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/ecard3/11_hires.png",
    custodianRef: "DemoGyaradosSkyridgePSA10",
    listPriceUsdc: 2400,
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "15151515",
    title: "2003 Pokémon Skyridge #11/144 Gyarados (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/ecard3/11_hires.png",
    custodianRef: "DemoGyaradosSkyridgePSA9",
    listPriceUsdc: 1850,
    saleTo: TEST1,
  },
  {
    recipient: BROCK,
    grader: "BGS",
    certNumber: "16161616",
    title: "2003 Pokémon Skyridge #11/144 Gyarados (BGS 9.5 GEM MINT)",
    image: "https://images.pokemontcg.io/ecard3/11_hires.png",
    custodianRef: "DemoGyaradosSkyridgeBGS95",
    listPriceUsdc: 2100,
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "17171717",
    title: "2017 Pokémon Shining Legends #40/73 Shining Mew - Shining (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/sm35/40_hires.png",
    custodianRef: "DemoShiningMewPSA10",
    listPriceUsdc: 1250,
  },
  {
    recipient: MISTY,
    grader: "PSA",
    certNumber: "18181818",
    title: "2017 Pokémon Shining Legends #40/73 Shining Mew - Shining (PSA 8 NM-MT)",
    image: "https://images.pokemontcg.io/sm35/40_hires.png",
    custodianRef: "DemoShiningMewPSA8",
    listPriceUsdc: 720,
    saleTo: TEST2,
  },
  {
    recipient: BROCK,
    grader: "BGS",
    certNumber: "19191919",
    title: "2017 Pokémon Shining Legends #40/73 Shining Mew - Shining (BGS 9.5 GEM MINT)",
    image: "https://images.pokemontcg.io/sm35/40_hires.png",
    custodianRef: "DemoShiningMewBGS95",
    listPriceUsdc: 1100,
  },
  {
    recipient: ASH,
    grader: "PSA",
    certNumber: "20202020",
    title: "2025 Pokémon Prismatic Evolutions #161/131 Umbreon ex (PSA 9 MINT)",
    image: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    custodianRef: "DemoUmbreonPSA9",
    listPriceUsdc: 1950,
  },
  {
    recipient: MISTY,
    grader: "BGS",
    certNumber: "21212121",
    title: "2025 Pokémon Prismatic Evolutions #161/131 Umbreon ex (BGS 9.5 GEM MINT)",
    image: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    custodianRef: "DemoUmbreonBGS95",
    listPriceUsdc: 2250,
    saleTo: TEST1,
  },
  {
    recipient: BROCK,
    grader: "PSA",
    certNumber: "22222223",
    title: "2025 Pokémon Prismatic Evolutions #161/131 Umbreon ex (PSA 10 GEM MT)",
    image: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    custodianRef: "DemoUmbreonPSA10",
    listPriceUsdc: 3100,
  },
];

async function seed() {
  console.log("\n🌱 Seeding on-chain demo accounts, vaulted slabs, and marketplace listings...");

  const registryAbi = parseAbi([
    "function register(string handle) external",
    "function isActive(address account) external view returns (bool)",
    "function accountOf(address account) external view returns ((string handle, uint8 status, uint256 registeredAt, uint256 closedAt, uint256 custodyBalance))",
    "function balanceOf(address owner) external view returns (uint256)",
    "function deposit(uint256 amount) external",
  ]);

  const usdcAbi = parseAbi([
    "function faucet(uint256 amount) external",
    "function balanceOf(address account) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
  ]);

  const vaultAbi = parseAbi([
    "struct SeedParams { address recipient; string grader; string certNumber; string title; string image; string custodianRef; bytes32 evidenceHash; }",
    "function seedSlab(SeedParams calldata p) external returns (uint256 tokenId)",
    "function tokenOfCert(bytes32 key) external view returns (uint256)",
    "function certKey(string grader, string certNumber) external pure returns (bytes32)",
  ]);

  const marketAbi = parseAbi([
    "function list(uint256 tokenId, uint256 price) external",
    "function listWithLoan(uint256 tokenId, uint256 price, uint256 loanAsk) external",
    "function buy(uint256 tokenId) external",
    "function isListed(uint256 tokenId) external view returns (bool)",
    "function getSalesForToken(uint256 tokenId) external view returns ((uint256 tokenId, address seller, address buyer, uint256 price, uint256 fee, uint64 settledAt)[])",
    "function getActiveListings() external view returns ((uint256 tokenId, address seller, string sellerHandle, uint256 price, uint64 listedAt, bool acceptsLoan, uint256 loanAsk, string grader, string certNumber, string title, string image)[])",
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

    const priorSales = tokenId > 0n
      ? await publicClient.readContract({
          address: slabMarketAddress,
          abi: marketAbi,
          functionName: "getSalesForToken",
          args: [tokenId],
        })
      : [];

    // 3. List on SlabMarket if listPriceUsdc > 0
    if (slab.listPriceUsdc > 0 && tokenId > 0n && priorSales.length === 0) {
      const alreadyListed = await publicClient.readContract({
        address: slabMarketAddress,
        abi: marketAbi,
        functionName: "isListed",
        args: [tokenId],
      });

      if (!alreadyListed) {
        const ownerWallet = getWallet(slab.recipient);
        const priceUnits = parseUnits(String(slab.listPriceUsdc), 6);
        // Alternate demo inventory opts into loans so both marketplace paths are easy to try locally.
        const acceptsDemoLoan = tokenId % 2n === 0n;
        const loanAskUnits = parseUnits(String(Math.floor(slab.listPriceUsdc * 0.6)), 6);
        const hash = await ownerWallet.writeContract({
          address: slabMarketAddress,
          abi: marketAbi,
          functionName: acceptsDemoLoan ? "listWithLoan" : "list",
          args: acceptsDemoLoan ? [tokenId, priceUnits, loanAskUnits] : [tokenId, priceUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ✓ Listed Token #${tokenId} on SlabMarket for $${slab.listPriceUsdc.toLocaleString()} USDC${acceptsDemoLoan ? " (loans accepted)" : ""}`);
      }
    }

    // Seed a few completed, on-chain demo sales. The sold slab remains unlisted on reruns;
    // checking its sales history makes this safe to run repeatedly.
    if (slab.saleTo && tokenId > 0n) {
      if (priorSales.length === 0) {
        const buyer = getWallet(slab.saleTo);
        // SlabMarket.buy pays from the buyer's Pokechain account (AccountRegistry custody balance),
        // so top it up from their wallet USDC first.
        const price = parseUnits(String(slab.listPriceUsdc), 6);
        const custody = await publicClient.readContract({
          address: accountRegistryAddress,
          abi: registryAbi,
          functionName: "balanceOf",
          args: [slab.saleTo],
        });
        if (custody < price) {
          const shortfall = price - custody;
          const approveHash = await buyer.writeContract({
            address: mockUSDCAddress,
            abi: usdcAbi,
            functionName: "approve",
            args: [accountRegistryAddress, shortfall],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          const depositHash = await buyer.writeContract({
            address: accountRegistryAddress,
            abi: registryAbi,
            functionName: "deposit",
            args: [shortfall],
          });
          await publicClient.waitForTransactionReceipt({ hash: depositHash });
        }
        const buyHash = await buyer.writeContract({
          address: slabMarketAddress,
          abi: marketAbi,
          functionName: "buy",
          args: [tokenId],
        });
        await publicClient.waitForTransactionReceipt({ hash: buyHash });
        console.log(`  ✓ Recorded demo sale for Token #${tokenId} at $${slab.listPriceUsdc.toLocaleString()} USDC`);
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

