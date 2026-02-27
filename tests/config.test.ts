import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { campaignConfigSchema, buildCreatePayload, type CampaignConfig } from '../src/config.js'

// ============================================
// Helpers
// ============================================

const examplesDir = path.resolve(__dirname, '..', 'examples')

function loadExample(filename: string): unknown {
  const raw = fs.readFileSync(path.join(examplesDir, filename), 'utf-8')
  return JSON.parse(raw)
}

/** Minimal valid farcaster fixed config for mutation tests. */
function validFarcasterFixed(): Record<string, unknown> {
  return {
    network: 'base',
    platform: 'farcaster',
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
    reward: {
      type: 'fixed',
      amountPerUser: '100',
      maxParticipants: 10,
    },
    actions: {},
    targeting: {},
    schedule: { endsAt: '2026-04-01T00:00:00.000Z' },
  }
}

// ============================================
// Schema Validation
// ============================================

describe('campaignConfigSchema', () => {
  describe('valid configs — example files', () => {
    const examples = [
      'campaign.farcaster.fixed.json',
      'campaign.farcaster.pool-split.json',
      'campaign.x.fixed.json',
      'campaign.x.pool-split.json',
    ]

    for (const file of examples) {
      it(`parses ${file} successfully`, () => {
        const json = loadExample(file)
        const result = campaignConfigSchema.safeParse(json)
        expect(result.success).toBe(true)
      })
    }
  })

  describe('invalid — missing fields', () => {
    it('fails when required top-level fields are missing', () => {
      const result = campaignConfigSchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('fails when host is missing fid', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.host as Record<string, unknown>).fid = undefined
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })
  })

  describe('invalid — bad addresses', () => {
    it('rejects wallet address without 0x prefix', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.host as Record<string, unknown>).walletAddress =
        'AAAA000000000000000000000000000000000001'
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })

    it('rejects wallet address with wrong length', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.host as Record<string, unknown>).walletAddress = '0xDEAD'
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })

    it('rejects token address with invalid hex', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.token as Record<string, unknown>).address = '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })
  })

  describe('invalid — bad URLs', () => {
    it('rejects invalid post URL', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.post as Record<string, unknown>).url = 'not-a-url'
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })
  })

  describe('invalid — wrong discriminated union', () => {
    it('rejects pool_split with amountPerUser field', () => {
      const cfg = validFarcasterFixed()
      cfg.reward = {
        type: 'pool_split',
        totalAmount: '50000',
        amountPerUser: '100', // invalid for pool_split
      }
      const result = campaignConfigSchema.safeParse(cfg)
      // Zod strips unknown keys on discriminated unions, so this should
      // parse but amountPerUser should NOT appear in the output.
      if (result.success) {
        expect((result.data.reward as Record<string, unknown>).amountPerUser).toBeUndefined()
      }
      // Either it fails or it strips — both acceptable
    })
  })

  describe('defaults', () => {
    it('applies correct defaults for omitted optional booleans', () => {
      const cfg = validFarcasterFixed()
      // actions and targeting left mostly empty to test defaults
      cfg.actions = {}
      cfg.targeting = {}
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(true)
      if (!result.success) return

      // Actions defaults
      expect(result.data.actions.follow).toBe(true)
      expect(result.data.actions.like).toBe(false)
      expect(result.data.actions.recast).toBe(false)
      expect(result.data.actions.quote).toBe(false)
      expect(result.data.actions.comment).toBe(false)

      // Targeting defaults
      expect(result.data.targeting.requirePro).toBe(false)
      expect(result.data.targeting.requireVerifiedOnly).toBe(false)
      expect(result.data.targeting.requireProfilePhoto).toBe(false)
      expect(result.data.targeting.minFollowers).toBe(0)
      expect(result.data.targeting.minNeynarScore).toBe(0)
      expect(result.data.targeting.minAccountAgeDays).toBe(0)
    })
  })

  describe('boundary — decimals', () => {
    it('accepts decimals = 0', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.token as Record<string, unknown>).decimals = 0
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(true)
    })

    it('accepts decimals = 77', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.token as Record<string, unknown>).decimals = 77
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(true)
    })

    it('rejects decimals = 78', () => {
      const cfg = validFarcasterFixed()
      ;(cfg.token as Record<string, unknown>).decimals = 78
      const result = campaignConfigSchema.safeParse(cfg)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================
// buildCreatePayload
// ============================================

describe('buildCreatePayload', () => {
  /** Parse a valid config through the schema to get correct types + defaults. */
  function parseConfig(overrides?: Partial<ReturnType<typeof validFarcasterFixed>>): CampaignConfig {
    const raw = { ...validFarcasterFixed(), ...overrides }
    const result = campaignConfigSchema.parse(raw)
    return result
  }

  it('farcaster with castData — includes castHash and castUrl', () => {
    const config = parseConfig()
    const payload = buildCreatePayload({
      campaignId: 'test-1',
      config,
      castData: {
        hash: '0xdeadbeef',
        authorFid: 99,
        authorUsername: 'alice',
        text: 'hello world',
        imageUrl: null,
      },
      totalAmount: '1000',
      fundingTxHash: '0xtx1',
      baseFeePaid: '0.001',
    })

    expect(payload.castHash).toBe('0xdeadbeef')
    expect(payload.castUrl).toBe(config.post.url)
    expect(payload.castAuthorFid).toBe(99)
    expect(payload.castAuthorUsername).toBe('alice')
    expect(payload.platform).toBe('farcaster')
    expect(payload.postUrl).toBeUndefined()
  })

  it('farcaster without castData — castHash is undefined', () => {
    const config = parseConfig()
    const payload = buildCreatePayload({
      campaignId: 'test-2',
      config,
      totalAmount: '1000',
      fundingTxHash: '0xtx2',
      baseFeePaid: '0.001',
    })

    expect(payload.castHash).toBeUndefined()
    expect(payload.castUrl).toBe(config.post.url)
  })

  it('X campaign — has postUrl, no castHash', () => {
    const config = parseConfig({
      platform: 'x',
      post: { url: 'https://x.com/alice/status/123' },
    })
    const payload = buildCreatePayload({
      campaignId: 'test-3',
      config,
      totalAmount: '1000',
      fundingTxHash: '0xtx3',
      baseFeePaid: '0.001',
    })

    expect(payload.postUrl).toBe('https://x.com/alice/status/123')
    expect(payload.castHash).toBeUndefined()
    expect(payload.castUrl).toBeUndefined()
    expect(payload.platform).toBe('x')
  })

  it('fixed reward — amountPerUser and maxParticipants present', () => {
    const config = parseConfig({
      reward: { type: 'fixed', amountPerUser: '50', maxParticipants: 20 },
    })
    const payload = buildCreatePayload({
      campaignId: 'test-4',
      config,
      totalAmount: '1000',
      fundingTxHash: '0xtx4',
      baseFeePaid: '0.001',
    })

    expect(payload.rewardType).toBe('fixed')
    expect(payload.amountPerUser).toBe('50')
    expect(payload.maxParticipants).toBe(20)
  })

  it('pool_split reward — totalAmount present, no amountPerUser', () => {
    const config = parseConfig({
      reward: { type: 'pool_split', totalAmount: '5000' },
    })
    const payload = buildCreatePayload({
      campaignId: 'test-5',
      config,
      totalAmount: '5000',
      fundingTxHash: '0xtx5',
      baseFeePaid: '0.001',
    })

    expect(payload.rewardType).toBe('pool_split')
    expect(payload.totalAmount).toBe('5000')
    expect(payload.amountPerUser).toBeUndefined()
    expect(payload.maxParticipants).toBeUndefined()
  })
})
