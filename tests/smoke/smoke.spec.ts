import type { Page } from "@playwright/test";
import { createPublicClient, http } from "viem";
import { hardhat } from "viem/chains";
import { deployments, slabVaultAbi } from "../../src/lib/chain/generated";
import { expect, test } from "./fixtures";
import { ASH, MISTY, custodyDollars, forwardedSubmission, isListed, listAsMisty, loadDemoTraders, logIn, openAccount, ownerOf, resetDemo } from "./helpers";

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
  await expect(page.getByText("Pick slabs or add cash and the balance appears here.")).toBeVisible();
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Add at least one of your slabs")).toBeVisible(); // empty offers are refused

  for (const id of [1, 2, 3]) await page.getByRole("button", { name: new RegExp(`Pikachu.*#${id}$`) }).click();
  await page.getByLabel("You give: cash").fill("50");
  for (const id of [5, 6]) await page.getByRole("button", { name: new RegExp(`Articuno.*#${id}$`) }).click();

  // Everything at market: 3 Pikachus ($104.96 + $8.00 + $207.22) + $50 for 2 Articunos ($1,057.00 + $445.05).
  const balance = page.getByTestId("trade-balance");
  // That is hugely in ash's favour, and the panel says so before he sends it.
  await expect(balance).toContainText("Lopsided, in your favour");
  await expect(balance.getByTestId("trade-net")).toHaveText("+$1,131.87");
  // The stated value of each Pikachu is $500 (that is what was declared at submission): counting them
  // at that makes the same swap fair, even slightly against ash. Both numbers stay on screen, so nobody has to take it on trust.
  for (const id of [1, 2, 3]) {
    await page.getByRole("button", { name: /stated \$500\.00/ }).nth(id - 1).click();
  }
  await expect(balance).toContainText("Fair trade");
  await expect(balance.getByTestId("trade-net")).toHaveText("−$47.95");
  await expect(balance).toContainText("Pikachu: stated $500.00 vs market $8.00."); // an inflated stated value is called out
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
  // She gives $1,502.05 of Articunos at market and gets $1,550.00 at what ash stated: fair on those numbers...
  await expect(card.getByTestId("trade-verdict")).toHaveText("Fair trade");
  // ...but at market, the Pikachus are worth far less. Her own view of the same offer says so, and tells no one.
  await card.getByText("See it at market and at stated values").click();
  await expect(card.getByRole("row", { name: /Everything at market/ })).toContainText("−$1,131.87");
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

  // His Charizard (market $1,207) for her listed Articuno (market $1,057): ash is giving more, and the panel says so.
  await page.getByRole("button", { name: /Charizard.*#4$/ }).click();
  await page.getByRole("button", { name: /Articuno.*#5$/ }).click();
  await expect(page.getByText("Listed for sale: it is delisted if they accept")).toBeVisible();
  await expect(page.getByTestId("trade-balance").getByTestId("trade-net")).toHaveText("−$150.00");
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
