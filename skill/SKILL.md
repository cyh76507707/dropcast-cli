# dropcast-cli Skill Definition

> Skill file for AI agents. Read this to learn how to create DropCast airdrop campaigns.

## 1. Overview

`dropcast-cli` is a command-line tool for creating **DropCast** token airdrop campaigns on **Base Mainnet** (chain ID 8453).

- **Platforms**: Farcaster, X (Twitter)
- **Reward types**: `pool_split` (total split among all participants) or `fixed` (fixed amount per user)
- **On-chain**: Funds are locked via the DropCast Router contract; fees are paid in ETH
- **Commands**: `validate`, `create`, `resume`, `status`, `list`

The CLI is installed locally in the project. Run via `npx dropcast-cli <command>` or the built binary.

All API requests include the `X-Dropcast-Client: cli` header. The backend persists this as `campaigns.created_via = 'cli'`, enabling the `/ai` page to deterministically filter CLI-originated campaigns. Historical campaigns (created before source tagging was deployed) may have `created_via = NULL`; `NULL` is also expected for non-CLI creation paths (e.g. the web app).

## 2. Quick Defaults

```
Default token:    USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 6 decimals)
Default budget:   12 USDC pool_split
Default period:   1 day (now + 24h)
Farcaster:        follow + like + recast | minFollowers: 20, minAccountAgeDays: 7 | fee ~0.0018 ETH
X:                proof-of-read only     | minXFollowers: 20                      | fee ~0.0037 ETH
ETH needed:       ~0.005 ETH for fee + gas (covers both platforms with buffer)
```

## 3. Workflow

Follow these steps in order. **Never skip the dry-run.**

### Step 1: Build the campaign config

The user's **post URL** is the primary required input. Parse the user's request and write a `campaign.json` file.

- **Farcaster**: Use `skill/templates/campaign.farcaster.template.json` as the starting point. Resolve the cast from the Farcaster URL and **suggest** `host.fid` from `cast.author.fid` — confirm with user before using.
- **X**: Use `skill/templates/campaign.x.template.json` as the starting point. `host.fid` must be asked or known from context (X posts don't carry FID).
- **Token**: Default to USDC if the user doesn't specify a token.

Fields the agent **must** replace from user/context:
- `host.fid` -- the user's Farcaster FID (integer). For Farcaster campaigns, suggest from cast author; for X, must ask.
- `host.walletAddress` -- the user's wallet address (0x...)
- `post.url` -- the Farcaster or X post URL
- `schedule.endsAt` -- **must always be overwritten**. Compute as `now + 24h` by default, or from user input. The template uses `2099-12-31` as a placeholder — never submit this value.

Fields the agent replaces **only if user specifies non-default values**:
- `token.address`, `token.symbol`, `token.decimals` -- only if not using USDC
- `reward.totalAmount` (pool_split) or `reward.amountPerUser` + `reward.maxParticipants` (fixed)
- `actions.*` -- engagement actions (template defaults are opinionated per platform)
- `targeting.*` -- audience filters (template defaults are opinionated per platform)

**Before writing the config**, present a defaults summary for user confirmation:
> "Using defaults: 12 USDC pool_split, ends in 24h, follow+like+recast. Confirm or adjust?"

For X campaigns, set `platform` to `"x"` and use a tweet URL for `post.url`.

### Step 2: Offline schema validation

```bash
dropcast-cli validate --config campaign.json --offline --json
```

This checks the Zod schema locally with zero network calls. Fix any reported errors before proceeding.

### Step 3: Full validation with live data

```bash
dropcast-cli validate --config campaign.json --json
```

This resolves the cast/post, fetches the token price, checks wallet balances, and calculates fees. Present the result to the user.

### Step 4: Dry-run the create command

```bash
dropcast-cli create --config campaign.json --json
```

Without `--execute`, `create` runs in **dry-run mode**: it resolves on-chain data, calculates fees, checks balances, and returns a full preview. No transactions are sent. Present the dry-run summary to the user.

### Step 5: Execute (only after explicit user confirmation)

```bash
dropcast-cli create --config campaign.json --execute --yes --json
```

**Requires** the `PRIVATE_KEY` environment variable. The `--yes` flag skips the interactive prompt (safe when the agent controls invocation). The CLI will:
1. Approve the ERC-20 token spend (if allowance insufficient)
2. Call `fundCampaign()` on the Router contract (sends tokens + ETH fee)
3. Write a recovery file to `.dropcast-cli/<campaignId>.json`
4. Register the campaign via `POST /api/campaigns` (with `X-Dropcast-Client: cli` header and internal 202 retry)
5. On success, delete the recovery file and return the campaign details

### Step 6: Error recovery

If the CLI exits with an error **after** on-chain funding succeeded, use `resume`:

```bash
dropcast-cli resume --recovery .dropcast-cli/<campaignId>.json --json
```

This re-sends the API registration call without any on-chain transaction.

## 4. Commands Reference

Always use `--json` for structured, parseable output.

### validate

Validate a campaign config file.

```
dropcast-cli validate --config <path> [--offline] [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--config, -c` | Yes | Path to campaign.json |
| `--offline` | No | Schema-only check (no network) |
| `--json` | No | Output as JSON |

**JSON output (offline):** `{ "valid": true, "config": { ... } }`
**JSON output (online):** `{ "valid": true, "config": { ... }, "fee": { "total": 0.0014, "totalFormatted": "0.0014 ETH", "breakdown": { ... } }, "tokenPriceUsd": ..., "totalAmount": "...", "castPreview": { ... } }`

### create

Create a campaign. Dry-run by default; add `--execute` for live execution.

```
dropcast-cli create --config <path> [--execute] [--campaign-id <uuid>] [--yes] [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--config, -c` | Yes | Path to campaign.json |
| `--execute` | No | Send real transactions (requires PRIVATE_KEY) |
| `--campaign-id` | No | Reuse a UUID for idempotent retries |
| `--yes, -y` | No | Skip interactive confirmation prompt |
| `--json` | No | Output as JSON |

**Dry-run JSON output:** `{ "mode": "dry-run", "campaignId": "...", "fee": { ... }, "totalAmount": "...", "config": { ... }, "balances": { ... } }`
**Execute JSON output (success):** `{ "success": true, "campaignNumber": 42, "campaignId": "...", "fundingTxHash": "0x...", "status": "active", "viewUrl": "https://dropcast.xyz/campaign/42" }`
**Execute JSON output (error):** `{ "error": "...", "status": 403, "recoveryFile": ".dropcast-cli/<id>.json", "fundingTxHash": "0x..." }`

### resume

Resume a funded-but-unregistered campaign from its recovery file. Sends no on-chain transactions.

```
dropcast-cli resume --recovery <path> [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--recovery, -r` | Yes | Path to recovery file (`.dropcast-cli/<id>.json`) |
| `--json` | No | Output as JSON |

**JSON output (success):** `{ "success": true, "resumed": true, "campaignNumber": 42, "campaignId": "...", "fundingTxHash": "0x...", "status": "active", "viewUrl": "..." }`

### status

Show details for a single campaign.

```
dropcast-cli status --id <uuid|campaign_number> [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--id` | Yes | Campaign UUID or campaign number (integer) |
| `--json` | No | Output as JSON |

### list

List campaigns with pagination and status filter.

```
dropcast-cli list [--status active|ended|all] [--limit N] [--offset N] [--json]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--status` | No | `active` | Filter: `active`, `ended`, or `all` |
| `--limit` | No | `20` | Results per page |
| `--offset` | No | `0` | Pagination offset |
| `--json` | No | | Output as JSON |

## 5. Config Schema

Campaign configs must pass the Zod schema defined in `src/config.ts`. Brief field reference:

| Section | Key Fields | Notes |
|---------|-----------|-------|
| `network` | `"base"` (literal) | Only Base Mainnet is supported |
| `platform` | `"farcaster"` or `"x"` | Determines post resolution and action behavior |
| `host` | `fid`, `walletAddress` | Must match `PRIVATE_KEY` wallet for `--execute` |
| `post` | `url` | Farcaster post URL or tweet URL (X) |
| `token` | `address`, `symbol`, `decimals`, `logoUrl?` | ERC-20 on Base |
| `reward` | `type` + type-specific fields | `pool_split`: `totalAmount`; `fixed`: `amountPerUser` + `maxParticipants` |
| `actions` | `follow`, `like`, `recast`, `quote`, `comment` | Booleans. X campaigns ignore these (proof-of-read only) |
| `targeting` | `minFollowers`, `minNeynarScore`, etc. | All optional with 0/false defaults |
| `schedule` | `endsAt` | ISO 8601 datetime string |

For full field-by-field documentation, see `skill/references/campaign-params.md`.

## 6. Safety Rules

1. **ALWAYS dry-run first.** Never call `create --execute` without presenting the dry-run summary to the user and receiving explicit confirmation.
2. **ALWAYS use `--json`.** Parse structured output; never rely on human-readable text.
3. **NEVER log, print, or expose `PRIVATE_KEY`.** Set it via `.env` or environment variable only.
4. **NEVER auto-execute.** The user must explicitly approve before any on-chain transaction.
5. **Verify wallet match.** The CLI checks that `PRIVATE_KEY` wallet matches `host.walletAddress`. If they differ, the backend will reject with 403.
6. **Respect the fee.** Fees are calculated dynamically. The CLI checks against the on-chain `minBaseFee` before executing. Do not override or skip fee checks.

For the full safety policy, see `skill/references/safety-policy.md`.

## 7. Error Handling

### Schema validation errors
Fix the config fields reported in the error output and re-run `validate --offline`.

### Cast/post resolution errors
The post URL may be invalid or the Neynar API may be down. Verify the URL and retry once.

### Insufficient balance errors
The CLI checks ETH (for fees + gas) and token balances before executing. Top up the wallet and retry.

### On-chain errors
**Do NOT retry `create --execute` after an on-chain error.** The transaction may have partially succeeded. Check the funding transaction hash on Basescan first.

### Post-funding API registration errors (most critical)
If the CLI exits with an error **after** the funding transaction confirmed, the tokens are already locked on-chain. **Do NOT re-run `create`.** Instead:
```bash
dropcast-cli resume --recovery .dropcast-cli/<campaignId>.json --json
```

### 202 pending finality
The CLI handles 202 (pending finality) retries internally with exponential backoff (2s to 60s, up to 7 attempts). **Do NOT retry `create` yourself.** If the CLI exhausts retries, use `resume` with the recovery file.

### API error codes
| Code | Meaning | Action |
|------|---------|--------|
| 200 | Idempotent return (already exists) | Success -- campaign was already registered |
| 201 | Created | Success |
| 202 | Pending finality | CLI retries automatically; if exhausted, use `resume` |
| 400 | Validation failure | Fix the config or payload |
| 400 (`fee_insufficient`) | Quota surcharge mismatch | On-chain fee underpaid vs server expectation. See error playbook. **Do NOT re-run `create --execute`.** |
| 403 | Authorization failure | Wallet mismatch or unauthorized |
| 409 | Conflict | Duplicate txHash or mismatched campaign data |

For the full error playbook, see `skill/references/error-playbook.md`.

## 8. DropCast Platform Refund Policy

| Scenario | Pool Split | Fixed |
|----------|-----------|-------|
| Full participation | All tokens distributed | All tokens distributed |
| Partial participation | Remaining split among verified | Unused tokens refunded to host |
| Zero participants | No refund (tokens held) | Full refund to host |
| Host fee (ETH) | Non-refundable | Non-refundable |

- Refunds (fixed mode only) are processed automatically after successful airdrop distribution.
- Host fees are forwarded to the BuyBackBurner contract on-chain at funding time and cannot be reversed.

## 9. Environment Variables

Set these in a `.env` file in the working directory or export them in the shell.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PRIVATE_KEY` | For `--execute` only | -- | Hex private key of the funding wallet |
| `DROPCAST_API_BASE_URL` | No | `https://dropcast.xyz` | DropCast API base URL |
| `RPC_URL` | No | `https://mainnet.base.org` | Base Mainnet RPC endpoint |
| `DROPCAST_ROUTER_ADDRESS` | No | `0xd216801c9B658f9bEcB8125387a2A02c0d7Cc3d2` | Router contract address |

`PRIVATE_KEY` is **not needed** for `validate`, `status`, `list`, or dry-run `create`. Only the `--execute` flag requires it.

Users need **~0.005 ETH** on Base for fee + gas. The fee cannot be paid in USDC.
