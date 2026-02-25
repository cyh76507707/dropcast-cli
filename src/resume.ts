/**
 * campaign resume — recover funded-but-unregistered campaigns.
 *
 * Reads recovery file, re-calls POST /api/campaigns.
 * Never sends on-chain transactions.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { formatEther } from 'viem'
import { buildCreatePayload, type CampaignConfig } from './config.js'
import { resolveCast, registerCampaignWithRetry, ApiError } from './api.js'
import { calculateFee, feeToWei } from './fees.js'
import { buildFeeOptions } from './validate.js'
import { jsonOutput } from './output.js'
import { parseUnits, formatUnits } from 'viem'

// ============================================
// Recovery File I/O
// ============================================

const RECOVERY_DIR = '.dropcast-cli'

export interface RecoveryData {
  campaignId: string
  fundingTxHash: string
  baseFeePaid?: string
  config: CampaignConfig
  createdAt: string
}

export function writeRecoveryFile(data: RecoveryData): string {
  mkdirSync(RECOVERY_DIR, { recursive: true })
  const filePath = join(RECOVERY_DIR, `${data.campaignId}.json`)
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return filePath
}

export function readRecoveryFile(filePath: string): RecoveryData {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(`Cannot read recovery file: ${filePath}`)
  }

  let data: RecoveryData
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in recovery file: ${filePath}`)
  }

  if (!data.campaignId || !data.fundingTxHash || !data.config) {
    throw new Error('Recovery file missing required fields (campaignId, fundingTxHash, config)')
  }

  return data
}

export function deleteRecoveryFile(campaignId: string): void {
  const filePath = join(RECOVERY_DIR, `${campaignId}.json`)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    // Non-critical — user can manually clean up
  }
}

// ============================================
// Resume Command
// ============================================

export async function resumeCommand(options: {
  recovery: string
  json?: boolean
}): Promise<void> {
  // 1. Read recovery file
  const recovery = readRecoveryFile(options.recovery)
  const { campaignId, fundingTxHash, config } = recovery

  if (!options.json) {
    console.log('=== Campaign Resume ===')
    console.log(`Campaign ID:    ${campaignId}`)
    console.log(`Funding TX:     ${fundingTxHash}`)
    console.log(`Config:         ${config.platform} campaign, ${config.token.symbol}`)
    console.log('')
    console.log('Re-registering via API (no on-chain transaction)...')
  }

  // 2. Resolve cast if Farcaster (needed for payload)
  let castData: Parameters<typeof buildCreatePayload>[0]['castData'] | undefined

  if (config.platform === 'farcaster') {
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!options.json) {
        console.warn(`Warning: Could not resolve cast: ${msg}`)
        console.warn('Proceeding without cast metadata...')
      }
    }
  }

  // 3. Calculate total amount
  let totalAmount: string
  if (config.reward.type === 'fixed') {
    const perUser = parseUnits(config.reward.amountPerUser, config.token.decimals)
    const total = perUser * BigInt(config.reward.maxParticipants)
    totalAmount = formatUnits(total, config.token.decimals)
  } else {
    totalAmount = config.reward.totalAmount
  }

  // 4. Determine baseFeePaid — use stored value if available, recalculate as fallback
  let baseFeePaid: string
  if (recovery.baseFeePaid) {
    baseFeePaid = recovery.baseFeePaid
  } else {
    // Fallback for recovery files written before baseFeePaid was stored
    const feeOptions = buildFeeOptions(config)
    const fee = calculateFee(feeOptions)
    const feeWei = feeToWei(fee)
    baseFeePaid = formatEther(feeWei)
  }

  // 5. Build and send payload
  const payload = buildCreatePayload({
    campaignId,
    config,
    castData,
    totalAmount,
    fundingTxHash: fundingTxHash.toLowerCase(),
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
        resumed: true,
        campaignNumber: data.campaign.campaign_number,
        campaignId,
        fundingTxHash,
        status: data.campaign.status,
        viewUrl: `https://dropcast.xyz/campaign/${data.campaign.campaign_number}`,
      })
    } else {
      console.log('')
      console.log('='.repeat(56))
      console.log('  CAMPAIGN RESUMED SUCCESSFULLY')
      console.log('='.repeat(56))
      console.log(`  Campaign #:   ${data.campaign.campaign_number}`)
      console.log(`  Campaign ID:  ${campaignId}`)
      console.log(`  Status:       ${status === 200 ? 'Already existed (idempotent)' : 'Created'}`)
      console.log(`  View:         https://dropcast.xyz/campaign/${data.campaign.campaign_number}`)
      console.log('='.repeat(56))
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (options.json) {
        jsonOutput({ error: err.message, status: err.status })
      } else {
        console.error(`\nERROR: ${err.message}`)
        console.error('Recovery file preserved. Fix the issue and retry.')
      }
      process.exit(1)
    }
    throw err
  }
}
