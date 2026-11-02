import { expect, test } from "./fixtures";
import { listAsMisty, loadDemoTraders, logIn, openAccount, resetDemo } from "./helpers";

// Two separate browsers, like a normal window and an incognito one: they share no localStorage, so
// everything has to come from the chain or the server. No page under test is ever reloaded.

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("live: a listing, a chat, a trade offer and its acceptance show up in the other collector's browser without a reload", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  await loadDemoTraders(request);
  await logIn(page, 1, "ash");

  const ctx = await browser.newContext();
  const misty = await ctx.newPage();
  await logIn(misty, 2, "misty");

  // A listing made right after the page opens, before its block subscription is confirmed.
  await page.goto("/marketplace");
  await listAsMisty(70000136, 900);
  await expect(page.getByText("Articuno").first()).toBeVisible({ timeout: 8_000 });

  // Misty opens a chat: ash's inbox and the chat itself follow.
  await page.goto("/trades");
  await misty.goto("/trades");
  await misty.getByRole("button", { name: "Chat with @ash" }).click();
  await misty.getByPlaceholder("Message ash…").fill("Hello from misty");
  await misty.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/misty/).first()).toBeVisible({ timeout: 8_000 });
  await page.getByRole("link", { name: /misty/ }).first().click();
  await expect(page.getByText("Hello from misty")).toBeVisible({ timeout: 8_000 });

  // Messages both ways while both have the chat open.
  await misty.getByPlaceholder("Message ash…").fill("Second message");
  await misty.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Second message")).toBeVisible({ timeout: 8_000 });
  await page.getByPlaceholder("Message misty…").fill("Reply from ash");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(misty.getByText("Reply from ash")).toBeVisible({ timeout: 8_000 });

  // Misty sends a trade offer from the chat: it appears in ash's open chat.
  await misty.getByRole("button", { name: "Make a trade offer" }).click();
  await misty.getByRole("button", { name: "Add items" }).click();
  await misty.getByRole("dialog").getByRole("button", { name: /Articuno.*token #70000256(?!\d)/ }).click();
  await misty.getByRole("dialog").getByRole("button", { name: "Add items" }).click();
  await misty.getByRole("button", { name: "Request items" }).click();
  await misty.getByRole("dialog").getByRole("button", { name: /Pikachu.*token #70000013(?!\d)/ }).click();
  await misty.getByRole("dialog").getByRole("button", { name: "Request items" }).click();
  await misty.getByRole("button", { name: "Send offer" }).click();
  await expect(misty.getByTestId("trade-status")).toHaveText("Waiting for them");
  await expect(page.getByTestId("trade-status")).toHaveText("Your move", { timeout: 8_000 });

  // Ash accepts: misty's chat and her open Vault tab follow.
  const mistyVault = await ctx.newPage();
  await mistyVault.goto("/vault");
  await expect(mistyVault.getByText("In offer #1")).toHaveCount(1, { timeout: 8_000 });
  const ashWallet = await (await page.context()).newPage();
  await ashWallet.goto("/wallet");
  await page.getByTestId("trade-card").getByRole("button", { name: "Accept trade" }).click();
  await expect(page.getByTestId("trade-status")).toHaveText("Accepted");
  await expect(misty.getByTestId("trade-status")).toHaveText("Accepted", { timeout: 8_000 });
  await expect(mistyVault.getByText("In offer #1")).toHaveCount(0, { timeout: 8_000 });
  await expect(mistyVault.getByText(/Pikachu/).first()).toBeVisible({ timeout: 8_000 });

  await ctx.close();
});

test("live: a vaulting-delay report reaches /intake in another browser, and the investigation reaches the collector", async ({ page, browser, request }) => {
  const cert = "8887776";
  await openAccount(page, "smoke_live");
  await page.goto("/submit");
  await page.getByLabel("Certification number").fill(cert);
  await page.getByRole("button", { name: /Use sample photos/ }).click();
  await page.getByPlaceholder("RR123456789SG").fill("RR000777997SG");
  for (const text of [/I own this slab/, /The slab is authentic/, /I agree to Pokechain/]) {
    await page.getByText(text).click();
  }
  await page.getByRole("button", { name: "Upload evidence and submit on-chain" }).click();
  await expect(page).toHaveURL(/\/submissions$/);
  const received = await request.post("/api/chain/receive", { data: { submissionId: cert } });
  expect(received.ok(), await received.text()).toBeTruthy();

  await page.goto("/vault?tab=awaiting");
  await page.getByRole("button", { name: "Report vaulting delay" }).click();
  await page.getByPlaceholder(/The card has not been vaulted yet/).fill("Still not vaulted");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Vaulting delay under review")).toBeVisible();
  await page.goto("/submissions");
  await page.getByRole("button", { name: /Recovery & insurance/ }).click();
  await expect(page.getByRole("button", { name: "Review reply" })).toHaveCount(0);

  // The vault team works in its own browser, which has none of the collector's saved state.
  const teamCtx = await browser.newContext();
  const intake = await teamCtx.newPage();
  await intake.goto("/intake");
  await intake.getByPlaceholder("4324324").fill(cert);
  await intake.getByRole("button", { name: "Simulate investigation" }).click();
  await expect(intake.getByRole("button", { name: "Simulate investigation" })).toHaveCount(0);
  await teamCtx.close();

  await expect(page.getByRole("button", { name: "Review reply" })).toBeVisible({ timeout: 8_000 });
});
