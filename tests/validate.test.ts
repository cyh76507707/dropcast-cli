import { describe, it, expect } from 'vitest'
import { buildFeeOptions } from '../src/validate.js'
import { calculateFee } from '../src/fees.js'
import type { CampaignConfig } from '../src/config.js'

// ============================================
// Helpers
// ============================================

/** Build a minimal CampaignConfig for testing buildFeeOptions. */
function makeConfig(overrides: {
  platform?: 'farcaster' | 'x'
  actions?: Partial<CampaignConfig['actions']>
  targeting?: Partial<CampaignConfig['targeting']>
  reward?: CampaignConfig['reward']
} = {}): CampaignConfig {
  return {
    network: 'base',
    platform: overrides.platform ?? 'farcaster',
    host: {
      fid: 1,
      walletAddress: '0x0000000000000000000000000000000000000001',
    },
    post: { url: 'https://farcaster.xyz/alice/0xabc123' },
    token: {
      address: '0x0000000000000000000000000000000000000002',
      symbol: 'TKN',
      decimals: 18,
    },
    reward: overrides.reward ?? {
      type: 'pool_split' as const,
      totalAmount: '1000',
    },
    actions: {
      follow: true,
      like: false,
      recast: false,
      quote: false,
      comment: false,
      ...overrides.actions,
    },
    targeting: {
      minFollowers: 0,
      minNeynarScore: 0,
      minQuotientScore: 0,
      requirePro: false,
      requireVerifiedOnly: false,
      requireProfilePhoto: false,
      minAccountAgeDays: 0,
      minXFollowers: 0,
      baseVerifyTargeting: null,
      ...overrides.targeting,
    },
    schedule: { endsAt: '2026-04-01T00:00:00.000Z' },
  } as CampaignConfig
}

// ============================================
// buildFeeOptions
// ============================================

describe('buildFeeOptions', () => {
  describe('farcaster campaigns', () => {
    it('actions pass through when true', () => {
      const config = makeConfig({
        platform: 'farcaster',
        actions: { follow: true, like: true, recast: true },
      })
      const opts = buildFeeOptions(config)

      expect(opts.requireLike).toBe(true)
      expect(opts.requireRecast).toBe(true)
      expect(opts.isXCampaign).toBe(false)
    })

    it('actions pass through when false', () => {
      const config = makeConfig({
        platform: 'farcaster',
        actions: { follow: false, like: false, recast: false, quote: false, comment: false },
      })
      const opts = buildFeeOptions(config)

      expect(opts.requireLike).toBe(false)
      expect(opts.requireRecast).toBe(false)
      expect(opts.requireQuote).toBe(false)
      expect(opts.requireComment).toBe(false)
      expect(opts.isXCampaign).toBe(false)
    })
  })

  describe('X campaigns', () => {
    it('forces all actions to false even when config has them true', () => {
      const config = makeConfig({
        platform: 'x',
        actions: { follow: true, like: true, recast: true, quote: true, comment: true },
      })
      const opts = buildFeeOptions(config)

      expect(opts.isXCampaign).toBe(true)
      expect(opts.requireLike).toBe(false)
      expect(opts.requireRecast).toBe(false)
      expect(opts.requireQuote).toBe(false)
      expect(opts.requireComment).toBe(false)
    })

    it('P0-2 regression — explicitly true actions still forced false', () => {
      const config = makeConfig({
        platform: 'x',
        actions: { follow: true, like: true, recast: true, quote: true, comment: true },
      })
      const opts = buildFeeOptions(config)

      // Every engagement action must be false for X
      expect(opts.requireLike).toBe(false)
      expect(opts.requireRecast).toBe(false)
      expect(opts.requireQuote).toBe(false)
      expect(opts.requireComment).toBe(false)
      expect(opts.isXCampaign).toBe(true)
    })
  })

  describe('targeting values', () => {
    it('passes through targeting values correctly', () => {
      const config = makeConfig({
        targeting: {
          minFollowers: 100,
          minNeynarScore: 0.8,
          minQuotientScore: 50,
          requirePro: true,
          requireVerifiedOnly: true,
          requireProfilePhoto: true,
          minAccountAgeDays: 30,
          minXFollowers: 500,
        },
      })
      const opts = buildFeeOptions(config)

      expect(opts.minFollowers).toBe(100)
      expect(opts.minNeynarScore).toBe(0.8)
      expect(opts.minQuotientScore).toBe(50)
      expect(opts.requireProSubscriber).toBe(true)
      expect(opts.requireVerifiedOnly).toBe(true)
      expect(opts.requireProfilePhoto).toBe(true)
      expect(opts.minAccountAgeDays).toBe(30)
      expect(opts.minXFollowers).toBe(500)
    })
  })

  describe('reward type', () => {
    it('detects fixed reward type', () => {
      const config = makeConfig({
        reward: { type: 'fixed', amountPerUser: '10', maxParticipants: 5 },
      })
      const opts = buildFeeOptions(config)

      expect(opts.rewardType).toBe('fixed')
    })

    it('detects pool_split reward type', () => {
      const config = makeConfig({
        reward: { type: 'pool_split', totalAmount: '5000' },
      })
      const opts = buildFeeOptions(config)

      expect(opts.rewardType).toBe('pool_split')
    })
  })

  describe('Base Verify provider count', () => {
    it('counts providers correctly', () => {
      const config = makeConfig({
        targeting: {
          baseVerifyTargeting: {
            coinbase: true,
            attestation: true,
            talent: true,
          },
        },
      })
      const opts = buildFeeOptions(config)

      expect(opts.baseVerifyProviderCount).toBe(3)
    })

    it('returns 0 when baseVerifyTargeting is null', () => {
      const config = makeConfig({
        targeting: { baseVerifyTargeting: null },
      })
      const opts = buildFeeOptions(config)

      expect(opts.baseVerifyProviderCount).toBe(0)
    })
  })

  describe('eligibleUserCount mutation', () => {
    it('buildFeeOptions result can have eligibleUserCount set via mutation', () => {
      const config = makeConfig()
      const opts = buildFeeOptions(config)

      // Initially no eligibleUserCount
      expect(opts.eligibleUserCount).toBeUndefined()

      const feeWithout = calculateFee(opts)

      // Mutate to add eligible user count
      opts.eligibleUserCount = 200

      const feeWith = calculateFee(opts)

      // Fee should increase by the surcharge for tier 101-500 (0.0009 ETH)
      expect(feeWith - feeWithout).toBeCloseTo(0.0009, 6)
    })
  })
})
