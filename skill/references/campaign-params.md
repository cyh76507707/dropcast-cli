# Campaign Parameters Reference

> AI agent guide: map user requests to `CampaignConfig` fields.
> Source of truth: `src/config.ts` `campaignConfigSchema` (Zod).

---

## 0. Source Tagging

All CLI API requests include the `X-Dropcast-Client: cli` header. The backend stores this as `campaigns.created_via = 'cli'`, which the `/ai` page uses for filtering. Historical campaigns may have `created_via = NULL` (pre-tagging); `NULL` is also the value for non-CLI paths. No agent action is required — the header is sent automatically by the CLI's HTTP client.

---

## 1. Resolution Priority

When building a campaign config from a user request, resolve each field in this order:

1. **Explicit user value** -- user stated it directly ("use DEGEN token", "end in 3 days")
2. **Inferable from context** -- user's connected wallet for `host.walletAddress`, cast URL they shared for `post.url`
3. **Platform default** -- X campaigns force all actions to `false`; Farcaster defaults `follow` to `true`
4. **Preset keyword** -- if user said "whale tier" or "broad", apply the preset (see Section 3)
5. **Global default** -- Zod schema defaults (see table below)
6. **Ask the user** -- if none of the above resolves the field and it is required, ask before proceeding

---

## 2. Field-by-Field Reference

### Top-level

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `network` | `"base"` (literal) | Yes | -- | Always `"base"`. DropCast only supports Base Mainnet (chain 8453). |
| `platform` | `"farcaster" \| "x"` | Yes | -- | Infer from post URL domain. Warpcast = farcaster. x.com/twitter.com = x. |

### `host`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `host.fid` | int, positive | Yes | -- | User's Farcaster FID. Look up via Neynar if user provides username. |
| `host.walletAddress` | string, `0x`-prefixed, 42 chars | Yes | -- | Must match `PRIVATE_KEY` wallet when executing. Infer from connected wallet context. |

### `post`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `post.url` | string, valid URL | Yes | -- | Farcaster: Warpcast URL (e.g. `https://warpcast.com/user/0xhash`). X: tweet URL (e.g. `https://x.com/user/status/123`). |

### `token`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `token.address` | string, `0x`-prefixed, 42 chars | Yes | -- | ERC-20 on Base. Validate via `/api/tokens/{address}`. |
| `token.symbol` | string, 1-20 chars | Yes | -- | Resolve from token API or user input. |
| `token.decimals` | int, 0-77 | Yes | -- | Resolve from token API. Almost always 18 for standard ERC-20. |
| `token.logoUrl` | string (URL) \| null | No | `null` | Optional. Resolve from token API `logoUrl` field. |

### `reward`

Discriminated union on `reward.type`:

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `reward.type` | `"pool_split" \| "fixed"` | Yes | -- | pool_split: total split among all claimants. fixed: exact amount per user with cap. |
| `reward.totalAmount` | string (numeric) | Yes (pool_split) | -- | Human-readable token units (e.g. `"50000"` = 50,000 tokens). |
| `reward.amountPerUser` | string (numeric) | Yes (fixed) | -- | Tokens each participant receives. |
| `reward.maxParticipants` | int, positive | Yes (fixed) | -- | Cap on participants. `totalAmount` = `amountPerUser * maxParticipants`. |
| `reward.totalAmount` | string | Optional (fixed) | Computed | For fixed: CLI computes it as `amountPerUser * maxParticipants`. If user provides it, it is informational. |

### `actions`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `actions.follow` | boolean | No | `true` | Follow the host. Default engagement action. |
| `actions.like` | boolean | No | `false` | Like the cast/post. **Farcaster default: `true`** |
| `actions.recast` | boolean | No | `false` | Recast (Farcaster retweet equivalent). **Farcaster default: `true`** |
| `actions.quote` | boolean | No | `false` | Quote the cast. |
| `actions.comment` | boolean | No | `false` | Comment / reply on the cast. |
| `actions.prefilledQuoteMessage` | string (max 350) \| null | No | `null` | Pre-filled text for quote action. Only relevant when `quote: true`. |

> **X campaign override**: When `platform === "x"`, all action fields are forced to `false` by `buildFeeOptions()`. X campaigns use proof-of-read verification only. The config file can set them however it wants -- the CLI ignores them for fee calculation and the backend ignores them for verification.
>
> **Platform defaults**: Farcaster templates default to `follow: true, like: true, recast: true`. X templates default to all actions `false`. These are agent-layer defaults in the template files; the Zod schema defaults remain unchanged.

### `targeting`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `targeting.minFollowers` | int, >= 0 | No | `0` | Minimum Farcaster follower count. Default 20 for Farcaster campaigns. |
| `targeting.minNeynarScore` | number, 0-1 | No | `0` | Neynar social score. 0.5 = moderate quality, 0.8 = high. |
| `targeting.minQuotientScore` | number, >= 0 | No | `0` | Quotient engagement score. |
| `targeting.requirePro` | boolean | No | `false` | Require Farcaster Pro subscription. |
| `targeting.requireVerifiedOnly` | boolean | No | `false` | Exclude spam-labeled accounts. |
| `targeting.requireProfilePhoto` | boolean | No | `false` | Require profile photo (anti-bot). |
| `targeting.minAccountAgeDays` | int, >= 0 | No | `0` | Minimum account age in days. Default 7 for Farcaster campaigns. |
| `targeting.minXFollowers` | int, >= 0 | No | `0` | X/Twitter minimum followers. Default 20 for X campaigns. |

### `schedule`

| Field | Type | Required | Default | Resolution notes |
|-------|------|----------|---------|------------------|
| `schedule.endsAt` | string, ISO 8601 | Yes | -- | Must be a valid future date. If user says "3 days", compute from now. If "next Friday", resolve the date. |

---

## 3. Agent Recommended Presets

When the user doesn't specify targeting, apply these agent-recommended presets. User-specified values always override presets.

> **Note**: These are opinionated defaults for CLI agent workflows, not the `dropcast.xyz` web app defaults. The web app uses all-zero/false targeting and no default token. These presets provide sensible starting points for natural-language-to-campaign flows.

### `default (Farcaster)`

Actions: `follow: true`, `like: true`, `recast: true`
Targeting: `minFollowers: 20`, `minAccountAgeDays: 7`

This is the standard Farcaster campaign configuration. Fee: ~0.0018 ETH.

### `default (X)`

Actions: all `false` (proof-of-read only)
Targeting: `minXFollowers: 20`

X campaigns use proof-of-read verification. Fee: ~0.0037 ETH.

### Custom Targeting Tiers

When the user explicitly requests a tier keyword, apply these targeting overrides:

#### `broad` / `T1` -- Maximum reach

```json
{
  "targeting": {
    "minFollowers": 0,
    "minNeynarScore": 0,
    "minQuotientScore": 0,
    "requirePro": false,
    "requireVerifiedOnly": false,
    "requireProfilePhoto": false,
    "minAccountAgeDays": 0,
    "minXFollowers": 0
  }
}
```

Cheapest fee (no targeting surcharges). Good for awareness campaigns.

#### `medium` / `T2` -- Quality filter

```json
{
  "targeting": {
    "minFollowers": 50,
    "minNeynarScore": 0.5,
    "minQuotientScore": 0,
    "requirePro": false,
    "requireVerifiedOnly": true,
    "requireProfilePhoto": true,
    "minAccountAgeDays": 7,
    "minXFollowers": 50
  }
}
```

Moderate quality filter. Excludes bots and very new accounts.

#### `whale` / `T3` -- High-value audience

```json
{
  "targeting": {
    "minFollowers": 500,
    "minNeynarScore": 0.8,
    "minQuotientScore": 0,
    "requirePro": true,
    "requireVerifiedOnly": true,
    "requireProfilePhoto": true,
    "minAccountAgeDays": 30,
    "minXFollowers": 500
  }
}
```

Premium audience. High fees but targets genuine, active users only.

---

## 4. Default Campaign Parameters

When the user provides only a post URL (and optionally a budget), use these defaults:

| Parameter | Default | Notes |
|-----------|---------|-------|
| Token | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals) | Most common airdrop token on Base |
| Budget | 12 USDC | Reasonable starting point for engagement campaigns |
| Reward type | `pool_split` | Split total among all participants |
| Period | 1 day (`endsAt` = now + 24h) | Standard campaign duration |
| Actions (Farcaster) | follow + like + recast | See platform defaults in Section 3 |
| Actions (X) | all false (proof-of-read) | See platform defaults in Section 3 |

**Always confirm defaults with the user before executing.** Present a summary:
> "Using defaults: 12 USDC pool_split, ends in 24h, follow+like+recast. Confirm or adjust?"

---

## 5. USD-to-Token Conversion

When the user specifies budget in USD (e.g. "$500 of DEGEN"):

1. Fetch current price: `GET /api/tokens/{address}/usd-price` returns `{ usdPrice: number | null }`
2. Compute token amount: `usdAmount / usdPrice` = raw token amount
3. Format to human-readable units (not wei) for `totalAmount` / `amountPerUser`
4. Show the user the conversion: "$500 = ~1,234,567 DEGEN at $0.000405/token"

**Price drift guard**: If more than 60 seconds pass between price check and `--execute`, re-fetch price. If the new price has drifted more than 5% from the original, re-confirm with the user before proceeding. Token prices can be volatile.

**USDC**: USDC is approximately $1; still show live price when available from the API for accuracy.

**Null price**: If `usdPrice` is `null`, the API has no price data. Ask the user for the token amount directly.

---

## 6. X Campaign Special Handling

When `platform` is `"x"`:

| Behavior | Detail |
|----------|--------|
| Proof-of-read only | Verification is based on reading the tweet, not engagement actions. |
| Actions forced false | `buildFeeOptions()` sets all action fees to `false` regardless of config values. Backend also ignores action requirements. |
| Post URL validation | `post.url` must be a valid X/Twitter URL (`https://x.com/*/status/*` or `https://twitter.com/*/status/*`). |
| X followers targeting | Use `targeting.minXFollowers` (not `minFollowers`) for X audience filtering. |
| No cast resolution | X posts are resolved server-side. CLI does not call `/api/neynar/cast`. |
| X campaign fee | Adds flat `0.0025 ETH` to the base fee (`FEE_CONFIG.X_CAMPAIGN`). |
| host.fid still required | Even for X campaigns, the host must have a Farcaster FID. |

Example config: `examples/campaign.x.fixed.json`.

---

## 7. Edge Cases

| Scenario | Problem | Resolution |
|----------|---------|------------|
| User gives username, not FID | `host.fid` requires an integer | Look up FID via Neynar API using the username. Never guess. |
| User gives token symbol, not address | `token.address` is required | Look up address via `/api/tokens/` or ask user. |
| User sets actions for X campaign | Actions will be ignored | Inform user; set actions to all `false` in config for clarity. |
| `totalAmount` given for fixed reward | Zod allows it but it is optional | Ignore it; CLI computes `amountPerUser * maxParticipants`. |
| `endsAt` is in the past | Schema validates format only | Agent must validate the date is in the future before submitting. |
| Decimals mismatch | User says 6 but token has 18 | Always resolve decimals from the token API, not user input. |
| `reward.totalAmount` is "0" or negative | Zod checks `min(1)` on string length, not value | Agent must ensure the numeric value is positive. Zod only checks the string is non-empty. |
| `walletAddress` checksum mismatch | Zod regex is case-insensitive | Both `0xAbC...` and `0xabc...` pass validation, but the on-chain comparison in `create.ts` uses `.toLowerCase()`. |
| User gives no budget | No explicit budget specified | Default to 12 USDC pool_split. Confirm with user. |
| User gives no period | No explicit end date specified | Default to 1 day (now + 24h). Confirm with user. |
| User wants both `pool_split` and `maxParticipants` | Not supported | `pool_split` splits among all claimants; there is no participant cap. Use `fixed` if a cap is needed. |
| Token doesn't support `approve` | `SafeERC20FailedOperation` on-chain | Some tokens (rebasing, fee-on-transfer) may not work. Warn the user to test with a small amount first. |

---

## 8. Fee Impact Quick Reference

See `src/fees.ts` for exact values. All fees are in ETH on Base.

| Component | Fee (ETH) | Triggered when |
|-----------|-----------|----------------|
| Base (follow) | 0.0010 | Always |
| Like | 0.0002 | `actions.like: true` |
| Recast | 0.0002 | `actions.recast: true` |
| Quote | 0.0004 | `actions.quote: true` |
| Comment | 0.0006 | `actions.comment: true` |
| Min followers | 0.0002 | `targeting.minFollowers > 0` |
| Neynar score | 0.0004 | `targeting.minNeynarScore > 0` |
| Quotient score | 0.0006 | `targeting.minQuotientScore > 0` |
| Pro only | 0.0006 | `targeting.requirePro: true` |
| Verified only | 0.0002 | `targeting.requireVerifiedOnly: true` |
| Profile photo | 0.0002 | `targeting.requireProfilePhoto: true` |
| Account age | 0.0002 | `targeting.minAccountAgeDays > 0` |
| X followers | 0.0002 | `targeting.minXFollowers > 0` |
| Fixed reward | 0.0008 | `reward.type === "fixed"` |
| X campaign | 0.0025 | `platform === "x"` |
| Quota surcharge | 0.0006-0.0018 | Based on eligible user count tier |

### Common Default Fee Totals

| Configuration | Approximate Fee | Components |
|--------------|-----------------|------------|
| Default Farcaster (follow+like+recast, minFollowers, accountAge) | ~0.0018 ETH | base + like + recast + minFollowers + accountAge |
| Default X (proof-of-read, minXFollowers) | ~0.0037 ETH | base + X campaign + minXFollowers |

Fees can be higher with advanced targeting. Quota surcharge (0.0006–0.0018 ETH) may apply based on eligible user count — determined server-side.

### Quota Surcharge Tiers

| Eligible users | Surcharge (ETH) |
|----------------|-----------------|
| 1-100 | 0.0006 |
| 101-500 | 0.0009 |
| 501-1500 | 0.0012 |
| 1501-3000 | 0.0015 |
| 3001+ | 0.0018 |

**Important**: The backend enforces quota surcharge parity at `POST /api/campaigns`. If the ETH fee paid on-chain does not include the expected quota surcharge (within one-tier tolerance), the API returns **400 `fee_insufficient`**. The CLI does not currently calculate quota surcharge locally — this means campaigns with large eligible user counts may fail at API registration after on-chain funding. **Do NOT re-run `create --execute`** — funds are already on-chain. Preserve the recovery file, use `resume` when permitted, or contact DropCast support. See `error-playbook.md` for full recovery steps. A CLI update to calculate surcharge locally is planned.
