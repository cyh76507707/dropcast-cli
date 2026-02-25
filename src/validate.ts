/**
 * campaign validate — offline schema validation + online preview.
 */

import { loadConfig, type CampaignConfig } from './config.js'
import { resolveCast, getTokenPrice } from './api.js'
import { calculateFee, getFeeBreakdown, formatFee, type CampaignFeeOptions } from './fees.js'
import { jsonOutput, printDryRunSummary, type DryRunData } from './output.js'
import { getBalances } from './chain.js'
import { randomUUID } from 'crypto'

// ============================================
// Fee Options Builder
// ============================================

export function buildFeeOptions(config: CampaignConfig): CampaignFeeOptions {
  // X campaigns use proof-of-read — backend forces all actions to false.
  // Do NOT include action fees for X campaigns (Section 7.1.6).
  const isX = config.platform === 'x'

  return {
    requireLike: isX ? false : config.actions.like,
    requireRecast: isX ? false : config.actions.recast,
    requireQuote: isX ? false : config.actions.quote,
    requireComment: isX ? false : config.actions.comment,
    minFollowers: config.targeting.minFollowers,
    minNeynarScore: config.targeting.minNeynarScore,
    minQuotientScore: config.targeting.minQuotientScore,
    requireProSubscriber: config.targeting.requirePro,
    requireVerifiedOnly: config.targeting.requireVerifiedOnly,
    requireProfilePhoto: config.targeting.requireProfilePhoto,
    minAccountAgeDays: config.targeting.minAccountAgeDays,
    minXFollowers: config.targeting.minXFollowers,
    baseVerifyProviderCount: config.targeting.baseVerifyTargeting
      ? Object.keys(config.targeting.baseVerifyTargeting).length
      : 0,
    isXCampaign: isX,
    rewardType: config.reward.type,
  }
}

// ============================================
// Validate Command
// ============================================

export async function validateCommand(options: {
  config: string
  offline?: boolean
  json?: boolean
}): Promise<void> {
  // 1. Load and validate schema
  const config = loadConfig(options.config)

  if (options.offline) {
    if (options.json) {
      jsonOutput({ valid: true, config })
    } else {
      console.log('Config is valid (offline check).')
    }
    return
  }

  // 2. Online validation
  const feeOptions = buildFeeOptions(config)
  const fee = calculateFee(feeOptions)
  const breakdown = getFeeBreakdown(feeOptions)

  // Resolve cast (Farcaster only)
  let castPreview: DryRunData['castPreview'] | undefined
  if (config.platform === 'farcaster') {
    try {
      const cast = await resolveCast(config.post.url)
      castPreview = {
        author: cast.author.username,
        text: cast.text,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!options.json) {
        console.warn(`Warning: Could not resolve cast: ${msg}`)
      }
    }
  }

  // Fetch token price
  let tokenPriceUsd: number | null = null
  try {
    tokenPriceUsd = await getTokenPrice(config.token.address)
  } catch {
    // Non-critical
  }

  // Calculate total amount for display
  let totalAmount: string
  if (config.reward.type === 'fixed') {
    // totalAmount = amountPerUser * maxParticipants (BigInt math)
    const { parseUnits, formatUnits } = await import('viem')
    const perUser = parseUnits(config.reward.amountPerUser, config.token.decimals)
    const total = perUser * BigInt(config.reward.maxParticipants)
    totalAmount = formatUnits(total, config.token.decimals)
  } else {
    totalAmount = config.reward.totalAmount
  }

  // Get balances
  let ethBalance = '(skipped)'
  let tokenBalance = '(skipped)'
  try {
    const balances = await getBalances(
      config.host.walletAddress as `0x${string}`,
      config.token.address as `0x${string}`,
      config.token.decimals,
    )
    ethBalance = balances.ethFormatted
    tokenBalance = balances.tokenFormatted
  } catch {
    // Balance check may fail if PRIVATE_KEY not set (validate doesn't need it)
  }

  if (options.json) {
    jsonOutput({
      valid: true,
      config,
      fee: {
        total: fee,
        totalFormatted: formatFee(fee),
        breakdown,
      },
      tokenPriceUsd,
      totalAmount,
      castPreview,
      ethBalance,
      tokenBalance,
    })
  } else {
    const campaignId = randomUUID()
    printDryRunSummary({
      config,
      campaignId,
      feeOptions,
      totalAmount,
      tokenPriceUsd,
      budgetUsd: tokenPriceUsd ? Number(totalAmount) * tokenPriceUsd : null,
      ethBalance,
      tokenBalance,
      castPreview,
    })
  }
}
