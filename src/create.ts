/**
 * campaign create — dry-run + execute flow.
 *
 * Flow:
 * 1. Load config, validate schema
 * 2. Resolve cast (Farcaster only), fetch price
 * 3. Calculate fee, check balances
 * 4. Dry-run summary (default)
 * 5. If --execute: approve → fund on-chain → write recovery → POST /api/campaigns → cleanup
 */

import { randomUUID } from 'crypto'
import { parseUnits, formatUnits, formatEther, parseEther } from 'viem'
import { loadConfig, buildCreatePayload } from './config.js'
import { resolveCast, getTokenPrice, registerCampaignWithRetry, getVerifiedAddresses, ApiError } from './api.js'
import { calculateFee, feeToWei, formatFee } from './fees.js'
import { buildFeeOptions } from './validate.js'
import { getBalances, getRouterStats, fundCampaign, validateChainId, getWalletClient } from './chain.js'
import { jsonOutput, printDryRunSummary, type DryRunData } from './output.js'
import { writeRecoveryFile, deleteRecoveryFile } from './resume.js'
import * as readline from 'readline'

// ============================================
// Helpers
// ============================================

function log(json: boolean | undefined, ...args: unknown[]): void {
  if (!json) console.log(...args)
}

function logError(json: boolean | undefined, ...args: unknown[]): void {
  if (!json) console.error(...args)
}

function askConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ============================================
// Create Command
// ============================================

export async function createCommand(options: {
  config: string
  execute?: boolean
  campaignId?: string
  yes?: boolean
  json?: boolean
}): Promise<void> {
  // 1. Load config
  const config = loadConfig(options.config)

  // Validate --campaign-id if provided
  if (options.campaignId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(options.campaignId)) {
      throw new Error(`Invalid --campaign-id: "${options.campaignId}". Must be a valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000).`)
    }
  }
  const campaignId = options.campaignId || randomUUID()

  // 2. Build fee options
  const feeOptions = buildFeeOptions(config)
  const fee = calculateFee(feeOptions)
  const feeWei = feeToWei(fee)
  const baseFeePaid = formatEther(feeWei)

  // 3. Resolve cast (Farcaster only)
  let castData: {
    hash: string
    authorFid: number
    authorUsername: string
    text: string
    imageUrl?: string | null
    embeds?: unknown
  } | undefined

  if (config.platform === 'farcaster') {
    log(options.json, 'Resolving cast...')
    const cast = await resolveCast(config.post.url)
    const imageUrl = cast.embeds?.find(
      (e) => e.metadata?.image?.url
    )?.metadata?.image?.url || null

    castData = {
      hash: cast.hash,
      authorFid: cast.author.fid,
      authorUsername: cast.author.username,
      text: cast.text,
      imageUrl,
      embeds: cast.embeds,
    }
  }

  // 4. Fetch token price
  let tokenPriceUsd: number | null = null
  try {
    tokenPriceUsd = await getTokenPrice(config.token.address)
  } catch {
    // Non-critical
  }

  // 5. Calculate total amount
  let totalAmount: string
  if (config.reward.type === 'fixed') {
    const perUser = parseUnits(config.reward.amountPerUser, config.token.decimals)
    const total = perUser * BigInt(config.reward.maxParticipants)
    totalAmount = formatUnits(total, config.token.decimals)
  } else {
    totalAmount = config.reward.totalAmount
  }

  const totalAmountWei = parseUnits(totalAmount, config.token.decimals)

  // 6. Check balances using config.host.walletAddress (works without PRIVATE_KEY)
  let ethBalance = '(skipped)'
  let tokenBalance = '(skipped)'
  let ethBalanceWei = 0n
  let tokenBalanceWei = 0n

  try {
    const balances = await getBalances(
      config.host.walletAddress as `0x${string}`,
      config.token.address as `0x${string}`,
      config.token.decimals,
    )
    ethBalance = balances.ethFormatted
    tokenBalance = balances.tokenFormatted
    ethBalanceWei = balances.ethBalance
    tokenBalanceWei = balances.tokenBalance
  } catch {
    // Balance check is best-effort during dry-run
  }

  // Dry-run summary
  const dryRunData: DryRunData = {
    config,
    campaignId,
    feeOptions,
    totalAmount,
    tokenPriceUsd,
    budgetUsd: tokenPriceUsd ? Number(totalAmount) * tokenPriceUsd : null,
    ethBalance,
    tokenBalance,
    castPreview: castData ? { authorFid: castData.authorFid, author: castData.authorUsername, text: castData.text } : undefined,
  }

  if (!options.execute) {
    // Dry-run mode — does NOT require PRIVATE_KEY
    if (options.json) {
      jsonOutput({
        mode: 'dry-run',
        campaignId,
        fee: { total: fee, formatted: formatFee(fee) },
        totalAmount,
        tokenPriceUsd,
        config,
        balances: { eth: ethBalance, token: tokenBalance },
        castPreview: castData ? { authorFid: castData.authorFid, author: castData.authorUsername, text: castData.text } : undefined,
      })
    } else {
      printDryRunSummary(dryRunData)
      console.log('')
      console.log('DRY RUN complete. No transactions were sent.')
      console.log('Add --execute to go live.')
    }
    return
  }

  // ── Execute Mode (requires PRIVATE_KEY) ──

  const { account } = getWalletClient()

  // P1: Verify signing wallet matches config host wallet
  if (account.address.toLowerCase() !== config.host.walletAddress.toLowerCase()) {
    const msg = `Wallet mismatch: PRIVATE_KEY wallet ${account.address} != config host.walletAddress ${config.host.walletAddress}. ` +
      `The backend will reject registration (403) if the funding wallet doesn't match the host. Aborting.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }

  // P2: Verify wallet is a verified address for host FID (prevents 403 after funding)
  try {
    const { verified_addresses } = await getVerifiedAddresses(config.host.fid)
    const normalizedAddresses = verified_addresses.map(a => a.toLowerCase())
    if (!normalizedAddresses.includes(account.address.toLowerCase())) {
      const msg = `Wallet ${account.address} is not a verified address for FID ${config.host.fid}. ` +
        `Connect it on Farcaster (Settings → Connected Addresses) and retry.`
      if (options.json) {
        jsonOutput({ error: msg, fid: config.host.fid, wallet: account.address, verified_addresses })
      } else {
        console.error(`\nERROR: ${msg}`)
        console.error(`Verified addresses for FID ${config.host.fid}: ${verified_addresses.join(', ') || '(none)'}`)
      }
      process.exit(1)
    }
  } catch (err) {
    // Hard-fail: if the pre-flight check fails, do not proceed to funding.
    // Proceeding would risk locking funds on-chain if the backend later returns 403.
    // Re-throw if this was triggered by process.exit or the wallet check itself
    if (err instanceof Error && (err.message?.includes('process.exit') || err.message?.includes('not a verified address'))) throw err
    const errMsg = err instanceof Error ? err.message : String(err)
    const msg = `Cannot verify wallet-FID binding: ${errMsg}. Aborting to prevent funding without verification.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }

  // Re-fetch balances using the signing wallet (authoritative for execute)
  const execBalances = await getBalances(
    account.address,
    config.token.address as `0x${string}`,
    config.token.decimals,
  )

  if (!options.json) {
    printDryRunSummary({
      ...dryRunData,
      ethBalance: execBalances.ethFormatted,
      tokenBalance: execBalances.tokenFormatted,
    })
  }

  // Pre-flight checks
  log(options.json, '\n--- Pre-flight Checks ---')

  // Chain ID validation
  await validateChainId()
  log(options.json, '  Chain ID: Base Mainnet (8453) OK')

  // Router stats + minBaseFee check
  const routerStats = await getRouterStats()
  if (feeWei < routerStats.minBaseFee) {
    const msg = `Fee mismatch: local fee ${formatEther(feeWei)} ETH < on-chain minBaseFee ${routerStats.minBaseFeeEth} ETH. ` +
      `Bundled fees.ts may be stale. fundCampaign will revert.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }
  log(options.json, `  Router minBaseFee: ${routerStats.minBaseFeeEth} ETH (local: ${formatFee(fee)}) OK`)

  // Balance checks
  const gasBuffer = parseEther('0.001')
  const ethNeeded = feeWei + gasBuffer
  if (execBalances.ethBalance < ethNeeded) {
    const msg = `Insufficient ETH. Need ~${formatEther(ethNeeded)} (fee + gas), have ${execBalances.ethFormatted}.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }
  log(options.json, `  ETH balance: ${execBalances.ethFormatted} (need ~${formatEther(ethNeeded)}) OK`)

  if (execBalances.tokenBalance < totalAmountWei) {
    const msg = `Insufficient ${config.token.symbol}. Need ${totalAmount}, have ${execBalances.tokenFormatted}.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }
  log(options.json, `  ${config.token.symbol} balance: ${execBalances.tokenFormatted} (need ${totalAmount}) OK`)
  log(options.json, '--- Pre-flight OK ---')

  // Confirmation
  if (!options.yes && !options.json) {
    const confirmed = await askConfirmation('\nLIVE EXECUTION: This will send real transactions. Continue? (y/N) ')
    if (!confirmed) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // ── On-chain funding ──
  log(options.json, '\n[1/2] Funding campaign on-chain...')

  const { txHash, approvalTxHash } = await fundCampaign({
    tokenAddress: config.token.address as `0x${string}`,
    tokenAmount: totalAmountWei,
    campaignId,
    feeAmountWei: feeWei,
  })

  if (approvalTxHash) {
    log(options.json, `  Approval tx: ${approvalTxHash}`)
  }
  log(options.json, `  Funding tx:  ${txHash}`)

  // Write recovery file BEFORE API call (includes baseFeePaid for resume accuracy)
  const recoveryData = {
    campaignId,
    fundingTxHash: txHash,
    baseFeePaid,
    config,
    createdAt: new Date().toISOString(),
  }
  const recoveryPath = writeRecoveryFile(recoveryData)
  log(options.json, `  Recovery file: ${recoveryPath}`)

  // ── Register via API ──
  log(options.json, '\n[2/2] Registering campaign via API...')

  const payload = buildCreatePayload({
    campaignId,
    config,
    castData,
    totalAmount,
    fundingTxHash: txHash.toLowerCase(),
    baseFeePaid,
  })

  try {
    const { status, data } = await registerCampaignWithRetry({
      payload,
      json: options.json,
    })

    // Success — clean up recovery file
    deleteRecoveryFile(campaignId)

    if (options.json) {
      jsonOutput({
        success: true,
        campaignNumber: data.campaign.campaign_number,
        campaignId,
        fundingTxHash: txHash,
        status: data.campaign.status,
        viewUrl: `https://dropcast.xyz/campaign/${data.campaign.campaign_number}`,
      })
    } else {
      console.log('')
      console.log('='.repeat(56))
      console.log('  CAMPAIGN CREATED SUCCESSFULLY')
      console.log('='.repeat(56))
      console.log(`  Campaign #:   ${data.campaign.campaign_number}`)
      console.log(`  Campaign ID:  ${campaignId}`)
      console.log(`  Funding TX:   ${txHash}`)
      console.log(`  View:         https://dropcast.xyz/campaign/${data.campaign.campaign_number}`)
      console.log('='.repeat(56))
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (options.json) {
        jsonOutput({
          error: err.message,
          status: err.status,
          recoveryFile: recoveryPath,
          fundingTxHash: txHash,
        })
      } else {
        console.error(`\nERROR: ${err.message}`)
        console.error(`  Campaign was funded on-chain (tx: ${txHash})`)
        console.error(`  Recovery file: ${recoveryPath}`)
        console.error(`  Run: dropcast-cli resume --recovery ${recoveryPath}`)
      }
      process.exit(1)
    }
    throw err
  }
}
