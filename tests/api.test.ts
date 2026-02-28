/**
 * Tests for src/api.ts — HTTP client for DropCast API endpoints.
 *
 * Mocks global.fetch to test all API functions in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveCast,
  createCampaign,
  registerCampaignWithRetry,
  getTargetingCount,
  ApiError,
} from '../src/api.js'
import type { CreateCampaignPayload } from '../src/config.js'

// ── Helpers ──

function mockFetch(response: {
  status: number
  ok?: boolean
  json?: unknown
  statusText?: string
}): void {
  const ok = response.ok ?? (response.status >= 200 && response.status < 300)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: response.status,
      ok,
      statusText: response.statusText ?? 'OK',
      json: vi.fn().mockResolvedValue(response.json ?? {}),
    }),
  )
}

function mockFetchSequence(
  responses: Array<{
    status: number
    ok?: boolean
    json?: unknown
    statusText?: string
  }>,
): void {
  let callIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const r = responses[callIndex] ?? responses[responses.length - 1]
      callIndex++
      const ok = r.ok ?? (r.status >= 200 && r.status < 300)
      return Promise.resolve({
        status: r.status,
        ok,
        statusText: r.statusText ?? 'OK',
        json: vi.fn().mockResolvedValue(r.json ?? {}),
      })
    }),
  )
}

const STUB_PAYLOAD: CreateCampaignPayload = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  hostFid: 12345,
  hostWalletAddress: '0x0000000000000000000000000000000000000000',
  platform: 'farcaster',
  requireFollow: true,
  requireLike: false,
  requireRecast: false,
  requireQuote: false,
  requireComment: false,
  minFollowerCount: 0,
  minNeynarScore: 0,
  minQuotientScore: 0,
  requireProSubscriber: false,
  requireVerifiedOnly: false,
  requireProfilePhoto: false,
  minAccountAgeDays: 0,
  tokenAddress: '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB',
  tokenSymbol: 'DR',
  tokenDecimals: 18,
  rewardType: 'pool_split',
  totalAmount: '50000',
  endsAt: '2026-03-10T00:00:00.000Z',
  fundingTxHash: '0xabc123',
  baseFeePaid: '0.001',
}

// ── Tests ──

describe('X-Dropcast-Client header', () => {
  beforeEach(() => {
    vi.stubEnv('DROPCAST_API_BASE_URL', 'https://test.dropcast.xyz')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends X-Dropcast-Client: cli on every request', async () => {
    mockFetch({ status: 200, json: { cast: { hash: '0x1', author: { fid: 1, username: 'a', display_name: 'A', pfp_url: '' }, text: '', embeds: [] } } })

    await resolveCast('https://farcaster.xyz/a/0x1')

    const callInit = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((callInit.headers as Record<string, string>)['X-Dropcast-Client']).toBe('cli')
  })

  it('sends X-Dropcast-Client: cli on POST /api/campaigns', async () => {
    mockFetch({ status: 201, json: { success: true, campaign: { id: STUB_PAYLOAD.id, campaign_number: 1, status: 'active' } } })

    await createCampaign(STUB_PAYLOAD)

    const callInit = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((callInit.headers as Record<string, string>)['X-Dropcast-Client']).toBe('cli')
  })
})

describe('resolveCast', () => {
  beforeEach(() => {
    vi.stubEnv('DROPCAST_API_BASE_URL', 'https://test.dropcast.xyz')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns parsed cast data on success', async () => {
    const castData = {
      hash: '0xdeadbeef',
      author: { fid: 1, username: 'alice', display_name: 'Alice', pfp_url: 'https://img.example.com/alice.jpg' },
      text: 'Hello world',
      embeds: [],
    }
    mockFetch({ status: 200, json: { cast: castData } })

    const result = await resolveCast('https://farcaster.xyz/alice/0xabc')

    expect(result).toEqual(castData)
    expect(fetch).toHaveBeenCalledOnce()
    const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(callUrl).toContain('/api/neynar/cast?url=')
  })

  it('throws ApiError on non-200 response', async () => {
    mockFetch({
      status: 404,
      ok: false,
      json: { error: 'Cast not found' },
      statusText: 'Not Found',
    })

    await expect(resolveCast('https://farcaster.xyz/alice/0xbad')).rejects.toThrow(ApiError)
    await expect(resolveCast('https://farcaster.xyz/alice/0xbad')).rejects.toThrow(/Failed to resolve cast/)
  })
})

describe('createCampaign', () => {
  beforeEach(() => {
    vi.stubEnv('DROPCAST_API_BASE_URL', 'https://test.dropcast.xyz')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns success with status 200 (idempotent)', async () => {
    const responseData = {
      success: true,
      campaign: { id: STUB_PAYLOAD.id, campaign_number: 42, status: 'active' },
    }
    mockFetch({ status: 200, json: responseData })

    const result = await createCampaign(STUB_PAYLOAD)

    expect(result.status).toBe(200)
    expect(result.data.campaign.campaign_number).toBe(42)
  })

  it('returns created with status 201', async () => {
    const responseData = {
      success: true,
      campaign: { id: STUB_PAYLOAD.id, campaign_number: 99, status: 'pending' },
    }
    mockFetch({ status: 201, json: responseData })

    const result = await createCampaign(STUB_PAYLOAD)

    expect(result.status).toBe(201)
    expect(result.data.campaign.id).toBe(STUB_PAYLOAD.id)
  })

  it('throws ApiError on 400 validation failure', async () => {
    mockFetch({
      status: 400,
      ok: false,
      json: { error: 'Missing required field: tokenAddress' },
    })

    await expect(createCampaign(STUB_PAYLOAD)).rejects.toThrow(ApiError)
    try {
      await createCampaign(STUB_PAYLOAD)
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(400)
    }
  })
})

describe('registerCampaignWithRetry', () => {
  beforeEach(() => {
    vi.stubEnv('DROPCAST_API_BASE_URL', 'https://test.dropcast.xyz')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('retries on 202 then succeeds on 201', async () => {
    const successResponse = {
      success: true,
      campaign: { id: STUB_PAYLOAD.id, campaign_number: 55, status: 'active' },
    }

    // 202 twice, then 201
    mockFetchSequence([
      { status: 202, json: { success: false, campaign: {} } },
      { status: 202, json: { success: false, campaign: {} } },
      { status: 201, json: successResponse },
    ])

    const promise = registerCampaignWithRetry({ payload: STUB_PAYLOAD, json: true })

    // Advance past first retry delay (2000ms)
    await vi.advanceTimersByTimeAsync(2000)
    // Advance past second retry delay (4000ms)
    await vi.advanceTimersByTimeAsync(4000)

    const result = await promise

    expect(result.status).toBe(201)
    expect(result.data.campaign.campaign_number).toBe(55)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('throws immediately on 400 (no retry)', async () => {
    mockFetch({
      status: 400,
      ok: false,
      json: { error: 'Bad request' },
    })

    await expect(
      registerCampaignWithRetry({ payload: STUB_PAYLOAD, json: true }),
    ).rejects.toThrow(ApiError)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on 403 (no retry)', async () => {
    mockFetch({
      status: 403,
      ok: false,
      json: { error: 'Forbidden' },
    })

    await expect(
      registerCampaignWithRetry({ payload: STUB_PAYLOAD, json: true }),
    ).rejects.toThrow(ApiError)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on 409 (no retry)', async () => {
    mockFetch({
      status: 409,
      ok: false,
      json: { error: 'Conflict' },
    })

    await expect(
      registerCampaignWithRetry({ payload: STUB_PAYLOAD, json: true }),
    ).rejects.toThrow(ApiError)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws after max retries when 202 is returned every time', async () => {
    // Always return 202 — use mockFetchSequence with enough entries
    const responses = Array.from({ length: 8 }, () => ({
      status: 202,
      json: { success: false, campaign: {} },
    }))
    mockFetchSequence(responses)

    // Catch the promise immediately to prevent unhandled rejection
    let caughtError: Error | undefined
    const promise = registerCampaignWithRetry({ payload: STUB_PAYLOAD, json: true }).catch(
      (err: Error) => {
        caughtError = err
      },
    )

    // There are 7 attempts total (0..6), with 6 delays between them:
    // delays: 2000, 4000, 8000, 16000, 32000, 60000 = 122000ms total
    // Advance enough time to cover all retries
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(65000) // generous advance per iteration
    }

    await promise

    expect(caughtError).toBeDefined()
    expect(caughtError!.message).toMatch(/pending finality after max retries/)
    // 7 total attempts: initial + 6 retries
    expect(fetch).toHaveBeenCalledTimes(7)
  })
})

describe('getTargetingCount', () => {
  const TARGETING_PARAMS = {
    platform: 'farcaster' as const,
    minFollowers: 20,
    minNeynarScore: 0.5,
    minQuotientScore: 0,
    requirePro: false,
    requireVerifiedOnly: true,
    requireProfilePhoto: false,
    minAccountAgeDays: 7,
    minXFollowers: 0,
  }

  beforeEach(() => {
    vi.stubEnv('DROPCAST_API_BASE_URL', 'https://test.dropcast.xyz')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns { count, cached } on 200', async () => {
    mockFetch({ status: 200, json: { count: 250, cached: true, criteria: {} } })

    const result = await getTargetingCount(TARGETING_PARAMS)

    expect(result).toEqual({ count: 250, cached: true })
  })

  it('returns null on non-200', async () => {
    mockFetch({ status: 500, ok: false, json: { error: 'Server error' } })

    const result = await getTargetingCount(TARGETING_PARAMS)

    expect(result).toBeNull()
  })

  it('returns null on malformed response (missing count)', async () => {
    mockFetch({ status: 200, json: { cached: true } })

    const result = await getTargetingCount(TARGETING_PARAMS)

    expect(result).toBeNull()
  })

  it('returns null on malformed response (non-integer count)', async () => {
    mockFetch({ status: 200, json: { count: 3.14, cached: false } })

    const result = await getTargetingCount(TARGETING_PARAMS)

    expect(result).toBeNull()
  })

  it('returns null on malformed response (negative count)', async () => {
    mockFetch({ status: 200, json: { count: -1, cached: false } })

    const result = await getTargetingCount(TARGETING_PARAMS)

    expect(result).toBeNull()
  })

  it('sends all query params explicitly', async () => {
    mockFetch({ status: 200, json: { count: 100, cached: false } })

    await getTargetingCount(TARGETING_PARAMS)

    const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(callUrl).toContain('platform=farcaster')
    expect(callUrl).toContain('minFollowers=20')
    expect(callUrl).toContain('minNeynarScore=0.5')
    expect(callUrl).toContain('minQuotientScore=0')
    expect(callUrl).toContain('requirePro=false')
    expect(callUrl).toContain('requireVerifiedOnly=true')
    expect(callUrl).toContain('requireProfilePhoto=false')
    expect(callUrl).toContain('minAccountAgeDays=7')
    expect(callUrl).toContain('minXFollowers=0')
  })
})
