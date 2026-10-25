@AGENTS.md

## Definition of done

Don't call a change done until all of these are true:

1. **Clicked through in the browser.** Start the dev server (`.claude/launch.json`), then for every role the
   change touches, do the main flow like a user would. Reload to check the data stayed.
2. **Clean console and server logs.** No errors, no duplicate-key warnings, no 4xx/5xx responses you didn't
   expect.
3. **Smoke tests pass:** `npm run test:smoke`. Add or extend a test for every new flow.
4. **The reply says** what changed, how to run it, how to test it, and what wasn't verified.
