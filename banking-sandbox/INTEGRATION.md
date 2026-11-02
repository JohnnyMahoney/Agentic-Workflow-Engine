# Bundled Banking Sandbox

The HTML, JavaScript and original README were copied byte-for-byte from the
user's Desktop/BankGPT fixture, including both Legacy frame files. Modern, Legacy
and Awkward use the same synthetic data and browser-local `sbx` storage.

From the repository root:

```powershell
npm.cmd run sandbox:serve
```

Open http://localhost:8080/ and choose a UI. The server needs only Node.js and
serves this fixture; no backend, Python installation or extra package is required.
Stop it with Ctrl+C. If another server already uses 8080, stop that server before
switching to this copy, or use `npm.cmd run sandbox:serve -- --port 8081`.
Do not run both servers on the same port.

The default port preserves the URLs in the saved requests, artifacts and origin
policy. A custom port requires matching request URLs, policy origins and the
runtime test's BANKING_SANDBOX_URL. Existing saved artifacts retain their original
URLs and must be recompiled for a different origin.

For Discovery/Compilation/Replay commands see the repository README's bundled
sandbox demo. Its request and policy are in examples/banking/. A model API key is
needed for Discovery and Compilation; serving the UI and Replay need none.

Browser state belongs to the browser context and origin. Fresh automation contexts
do not share sub-accounts with an already open Chrome window. Changing a server
at the same localhost origin does not itself clear that Chrome window's storage.
The test panel can clear storage with Reset state; starting this server never resets it.

Known fixture limitations are preserved:

- Legacy's custom account-type click is broken and was manually reproduced by the
  administrator (E2E Test 5). Bundling does not repair or change its behavior.
- Awkward member details omit the primary account type and load balance later.
- These are simulated accounts and transactions, with no production banking API.

The original README in this directory describes the standalone fixture. This
integration guide provides the current repository commands and known limits.
