import { describe, it, expect } from 'vitest'
import {
  calculateFee,
  getFeeBreakdown,
  feeToWei,
  formatFee,
  isValidFee,
  calculateQuotaSurcharge,
  FEE_CONFIG,
  type CampaignFeeOptions,
} from '../src/fees.js'

describe('calculateFee', () => {
  it('returns base fee only when no actions or targeting', () => {
    const fee = calculateFee({})
    expect(fee).toBe(FEE_CONFIG.BASE) // 0.0010
  })

  it('sums all action fees plus base when all actions enabled', () => {
    const fee = calculateFee({
      requireLike: true,
      requireRecast: true,
      requireQuote: true,
      requireComment: true,
    })
    const expected =
      FEE_CONFIG.BASE +
      FEE_CONFIG.LIKE +
      FEE_CONFIG.RECAST +
      FEE_CONFIG.QUOTE +
      FEE_CONFIG.COMMENT
    expect(fee).toBeCloseTo(expected, 10)
  })

  it('sums all targeting fees plus base when all targeting enabled', () => {
    const fee = calculateFee({
      minFollowers: 100,
      minNeynarScore: 0.5,
      minQuotientScore: 50,
      requireProSubscriber: true,
      requireVerifiedOnly: true,
      requireProfilePhoto: true,
      minAccountAgeDays: 30,
      minXFollowers: 100,
      baseVerifyProviderCount: 1,
    })
    const expected =
      FEE_CONFIG.BASE +
      FEE_CONFIG.MIN_FOLLOWERS +
      FEE_CONFIG.MIN_NEYNAR_SCORE +
      FEE_CONFIG.MIN_QUOTIENT_SCORE +
      FEE_CONFIG.PRO_ONLY +
      FEE_CONFIG.VERIFIED_ONLY +
      FEE_CONFIG.PROFILE_PHOTO +
      FEE_CONFIG.ACCOUNT_AGE +
      FEE_CONFIG.X_MIN_FOLLOWERS +
      FEE_CONFIG.BASE_VERIFY_PER_PROVIDER * 1
    expect(fee).toBeCloseTo(expected, 10)
  })

  it('adds FIXED_REWARD surcharge when rewardType is fixed', () => {
    const base = calculateFee({})
    const withFixed = calculateFee({ rewardType: 'fixed' })
    expect(withFixed).toBeCloseTo(base + FEE_CONFIG.FIXED_REWARD, 10)
  })

  it('adds X_CAMPAIGN surcharge when isXCampaign is true', () => {
    const base = calculateFee({})
    const withX = calculateFee({ isXCampaign: true })
    expect(withX).toBeCloseTo(base + FEE_CONFIG.X_CAMPAIGN, 10)
  })
})

describe('calculateQuotaSurcharge', () => {
  it('returns tier 1 fee for eligibleCount 1-100', () => {
    const result = calculateQuotaSurcharge(50)
    expect(result.fee).toBe(0.0006)
    expect(result.tierLabel).toBe('1-100')
  })

  it('returns tier 2 fee for eligibleCount 101-500', () => {
    const result = calculateQuotaSurcharge(250)
    expect(result.fee).toBe(0.0009)
    expect(result.tierLabel).toBe('101-500')
  })

  it('returns tier 3 fee for eligibleCount 501-1500', () => {
    const result = calculateQuotaSurcharge(1000)
    expect(result.fee).toBe(0.0012)
    expect(result.tierLabel).toBe('501-1500')
  })

  it('returns tier 4 fee for eligibleCount 1501-3000', () => {
    const result = calculateQuotaSurcharge(2000)
    expect(result.fee).toBe(0.0015)
    expect(result.tierLabel).toBe('1501-3000')
  })

  it('returns tier 5 fee for eligibleCount 3001+', () => {
    const result = calculateQuotaSurcharge(5000)
    expect(result.fee).toBe(0.0018)
    expect(result.tierLabel).toBe('3001+')
  })

  it('boundary: 100 is tier 1, 101 is tier 2', () => {
    const at100 = calculateQuotaSurcharge(100)
    const at101 = calculateQuotaSurcharge(101)
    expect(at100.fee).toBe(0.0006)
    expect(at100.tierLabel).toBe('1-100')
    expect(at101.fee).toBe(0.0009)
    expect(at101.tierLabel).toBe('101-500')
  })

  it('returns zero surcharge for eligibleCount 0', () => {
    const result = calculateQuotaSurcharge(0)
    expect(result.fee).toBe(0)
    expect(result.tierLabel).toBeNull()
  })

  it('returns zero surcharge for null', () => {
    const result = calculateQuotaSurcharge(null)
    expect(result.fee).toBe(0)
    expect(result.tierLabel).toBeNull()
  })
})

describe('getFeeBreakdown', () => {
  it('total matches calculateFee for the same options', () => {
    const options: CampaignFeeOptions = {
      requireLike: true,
      requireRecast: true,
      minFollowers: 50,
      rewardType: 'fixed',
      eligibleUserCount: 200,
    }
    const breakdown = getFeeBreakdown(options)
    const fee = calculateFee(options)
    expect(breakdown.total).toBeCloseTo(fee, 10)
  })

  it('returns correct labels and amounts in breakdown', () => {
    const options: CampaignFeeOptions = {
      requireLike: true,
      requireComment: true,
      minFollowers: 100,
      eligibleUserCount: 50,
    }
    const breakdown = getFeeBreakdown(options)

    expect(breakdown.base).toBe(FEE_CONFIG.BASE)
    expect(breakdown.like).toBe(FEE_CONFIG.LIKE)
    expect(breakdown.comment).toBe(FEE_CONFIG.COMMENT)
    expect(breakdown.minFollowers).toBe(FEE_CONFIG.MIN_FOLLOWERS)
    expect(breakdown.quotaSurcharge).toBe(0.0006)
    expect(breakdown.quotaSurchargeTier).toBe('1-100')

    // Disabled items should be 0
    expect(breakdown.recast).toBe(0)
    expect(breakdown.quote).toBe(0)
    expect(breakdown.proOnly).toBe(0)
    expect(breakdown.fixedReward).toBe(0)
    expect(breakdown.xCampaign).toBe(0)
  })
})

describe('feeToWei', () => {
  it('converts 0.001 ETH to correct wei value', () => {
    const wei = feeToWei(0.001)
    expect(wei).toBe(1000000000000000n) // 10^15
  })

  it('converts small amount 0.0002 ETH to correct wei value', () => {
    const wei = feeToWei(0.0002)
    expect(wei).toBe(200000000000000n)
  })
})

describe('formatFee', () => {
  it('shows 4 decimal places for fee < 0.01', () => {
    const result = formatFee(0.001)
    expect(result).toBe('0.0010 ETH')
  })

  it('shows 3 decimal places for fee >= 0.01', () => {
    const result = formatFee(0.05)
    expect(result).toBe('0.050 ETH')
  })

  it('returns "0 ETH" for zero fee', () => {
    expect(formatFee(0)).toBe('0 ETH')
  })
})

describe('isValidFee', () => {
  it('returns true when fee meets calculated minimum', () => {
    const options: CampaignFeeOptions = { requireLike: true }
    const minFee = calculateFee(options)
    expect(isValidFee(minFee, options)).toBe(true)
    expect(isValidFee(minFee + 0.001, options)).toBe(true)
  })

  it('returns false when fee is below calculated minimum', () => {
    const options: CampaignFeeOptions = { requireLike: true }
    const minFee = calculateFee(options)
    expect(isValidFee(minFee - 0.0001, options)).toBe(false)
  })
})
