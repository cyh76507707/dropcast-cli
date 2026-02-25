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
import { resolveCast, getTokenPrice, createCampaign, ApiError } from './api.js'
import { calculateFee, feeToWei, formatFee } from './fees.js'
import { buildFeeOptions } from './validate.js'
import { getBalances, getRouterStats, fundCampaign, validateChainId, getWalletClient } from './chain.js'
import { jsonOutput, printDryRunSummary, type DryRunData } from './output.js'
import { writeRecoveryFile, deleteRecoveryFile } from './resume.js'
import * as readline from 'readline'

// ============================================
// Helpers
// ============================================

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
  const campaignId = options.campaignId || randomUUID()

  // 2. Build fee options
  const feeOptions = buildFeeOptions(config)
  const fee = calculateFee(feeOptions)
  const feeWei = feeToWei(fee)

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
    console.log('Resolving cast...')
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

  // 6. Check balances
  const { account } = getWalletClient()
  const balances = await getBalances(
    account.address,
    config.token.address as `0x${string}`,
    config.token.decimals,
  )

  // Dry-run summary
  const dryRunData: DryRunData = {
    config,
    campaignId,
    feeOptions,
    totalAmount,
    tokenPriceUsd,
    budgetUsd: tokenPriceUsd ? Number(totalAmount) * tokenPriceUsd : null,
    ethBalance: balances.ethFormatted,
    tokenBalance: balances.tokenFormatted,
    castPreview: castData ? { author: castData.authorUsername, text: castData.text } : undefined,
  }

  if (!options.execute) {
    // Dry-run mode
    if (options.json) {
      jsonOutput({
        mode: 'dry-run',
        campaignId,
        fee: { total: fee, formatted: formatFee(fee) },
        totalAmount,
        tokenPriceUsd,
        config,
        balances: {
          eth: balances.ethFormatted,
          token: balances.tokenFormatted,
        },
        castPreview: castData ? { author: castData.authorUsername, text: castData.text } : undefined,
      })
    } else {
      printDryRunSummary(dryRunData)
      console.log('')
      console.log('DRY RUN complete. No transactions were sent.')
      console.log('Add --execute to go live.')
    }
    return
  }

  // ── Execute Mode ──

  if (!options.json) {
    printDryRunSummary(dryRunData)
  }

  // Pre-flight checks
  console.log('\n--- Pre-flight Checks ---')

  // Chain ID validation
  await validateChainId()
  console.log('  Chain ID: Base Mainnet (8453) OK')

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
  console.log(`  Router minBaseFee: ${routerStats.minBaseFeeEth} ETH (local: ${formatFee(fee)}) OK`)

  // Balance checks
  const gasBuffer = parseEther('0.001')
  const ethNeeded = feeWei + gasBuffer
  if (balances.ethBalance < ethNeeded) {
    const msg = `Insufficient ETH. Need ~${formatEther(ethNeeded)} (fee + gas), have ${balances.ethFormatted}.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }
  console.log(`  ETH balance: ${balances.ethFormatted} (need ~${formatEther(ethNeeded)}) OK`)

  if (balances.tokenBalance < totalAmountWei) {
    const msg = `Insufficient ${config.token.symbol}. Need ${totalAmount}, have ${balances.tokenFormatted}.`
    if (options.json) {
      jsonOutput({ error: msg })
    } else {
      console.error(`\nERROR: ${msg}`)
    }
    process.exit(1)
  }
  console.log(`  ${config.token.symbol} balance: ${balances.tokenFormatted} (need ${totalAmount}) OK`)
  console.log('--- Pre-flight OK ---')

  // Confirmation
  if (!options.yes && !options.json) {
    const confirmed = await askConfirmation('\nLIVE EXECUTION: This will send real transactions. Continue? (y/N) ')
    if (!confirmed) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // ── On-chain funding ──
  console.log('\n[1/2] Funding campaign on-chain...')

  const { txHash, approvalTxHash } = await fundCampaign({
    tokenAddress: config.token.address as `0x${string}`,
    tokenAmount: totalAmountWei,
    campaignId,
    feeAmountWei: feeWei,
  })

  if (approvalTxHash) {
    console.log(`  Approval tx: ${approvalTxHash}`)
  }
  console.log(`  Funding tx:  ${txHash}`)

  // Write recovery file BEFORE API call
  const recoveryData = {
    campaignId,
    fundingTxHash: txHash,
    config,
    createdAt: new Date().toISOString(),
  }
  const recoveryPath = writeRecoveryFile(recoveryData)
  console.log(`  Recovery file: ${recoveryPath}`)

  // ── Register via API ──
  console.log('\n[2/2] Registering campaign via API...')

  const payload = buildCreatePayload({
    campaignId,
    config,
    castData,
    totalAmount,
    fundingTxHash: txHash.toLowerCase(),
    baseFeePaid: formatEther(feeWei),
  })

  // Retry loop for 202 (pending finality)
  const maxRetries = 6
  const retryDelays = [2000, 4000, 8000, 16000, 32000, 60000]
  let lastStatus = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { status, data } = await createCampaign(payload as unknown as Record<string, unknown>)
      lastStatus = status

      if (status === 200 || status === 201) {
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
        return
      }

      if (status === 202) {
        const delay = retryDelays[attempt] || 60000
        if (!options.json) {
          console.log(`  Pending finality... retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})`)
        }
        await sleep(delay)
        continue
      }
    } catch (err) {
      if (err instanceof ApiError) {
        // Terminal errors — don't retry
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

  // Exhausted retries
  if (options.json) {
    jsonOutput({
      error: 'Campaign registration pending finality after max retries',
      status: lastStatus,
      recoveryFile: recoveryPath,
      fundingTxHash: txHash,
    })
  } else {
    console.error(`\nWARNING: Campaign funded but registration still pending after ${maxRetries + 1} attempts.`)
    console.error(`  Recovery file: ${recoveryPath}`)
    console.error(`  Run: dropcast-cli resume --recovery ${recoveryPath}`)
  }
  process.exit(1)
}
