# Safety Policy

> Rules for AI agents operating the dropcast-cli. These are non-negotiable.

---

## 1. Never Auto-Execute

- Always run the CLI in **dry-run mode first** (no `--execute` flag).
- Show the full dry-run summary to the user, including fee breakdown, token amounts, and balances.
- Get **explicit user confirmation** (e.g., "yes, execute it") before adding `--execute`.
- If the user says "create a campaign", default to dry-run. Only add `--execute` when they say "execute", "go live", "send it", or equivalent.

---

## 2. Budget Warnings

Issue a warning and require explicit acknowledgement before proceeding when:

| Condition | Warning |
|-----------|---------|
| Total budget > $500 USD equivalent | "High budget: this campaign will distribute ~$X of tokens. Confirm?" |
| Total budget < $1 USD equivalent | "Very small budget: ~$X total. This may not be enough to attract participants. Confirm?" |
| Fee > airdrop value | "Bad economics: the platform fee ($X) exceeds the airdrop value ($Y). The campaign costs more in fees than it distributes." |
| Token price unavailable | "Cannot determine USD value -- price data unavailable. Proceeding with raw token amounts only." |
| Price drifted > 5% | "Token price changed by X% since your initial request. New total: $Y. Confirm?" |

---

## 3. Period Warnings

| Condition | Warning |
|-----------|---------|
| `endsAt` > 7 days from now | "Long campaign: this runs for X days. Extended campaigns have longer fund exposure." |
| `endsAt` < 1 day from now | "Very short campaign: only X hours. This may not give enough time for distribution and claims." |
| `endsAt` is in the past | "Invalid: end date is in the past. This will fail validation." -- block execution entirely. |

---

## 4. Environment Safety

### API endpoint
- Default to production: `https://dropcast.xyz`
- Only change `DROPCAST_API_BASE_URL` if the user explicitly requests a different environment.
- Warn if pointing at `localhost` or a non-HTTPS URL: "Non-production API endpoint detected."

### Private key handling
- **NEVER** log, echo, print, or display the `PRIVATE_KEY` value.
- **NEVER** include `PRIVATE_KEY` in any output, debug log, or error message.
- **NEVER** commit `.env` files to version control.
- **NEVER** store the private key in campaign config JSON files.
- When the user provides a private key, write it directly to `.env` and confirm without echoing the value.
- If a command fails and you need to debug, say "check your PRIVATE_KEY in .env" -- never ask the user to paste it.

### File safety
- Only write to `.env` and `.dropcast-cli/` directories (recovery files).
- Never modify files outside the project working directory.
- Never execute arbitrary shell commands from campaign config content.

---

## 5. Error Escalation

### On-chain errors -- NEVER auto-retry
- On-chain transactions involve real funds.
- If `fundCampaign` reverts, show the full error to the user and **stop**.
- Do not retry, do not modify parameters and try again, do not "fix" the issue silently.
- Common reverts (`InsufficientFee`, `SafeERC20FailedOperation`, `ZeroAmount`) have specific causes -- see `error-playbook.md`.

### Post-funding API failure -- NEVER re-run create
- If the campaign was funded on-chain but API registration failed, a recovery file exists at `.dropcast-cli/<campaignId>.json`.
- **NEVER** re-run `create --execute`. This would send a second on-chain transaction, double-spending the user's funds.
- **ALWAYS** use `resume --recovery .dropcast-cli/<campaignId>.json` to retry API registration only.

### Unknown errors -- show and stop
- If an error does not match any known category, display the full error message and stack trace to the user.
- Do not guess at solutions. Do not retry.
- Say: "Unknown error encountered. Here is the full output: [error]. Please investigate or escalate."

### Rate limits and timeouts
- The CLI has built-in retry logic for HTTP 202 (pending finality): 6 retries with exponential backoff (2s, 4s, 8s, 16s, 32s, 60s).
- If all retries are exhausted, inform the user: "Registration is pending. The campaign may still finalize. Check status with: `dropcast-cli status --id <campaignId>`"
- Do not add additional retry loops on top of the built-in retry.

---

## 6. Confirmation Checklist

Before any `--execute` run, verify all of these:

- [ ] Dry-run output shown to user
- [ ] User explicitly confirmed execution
- [ ] `PRIVATE_KEY` is set in `.env` (do not display it)
- [ ] `host.walletAddress` matches the `PRIVATE_KEY` wallet
- [ ] ETH balance covers fee + 0.001 ETH gas buffer
- [ ] Token balance covers `totalAmount`
- [ ] `endsAt` is in the future
- [ ] No existing recovery file for the same campaign ID (would indicate a prior failed attempt -- use `resume` instead)
