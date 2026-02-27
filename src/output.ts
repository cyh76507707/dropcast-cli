/**
 * Output formatting for human-readable and JSON modes.
 */

import { formatFee, getFeeBreakdown, FEE_LABELS, type CampaignFeeOptions, type FeeBreakdown } from './fees.js'
import type { CampaignConfig } from './config.js'
import type { CampaignDetails } from './api.js'

// ============================================
// JSON Output
// ============================================

export function jsonOutput(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

// ============================================
// Dry-Run Summary
// ============================================

export interface DryRunData {
  config: CampaignConfig
  campaignId: string
  feeOptions: CampaignFeeOptions
  totalAmount: string
  tokenPriceUsd: number | null
  budgetUsd: number | null
  ethBalance: string
  tokenBalance: string
  castPreview?: {
    authorFid: number
    author: string
    text: string
  }
}

export function printDryRunSummary(data: DryRunData): void {
  const { config, campaignId, feeOptions, totalAmount, tokenPriceUsd, budgetUsd, castPreview } = data
  const breakdown = getFeeBreakdown(feeOptions)

  console.log('')
  console.log('=== Campaign Dry-Run ===')
  console.log('')
  console.log(`Campaign ID:    ${campaignId}`)
  console.log(`Platform:       ${config.platform}`)
  console.log(`Post:           ${config.post.url}`)

  if (castPreview) {
    const text = castPreview.text.length > 80
      ? `${castPreview.text.slice(0, 80)}...`
      : castPreview.text
    console.log(`                "${text}"`)
    console.log(`Cast author:    @${castPreview.author}`)
  } else if (config.platform === 'x') {
    console.log(`                (Tweet resolved server-side during creation)`)
  }

  console.log(`Host:           FID ${config.host.fid} (${config.host.walletAddress})`)
  console.log('')
  console.log(`Token:          ${config.token.symbol} (${config.token.address})`)
  if (tokenPriceUsd !== null) {
    console.log(`Token price:    $${tokenPriceUsd.toFixed(6)}`)
  }

  if (budgetUsd !== null) {
    console.log(`Budget:         $${budgetUsd.toFixed(2)} USD ~ ${Number(totalAmount).toLocaleString()} ${config.token.symbol}`)
  } else {
    console.log(`Amount:         ${Number(totalAmount).toLocaleString()} ${config.token.symbol}`)
    if (tokenPriceUsd !== null) {
      const usdValue = Number(totalAmount) * tokenPriceUsd
      console.log(`                (~$${usdValue.toFixed(2)} USD at current price)`)
    }
  }

  if (config.reward.type === 'fixed') {
    console.log(`Reward type:    fixed (${config.reward.amountPerUser} ${config.token.symbol} x ${config.reward.maxParticipants} users)`)
  } else {
    console.log(`Reward type:    pool_split`)
  }

  console.log(`Fee:            ${formatFee(breakdown.total)}`)
  console.log('')

  // Actions
  if (config.platform === 'x') {
    console.log(`Actions:        Proof-of-read (word challenge)`)
  } else {
    const actions: string[] = []
    if (config.actions.follow) actions.push('Follow')
    if (config.actions.like) actions.push('Like')
    if (config.actions.recast) actions.push('Recast')
    if (config.actions.quote) actions.push('Quote')
    if (config.actions.comment) actions.push('Comment')
    console.log(`Actions:        ${actions.join(', ')}`)
  }

  // Targeting
  const targeting: string[] = []
  if (config.targeting.requireVerifiedOnly) targeting.push('Non-spam only')
  if (config.targeting.minFollowers > 0) targeting.push(`${config.targeting.minFollowers}+ followers`)
  if (config.targeting.minNeynarScore > 0) targeting.push(`Neynar >= ${config.targeting.minNeynarScore}`)
  if (config.targeting.minQuotientScore > 0) targeting.push(`Quotient >= ${config.targeting.minQuotientScore}`)
  if (config.targeting.requirePro) targeting.push('Pro only')
  if (config.targeting.requireProfilePhoto) targeting.push('Profile photo required')
  if (config.targeting.minAccountAgeDays > 0) targeting.push(`${config.targeting.minAccountAgeDays}d account age`)
  if (config.targeting.minXFollowers > 0) targeting.push(`${config.targeting.minXFollowers}+ X followers`)

  console.log(`Targeting:      ${targeting.length > 0 ? targeting.join(', ') : '(none)'}`)
  console.log(`Period:         ends ${config.schedule.endsAt}`)
  console.log('')

  // Balances
  console.log(`Wallet ETH:     ${data.ethBalance}`)
  console.log(`Wallet ${config.token.symbol.padEnd(7)} ${data.tokenBalance}`)
  console.log('')

  // Fee breakdown
  printFeeBreakdown(breakdown)
}

export function printFeeBreakdown(breakdown: FeeBreakdown): void {
  console.log('--- Fee Breakdown ---')

  const entries = Object.entries(breakdown) as [keyof FeeBreakdown, number | string | null][]
  for (const [key, value] of entries) {
    if (key === 'total' || key === 'quotaSurchargeTier') continue
    if (typeof value === 'number' && value > 0) {
      const label = FEE_LABELS[key] || key
      console.log(`  ${label.padEnd(28)} ${formatFee(value)}`)
    }
  }

  if (breakdown.quotaSurchargeTier) {
    console.log(`  Eligible users tier:        ${breakdown.quotaSurchargeTier}`)
  }

  console.log(`  ${'─'.repeat(40)}`)
  console.log(`  ${'Total'.padEnd(28)} ${formatFee(breakdown.total)}`)
}

// ============================================
// Campaign Status Display
// ============================================

export function printCampaignStatus(campaign: CampaignDetails): void {
  console.log('')
  console.log('=== Campaign Status ===')
  console.log('')
  console.log(`Campaign #:     ${campaign.campaign_number}`)
  console.log(`Campaign ID:    ${campaign.id}`)
  console.log(`Status:         ${campaign.status}`)
  console.log(`Platform:       ${campaign.platform}`)
  console.log(`Token:          ${campaign.token_symbol} (${campaign.token_address})`)
  console.log(`Reward type:    ${campaign.reward_type}`)
  console.log(`Total amount:   ${Number(campaign.total_amount).toLocaleString()} ${campaign.token_symbol}`)

  if (campaign.reward_type === 'fixed') {
    console.log(`Per user:       ${campaign.amount_per_user} ${campaign.token_symbol}`)
    console.log(`Max users:      ${campaign.max_participants}`)
  }

  console.log('')
  console.log(`Created:        ${campaign.created_at}`)
  console.log(`Ends at:        ${campaign.ends_at}`)

  const now = new Date()
  const endsAt = new Date(campaign.ends_at)
  if (endsAt > now) {
    const diffMs = endsAt.getTime() - now.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    const remainingHours = diffHours % 24
    console.log(`Time left:      ${diffDays}d ${remainingHours}h`)
  } else {
    console.log(`Time left:      Ended`)
  }

  console.log('')
  if (campaign.participant_count !== undefined) {
    console.log(`Participants:   ${campaign.participant_count}`)
  }
  if (campaign.verified_count !== undefined) {
    console.log(`Verified:       ${campaign.verified_count}`)
  }

  if (campaign.funding_tx_hash) {
    console.log('')
    console.log(`Funding TX:     ${campaign.funding_tx_hash}`)
  }
  if (campaign.base_fee_paid) {
    console.log(`Fee paid:       ${campaign.base_fee_paid} ETH`)
  }

  if (campaign.distribution_status) {
    console.log(`Distribution:   ${campaign.distribution_status}`)
  }
  if (campaign.refund_status) {
    console.log(`Refund:         ${campaign.refund_status}`)
  }
}

export function printCampaignList(campaigns: CampaignDetails[], total: number, limit: number, offset: number): void {
  if (campaigns.length === 0) {
    console.log('No campaigns found.')
    return
  }

  console.log('')
  console.log(`Showing ${offset + 1}-${offset + campaigns.length} of ${total} campaigns`)
  console.log('')

  // Table header
  const header = [
    '#'.padEnd(6),
    'Token'.padEnd(8),
    'Type'.padEnd(12),
    'Participants'.padEnd(14),
    'Status'.padEnd(10),
    'Ends At',
  ].join(' ')
  console.log(header)
  console.log('─'.repeat(header.length))

  for (const c of campaigns) {
    const row = [
      String(c.campaign_number).padEnd(6),
      (c.token_symbol || '?').padEnd(8),
      c.reward_type.padEnd(12),
      String(c.participant_count ?? '-').padEnd(14),
      c.status.padEnd(10),
      c.ends_at ? new Date(c.ends_at).toLocaleDateString() : '-',
    ].join(' ')
    console.log(row)
  }

  if (offset + campaigns.length < total) {
    console.log('')
    console.log(`Use --offset ${offset + limit} to see next page`)
  }
}
