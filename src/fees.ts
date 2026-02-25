/**
 * Dynamic Fee Calculation for DropCast Campaigns
 *
 * Synced from dropcast/lib/fees.ts @ 97f74d0
 * Partial sync: omitted formatEther import and getFeeRangeDescription() (unused in CLI).
 * DO NOT edit manually — sync from the dropcast repo when fees change.
 *
 * [BE-056] Updated Fee Structure (2026-01-21)
 * - Base Fee: 0.0010 ETH (Follow only, no targeting, pool split)
 * - Action/Targeting fees: +33% increase
 * - NEW: Quota surcharge based on eligible user count
 *
 * Range: 0.0016 ETH (min with 1-100 eligible) to 0.0070 ETH (max with all options + 3001+ eligible)
 */

import { parseEther } from 'viem'

// ============================================
// Fee Configuration (in ETH)
// ============================================

export const FEE_CONFIG = {
  // Base fee (required actions: follow only, no targeting, pool split)
  BASE: 0.0010,

  // Additional action requirements (+33% from original)
  LIKE: 0.0002,
  RECAST: 0.0002,
  QUOTE: 0.0004,
  COMMENT: 0.0006,

  // Targeting options (+33% from original)
  MIN_FOLLOWERS: 0.0002,
  MIN_NEYNAR_SCORE: 0.0004,
  MIN_QUOTIENT_SCORE: 0.0006,
  PRO_ONLY: 0.0006,
  // [BE-028] Spam label targeting
  VERIFIED_ONLY: 0.0002,
  // [BE-058] Profile photo and account age targeting
  PROFILE_PHOTO: 0.0002,
  ACCOUNT_AGE: 0.0002,
  // [#179] X campaign min followers targeting
  X_MIN_FOLLOWERS: 0.0002,
  // [BE-060] Base Verify (per enabled provider)
  BASE_VERIFY_PER_PROVIDER: 0.0004,

  // Reward type (+33% from original)
  FIXED_REWARD: 0.0008,

  // [#162] X Campaign (proof-of-read requirement)
  X_CAMPAIGN: 0.0025,
} as const

// ============================================
// [BE-056] Quota Surcharge Configuration
// ============================================

export const QUOTA_SURCHARGE_TIERS = [
  { min: 1, max: 100, fee: 0.0006 },
  { min: 101, max: 500, fee: 0.0009 },
  { min: 501, max: 1500, fee: 0.0012 },
  { min: 1501, max: 3000, fee: 0.0015 },
  { min: 3001, max: Infinity, fee: 0.0018 },
] as const

// ============================================
// Types
// ============================================

export interface CampaignFeeOptions {
  // Required actions
  requireLike?: boolean
  requireRecast?: boolean
  requireQuote?: boolean
  requireComment?: boolean

  // Targeting
  minFollowers?: number
  minNeynarScore?: number
  minQuotientScore?: number
  requireProSubscriber?: boolean
  // [BE-028] Spam label targeting
  requireVerifiedOnly?: boolean
  // [BE-058] Profile photo and account age targeting
  requireProfilePhoto?: boolean
  minAccountAgeDays?: number
  // [#179] X campaign min followers targeting
  minXFollowers?: number
  // [BE-060] Base Verify (number of enabled providers)
  baseVerifyProviderCount?: number

  // [#162] X campaign (proof-of-read)
  isXCampaign?: boolean

  // Reward type
  rewardType?: 'pool_split' | 'fixed'

  // [BE-056] Eligible user count for quota surcharge
  eligibleUserCount?: number | null
}

export interface FeeBreakdown {
  base: number
  like: number
  recast: number
  quote: number
  comment: number
  minFollowers: number
  minNeynarScore: number
  minQuotientScore: number
  proOnly: number
  // [BE-028] Spam label targeting
  verifiedOnly: number
  // [BE-058] Profile photo and account age targeting
  profilePhoto: number
  accountAge: number
  // [#179] X campaign min followers targeting
  xMinFollowers: number
  // [BE-060] Base Verify
  baseVerify: number
  fixedReward: number
  // [#162] X Campaign fee
  xCampaign: number
  // [BE-056] Quota surcharge
  quotaSurcharge: number
  quotaSurchargeTier: string | null
  total: number
}

// ============================================
// Fee Calculation
// ============================================

/**
 * [BE-056] Calculate quota surcharge based on eligible user count
 */
export function calculateQuotaSurcharge(eligibleCount: number | null | undefined): {
  fee: number
  tierLabel: string | null
} {
  if (eligibleCount === null || eligibleCount === undefined || eligibleCount <= 0) {
    return { fee: 0, tierLabel: null }
  }

  for (const tier of QUOTA_SURCHARGE_TIERS) {
    if (eligibleCount >= tier.min && eligibleCount <= tier.max) {
      const tierLabel = tier.max === Infinity
        ? `${tier.min}+`
        : `${tier.min}-${tier.max}`
      return { fee: tier.fee, tierLabel }
    }
  }

  // Fallback to highest tier
  const lastTier = QUOTA_SURCHARGE_TIERS[QUOTA_SURCHARGE_TIERS.length - 1]
  return { fee: lastTier.fee, tierLabel: `${lastTier.min}+` }
}

/**
 * Calculate total campaign fee based on options
 */
export function calculateFee(options: CampaignFeeOptions): number {
  let fee = FEE_CONFIG.BASE

  // Actions
  if (options.requireLike) fee += FEE_CONFIG.LIKE
  if (options.requireRecast) fee += FEE_CONFIG.RECAST
  if (options.requireQuote) fee += FEE_CONFIG.QUOTE
  if (options.requireComment) fee += FEE_CONFIG.COMMENT

  // Targeting
  if (options.minFollowers && options.minFollowers > 0) fee += FEE_CONFIG.MIN_FOLLOWERS
  if (options.minNeynarScore && options.minNeynarScore > 0) fee += FEE_CONFIG.MIN_NEYNAR_SCORE
  if (options.minQuotientScore && options.minQuotientScore > 0) fee += FEE_CONFIG.MIN_QUOTIENT_SCORE
  if (options.requireProSubscriber) fee += FEE_CONFIG.PRO_ONLY
  // [BE-028] Spam label targeting
  if (options.requireVerifiedOnly) fee += FEE_CONFIG.VERIFIED_ONLY
  // [BE-058] Profile photo and account age targeting
  if (options.requireProfilePhoto) fee += FEE_CONFIG.PROFILE_PHOTO
  if (options.minAccountAgeDays && options.minAccountAgeDays > 0) fee += FEE_CONFIG.ACCOUNT_AGE
  // [#179] X campaign min followers targeting
  if (options.minXFollowers && options.minXFollowers > 0) fee += FEE_CONFIG.X_MIN_FOLLOWERS
  // [BE-060] Base Verify: per-provider fee
  if (options.baseVerifyProviderCount && options.baseVerifyProviderCount > 0) {
    fee += FEE_CONFIG.BASE_VERIFY_PER_PROVIDER * options.baseVerifyProviderCount
  }

  // Reward type
  if (options.rewardType === 'fixed') fee += FEE_CONFIG.FIXED_REWARD

  // [#162] X Campaign fee
  if (options.isXCampaign) fee += FEE_CONFIG.X_CAMPAIGN

  // [BE-056] Quota surcharge
  const { fee: quotaSurchargeFee } = calculateQuotaSurcharge(options.eligibleUserCount)
  fee += quotaSurchargeFee

  return fee
}

/**
 * Get detailed fee breakdown
 */
export function getFeeBreakdown(options: CampaignFeeOptions): FeeBreakdown {
  // [BE-056] Calculate quota surcharge
  const { fee: quotaSurchargeFee, tierLabel } = calculateQuotaSurcharge(options.eligibleUserCount)

  return {
    base: FEE_CONFIG.BASE,
    like: options.requireLike ? FEE_CONFIG.LIKE : 0,
    recast: options.requireRecast ? FEE_CONFIG.RECAST : 0,
    quote: options.requireQuote ? FEE_CONFIG.QUOTE : 0,
    comment: options.requireComment ? FEE_CONFIG.COMMENT : 0,
    minFollowers: (options.minFollowers && options.minFollowers > 0) ? FEE_CONFIG.MIN_FOLLOWERS : 0,
    minNeynarScore: (options.minNeynarScore && options.minNeynarScore > 0) ? FEE_CONFIG.MIN_NEYNAR_SCORE : 0,
    minQuotientScore: (options.minQuotientScore && options.minQuotientScore > 0) ? FEE_CONFIG.MIN_QUOTIENT_SCORE : 0,
    proOnly: options.requireProSubscriber ? FEE_CONFIG.PRO_ONLY : 0,
    // [BE-028] Spam label targeting
    verifiedOnly: options.requireVerifiedOnly ? FEE_CONFIG.VERIFIED_ONLY : 0,
    // [BE-058] Profile photo and account age targeting
    profilePhoto: options.requireProfilePhoto ? FEE_CONFIG.PROFILE_PHOTO : 0,
    accountAge: (options.minAccountAgeDays && options.minAccountAgeDays > 0) ? FEE_CONFIG.ACCOUNT_AGE : 0,
    // [#179] X campaign min followers targeting
    xMinFollowers: (options.minXFollowers && options.minXFollowers > 0) ? FEE_CONFIG.X_MIN_FOLLOWERS : 0,
    // [BE-060] Base Verify
    baseVerify: (options.baseVerifyProviderCount && options.baseVerifyProviderCount > 0)
      ? FEE_CONFIG.BASE_VERIFY_PER_PROVIDER * options.baseVerifyProviderCount : 0,
    fixedReward: options.rewardType === 'fixed' ? FEE_CONFIG.FIXED_REWARD : 0,
    // [#162] X Campaign fee
    xCampaign: options.isXCampaign ? FEE_CONFIG.X_CAMPAIGN : 0,
    // [BE-056] Quota surcharge
    quotaSurcharge: quotaSurchargeFee,
    quotaSurchargeTier: tierLabel,
    total: calculateFee(options),
  }
}

/**
 * Convert fee to wei (bigint)
 */
export function feeToWei(fee: number): bigint {
  // Use parseEther with fixed decimal string to avoid floating point issues
  return parseEther(fee.toFixed(6))
}

/**
 * Format fee for display
 */
export function formatFee(fee: number): string {
  if (fee === 0) return '0 ETH'

  // Show 4 decimal places for small amounts
  if (fee < 0.01) {
    return `${fee.toFixed(4)} ETH`
  }

  return `${fee.toFixed(3)} ETH`
}

// ============================================
// Fee Validation
// ============================================

/**
 * Check if fee meets minimum requirement
 */
export function isValidFee(feeInEth: number, options: CampaignFeeOptions): boolean {
  return feeInEth >= calculateFee(options)
}

/**
 * Get minimum fee in wei
 */
export function getMinFeeWei(options: CampaignFeeOptions): bigint {
  return feeToWei(calculateFee(options))
}

// ============================================
// Human-readable labels for fee breakdown
// ============================================

export const FEE_LABELS: Record<keyof FeeBreakdown, string> = {
  base: 'Host fee (Follow)',
  like: 'Like requirement',
  recast: 'Recast requirement',
  quote: 'Quote requirement',
  comment: 'Comment requirement',
  minFollowers: 'Min followers targeting',
  minNeynarScore: 'Neynar score targeting',
  minQuotientScore: 'Quotient score targeting',
  proOnly: 'Pro subscribers only',
  // [BE-028] Spam label targeting
  verifiedOnly: 'Non-spam only',
  // [BE-058] Profile photo and account age targeting
  profilePhoto: 'Profile photo required',
  accountAge: 'Account age requirement',
  // [#179] X campaign min followers targeting
  xMinFollowers: 'X followers targeting',
  // [BE-060] Base Verify
  baseVerify: 'Base Verify targeting',
  fixedReward: 'Fixed reward type',
  // [#162] X Campaign
  xCampaign: 'X Campaign fee',
  // [BE-056] Quota surcharge
  quotaSurcharge: 'Quota surcharge',
  quotaSurchargeTier: 'Eligible users tier',
  total: 'Total',
}
