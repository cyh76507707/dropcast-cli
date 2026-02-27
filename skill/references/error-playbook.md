# Error Playbook

> Troubleshooting guide for dropcast-cli errors, organized by category.
> For each error: what it means, why it happens, and exactly what to do.

---

## 1. Schema Errors (Zod Validation)

These occur when `loadConfig()` parses the campaign JSON. The CLI exits before any network or chain calls.

| Error message pattern | Cause | Fix |
|----------------------|-------|-----|
| `network: Expected "base"` | Network is not `"base"` | Set `"network": "base"`. Only Base Mainnet is supported. |
| `platform: Invalid enum value` | Platform is not `"farcaster"` or `"x"` | Fix to one of the two supported values. |
| `host.fid: Expected number, received string` | FID is a string like `"12345"` | Use an integer: `12345` (no quotes). |
| `host.walletAddress: Invalid wallet address` | Address is not 0x-prefixed or not 42 chars | Must match `/^0x[0-9a-fA-F]{40}$/`. Check for typos or missing `0x` prefix. |
| `post.url: Invalid post URL` | URL failed Zod `.url()` check | Must be a valid HTTP/HTTPS URL. No bare paths or missing protocol. |
| `token.address: Invalid token address` | Same as wallet address | Must be a valid 0x-prefixed, 42-character hex string. |
| `token.symbol: String must contain at least 1 character(s)` | Symbol is empty | Provide the token symbol (e.g. `"DEGEN"`). Max 20 chars. |
| `reward.type: Invalid discriminator value` | Reward type is not `"pool_split"` or `"fixed"` | Only two reward types exist. Check spelling. |
| `totalAmount is required for pool_split` | Missing `totalAmount` in pool_split reward | Add `"totalAmount": "<number>"` as a string (e.g. `"50000"`). |
| `amountPerUser is required for fixed` | Missing `amountPerUser` in fixed reward | Add `"amountPerUser": "<number>"` as a string. |
| `maxParticipants must be positive` | Missing or zero `maxParticipants` for fixed reward | Add a positive integer `maxParticipants`. |
| `endsAt must be a valid ISO date string` | Date string cannot be parsed | Use ISO 8601 format: `"2026-03-10T00:00:00.000Z"`. |
| `minNeynarScore: Number must be less than or equal to 1` | Score > 1.0 | Neynar score is 0.0 to 1.0. |

**General approach**: Read the full Zod error path (e.g. `reward.totalAmount`) to locate the exact field. Cross-reference with the schema in `src/config.ts`.

---

## 2. Pre-flight Errors (Before On-chain)

These occur during `create --execute` after config validation but before any transaction is sent. No funds are at risk.

### Wallet mismatch
```
Wallet mismatch: PRIVATE_KEY wallet 0xAAA... != config host.walletAddress 0xBBB...
```
- **Cause**: The wallet derived from `PRIVATE_KEY` in `.env` does not match `host.walletAddress` in the config.
- **Fix**: Either update the config `host.walletAddress` to match your private key wallet, or set the correct `PRIVATE_KEY` in `.env`.
- **Why it matters**: The backend rejects registration (403) if the funding wallet does not match the host.

### Fee mismatch
```
Fee mismatch: local fee 0.0016 ETH < on-chain minBaseFee 0.0020 ETH
```
- **Cause**: The fee calculated by the bundled `fees.ts` is lower than the router contract's `minBaseFee`. The contract's fee floor was raised after the CLI was built.
- **Fix**: Update the CLI to the latest version (`npm update dropcast-cli` or rebuild). If the CLI is latest, the on-chain minimum was very recently changed -- wait for CLI update or manually override.
- **Impact if ignored**: The `fundCampaign` call would revert with `InsufficientFee`.

### Insufficient ETH
```
Insufficient ETH. Need ~0.0026 (fee + gas), have 0.0010.
```
- **Cause**: Wallet does not have enough ETH for the platform fee plus a 0.001 ETH gas buffer.
- **Fix**: Send more ETH to the wallet on Base. The required amount is `fee + 0.001 ETH`.
- **Breakdown**: Fee varies by campaign options (see `campaign-params.md` Section 8). Gas buffer is fixed at 0.001 ETH.

### Insufficient ETH for fee (wallet has USDC but no ETH)
- **Cause**: Wallet holds USDC (or other tokens) but has insufficient ETH. The platform fee must be paid in ETH — it cannot be paid in USDC.
- **Fix**: Send ~0.005 ETH to the wallet on Base. This covers the fee + gas buffer for either platform.
- Typical default fees are ~0.0018 to ~0.0037 ETH; can be higher with advanced targeting or quota surcharge.
- USDC cannot be used for the platform fee. A future update may add automatic USDC→ETH swap.

### Insufficient token balance
```
Insufficient DEGEN. Need 50000, have 12000.
```
- **Cause**: Wallet does not hold enough of the airdrop token.
- **Fix**: Transfer more tokens to the wallet, or reduce `totalAmount` / `maxParticipants`.

### Chain ID mismatch
```
Expected Base Mainnet (8453), got chain 31337.
```
- **Cause**: `RPC_URL` points to a different network (e.g. local Hardhat or testnet).
- **Fix**: Set `RPC_URL` to a Base Mainnet RPC (default: `https://mainnet.base.org`), or remove the override.

### Missing PRIVATE_KEY
```
PRIVATE_KEY environment variable is required
```
- **Cause**: No `PRIVATE_KEY` in `.env` or environment. Required for `--execute` mode.
- **Fix**: Add `PRIVATE_KEY=0x...` to the `.env` file. Dry-run mode does not require it.

---

## 3. On-chain Errors (Router Contract Reverts)

These occur during `fundCampaign()`. The transaction reverts and no tokens are transferred, but gas is consumed.

### SafeERC20FailedOperation
```
SafeERC20FailedOperation(token: 0x...)
```
- **Cause**: The token's `approve` or `transferFrom` call failed. Common with non-standard tokens (rebasing, fee-on-transfer, pausable, or tokens that return `false` instead of reverting).
- **Fix**: Verify the token is a standard ERC-20. Try a manual `approve` + `transferFrom` outside the CLI. Some tokens require a zero-approval reset first.

### InsufficientFee
```
InsufficientFee(sent: 1000000000000000, required: 2000000000000000)
```
- **Cause**: The ETH value sent with the transaction is less than the router's `minBaseFee`. Values are in wei.
- **Fix**: This should be caught by the pre-flight check. If it slipped through, the on-chain minimum was updated between the check and the transaction. Update CLI and retry.

### FeeTransferFailed
```
FeeTransferFailed()
```
- **Cause**: The router could not forward the fee to the buy-back-burner or relayer wallet. Likely a misconfigured router (admin issue).
- **Fix**: This is not a user error. Report to the DropCast team. Do not retry -- the router configuration must be fixed.

### ZeroAmount
```
ZeroAmount()
```
- **Cause**: `tokenAmount` passed to `fundCampaign` is `0`.
- **Fix**: Check that `totalAmount` (pool_split) or `amountPerUser * maxParticipants` (fixed) produces a non-zero value. Likely a config issue with `"0"` as the amount.

### ZeroAddress
```
ZeroAddress()
```
- **Cause**: Token address passed is `0x0000000000000000000000000000000000000000`.
- **Fix**: Set a valid ERC-20 token address in `token.address`. The zero address is not a valid token.

---

## 4. API Errors (HTTP Status Codes)

These occur when the CLI calls `POST /api/campaigns` or other API endpoints.

### 400 -- Validation failure
- **Cause**: The API rejected the payload. Field mismatch, invalid data, or schema version mismatch between CLI and server.
- **Fix**: Check the error body for specific field failures. Ensure CLI version matches server expectations.

### 400 -- `fee_insufficient` (quota surcharge mismatch)
- **Cause**: The ETH fee paid on-chain does not include the expected quota surcharge. The backend recalculates the expected fee server-side (including quota surcharge based on eligible user count) and compares it against the on-chain decoded fee (with one-tier tolerance). If the paid fee is too low, registration is rejected.
- **This is a post-funding error**: The on-chain transaction already succeeded, but API registration failed. A recovery file exists at `.dropcast-cli/<campaignId>.json`.
- **Fix**: Do NOT re-run `create --execute` (funds are already on-chain). The user needs to understand the fee shortfall. Show the expected vs actual fee from the error response. A CLI update to pre-calculate quota surcharge locally is planned. In the meantime, use `resume` after the backend team adjusts, or contact DropCast support.
- **Prevention**: For campaigns with large eligible audiences, consider adding a fee buffer by using more targeting options (which increase the fee) or waiting for the CLI surcharge calculation update.

### 403 -- Authorization failure
- **Cause**: The wallet that funded the campaign does not match the `hostWalletAddress` in the payload, or the host FID is not authorized.
- **Fix**: Ensure `PRIVATE_KEY` derives to the same address as `host.walletAddress`. The pre-flight check should catch this, but if the config was modified between dry-run and execute, this can occur.

### 409 -- Conflict
- **Cause**: Either (a) the `fundingTxHash` is already associated with a different campaign, or (b) the campaign ID exists with different data.
- **Fix**: If resuming, use the exact same recovery file. Do not modify the recovery JSON. If creating, ensure you are not re-using a campaign ID. The CLI generates a UUID per run, so this typically means a retry hit a stale state -- check `status --id <campaignId>` to see if it already succeeded.

### 202 -- Pending finality
- **Cause**: The server accepted the request but the on-chain transaction has not reached finality yet.
- **Behavior**: The CLI retries automatically: 6 attempts with exponential backoff (delays: 2s, 4s, 8s, 16s, 32s, 60s; total ~122 seconds).
- **If retries exhausted**: The campaign may still finalize asynchronously. Check status: `dropcast-cli status --id <campaignId>`. Do NOT re-run `create --execute`.

### Network / timeout errors
- **Cause**: DNS failure, server unreachable, TLS error, or request timeout.
- **Fix**: Check internet connectivity. Verify `DROPCAST_API_BASE_URL` is correct (default: `https://dropcast.xyz`). Retry once manually.

---

## 5. Post-funding Failure (CRITICAL PATH)

This is the most dangerous error scenario. The campaign has been funded on-chain (tokens and fee transferred) but the API registration failed.

### Symptoms
- CLI printed the funding tx hash but then errored during API registration.
- A recovery file exists at `.dropcast-cli/<campaignId>.json`.
- The CLI output includes: `Run: dropcast-cli resume --recovery .dropcast-cli/<campaignId>.json`

### Recovery procedure

```bash
# 1. Verify the funding transaction succeeded on BaseScan
#    (check the tx hash from CLI output or recovery file)

# 2. Resume API registration (NO on-chain transaction)
dropcast-cli resume --recovery .dropcast-cli/<campaignId>.json --json

# 3. If resume succeeds, the recovery file is automatically deleted.

# 4. If resume fails with 409, check if the campaign already exists:
dropcast-cli status --id <campaignId>
```

### What NOT to do

- **NEVER re-run `create --execute`**. The funds are already on-chain. Running create again would send a second `fundCampaign` transaction, double-spending the user's tokens and ETH fee.
- **NEVER delete the recovery file** before confirming the campaign was successfully registered.
- **NEVER modify the recovery file**. The `fundingTxHash` and `baseFeePaid` must exactly match what was sent on-chain.

### Recovery file format
```json
{
  "campaignId": "uuid",
  "fundingTxHash": "0x...",
  "baseFeePaid": "0.0016",
  "config": { ... full CampaignConfig ... },
  "createdAt": "2026-02-26T12:00:00.000Z"
}
```
Location: `.dropcast-cli/<campaignId>.json`

The `resume` command reads this file, re-resolves the cast (Farcaster only), rebuilds the API payload with the stored `fundingTxHash` and `baseFeePaid`, and calls `POST /api/campaigns`. It never sends on-chain transactions.
