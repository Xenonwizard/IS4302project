import type { Page } from "@playwright/test";
import { createPublicClient, http } from "viem";
import { hardhat } from "viem/chains";
import { deployments, slabVaultAbi } from "../../src/lib/chain/generated";
import { expect, test } from "./fixtures";
import { ASH, MISTY, TEST1, TEST2, custodyDollars, forwardedSubmission, isListed, listAsMisty, loadDemoTraders, logIn, openAccount, ownerOf, resetDemo, resetSeeded } from "./helpers";

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
  await page.getByText("test1 wallet", { exact: true }).click();
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

/** @ash chats with @misty and sends the 3 Pikachus + $50 for 2 Articunos offer from inside the chat. */
async function ashOffersFromChat(page: Page) {
  await logIn(page, 1, "ash");
  await page.goto("/trades");
  await page.getByRole("button", { name: "Chat with @misty" }).click();
  await expect(page.getByText("ash opened a chat with misty.")).toBeVisible();

  // They talk first, like Carousell: the offer comes out of the conversation.
  await page.getByPlaceholder("Message misty…").fill("Hi! Keen on your two Articunos. Would you swap my Pikachus for them?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Would you swap my Pikachus for them?")).toBeVisible();

  await page.getByRole("button", { name: "Make a trade offer" }).click();
  // The chat is about her Articuno #5, so the offer starts with it picked.
  await expect(page.getByRole("button", { name: /Articuno.*#5$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Add at least one of your slabs")).toBeVisible(); // giving nothing is refused

  for (const id of [1, 2, 3]) await page.getByRole("button", { name: new RegExp(`Pikachu.*#${id}$`) }).click();
  await page.getByLabel("You give: cash").fill("50");
  await page.getByRole("button", { name: /Articuno.*#6$/ }).click();

  const terms = page.getByTestId("trade-terms");
  await expect(terms).toContainText("3 slabs + $50.00 PokeCredits");
  await expect(terms).toContainText("2 slabs + $0.00 PokeCredits");
  await expect(page.getByTestId("trade-verdict")).toHaveCount(0);
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByTestId("trade-status")).toHaveText("Waiting for them");
}

test("two collectors: negotiate in a chat, then 3 Pikachus + $50 for 2 Articunos settles on-chain in one go", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await ashOffersFromChat(page);
  // The chat and the offer survive a reload: the messages are saved, the status is read from the chain.
  await page.reload();
  await expect(page.getByText("Would you swap my Pikachus for them?")).toBeVisible();
  await expect(page.getByTestId("trade-status")).toHaveText("Waiting for them");
  // Ash's side is locked in escrow; Misty's hasn't moved.
  expect(await ownerOf(1)).toBe(deployments["31337"].TradeEscrow);
  expect(await ownerOf(5)).toBe(MISTY);
  expect(await custodyDollars(ASH)).toBe(950);
  await page.goto("/vault");
  await expect(page.getByText("In offer #1")).toHaveCount(3);

  // @misty, in her own browser, finds the chat and the offer, and sees the balance from her side.
  const other = await browser.newContext();
  const misty = await other.newPage();
  const mistyProblems: string[] = [];
  misty.on("console", (m) => {
    if (m.type() === "error") mistyProblems.push(m.text());
  });
  await logIn(misty, 2, "misty");
  await misty.goto("/trades");
  await expect(misty.getByText("Trade to review")).toBeVisible();
  await misty.getByRole("link", { name: /ash/ }).first().click();
  await expect(misty.getByText("Would you swap my Pikachus for them?")).toBeVisible();
  const card = misty.getByTestId("trade-card");
  await expect(card.getByTestId("trade-status")).toHaveText("Your move");
  await expect(card.getByTestId("trade-terms")).toContainText("2 slabs + $0.00 PokeCredits");
  await expect(card.getByTestId("trade-terms")).toContainText("3 slabs + $50.00 PokeCredits");
  await card.getByRole("button", { name: "Accept trade" }).click();
  await expect(card.getByTestId("trade-status")).toHaveText("Accepted");
  await expect(misty.getByText(/misty accepted trade #1/)).toBeVisible();
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

test("two collectors: declining an offer in the chat refunds the sender's side", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await ashOffersFromChat(page);
  expect(await ownerOf(1)).toBe(deployments["31337"].TradeEscrow);

  const other = await browser.newContext();
  const misty = await other.newPage();
  await logIn(misty, 2, "misty");
  await misty.goto("/trades");
  await misty.getByRole("link", { name: /ash/ }).first().click();
  const card = misty.getByTestId("trade-card");
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card.getByTestId("trade-status")).toHaveText("Declined");
  await other.close();

  // Nothing moved, and ash has his slabs and cash back.
  for (const id of [1, 2, 3]) expect(await ownerOf(id)).toBe(ASH);
  for (const id of [5, 6]) expect(await ownerOf(id)).toBe(MISTY);
  expect(await custodyDollars(ASH)).toBe(1000);
  await expect(page.getByTestId("trade-status")).toHaveText("Declined");
});

test("two collectors: a counter-offer in the chat replaces the first, and accepting it swaps the new terms", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await ashOffersFromChat(page);

  // @misty doesn't take it as it stands: she asks for $100 more on top, in the same chat.
  const other = await browser.newContext();
  const misty = await other.newPage();
  await logIn(misty, 2, "misty");
  await misty.goto("/trades");
  await misty.getByRole("link", { name: /ash/ }).first().click();
  await misty.getByRole("button", { name: "Counter" }).click();
  // The builder starts from the offer: her two Articunos on one side, his three Pikachus on the other.
  await expect(misty.getByRole("button", { name: /Articuno.*#5$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(misty.getByRole("button", { name: /Pikachu.*#1$/ })).toHaveAttribute("aria-pressed", "true");
  await misty.getByLabel("You get from @ash: cash").fill("100");
  await misty.getByRole("button", { name: "Send counter-offer" }).click();
  await expect(misty.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Waiting for them");
  await expect(misty.getByTestId("trade-card").first().getByTestId("trade-status")).toHaveText("Countered");
  // The first offer was refunded when it was countered; her side is now the one in escrow.
  expect(await ownerOf(1)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(1000);
  expect(await ownerOf(5)).toBe(deployments["31337"].TradeEscrow);

  // @ash sees it arrive in his chat and accepts it.
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Your move");
  await page.getByTestId("trade-card").last().getByRole("button", { name: "Accept trade" }).click();
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Accepted");
  await other.close();
  for (const id of [1, 2, 3]) expect(await ownerOf(id)).toBe(MISTY);
  for (const id of [5, 6]) expect(await ownerOf(id)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(900);
  expect(await custodyDollars(MISTY)).toBe(1100);
});

test("two collectors: an offer on a listed slab starts a chat; accepting delists it, then swaps", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await listAsMisty(5, 900); // her Articuno, asking $900
  expect(await isListed(5)).toBe(true);

  // @ash finds it on the marketplace and makes an offer: that opens the chat with the builder ready.
  await logIn(page, 1, "ash");
  await page.goto("/marketplace");
  await page.getByText("Articuno").first().click();
  await expect(page.getByText("Owned by")).toBeVisible();
  await page.getByRole("button", { name: "Make an offer" }).click();
  await expect(page.getByText("Trade with this collector")).toBeVisible();
  await page.getByRole("button", { name: "Open chat and build a trade" }).click();
  await expect(page.getByRole("heading", { name: "Trade offer to @misty" })).toBeVisible();

  // Review exact slab terms; the app assigns no monetary value to either card.
  await page.getByRole("button", { name: /Charizard.*#4$/ }).click();
  await expect(page.getByRole("button", { name: /Articuno.*#5$/ })).toHaveAttribute("aria-pressed", "true"); // the listed slab
  // Her stated value is what she's asking for it ($900).
  await expect(page.getByText("Listed at $900.00: it is delisted if they accept")).toBeVisible();
  await expect(page.getByTestId("trade-terms")).toContainText("1 slab + $0.00 PokeCredits");
  await expect(page.getByTestId("trade-verdict")).toHaveCount(0);
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByTestId("trade-status")).toHaveText("Waiting for them");

  // @misty accepts. Her slab was listed, so the sale is cancelled first (its own transaction), then the swap.
  const other = await browser.newContext();
  const misty = await other.newPage();
  await logIn(misty, 2, "misty");
  await misty.goto("/trades");
  await misty.getByRole("link", { name: /ash/ }).first().click();
  await misty.getByRole("button", { name: "Accept trade" }).click();
  await expect(misty.getByTestId("trade-status")).toHaveText("Accepted");
  await other.close();
  expect(await isListed(5)).toBe(false);
  expect(await ownerOf(4)).toBe(MISTY);
  expect(await ownerOf(5)).toBe(ASH);
});

test("seeded demo: an offer on a listed slab, a counter that includes your own listed slab, then Sold", async ({ page, browser, request }) => {
  // What `npm run chain` and the Reset button give you: accounts, slabs and listings already on-chain.
  await resetSeeded(request);
  expect(await isListed(3)).toBe(true); // test2's Dark Dragonite is for sale

  // test1 opens a chat about it: the new offer starts with that slab already picked.
  await logIn(page, 1, "test1");
  await page.goto("/trades");
  await page.getByRole("button", { name: "Chat with @test2" }).click();
  await page.getByRole("button", { name: "Make a trade offer" }).click();
  await expect(page.getByRole("button", { name: /Dark Dragonite.*#3$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Seller ask $1,150.00").first()).toBeVisible();
  await page.getByRole("button", { name: /Charizard.*#2$/ }).click();
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByTestId("trade-status")).toHaveText("Waiting for them");

  // test2 counters: keeps their own listed Dragonite in it and also asks for test1's listed Alakazam. This
  // used to revert (SlabIsListed); now test2's listing is cancelled first, then the counter goes through.
  const other = await browser.newContext();
  const test2 = await other.newPage();
  const problems: string[] = [];
  test2.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await logIn(test2, 2, "test2");
  await test2.goto("/trades");
  await test2.getByRole("link", { name: /test1/ }).first().click();
  await test2.getByRole("button", { name: "Counter" }).click();
  await expect(test2.getByText(/Listed at \$[\d,.]+: the listing is cancelled when you send/).first()).toBeVisible();
  await test2.getByRole("button", { name: /Alakazam.*#1$/ }).click();
  await test2.getByRole("button", { name: "Send counter-offer" }).click();
  await expect(test2.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Waiting for them");
  expect(await isListed(3)).toBe(false);
  expect(await ownerOf(3)).toBe(deployments["31337"].TradeEscrow);
  await other.close();
  expect(problems, problems.join("\n")).toEqual([]);

  // test1 accepts: their listed Alakazam is delisted first, then everything swaps. The Dragonite shows as sold.
  await page.getByTestId("trade-card").last().getByRole("button", { name: "Accept trade" }).click();
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Accepted");
  await expect(page.getByTestId("sold-banner")).toContainText("Traded from @test2 to @test1");
  for (const id of [1, 2]) expect(await ownerOf(id)).toBe(TEST2);
  expect(await ownerOf(3)).toBe(TEST1);
  expect(await isListed(1)).toBe(false);
  await page.goto("/asset/token-3");
  await expect(page.getByTestId("sold-banner")).toBeVisible();
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
