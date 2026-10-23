import { createPublicClient, http } from "viem";
import { hardhat } from "viem/chains";
import { deployments, slabVaultAbi } from "../../src/lib/chain/generated";
import { expect, test } from "./fixtures";
import { ASH, MISTY, custodyDollars, forwardedSubmission, loadDemoTraders, logIn, openAccount, ownerOf, resetDemo } from "./helpers";

// One test per role's main job, against the real app and local chain. Each test starts from a
// freshly reset chain and a fresh browser (empty localStorage).

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("collector: opens an account with a wallet, and it survives a reload", async ({ page }) => {
  await openAccount(page, "smoke_ash");
  await page.reload();
  await expect(page.locator("header")).toContainText("smoke_ash");
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "@smoke_ash" })).toBeVisible();
});

test("collector: an invalid handle is refused with a reason", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText("Hardhat test collector #1").click();
  await page.getByPlaceholder("vaultedcharizard").fill("ab");
  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByText("3 to 20 characters: a-z, 0-9 or _.", { exact: true })).toBeVisible();
});

test("collector: submits a slab through the intake form; its NFT is minted at once, locked", async ({ page }) => {
  await openAccount(page, "smoke_ash");
  await page.goto("/submit");
  await page.getByRole("button", { name: /Random unused cert/ }).click();
  await expect(page.getByText(/Found in the PSA registry/i)).toBeVisible();
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByRole("button", { name: "Use estimate" }).click();
  await page.getByPlaceholder("RR123456789SG").fill("RR000111222SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page.getByText("NFT #1: Posted to Pokechain")).toBeVisible();
  await page.reload();
  await expect(page.getByText("NFT #1: Posted to Pokechain")).toBeVisible();
  await expect(page.getByText("Locked until vaulted")).toBeVisible();
  // The token exists and is the collector's from the first step.
  expect(await ownerOf(1)).toBe(ASH);
});

test("collector: a parcel lost on the way in is reported against its NFT, then found", async ({ page }) => {
  await openAccount(page, "smoke_ash");
  await page.goto("/submit");
  await page.getByRole("button", { name: /Random unused cert/ }).click();
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByRole("button", { name: "Use estimate" }).click();
  await page.getByPlaceholder("RR123456789SG").fill("RR000333444SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page.getByText("NFT #1: Posted to Pokechain")).toBeVisible();

  await page.getByRole("button", { name: "Report lost", exact: true }).click();
  await page.getByRole("button", { name: "Report lost on-chain" }).click();
  await expect(page.getByText("NFT #1: reported lost in the post")).toBeVisible();
  // Lost tokens can't be traded or moved on; the carrier finds it at Pokechain's warehouse.
  await page.getByRole("button", { name: "Simulate: parcel turns up at Pokechain" }).click();
  await expect(page.getByText("NFT #1: At Pokechain")).toBeVisible();
});

test("two collectors: 3 Pikachus + $50 for 2 Articunos, settled on-chain in one go", async ({ page, browser, request }) => {
  await loadDemoTraders(request);

  // @ash makes the offer in the trade room with @misty.
  await logIn(page, 1, "ash");
  await page.goto("/trades");
  await page.getByRole("link", { name: /@misty/ }).click();
  await page.getByRole("button", { name: "Make an offer" }).click();
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Add at least one of your slabs")).toBeVisible(); // empty offers are refused
  for (const id of [1, 2, 3]) await page.getByRole("button", { name: new RegExp(`Pikachu.*#${id}$`) }).click();
  await page.getByLabel("You give: cash").fill("50");
  for (const id of [5, 6]) await page.getByRole("button", { name: new RegExp(`Articuno.*#${id}$`) }).click();
  await expect(page.getByText("You give 3 slabs + $50.00 · you get 2 slabs")).toBeVisible();
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Waiting for them")).toBeVisible();
  // Ash's side is locked in escrow; Misty's hasn't moved.
  expect(await ownerOf(1)).toBe(deployments["31337"].TradeEscrow);
  expect(await ownerOf(5)).toBe(MISTY);
  expect(await custodyDollars(ASH)).toBe(950);
  await page.goto("/vault");
  await expect(page.getByText("In offer #1")).toHaveCount(3);

  // @misty, in her own browser, accepts.
  const other = await browser.newContext();
  const misty = await other.newPage();
  const mistyProblems: string[] = [];
  misty.on("console", (m) => {
    if (m.type() === "error") mistyProblems.push(m.text());
  });
  await logIn(misty, 2, "misty");
  await misty.goto(`/trades/chain-${ASH}`);
  await misty.getByRole("button", { name: "Accept trade" }).click();
  await expect(misty.getByText("Accepted", { exact: true })).toBeVisible();
  await other.close();
  expect(mistyProblems, mistyProblems.join("\n")).toEqual([]);

  // Everything swapped in one transaction.
  for (const id of [1, 2, 3]) expect(await ownerOf(id)).toBe(MISTY);
  for (const id of [5, 6]) expect(await ownerOf(id)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(950);
  expect(await custodyDollars(MISTY)).toBe(1050);
  await page.goto("/vault");
  await expect(page.getByText("In offer #1")).toHaveCount(0);
  await expect(page.getByText(/Articuno/).first()).toBeVisible();
});

test("Collector Crypt: reads the forwarded parcel; the chain only holds ciphertext", async ({ page, request }) => {
  const { submissionId, trackingNumber } = await forwardedSubmission(request, "88800022");

  // Anyone reading the chain: the tracking number is nowhere in the event.
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const [event] = await pub.getContractEvents({
    address: deployments["31337"].SlabVault,
    abi: slabVaultAbi,
    eventName: "SubmissionForwarded",
    args: { submissionId: BigInt(submissionId) },
    fromBlock: BigInt(0),
  });
  expect(event.args.ciphertext).not.toContain(Buffer.from(trackingNumber).toString("hex"));

  // Collector Crypt: decrypts it with its private key.
  await page.goto("/collector-crypt");
  await expect(page.getByText(`Incoming parcel · submission #${submissionId}`)).toBeVisible();
  await expect(page.getByText(trackingNumber)).toBeVisible();

  // Dispute: the contract confirms the revealed message matches the commitment.
  await page.getByRole("button", { name: "Run dispute check" }).click();
  await expect(page.getByText("The contract confirms")).toBeVisible();
});
