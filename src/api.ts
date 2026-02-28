/**
 * HTTP client for DropCast API endpoints.
 *
 * All mutations go through POST /api/campaigns.
 * Read endpoints: /api/neynar/cast, /api/tokens/[address], /api/campaigns.
 */

import { getApiBaseUrl } from './constants.js'
import type { CreateCampaignPayload } from './config.js'

const CLIENT_HEADER = { 'X-Dropcast-Client': 'cli' }

// ============================================
// Types
// ============================================

export interface NeynarCastResponse {
  cast: {
    hash: string
    author: {
      fid: number
      username: string
      display_name: string
      pfp_url: string
    }
    text: string
    embeds: Array<{
      url?: string
      metadata?: {
        image?: { url: string }
      }
    }>
  }
}

export interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals: number
  logoUrl?: string
  isWhitelisted: boolean
}

export interface TokenPriceResponse {
  usdPrice: number | null
}

export interface CreateCampaignResponse {
  success: boolean
  campaign: {
    id: string
    campaign_number: number
    status: 'active' | 'pending'
    [key: string]: unknown
  }
}

export interface CampaignDetails {
  id: string
  campaign_number: number
  status: string
  platform: string
  host_fid: number
  cast_url?: string
  post_url?: string
  token_address: string
  token_symbol: string
  token_decimals: number
  reward_type: string
  total_amount: string
  amount_per_user?: string
  max_participants?: number
  ends_at: string
  created_at: string
  funding_tx_hash?: string
  base_fee_paid?: string
  participant_count?: number
  verified_count?: number
  distribution_status?: string
  refund_status?: string
  [key: string]: unknown
}

export interface CampaignListResponse {
  campaigns: CampaignDetails[]
  total: number
  limit: number
  offset: number
}

// ============================================
// API Client
// ============================================

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export { ApiError }

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path}`

  const headers: Record<string, string> = {
    ...CLIENT_HEADER,
    ...(init?.headers as Record<string, string> || {}),
  }

  const res = await fetch(url, { ...init, headers })
  return res
}

// ============================================
// Cast Resolution
// ============================================

/**
 * Resolve a cast via the Neynar proxy endpoint.
 * Farcaster only — X casts are resolved server-side during creation.
 */
export async function resolveCast(postUrl: string): Promise<NeynarCastResponse['cast']> {
  const res = await apiFetch(`/api/neynar/cast?url=${encodeURIComponent(postUrl)}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Failed to resolve cast: ${(body as { error?: string }).error || res.statusText}`)
  }

  const data = (await res.json()) as NeynarCastResponse
  return data.cast
}

// ============================================
// Token
// ============================================

/**
 * Validate a token address via the token endpoint.
 */
export async function resolveToken(tokenAddress: string): Promise<TokenInfo> {
  const res = await apiFetch(`/api/tokens/${tokenAddress}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Failed to resolve token ${tokenAddress}: ${(body as { error?: string }).error || res.statusText}`)
  }

  return (await res.json()) as TokenInfo
}

/**
 * Get token USD price.
 */
export async function getTokenPrice(tokenAddress: string): Promise<number | null> {
  const res = await apiFetch(`/api/tokens/${tokenAddress}/usd-price`)

  if (!res.ok) {
    return null
  }

  const data = (await res.json()) as TokenPriceResponse
  return data.usdPrice
}

// ============================================
// Campaign Creation
// ============================================

/**
 * Register a campaign via POST /api/campaigns.
 *
 * Response codes:
 * - 200: Idempotent return (same id + same txHash)
 * - 201: Created
 * - 202: Pending finality (retry later)
 * - 400: Validation failure
 * - 403: Authorization failure
 * - 409: Conflict (duplicate txHash or mismatched data)
 */
export async function createCampaign(payload: CreateCampaignPayload): Promise<{
  status: number
  data: CreateCampaignResponse
}> {
  const res = await apiFetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let data: CreateCampaignResponse
  try {
    data = await res.json()
  } catch {
    throw new ApiError(res.status, null, `Campaign creation failed (${res.status}): non-JSON response from server`)
  }

  if (res.status === 202) {
    return { status: 202, data }
  }

  if (!res.ok) {
    throw new ApiError(res.status, data, `Campaign creation failed (${res.status}): ${(data as unknown as { error?: string }).error || JSON.stringify(data)}`)
  }

  return { status: res.status, data }
}

// ============================================
// Campaign Registration with Retry
// ============================================

/**
 * Register campaign via API with exponential backoff retry for 202 (pending finality).
 * Shared by create and resume commands.
 */
export async function registerCampaignWithRetry(params: {
  payload: CreateCampaignPayload
  json?: boolean
}): Promise<{
  status: number
  data: CreateCampaignResponse
}> {
  const maxRetries = 6
  const retryDelays = [2000, 4000, 8000, 16000, 32000, 60000]
  let lastStatus = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { status, data } = await createCampaign(params.payload)
    lastStatus = status

    if (status === 200 || status === 201) {
      return { status, data }
    }

    if (status === 202) {
      const delay = retryDelays[attempt] || 60000
      if (!params.json) {
        console.log(`  Pending finality... retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})`)
      }
      await new Promise((r) => setTimeout(r, delay))
      continue
    }
  }

  throw new ApiError(lastStatus, null, 'Campaign registration pending finality after max retries')
}

// ============================================
// Campaign Status / List
// ============================================

/**
 * Get campaign details by ID or campaign_number.
 */
export async function getCampaignDetails(id: string): Promise<CampaignDetails> {
  const res = await apiFetch(`/api/campaigns/${id}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Failed to fetch campaign ${id}: ${(body as { error?: string }).error || res.statusText}`)
  }

  const data = await res.json()
  // The response may wrap in { campaign: ... } or return directly
  return (data.campaign || data) as CampaignDetails
}

/**
 * List campaigns with pagination and status filter.
 */
export async function listCampaigns(params: {
  status?: 'active' | 'ended' | 'all'
  limit?: number
  offset?: number
}): Promise<CampaignListResponse> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const qs = query.toString()
  const res = await apiFetch(`/api/campaigns${qs ? `?${qs}` : ''}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Failed to list campaigns: ${(body as { error?: string }).error || res.statusText}`)
  }

  return (await res.json()) as CampaignListResponse
}

// ============================================
// Targeting Count
// ============================================

/**
 * Fetch eligible user count from GET /api/targeting/count.
 * Used to calculate quota surcharge before on-chain funding.
 *
 * Always sends all targeting params explicitly (including 0/false)
 * for a deterministic query contract.
 *
 * Returns { count, cached } on success, null on any error.
 */
export async function getTargetingCount(params: {
  platform: 'farcaster' | 'x'
  minFollowers: number
  minNeynarScore: number
  minQuotientScore: number
  requirePro: boolean
  requireVerifiedOnly: boolean
  requireProfilePhoto: boolean
  minAccountAgeDays: number
  minXFollowers: number
}): Promise<{ count: number; cached: boolean } | null> {
  try {
    const query = new URLSearchParams({
      platform: params.platform,
      minFollowers: String(params.minFollowers),
      minNeynarScore: String(params.minNeynarScore),
      minQuotientScore: String(params.minQuotientScore),
      requirePro: String(params.requirePro),
      requireVerifiedOnly: String(params.requireVerifiedOnly),
      requireProfilePhoto: String(params.requireProfilePhoto),
      minAccountAgeDays: String(params.minAccountAgeDays),
      minXFollowers: String(params.minXFollowers),
    })

    const res = await apiFetch(`/api/targeting/count?${query.toString()}`)

    if (!res.ok) {
      return null
    }

    const data = await res.json()

    // Validate response shape: count must be a finite integer >= 0
    if (
      typeof data.count !== 'number' ||
      !Number.isFinite(data.count) ||
      !Number.isInteger(data.count) ||
      data.count < 0
    ) {
      return null
    }

    return { count: data.count, cached: Boolean(data.cached) }
  } catch {
    return null
  }
}

// ============================================
// Verified Addresses
// ============================================

/**
 * Get verified addresses for a FID. Triggers server-side refresh if stale.
 * Used for pre-flight wallet-FID check before on-chain funding.
 */
export async function getVerifiedAddresses(fid: number): Promise<{
  fid: number
  verified_addresses: string[]
  refreshed: boolean
}> {
  const res = await apiFetch(`/api/user/verified-addresses?fid=${fid}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Failed to fetch verified addresses for FID ${fid}: ${(body as { error?: string }).error || res.statusText}`)
  }

  return (await res.json()) as { fid: number; verified_addresses: string[]; refreshed: boolean }
}
