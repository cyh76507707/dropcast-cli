# dropcast-cli

CLI + Agent Skill for creating DropCast airdrop campaigns on Base.

> **WARNING: The default API URL (`https://dropcast.xyz`) is production. All `--execute` commands create real campaigns with real funds.**

## Install

```bash
# Run directly
npx dropcast-cli --help

# Or install globally
npm install -g dropcast-cli
```

Requires Node.js >= 18.

## Quickstart

1. Copy an example config:

```bash
cp examples/campaign.farcaster.pool-split.json campaign.json
```

2. Edit `campaign.json` with your campaign details (FID, wallet, post URL, token, reward amounts, etc.).

3. Validate offline (schema only, no network):

```bash
dropcast-cli validate --config campaign.json --offline
```

4. Dry-run (resolves cast, fetches prices, checks balances -- no transactions):

```bash
dropcast-cli create --config campaign.json
```

5. Execute (when ready -- sends real transactions):

```bash
dropcast-cli create --config campaign.json --execute
```

## Configuration Reference

Campaign configs are JSON files validated against a Zod schema. See `examples/` for complete samples.

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | `"base"` | Yes | Only Base Mainnet is supported |
| `platform` | `"farcaster"` \| `"x"` | Yes | Target platform |

### `host`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fid` | integer | Yes | Host's Farcaster FID |
| `walletAddress` | string | Yes | Host's wallet address (0x-prefixed, 40 hex chars). Must match `PRIVATE_KEY` wallet for `--execute` |

### `post`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string (URL) | Yes | Farcaster post URL or tweet URL (X) |

### `token`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string | Yes | ERC-20 token contract address on Base |
| `symbol` | string | Yes | Token ticker symbol (1-20 chars) |
| `decimals` | integer | Yes | Token decimal precision (0-77) |
| `logoUrl` | string \| null | No | Token logo URL |

### `reward`

Discriminated union on `type`:

**`pool_split`** -- total amount split among all participants:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"pool_split"` | Yes | Reward type |
| `totalAmount` | string | Yes | Total token amount to distribute (human-readable, e.g. `"50000"`) |

**`fixed`** -- fixed amount per user:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"fixed"` | Yes | Reward type |
| `amountPerUser` | string | Yes | Token amount per participant (e.g. `"100"`) |
| `maxParticipants` | integer | Yes | Maximum number of participants (must be positive) |
| `totalAmount` | string | No | Optional override; defaults to `amountPerUser * maxParticipants` |

### `actions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `follow` | boolean | `true` | Require follow |
| `like` | boolean | `false` | Require like |
| `recast` | boolean | `false` | Require recast |
| `quote` | boolean | `false` | Require quote |
| `comment` | boolean | `false` | Require comment |
| `prefilledQuoteMessage` | string \| null | `null` | Pre-filled message for quote casts (max 350 chars) |

### `targeting`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minFollowers` | integer | `0` | Minimum Farcaster follower count |
| `minNeynarScore` | number | `0` | Minimum Neynar user quality score (0.0-1.0) |
| `minQuotientScore` | number | `0` | Minimum Quotient score |
| `requirePro` | boolean | `false` | Require Farcaster Pro subscription |
| `requireVerifiedOnly` | boolean | `false` | Exclude spam-labeled accounts |
| `requireProfilePhoto` | boolean | `false` | Require a profile photo |
| `minAccountAgeDays` | integer | `0` | Minimum account age in days |
| `minXFollowers` | integer | `0` | Minimum X (Twitter) follower count (X campaigns) |

### `schedule`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endsAt` | string | Yes | Campaign end date as ISO 8601 datetime (e.g. `"2026-03-10T00:00:00.000Z"`) |

## Commands

### `validate`

Validate a campaign config file.

```bash
dropcast-cli validate --config <path> [--offline] [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--config, -c` | Yes | Path to campaign.json |
| `--offline` | No | Schema validation only (no network calls) |
| `--json` | No | Output as JSON |

### `create`

Create a campaign. Dry-run by default; add `--execute` for live execution.

```bash
dropcast-cli create --config <path> [--execute] [--campaign-id <uuid>] [--yes] [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--config, -c` | Yes | Path to campaign.json |
| `--execute` | No | Send real transactions (requires `PRIVATE_KEY`) |
| `--campaign-id` | No | Reuse a UUID for idempotent retries |
| `--yes, -y` | No | Skip interactive confirmation prompt |
| `--allow-fee-uncertain` | No | Proceed without quota surcharge when eligible count is unavailable |
| `--json` | No | Output as JSON |

Without `--execute`, the command runs in dry-run mode: resolves on-chain data, calculates fees, checks balances, and prints a summary. No transactions are sent and `PRIVATE_KEY` is not required.

With `--execute`, the command:
1. Validates the config and runs pre-flight checks (chain ID, fee, balances, wallet match)
2. Approves ERC-20 token spend if needed
3. Calls `fundCampaign()` on the Router contract (sends tokens + ETH fee)
4. Writes a recovery file to `.dropcast-cli/<campaignId>.json`
5. Registers the campaign via `POST /api/campaigns` (with automatic 202 retry)
6. On success, deletes the recovery file and prints campaign details

All API requests include the `X-Dropcast-Client: cli` header, which the backend uses to tag campaigns as `created_via='cli'`. This enables deterministic filtering of CLI-originated campaigns (e.g. the `/ai` page). Historical campaigns created before this tagging was deployed may have `created_via = NULL`.

### `resume`

Resume a funded-but-unregistered campaign from its recovery file. Sends no on-chain transactions.

```bash
dropcast-cli resume --recovery <path> [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--recovery, -r` | Yes | Path to recovery file (`.dropcast-cli/<id>.json`) |
| `--json` | No | Output as JSON |

### `status`

Show details for a single campaign.

```bash
dropcast-cli status --id <uuid|campaign_number> [--json]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--id` | Yes | Campaign UUID or campaign number |
| `--json` | No | Output as JSON |

### `list`

List campaigns with pagination and status filter.

```bash
dropcast-cli list [--status active|ended|all] [--limit N] [--offset N] [--json]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--status` | No | `active` | Filter: `active`, `ended`, or `all` |
| `--limit` | No | `20` | Results per page |
| `--offset` | No | `0` | Pagination offset |
| `--json` | No | | Output as JSON |

## Environment Variables

Set these in a `.env` file in the working directory or export them in your shell. See `.env.example`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PRIVATE_KEY` | For `--execute` only | -- | Hex private key of the funding wallet. Not needed for validate, status, list, or dry-run create |
| `DROPCAST_API_BASE_URL` | No | `https://dropcast.xyz` | DropCast API base URL |
| `RPC_URL` | No | `https://mainnet.base.org` | Base Mainnet RPC endpoint. **Set this if you get RPC errors or rate limits** |
| `DROPCAST_ROUTER_ADDRESS` | No | `0xd216801c9B658f9bEcB8125387a2A02c0d7Cc3d2` | DropCast Router contract address |

## Recovery / Resume Flow

If the CLI exits with an error **after** the on-chain funding transaction succeeds, tokens are already locked in the Router contract. A recovery file is automatically written to `.dropcast-cli/<campaignId>.json`.

**Do NOT re-run `create --execute`** -- this would send a second funding transaction and double-spend your tokens.

Instead, use the `resume` command to retry only the API registration:

```bash
# 1. Check the funding tx on BaseScan to confirm it succeeded

# 2. Resume API registration (no on-chain transaction)
dropcast-cli resume --recovery .dropcast-cli/<campaignId>.json

# 3. If resume succeeds, the recovery file is automatically deleted

# 4. If resume fails with 409, the campaign may already exist:
dropcast-cli status --id <campaignId>
```

The recovery file contains the campaign ID, funding transaction hash, fee paid, and the full config. Do not modify it.

## Agent Skill

This package includes an AI agent skill definition at `skill/SKILL.md`. It provides structured instructions for AI agents to create DropCast campaigns programmatically. See the `skill/` directory for the full skill definition, templates, and reference docs.

## Troubleshooting

### RPC errors or rate limits

The default RPC (`https://mainnet.base.org`) has rate limits. Set a custom RPC endpoint:

```bash
# In .env
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### Wallet mismatch

```
Wallet mismatch: PRIVATE_KEY wallet 0xAAA... != config host.walletAddress 0xBBB...
```

The wallet derived from `PRIVATE_KEY` must match `host.walletAddress` in your config. The backend rejects registration (403) if they differ.

### Insufficient balance

```
Insufficient ETH. Need ~0.0026 (fee + gas), have 0.0010.
```

The wallet needs enough ETH for the platform fee plus a 0.001 ETH gas buffer, and enough of the airdrop token to cover `totalAmount`.

### Fee mismatch

```
Fee mismatch: local fee 0.0016 ETH < on-chain minBaseFee 0.0020 ETH
```

The bundled fee schedule may be stale. Update the CLI to the latest version: `npm update -g dropcast-cli`.

### Post-funding API failure

If the campaign was funded on-chain but API registration failed:

1. **Do NOT re-run `create --execute`** (would double-spend)
2. Use `resume` with the recovery file (see [Recovery / Resume Flow](#recovery--resume-flow))
3. If resume fails with 409, check `status --id <campaignId>` -- the campaign may already exist

### 202 pending finality

The CLI retries 202 responses automatically with exponential backoff (up to ~2 minutes). If retries are exhausted, use `resume` with the recovery file or check `status --id <campaignId>`.

## License

MIT
