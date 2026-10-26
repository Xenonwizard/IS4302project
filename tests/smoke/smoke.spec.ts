import type { Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { hardhat } from "viem/chains";
import { deployments, slabVaultAbi } from "../../src/lib/chain/generated";
import { expect, test } from "./fixtures";
import { ASH, MISTY, TEST1, TEST2, custodyDollars, custodyOf, depositAsTest1, depositAsTest2, escrowedBounty, forwardedSubmission, isListed, listAsMisty, loadDemoTraders, logIn, openAccount, ownerOf, resetDemo, resetSeeded } from "./helpers";

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

test("collector: submits a slab request; no NFT is minted until Pokechain receives it", async ({ page }) => {
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
  await expect(page).toHaveURL(/\/submissions$/);
  await expect(page.getByText("Awaiting receipt at Pokechain")).toBeVisible();

  // A completed request returns to the list, where another independent slab can be added immediately.
  await page.getByRole("link", { name: "Add another slab" }).click();
  await page.getByRole("button", { name: /Random unused cert/ }).click();
  await expect(page.getByText(/Found in the PSA registry/i)).toBeVisible();
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await page.getByPlaceholder("RR123456789SG").fill("RR000111333SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page).toHaveURL(/\/submissions$/);
  await expect(page.locator('li[data-testid^="request-"]')).toHaveCount(2);
  await page.reload();
  await expect(page.getByText("Awaiting receipt at Pokechain")).toHaveCount(2);
});

test("collector: a received slab stays in Submissions and its row expands to the submitted form", async ({ page }) => {
  await openAccount(page, "smoke_ash");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill("4324324");
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByPlaceholder("RR123456789SG").fill("RR000333444SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await page.goto("/intake");
  await page.getByPlaceholder("4324324").fill("4324324");
  await expect(page.getByText("Current status: Pending")).toBeVisible();
  await page.getByRole("button", { name: "Received at Pokechain", exact: true }).click();
  await expect(page.getByText("Received at Pokechain")).toBeVisible();
  await page.goto("/submissions");
  const request = page.getByTestId("request-4324324");
  await expect(request.getByTestId("request-stage")).toHaveText("Received at Pokechain");
  await request.getByRole("button").click();
  await expect(request.getByText("Delivery method")).toBeVisible();
  await expect(request.getByText("RR000333444SG")).toBeVisible();
  await expect(page).toHaveURL(/\/submissions$/);
});

test("submissions: a received slab links to the Vault and its NFT, and a chain reset clears it from every tab", async ({ page, context, request }) => {
  const cert = "5554443";
  await openAccount(page, "smoke_links");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill(cert);
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByPlaceholder("RR123456789SG").fill("RR000999111SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page).toHaveURL(/\/submissions$/);

  // Pokechain receives it: the NFT is minted, locked, awaiting vault.
  const received = await request.post("/api/chain/receive", { data: { submissionId: cert } });
  expect(received.ok(), await received.text()).toBeTruthy();
  const row = page.getByTestId(`request-${cert}`);
  await expect(row.getByTestId("request-stage")).toHaveText("Received at Pokechain");
  await row.getByRole("button").first().click();

  // One button: View Vaulted NFT opens the Vault's Awaiting vault tab, with that NFT in it once.
  await expect(row.getByRole("link")).toHaveCount(1);
  await row.getByRole("link", { name: "View Vaulted NFT" }).click();
  await expect(page).toHaveURL(/\/vault\?tab=awaiting$/);
  await expect(page.getByText("Awaiting Vaulting", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Report lost/ })).toHaveCount(1);

  // An NFT still being vaulted has no page of its own: its address leads back to Awaiting vault.
  await page.goto(`/asset/token-${cert}`);
  await expect(page).toHaveURL(/\/vault\?tab=awaiting$/);

  // A second tab stays open on Submissions while the chain is reset from elsewhere (the Reset button
  // or curl). Both tabs drop the request and the awaiting NFT; nothing old is written back.
  const other = await context.newPage();
  await other.goto("/submissions");
  await expect(other.getByTestId(`request-${cert}`)).toBeVisible();
  const reset = await request.post("/api/dev/reset?clean=1");
  expect(reset.ok(), await reset.text()).toBeTruthy();
  await expect(other.getByTestId(`request-${cert}`)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId(`request-${cert}`)).toHaveCount(0, { timeout: 15_000 });
  await page.goto("/vault?tab=awaiting");
  await expect(page.getByText("Awaiting Vaulting", { exact: true })).toHaveCount(0);
  // Nothing about the rolled-back request is left in this browser's saved state either.
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("pokechain.state.v3") ?? "").catch(() => cert), { timeout: 15_000 })
    .not.toContain(cert);
});

test("intake demo: the submit tab updates live while another tab (or curl) runs each step", async ({ page, context, request }) => {
  const cert = "7654321";
  await openAccount(page, "smoke_live");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill(cert);
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByPlaceholder("RR123456789SG").fill("RR000555666SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  const tracked = page.getByTestId(`request-${cert}`);
  await expect(tracked.getByTestId("request-stage")).toHaveText("Awaiting receipt at Pokechain");

  // The operator works in a second tab; the collector's tab is never reloaded.
  const intake = await context.newPage();
  await intake.goto("/intake");
  await intake.getByPlaceholder("4324324").fill(cert);
  await expect(intake.getByText("Current status: Pending")).toBeVisible();
  await intake.getByRole("button", { name: "Received at Pokechain", exact: true }).click();
  await expect(tracked.getByTestId("request-stage")).toHaveText("Received at Pokechain");
  await expect(tracked).toContainText(`NFT #${cert}`);

  // The same step as a curl command: the intake tab and the submit tab both follow.
  const forwarded = await request.post("/api/chain/forward", { data: { submissionId: cert } });
  expect(forwarded.ok(), await forwarded.text()).toBeTruthy();
  await expect(intake.getByText("Current status: At Collector Crypt")).toBeVisible();
  await expect(tracked.getByTestId("request-stage")).toHaveText("With Collector Crypt");

  await intake.getByRole("button", { name: "Vaulted at Collector Crypt", exact: true }).click();
  await expect(tracked.getByTestId("request-stage")).toHaveText("Vaulted");
  await tracked.getByRole("button").click();
  await expect(tracked.getByText("Delivery method")).toBeVisible();
  await expect(tracked.getByRole("link", { name: "View Vaulted NFT" })).toBeVisible();
  expect(await ownerOf(Number(cert))).toBe(ASH);
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
  // The chat is about her first Articuno, whose token id is its PSA cert.
  await expect(page.getByRole("button", { name: /Articuno.*#70000136$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Add at least one of your slabs")).toBeVisible(); // giving nothing is refused

  for (const id of [70000013, 70000035, 70000041]) await page.getByRole("button", { name: new RegExp(`Pikachu.*#${id}$`) }).click();
  await page.getByLabel("You give: cash").fill("50");
  await page.getByRole("button", { name: /Articuno.*#70000256$/ }).click();

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
  expect(await ownerOf(70000013)).toBe(deployments["31337"].TradeEscrow);
  expect(await ownerOf(70000136)).toBe(MISTY);
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
  for (const id of [70000013, 70000035, 70000041]) expect(await ownerOf(id)).toBe(MISTY);
  for (const id of [70000136, 70000256]) expect(await ownerOf(id)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(950);
  expect(await custodyDollars(MISTY)).toBe(1050);
  await page.goto("/vault");
  await expect(page.getByText("In offer #1")).toHaveCount(0);
  await expect(page.getByText(/Articuno/).first()).toBeVisible();
});

test("two collectors: declining an offer in the chat refunds the sender's side", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await ashOffersFromChat(page);
  expect(await ownerOf(70000013)).toBe(deployments["31337"].TradeEscrow);

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
  for (const id of [70000013, 70000035, 70000041]) expect(await ownerOf(id)).toBe(ASH);
  for (const id of [70000136, 70000256]) expect(await ownerOf(id)).toBe(MISTY);
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
  await expect(misty.getByRole("button", { name: /Articuno.*#70000136$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(misty.getByRole("button", { name: /Pikachu.*#70000013$/ })).toHaveAttribute("aria-pressed", "true");
  await misty.getByLabel("You get from @ash: cash").fill("100");
  await misty.getByRole("button", { name: "Send counter-offer" }).click();
  await expect(misty.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Waiting for them");
  await expect(misty.getByTestId("trade-card").first().getByTestId("trade-status")).toHaveText("Countered");
  // The first offer was refunded when it was countered; her side is now the one in escrow.
  expect(await ownerOf(70000013)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(1000);
  expect(await ownerOf(70000136)).toBe(deployments["31337"].TradeEscrow);

  // @ash sees it arrive in his chat and accepts it.
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Your move");
  await page.getByTestId("trade-card").last().getByRole("button", { name: "Accept trade" }).click();
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Accepted");
  await other.close();
  for (const id of [70000013, 70000035, 70000041]) expect(await ownerOf(id)).toBe(MISTY);
  for (const id of [70000136, 70000256]) expect(await ownerOf(id)).toBe(ASH);
  expect(await custodyDollars(ASH)).toBe(900);
  expect(await custodyDollars(MISTY)).toBe(1100);
});

test("two collectors: an offer on a listed slab starts a chat; accepting delists it, then swaps", async ({ page, browser, request }) => {
  await loadDemoTraders(request);
  await listAsMisty(70000136, 900); // her Articuno, asking $900
  expect(await isListed(70000136)).toBe(true);

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
  await page.getByRole("button", { name: /Charizard.*#70000038$/ }).click();
  await expect(page.getByRole("button", { name: /Articuno.*#70000136$/ })).toHaveAttribute("aria-pressed", "true"); // the listed slab
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
  expect(await isListed(70000136)).toBe(false);
  expect(await ownerOf(70000038)).toBe(MISTY);
  expect(await ownerOf(70000136)).toBe(ASH);
});

test("seeded demo: an offer on a listed slab, a counter that includes your own listed slab, then Sold", async ({ page, browser, request }) => {
  // What `npm run chain` and the Reset button give you: accounts, slabs and listings already on-chain.
  await resetSeeded(request);
  expect(await isListed(33333333)).toBe(true); // test2's Dark Dragonite is for sale
  // Seeded slabs were placed in the vault directly, so they aren't anyone's submissions.
  const seededCtx = await browser.newContext();
  const seeded = await seededCtx.newPage();
  await logIn(seeded, 2, "test2");
  await seeded.goto("/submissions");
  await expect(seeded.getByText("No slab submissions yet")).toBeVisible();
  await seededCtx.close();

  // test1 opens a chat about it: the new offer starts with that slab already picked.
  await logIn(page, 1, "test1");
  await page.goto("/trades");
  await page.getByRole("button", { name: "Chat with @test2" }).click();
  await page.getByRole("button", { name: "Make a trade offer" }).click();
  await expect(page.getByRole("button", { name: /Dark Dragonite.*#33333333$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Seller ask $1,150.00").first()).toBeVisible();
  await page.getByRole("button", { name: /Charizard.*#22222222$/ }).click();
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
  await test2.getByRole("button", { name: /Alakazam.*#11111111$/ }).click();
  await test2.getByRole("button", { name: "Send counter-offer" }).click();
  await expect(test2.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Waiting for them");
  expect(await isListed(33333333)).toBe(false);
  expect(await ownerOf(33333333)).toBe(deployments["31337"].TradeEscrow);
  await other.close();
  expect(problems, problems.join("\n")).toEqual([]);

  // test1 accepts: their listed Alakazam is delisted first, then everything swaps. The Dragonite shows as sold.
  await page.getByTestId("trade-card").last().getByRole("button", { name: "Accept trade" }).click();
  await expect(page.getByTestId("trade-card").last().getByTestId("trade-status")).toHaveText("Accepted");
  await expect(page.getByTestId("sold-banner")).toContainText("Traded from @test2 to @test1");
  for (const id of [11111111, 22222222]) expect(await ownerOf(id)).toBe(TEST2);
  expect(await ownerOf(33333333)).toBe(TEST1);
  expect(await isListed(11111111)).toBe(false);
  await page.goto("/asset/token-33333333");
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

/** A slab vaulted for @ash via the intake API (wallet #1), returning its token id. */
async function vaultedForAsh(page: Page, request: Parameters<typeof resetDemo>[0], cert: string) {
  await openAccount(page, "smoke_out");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill(cert);
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByPlaceholder("RR123456789SG").fill("RR000777888SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page).toHaveURL(/\/submissions$/);
  for (const step of ["receive", "forward"]) {
    const res = await request.post(`/api/chain/${step}`, { data: { submissionId: cert } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const intake = await page.context().newPage();
  await intake.goto("/intake");
  await intake.getByPlaceholder("4324324").fill(cert);
  await intake.getByRole("button", { name: "Vaulted at Collector Crypt", exact: true }).click();
  await expect(page.getByTestId(`request-${cert}`).getByTestId("request-stage")).toHaveText("Vaulted");
  await intake.close();
}

test("outtake: withdrawing from the Vault waits for /outtake to notify Collector Crypt, then the Vault shows it shipped", async ({ page, request }) => {
  const cert = "8887771";
  const shipTo = "Ash Ketchum, 1 Pallet Town Road";
  await vaultedForAsh(page, request, cert);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Ship to me" }).first().click();
  await page.getByPlaceholder(/Ash Ketchum/).fill(shipTo);
  await page.getByRole("button", { name: "Withdraw and ship to me" }).click();
  await expect(page.getByText("Withdrawal requested")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // The owner's withdrawal only locks the token: nothing has shipped yet.
  await page.goto("/vault?tab=withdrawn");
  await expect(page.getByText("Redemption requested").first()).toBeVisible();

  // Pokechain's outtake step notifies Collector Crypt in another tab.
  const outtake = await page.context().newPage();
  await outtake.goto(`/outtake?certNumber=${cert}`);
  await expect(outtake.getByText("Ready: the latest owner requested redemption.")).toBeVisible();
  // The address the owner gave when withdrawing is filled in for the operator.
  await expect(outtake.getByPlaceholder(/Ash Ketchum/)).toHaveValue(shipTo);
  await outtake.getByRole("button", { name: /Notify Collector Crypt and ship/ }).click();
  await expect(outtake.getByText(/Already dispatched:/)).toBeVisible();
  await expect(outtake.getByRole("button", { name: /Notify Collector Crypt and ship/ })).toBeDisabled();

  // The collector's Vault picks up Collector Crypt's tracking number from the chain.
  await expect(page.getByText(/· Collector Crypt \S+ · /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Confirm delivery/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Confirm delivery/ })).toBeVisible();

  // Dispatching twice is refused by the API.
  const again = await request.post("/api/chain/outtake", { data: { certNumber: cert } });
  expect(again.status()).toBe(400);
});

test("submissions: a withdrawal shows up as a withdraw request, where it can be reported lost", async ({ page, request }) => {
  const cert = "8887779";
  await vaultedForAsh(page, request, cert);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Ship to me" }).first().click();
  await page.getByPlaceholder(/Ash Ketchum/).fill("Ash Ketchum, 1 Pallet Town Road");
  await page.getByRole("button", { name: "Withdraw and ship to me" }).click();
  await page.getByRole("link", { name: "View withdraw request" }).click();
  await expect(page).toHaveURL(/\/submissions\?tab=withdrawals/);

  const withdrawals = page.getByTestId("withdraw-requests");
  await expect(withdrawals.getByText("Redemption requested").first()).toBeVisible();
  await page.reload();
  await withdrawals.getByRole("button", { name: "Report lost" }).click();
  await withdrawals.getByPlaceholder(/Not delivered after 10 days/).fill("Never arrived");
  await withdrawals.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByText("Lost report filed")).toBeVisible();
  await expect(withdrawals.getByRole("button", { name: "Cancel lost status" })).toBeVisible();
});

test("outtake: the operator dispatches a pending redemption from /outtake by PSA cert", async ({ page, request }) => {
  const cert = "8887772";
  const shipTo = "Ash Ketchum, 1 Pallet Town Road";
  await vaultedForAsh(page, request, cert);
  // The owner signs only the redemption request; the hand-off to Collector Crypt is left to /outtake.
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const wallet = createWalletClient({ chain: hardhat, transport: http(), account: ASH });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: deployments["31337"].SlabVault,
      abi: slabVaultAbi,
      functionName: "requestRedemption",
      args: [BigInt(cert), keccak256(toBytes(shipTo))],
    }),
  });
  await page.goto(`/outtake?certNumber=${cert}`);
  await expect(page.getByText("Ready: the latest owner requested redemption.")).toBeVisible();
  // A different address than the one the owner signed is refused.
  await page.getByPlaceholder(/Ash Ketchum/).fill("Team Rocket HQ");
  await page.getByRole("button", { name: /Notify Collector Crypt and ship/ }).click();
  await expect(page.getByText(/doesn't match the shippingHash/)).toBeVisible();
  await page.getByPlaceholder(/Ash Ketchum/).fill(shipTo);
  await page.getByRole("button", { name: /Notify Collector Crypt and ship/ }).click();
  await expect(page.getByText("Collector Crypt notified")).toBeVisible();
  await expect(page.getByText(/current status: Shipped/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Already dispatched:/)).toBeVisible();
});

/**
 * A found slab returned to the vault is back in normal intake at Pokechain: from the queue, open its
 * cert in the steps above, forward it to Collector Crypt, and have CC vault it (under a new NFT).
 */
async function revaultFoundSlab(intake: Page, cert: string) {
  await intake.getByTestId("found-intake-1").getByRole("button", { name: `Open cert #${cert} above` }).click();
  await expect(intake.getByText(/Current status: Received by Pokechain/)).toBeVisible();
  await intake.getByRole("button", { name: "Forwarded to Collector Crypt", exact: true }).click();
  await expect(intake.getByText(/Current status: At Collector Crypt/)).toBeVisible();
  await intake.getByRole("button", { name: "Vaulted at Collector Crypt", exact: true }).click();
  await expect(intake.getByText("No found-slab claims are waiting at intake.")).toBeVisible();
}

async function signOut(page: Page, handle: string) {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: new RegExp(handle) }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("header").getByRole("button", { name: "Log in" })).toBeVisible();
}

test("lost & found: a bounty is escrowed on-chain, a finder's claim goes through intake, the owner picks the vault, and the finder claims the bounty", async ({ page, request }) => {
  test.setTimeout(240_000);
  const cert = "8887773";
  const shipTo = "Ash Ketchum, 1 Pallet Town Road";
  await vaultedForAsh(page, request, cert);
  await depositAsTest1(200);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Ship to me" }).first().click();
  await page.getByPlaceholder(/Ash Ketchum/).fill(shipTo);
  await page.getByRole("button", { name: "Withdraw and ship to me" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  const shipped = await request.post("/api/chain/outtake", { data: { certNumber: cert } });
  expect(shipped.ok(), await shipped.text()).toBeTruthy();

  // The owner reports it lost with a $50 bounty: LostAndFound escrows it from their balance.
  await page.goto("/vault?tab=withdrawn");
  await page.getByRole("button", { name: "Report lost" }).click();
  await page.getByPlaceholder(/Not delivered after 10 days/).fill("No carrier scan for two weeks");
  await page.getByPlaceholder("Bounty (optional)").fill("50");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByText("Lost report and bounty filed")).toBeVisible();
  expect(await escrowedBounty(Number(cert))).toBe(50);
  expect(await custodyDollars(TEST1)).toBe(150);
  // Cancelling the report refunds the escrow; reporting again escrows it again.
  await page.getByRole("button", { name: "Cancel lost status" }).click();
  await expect(page.getByRole("button", { name: /Confirm delivery/ })).toBeVisible();
  await expect.poll(() => custodyDollars(TEST1)).toBe(200);
  await page.getByRole("button", { name: "Report lost" }).click();
  await page.getByPlaceholder("Bounty (optional)").fill("50");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel lost status" })).toBeVisible();
  await expect.poll(() => escrowedBounty(Number(cert))).toBe(50);

  // Another collector finds it, searches the cert, and files a claim on-chain.
  await signOut(page, "smoke_out");
  await openAccount(page, "smoke_finder", 2);
  await page.getByPlaceholder(/Search Pokechain/).fill(cert);
  await page.getByPlaceholder(/Search Pokechain/).press("Enter");
  await page.getByRole("link", { name: new RegExp(`cert #${cert} is reported lost`) }).click();
  await page.getByRole("button", { name: "Found Slab" }).click();
  await page.getByPlaceholder(/Location, date/).fill("Bought at a Sunday flea market stall in Bugis");
  await page.getByPlaceholder(/Front\/back label/).fill("PSA label shows the cert number, case intact, no tamper marks");
  await page.getByPlaceholder("DHL").fill("SingPost");
  await page.getByPlaceholder("Recovery shipment").fill("RR555000111SG");
  await page.getByRole("button", { name: "Submit found-slab claim" }).click();
  await expect(page).toHaveURL(/\/submissions\?tab=found/);
  const finderCase = page.getByTestId("found-case-1");
  await expect(finderCase).toContainText("You found it");
  await expect(finderCase).toContainText("$50.00 bounty in escrow");

  // Pokechain's intake authenticates it. The finder gets the case update without reloading.
  const intake = await page.context().newPage();
  await intake.goto("/intake");
  await intake.getByTestId("found-intake-1").getByRole("button", { name: "Received & authenticated" }).click();
  await expect(intake.getByText("Waiting for the owner to choose vault or delivery.")).toBeVisible();
  await expect(finderCase).toContainText("Pokechain authenticated the slab you found");

  // The owner chooses the vault; Pokechain returns it, which closes the lost report on SlabVault.
  await signOut(page, "smoke_finder");
  await logIn(page, 1, "smoke_out");
  // The owner can't dodge the bounty now: cancelling the lost report reverts on-chain.
  await page.goto("/vault?tab=withdrawn");
  await page.getByRole("button", { name: "Cancel lost status" }).click();
  await expect(page.getByText(/A finder's claim on this slab is open/)).toBeVisible();
  await page.goto("/submissions?tab=found");
  const ownerCase = page.getByTestId("found-case-1");
  await expect(ownerCase).toContainText("Your lost slab");
  await ownerCase.getByRole("button", { name: "Return to my vault" }).click();
  await expect(page.getByText("Returning to your vault")).toBeVisible();
  await intake.reload();
  await intake.getByTestId("found-intake-1").getByRole("button", { name: "Back into intake for re-vaulting" }).click();
  // It's at Pokechain, not in the vault yet, so the finder can't be paid.
  await expect.poll(() => custodyOf(Number(cert))).toBe(7); // At Pokechain
  await revaultFoundSlab(intake, cert);
  await intake.close();
  expect(await custodyOf(Number(cert))).toBe(1); // Vaulted
  expect(await ownerOf(Number(cert))).toBe(ASH);

  // The NFT is back in the owner's Vault, and the slab is off the Lost page.
  await page.goto("/vault?tab=unlisted");
  await expect(page.getByRole("button", { name: "Ship to me" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/lost");
  await page.getByPlaceholder("Search by card, cert #, notes...").fill(cert);
  await expect(page.getByRole("button", { name: /Open found case|Found Slab/ })).toHaveCount(0);

  // The finder claims the bounty: LostAndFound checks SlabVault says Vaulted, then pays from escrow.
  await signOut(page, "smoke_out");
  await logIn(page, 2, "smoke_finder");
  await page.goto("/submissions?tab=found");
  await page.getByTestId("found-case-1").getByRole("button", { name: "Claim $50.00 bounty" }).click();
  await expect(page.getByText("Bounty claimed")).toBeVisible();
  await expect(page.getByTestId("found-case-1")).toContainText("$50.00 paid to the finder");
  expect(await custodyDollars(TEST2)).toBe(50);
  expect(await escrowedBounty(Number(cert))).toBe(0);
  await page.reload();
  await expect(page.getByTestId("found-case-1")).toContainText("Paid");

  // The payout is in the finder's Wallet history, read from AccountRegistry/LostAndFound events.
  await page.goto("/wallet");
  const finderHistory = page.getByTestId("onchain-payments");
  await expect(finderHistory.getByRole("listitem").filter({ hasText: "Recovery bounty received · case #1" })).toContainText("+$50.00");

  // The owner's history shows the escrow, the refund on cancel, and the second escrow.
  await signOut(page, "smoke_finder");
  await logIn(page, 1, "smoke_out");
  await page.goto("/wallet");
  const ownerHistory = page.getByTestId("onchain-payments");
  await expect(ownerHistory.getByRole("listitem").filter({ hasText: "Lost-slab bounty escrowed" })).toHaveCount(2);
  await expect(ownerHistory.getByRole("listitem").filter({ hasText: "Lost-slab bounty refunded" })).toContainText("+$50.00");
  await expect(ownerHistory.getByRole("listitem").filter({ hasText: "Deposit from wallet" })).toContainText("+$200.00");
});

test("lost & found: the owner picks delivery, and the bounty unlocks only after they confirm receipt", async ({ page, request }) => {
  test.setTimeout(240_000);
  const cert = "8887775";
  await vaultedForAsh(page, request, cert);
  await depositAsTest1(100);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Ship to me" }).first().click();
  await page.getByPlaceholder(/Ash Ketchum/).fill("Ash Ketchum, 1 Pallet Town Road");
  await page.getByRole("button", { name: "Withdraw and ship to me" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  expect((await request.post("/api/chain/outtake", { data: { certNumber: cert } })).ok()).toBeTruthy();
  await page.goto("/vault?tab=withdrawn");
  await page.getByRole("button", { name: "Report lost" }).click();
  await page.getByPlaceholder("Bounty (optional)").fill("40");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel lost status" })).toBeVisible();

  await signOut(page, "smoke_out");
  await openAccount(page, "smoke_finder", 2);
  await page.goto(`/lost?q=${cert}`);
  await page.getByRole("button", { name: "Found Slab" }).click();
  await page.getByPlaceholder(/Location, date/).fill("Left on an MRT seat at Dhoby Ghaut");
  await page.getByPlaceholder(/Front\/back label/).fill("Label matches the cert, small scuff on the case");
  await page.getByPlaceholder("DHL").fill("Ninja Van");
  await page.getByPlaceholder("Recovery shipment").fill("NV0001SG");
  await page.getByRole("button", { name: "Submit found-slab claim" }).click();
  await expect(page.getByTestId("found-case-1")).toContainText("You found it");
  // Pokechain's intake step, run with curl as the /intake page shows it.
  expect((await request.post("/api/chain/found", { data: { claimId: "1", step: "receive" } })).ok()).toBeTruthy();

  await signOut(page, "smoke_finder");
  await logIn(page, 1, "smoke_out");
  await page.goto("/submissions?tab=found");
  const ownerCase = page.getByTestId("found-case-1");
  await ownerCase.getByRole("button", { name: "Deliver to me" }).click();
  await ownerCase.getByPlaceholder("Ash Ketchum, 1 Pallet Town Road").fill("Ash Ketchum, 1 Pallet Town Road");
  await ownerCase.getByRole("button", { name: "Deliver here" }).click();
  await expect(page.getByText("Delivery requested")).toBeVisible();
  const returned = await request.post("/api/chain/found", { data: { claimId: "1", step: "return" } });
  expect(returned.ok(), await returned.text()).toBeTruthy();
  expect(await custodyOf(Number(cert))).toBe(3); // Shipped

  // Shipped isn't enough: the finder's button stays disabled until the owner confirms receipt.
  await signOut(page, "smoke_out");
  await logIn(page, 2, "smoke_finder");
  await page.goto("/submissions?tab=found");
  await expect(page.getByTestId("found-case-1").getByRole("button", { name: "Claim $40.00 bounty" })).toBeDisabled();

  await signOut(page, "smoke_finder");
  await logIn(page, 1, "smoke_out");
  await page.goto("/submissions?tab=found");
  await page.getByTestId("found-case-1").getByRole("button", { name: "Confirm received" }).click();
  await expect(page.getByText("Delivery confirmed")).toBeVisible();
  await expect(ownerOf(Number(cert))).rejects.toThrow(); // burned on confirmed delivery

  await signOut(page, "smoke_out");
  await logIn(page, 2, "smoke_finder");
  await page.goto("/submissions?tab=found");
  await page.getByTestId("found-case-1").getByRole("button", { name: "Claim $40.00 bounty" }).click();
  await expect(page.getByTestId("found-case-1")).toContainText("$40.00 paid to the finder");
  expect(await custodyDollars(TEST2)).toBe(40);
});

test("lost & found: a slab that never reached the vault: a delay report, Pokechain's investigation, then an on-chain lost report with a bounty, then written off", async ({ page, request }) => {
  const cert = "8887774";
  await openAccount(page, "smoke_inbound");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill(cert);
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await expect(page.getByText(/^keccak 0x/)).toHaveCount(3);
  await page.getByPlaceholder("RR123456789SG").fill("RR000777999SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page).toHaveURL(/\/submissions$/);
  const received = await request.post("/api/chain/receive", { data: { submissionId: cert } });
  expect(received.ok(), await received.text()).toBeTruthy();
  await depositAsTest1(100);

  // Months later it still isn't vaulted: the owner reports the delay privately (nothing public yet).
  await page.goto("/vault?tab=awaiting");
  await page.getByRole("button", { name: "Report vaulting delay" }).click();
  await page.getByPlaceholder(/The card has not been vaulted yet/).fill("Still not vaulted after three months");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("main").getByText("Vaulting delay reported")).toBeVisible();
  expect(await custodyOf(Number(cert))).toBe(7); // still At Pokechain

  // The vault team's investigation (simulated on /intake) confirms it was lost.
  const intake = await page.context().newPage();
  await intake.goto("/intake");
  await intake.getByPlaceholder("4324324").fill(cert);
  await intake.getByRole("button", { name: "Simulate investigation" }).click();
  await intake.close();

  // The owner publishes it with a $75 bounty: SlabVault.reportLost, then LostAndFound escrows the $75.
  await page.goto("/vault?tab=awaiting");
  await page.getByRole("button", { name: "Pokechain replied — review" }).click();
  await page.getByRole("button", { name: /Publish a lost-card bounty/ }).click();
  await page.getByPlaceholder("e.g. 150").fill("75");
  await page.getByRole("button", { name: "Publish lost card" }).click();
  await expect.poll(() => escrowedBounty(Number(cert))).toBe(75);
  expect(await custodyOf(Number(cert))).toBe(5); // Lost
  expect(await custodyDollars(TEST1)).toBe(25);
  await expect(page.getByRole("button", { name: "Edit bounty" })).toBeVisible();
  await page.goto(`/lost?q=${cert}`);
  await expect(page.locator("div.rounded-card").filter({ hasText: `#${cert}` })).toContainText("$75.00 PokeCredits");

  // The owner gives up and claims insurance: the bounty comes back and the token is burned.
  await page.goto("/vault?tab=awaiting");
  await page.getByRole("button", { name: "Withdraw & claim insurance" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw and claim insurance" }).click();
  await expect.poll(() => custodyOf(Number(cert))).toBe(10); // Written off
  expect(await escrowedBounty(Number(cert))).toBe(0);
  expect(await custodyDollars(TEST1)).toBe(100);
  await page.goto(`/lost?q=${cert}`);
  await expect(page.locator("div.rounded-card").filter({ hasText: `#${cert}` })).toHaveCount(0);
});

test("lost & found: a slab one collector reports lost is on every collector's Lost page, read from the chain", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  await resetSeeded(request);
  // The seeded demo already has two slabs reported lost on-chain, visible to a logged-out visitor.
  await page.goto("/lost");
  await expect(page.getByText(/Showing\s*2\s*cards/)).toBeVisible();
  await expect(page.getByText("$350.00 PokeCredits").first()).toBeVisible();

  // test2 withdraws one of their slabs; it never arrives, so they report it lost with a $150 bounty.
  await depositAsTest2(150);
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await logIn(owner, 2, "test2");
  await owner.goto("/vault");
  await owner.getByRole("button", { name: "Ship to me" }).first().click();
  const cert = (await owner.getByRole("dialog").getByText(/PSA cert \d+/).innerText()).match(/cert (\d+)/)![1];
  await owner.getByPlaceholder(/Ash Ketchum/).fill("test2, 2 Cerulean Way");
  await owner.getByRole("button", { name: "Withdraw and ship to me" }).click();
  await owner.getByRole("button", { name: "Done" }).click();
  expect((await request.post("/api/chain/outtake", { data: { certNumber: cert } })).ok()).toBeTruthy();
  await owner.goto("/vault?tab=withdrawn");
  await owner.getByRole("button", { name: "Report lost" }).click();
  await owner.getByPlaceholder(/Not delivered after 10 days/).fill("Courier lost the parcel at the Tampines hub");
  await owner.getByPlaceholder("Bounty (optional)").fill("150");
  await owner.getByRole("button", { name: "File", exact: true }).click();
  await expect(owner.getByText("Lost report and bounty filed")).toBeVisible();
  expect(await custodyOf(Number(cert))).toBe(5); // Lost
  expect(await escrowedBounty(Number(cert))).toBe(150);
  // Nothing about the public report is kept in the owner's browser.
  const savedPublicLosses = await owner.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("pokechain.state"))
      .flatMap((k) => Object.values((JSON.parse(localStorage.getItem(k)!).vaultLosses ?? {}) as Record<string, { published?: boolean }>))
      .filter((loss) => loss.published !== false),
  );
  expect(savedPublicLosses).toEqual([]);

  // test1, in their own browser, sees it on the Lost page with its bounty and report, and after a reload.
  await logIn(page, 1, "test1");
  await page.goto(`/lost?q=${cert}`);
  const card = page.locator("div.rounded-card").filter({ hasText: `#${cert}` });
  await expect(card).toContainText("Courier lost the parcel at the Tampines hub");
  await expect(card).toContainText("$150.00 PokeCredits");
  await expect(card.getByRole("button", { name: "Found Slab" })).toBeVisible();
  await page.reload();
  await expect(card).toContainText("$150.00 PokeCredits");
  await page.goto("/lost");
  await expect(page.getByText(/Showing\s*3\s*cards/)).toBeVisible();

  // test2 writes it off for insurance: SlabVault refunds the bounty and burns the token, so it leaves everyone's Lost page.
  await owner.goto(`/lost?q=${cert}`);
  await owner.locator("div.rounded-card").filter({ hasText: `#${cert}` }).getByRole("button", { name: "Withdraw", exact: true }).click();
  await owner.getByRole("button", { name: "Withdraw and claim insurance" }).click();
  await expect.poll(() => custodyOf(Number(cert))).toBe(10); // Written off
  expect(await escrowedBounty(Number(cert))).toBe(0);
  await expect(ownerOf(Number(cert))).rejects.toThrow();
  await page.goto("/lost");
  await expect(page.getByText(/Showing\s*2\s*cards/)).toBeVisible();
  await ownerCtx.close();
});

test("bounty: the owner raises and lowers it from escrow, can't overspend, and a finder of a slab lost in the vault is paid", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await resetSeeded(request);
  // Seeded: test2's Shining Celebi went missing in the vault with $250 escrowed; test1's Alakazam with $100.
  const celebi = 79961445;
  const alakazam = 92596655;
  expect(await escrowedBounty(celebi)).toBe(250);
  expect(await custodyDollars(TEST2)).toBe(0);

  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await logIn(owner, 2, "test2");
  await owner.goto("/vault");
  await expect(owner.getByText("Lost in vault")).toBeVisible();
  await expect(owner.getByText("Bounty: $250.00")).toBeVisible();

  // Raising it with no Pokechain balance is refused before anything is sent.
  const editBounty = async (dollars: number) => {
    await owner.goto(`/lost?q=${celebi}`);
    await owner.locator("div.rounded-card").filter({ hasText: `#${celebi}` }).getByRole("button", { name: "Edit bounty" }).click();
    await owner.getByRole("spinbutton").fill(String(dollars));
    await owner.getByRole("button", { name: "Save bounty" }).click();
  };
  await editBounty(400);
  await expect(owner.getByText(/needs \$150\.00 more, but your Pokechain balance is \$0\.00/)).toBeVisible();
  expect(await escrowedBounty(celebi)).toBe(250);

  // With $200 deposited: raise to $400 (escrows $150 more), then lower to $300 (refunds $100).
  await depositAsTest2(200);
  await owner.getByRole("button", { name: "Save bounty" }).click();
  await expect.poll(() => escrowedBounty(celebi)).toBe(400);
  expect(await custodyDollars(TEST2)).toBe(50);
  await editBounty(300);
  await expect.poll(() => escrowedBounty(celebi)).toBe(300);
  expect(await custodyDollars(TEST2)).toBe(150);
  await owner.reload();
  await expect(owner.locator("div.rounded-card").filter({ hasText: `#${celebi}` })).toContainText("$300.00 PokeCredits");

  // test1 cancels the bounty on their own lost Alakazam from the Vault: the $100 comes back.
  await logIn(page, 1, "test1");
  const test1Before = await custodyDollars(TEST1);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Cancel bounty" }).click();
  await expect.poll(() => escrowedBounty(alakazam)).toBe(0);
  expect(await custodyDollars(TEST1)).toBe(test1Before + 100);

  // test1 finds test2's Celebi and files a claim; the case shows the escrowed bounty.
  await page.goto(`/lost?q=${celebi}`);
  await page.getByRole("button", { name: "Found Slab" }).click();
  await page.getByPlaceholder(/Location, date/).fill("Spotted at a card show in Suntec, seller had no paperwork");
  await page.getByPlaceholder(/Front\/back label/).fill("BGS label matches the cert, subgrades 8 / 9.5 / 8 / 8.5");
  await page.getByPlaceholder("DHL").fill("SingPost");
  await page.getByPlaceholder("Recovery shipment").fill("RR777000111SG");
  await page.getByRole("button", { name: "Submit found-slab claim" }).click();
  const finderCase = page.getByTestId("found-case-1");
  await expect(finderCase).toContainText("$300.00 bounty in escrow");

  // Pokechain authenticates it, test2 picks their vault, and Pokechain puts it back.
  const intake = await page.context().newPage();
  await intake.goto("/intake");
  await intake.getByTestId("found-intake-1").getByRole("button", { name: "Received & authenticated" }).click();
  await expect(intake.getByText("Waiting for the owner to choose vault or delivery.")).toBeVisible();
  await owner.goto("/submissions?tab=found");
  await owner.getByTestId("found-case-1").getByRole("button", { name: "Return to my vault" }).click();
  await expect(owner.getByText("Returning to your vault")).toBeVisible();
  await intake.reload();
  await intake.getByTestId("found-intake-1").getByRole("button", { name: "Back into intake for re-vaulting" }).click();
  await revaultFoundSlab(intake, String(celebi));
  await intake.close();
  expect(await custodyOf(celebi)).toBe(1); // Vaulted again
  await owner.goto("/vault");
  await expect(owner.getByText("Lost in vault")).toHaveCount(0);

  // test1 claims the bounty: LostAndFound pays the $300 from escrow.
  const finderBefore = await custodyDollars(TEST1);
  await page.goto("/submissions?tab=found");
  await page.getByTestId("found-case-1").getByRole("button", { name: "Claim $300.00 bounty" }).click();
  await expect(page.getByTestId("found-case-1")).toContainText("$300.00 paid to the finder");
  expect(await custodyDollars(TEST1)).toBe(finderBefore + 300);
  expect(await escrowedBounty(celebi)).toBe(0);
  await page.goto("/lost");
  await expect(page.getByText(/Showing\s*1\s*card/)).toBeVisible();
  await ownerCtx.close();
});
