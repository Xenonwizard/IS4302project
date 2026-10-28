import { test as base, expect } from "@playwright/test";

// Every smoke test fails on a console error, an uncaught exception or a 5xx response,
// because "the page rendered" is not the same as "it works". Duplicate React keys show
// up here as console errors, which is the point.
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });
      // Graded prices come from a rate-limited free API: keep it out of the tests unless a test stubs a price.
      await page.route("**/api/pricing/graded?**", (route) => route.fulfill({ json: { error: "Pricing is stubbed in smoke tests." } }));
      await use(problems);
      expect(problems, problems.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
