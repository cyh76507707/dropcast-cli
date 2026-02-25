/**
 * Campaign configuration schema (zod).
 *
 * Defines the campaign.json structure that the CLI consumes.
 * Maps to the POST /api/campaigns payload shape.
 */

import { z } from 'zod'

// ============================================
// Config Schema
// ============================================

const ethAddressRegex = /^0x[0-9a-fA-F]{40}$/

export const campaignConfigSchema = z.object({
  network: z.literal('base'),

  platform: z.enum(['farcaster', 'x']),

  host: z.object({
    fid: z.number().int().positive(),
    walletAddress: z.string().regex(ethAddressRegex, 'Invalid wallet address'),
  }),

  post: z.object({
    url: z.string().url('Invalid post URL'),
  }),

  token: z.object({
    address: z.string().regex(ethAddressRegex, 'Invalid token address'),
    symbol: z.string().min(1).max(20),
    decimals: z.number().int().min(0).max(77),
    logoUrl: z.string().url().nullable().optional(),
  }),

  reward: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('pool_split'),
      totalAmount: z.string().min(1, 'totalAmount is required for pool_split'),
    }),
    z.object({
      type: z.literal('fixed'),
      amountPerUser: z.string().min(1, 'amountPerUser is required for fixed'),
      maxParticipants: z.number().int().positive('maxParticipants must be positive'),
      totalAmount: z.string().optional(),
    }),
  ]),

  actions: z.object({
    follow: z.boolean().default(true),
    like: z.boolean().default(false),
    recast: z.boolean().default(false),
    quote: z.boolean().default(false),
    comment: z.boolean().default(false),
    prefilledQuoteMessage: z.string().max(350).nullable().optional(),
  }),

  targeting: z.object({
    minFollowers: z.number().int().min(0).default(0),
    minNeynarScore: z.number().min(0).max(1).default(0),
    minQuotientScore: z.number().min(0).default(0),
    requirePro: z.boolean().default(false),
    requireVerifiedOnly: z.boolean().default(false),
    requireProfilePhoto: z.boolean().default(false),
    minAccountAgeDays: z.number().int().min(0).default(0),
    minXFollowers: z.number().int().min(0).default(0),
    baseVerifyTargeting: z.record(z.unknown()).nullable().optional(),
  }),

  schedule: z.object({
    endsAt: z.string().refine(
      (val) => !isNaN(Date.parse(val)),
      'endsAt must be a valid ISO date string',
    ),
  }),
})

export type CampaignConfig = z.infer<typeof campaignConfigSchema>

// ============================================
// Config → API Payload Mapping
// ============================================

export interface CreateCampaignPayload {
  id: string
  hostFid: number
  hostWalletAddress: string
  platform: 'farcaster' | 'x'

  // Cast metadata (Farcaster only — resolved by CLI)
  castUrl?: string
  castHash?: string
  castAuthorFid?: number
  castAuthorUsername?: string
  castText?: string
  castImageUrl?: string | null
  castEmbeds?: unknown

  // For X campaigns
  postUrl?: string

  // Engagement requirements
  requireFollow: boolean
  requireLike: boolean
  requireRecast: boolean
  requireQuote: boolean
  requireComment: boolean
  prefilledQuoteMessage?: string | null

  // Targeting
  minFollowerCount: number
  minNeynarScore: number
  minQuotientScore: number
  requireProSubscriber: boolean
  requireVerifiedOnly: boolean
  requireProfilePhoto: boolean
  minAccountAgeDays: number
  minXFollowers?: number
  baseVerifyTargeting?: Record<string, unknown> | null

  // Token
  tokenAddress: string
  tokenSymbol: string
  tokenDecimals: number
  tokenLogoUrl?: string | null

  // Reward
  rewardType: 'pool_split' | 'fixed'
  totalAmount: string
  amountPerUser?: string
  maxParticipants?: number

  // Schedule
  endsAt: string

  // On-chain funding
  fundingTxHash: string
  baseFeePaid: string
}

/**
 * Build the POST /api/campaigns payload from config + resolved data.
 */
export function buildCreatePayload(params: {
  campaignId: string
  config: CampaignConfig
  castData?: {
    hash: string
    authorFid: number
    authorUsername: string
    text: string
    imageUrl?: string | null
    embeds?: unknown
  }
  totalAmount: string
  fundingTxHash: string
  baseFeePaid: string
}): CreateCampaignPayload {
  const { campaignId, config, castData, totalAmount, fundingTxHash, baseFeePaid } = params

  const payload: CreateCampaignPayload = {
    id: campaignId,
    hostFid: config.host.fid,
    hostWalletAddress: config.host.walletAddress,
    platform: config.platform,

    // Engagement
    requireFollow: config.actions.follow,
    requireLike: config.actions.like,
    requireRecast: config.actions.recast,
    requireQuote: config.actions.quote,
    requireComment: config.actions.comment,
    prefilledQuoteMessage: config.actions.prefilledQuoteMessage ?? null,

    // Targeting
    minFollowerCount: config.targeting.minFollowers,
    minNeynarScore: config.targeting.minNeynarScore,
    minQuotientScore: config.targeting.minQuotientScore,
    requireProSubscriber: config.targeting.requirePro,
    requireVerifiedOnly: config.targeting.requireVerifiedOnly,
    requireProfilePhoto: config.targeting.requireProfilePhoto,
    minAccountAgeDays: config.targeting.minAccountAgeDays,
    baseVerifyTargeting: config.targeting.baseVerifyTargeting ?? null,

    // Token
    tokenAddress: config.token.address,
    tokenSymbol: config.token.symbol,
    tokenDecimals: config.token.decimals,
    tokenLogoUrl: config.token.logoUrl ?? null,

    // Reward
    rewardType: config.reward.type,
    totalAmount,
    ...(config.reward.type === 'fixed' && {
      amountPerUser: config.reward.amountPerUser,
      maxParticipants: config.reward.maxParticipants,
    }),

    // Schedule
    endsAt: config.schedule.endsAt,

    // On-chain funding
    fundingTxHash,
    baseFeePaid,
  }

  // Platform-specific fields
  if (config.platform === 'farcaster') {
    payload.castUrl = config.post.url
    if (castData) {
      payload.castHash = castData.hash
      payload.castAuthorFid = castData.authorFid
      payload.castAuthorUsername = castData.authorUsername
      payload.castText = castData.text
      payload.castImageUrl = castData.imageUrl ?? null
      payload.castEmbeds = castData.embeds
    }
  } else {
    // X campaign — backend resolves tweet server-side
    payload.postUrl = config.post.url
  }

  // X campaign targeting
  if (config.platform === 'x' && config.targeting.minXFollowers > 0) {
    payload.minXFollowers = config.targeting.minXFollowers
  }

  return payload
}

// ============================================
// Config File I/O
// ============================================

import { readFileSync } from 'fs'

export function loadConfig(configPath: string): CampaignConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch {
    throw new Error(`Cannot read config file: ${configPath}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`)
  }

  const result = campaignConfigSchema.safeParse(json)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Config validation failed:\n${issues}`)
  }

  return result.data
}
