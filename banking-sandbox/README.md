# Banking UI Sandbox

A synthetic test application for AI computer-use automation: Discovery, a JSON
Capability Contract, and deterministic Playwright Replay.

This is not a banking system. All customers and transactions are fictional.
There is no backend service: the simulated api() function lives in shared.js,
and browser state is stored in localStorage under the sbx key.

## Run

From the repository root:

```powershell
npm.cmd run sandbox:serve
```

Open http://localhost:8080/ and choose Modern, Legacy or Awkward.
For an optional Python server, port configuration and browser storage behavior,
see the [integration guide](INTEGRATION.md) and [project setup](../README.md).

## Files

| File | Purpose |
| --- | --- |
| shared.js | Synthetic data, simulated API, failure modes and test panel |
| modern.html | Conventional labeled forms and buttons |
| legacy/index.html | Outer table layout and iframe |
| legacy/content.html | Legacy content with nested tables and custom controls |
| awkward.html | Ambiguous controls and asynchronous UI states |

## Synthetic members

| ID | Name | Account type | Balance |
| --- | --- | --- | --- |
| M-1001 | Anna Kovalenko | Checking | $2,450.75 |
| M-1002 | Bohdan Melnyk | Savings | $18,200.00 |
| M-1003 | Sam Rivera | Checking | $310.40 |
| M-1004 | Olena Shevchenko | Business | $92,500.10 |
| M-1005 | Taras Bondar | Term Deposit | $50,000.00 |
| M-1006 | Iryna Lysenko | Savings | $7,640.20 |
| M-1007 | Maksym Tkach | Checking | $0.00 |
| M-1008 | Daria Petrenko | Savings | $1,299.99 |
| M-1009 | Sam Rivera | Savings | $15,800.00 |
| M-1010 | Yuri Savchenko | Business | $430,250.00 |
| M-1011 | Kateryna Moroz | Checking | -$120.50 |
| M-1012 | Leo Hrytsenko | Term Deposit | $25,000.00 |

The duplicate name Sam Rivera (M-1003 and M-1009) exercises scoped row selection.
These are fixture data values; not every UI exposes every field.

## Example scenarios

1. Search for M-1001 and inspect the member details and $2,450.75 balance.
2. Search for Sam Rivera, distinguish the two members, and select M-1009 with a
   $15,800.00 balance.
3. Open a Savings sub-account for M-1002 and verify its confirmation and appearance
   in member details. A fresh state produces M-1002-S1; subsequent creation uses S2.
4. On Legacy details, the Print Statement canvas exercises coordinate targeting;
   its simulated response is Statement queued (simulated).
5. Exercise negative outcomes: empty search and a missing member such as zzz.

These describe fixture scenarios, not a claim that every automation path passes.
Legacy account-type selection has a known defect reproduced manually by the
administrator. Awkward details do not expose the primary account type.

## Locator challenges

- **Modern:** role/name targeting, labeled inputs, and alert/status regions.
- **Legacy:** frame traversal, nested tables, clickable td/span elements without
  semantic roles, unlabeled inputs, scoped rows and a canvas control.
- **Awkward:** two Open buttons per row, additional Open controls on other screens,
  deep wrappers, debounced search, staggered results, a delayed balance, delayed
  account-type options, Next appearing only after selection, and a transient toast.

## Failure modes

The test panel appears in the lower-right corner of the top window. Choose a mode
there or use a URL such as /modern.html?mode=SLOW_LOADING. The selected mode remains
active until changed or reset.

| Mode | Behavior |
| --- | --- |
| NONE | Normal behavior |
| NOT_FOUND | Search and member lookup return NOT_FOUND |
| VALIDATION_ERROR | Sub-account creation returns VALIDATION_ERROR; Legacy shows an error screen with Back |
| PERMISSION_DENIED | Sub-account creation returns PERMISSION_DENIED |
| SESSION_EXPIRED | The first simulated API call shows a session error and Log in; login restores access until the mode is rearmed |
| SLOW_LOADING | Each simulated API call takes four seconds instead of 0.3 seconds |
| UNEXPECTED_DIALOG | A Scheduled maintenance notice dialog appears before each call |
| TIMEOUT | The response never arrives; loading remains indefinitely |

Reset state clears sub-accounts, sets the mode to NONE and restores the active
session. Starting the server does not reset state. Fresh automation browser
contexts do not share your existing browser's localStorage.
