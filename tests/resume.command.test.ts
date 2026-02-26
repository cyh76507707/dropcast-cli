/**
 * Tests for resumeCommand in src/resume.ts — command-level integration.
 *
 * Mocks fs (readFileSync/existsSync/unlinkSync) and api module.
 * Since resumeCommand calls readRecoveryFile internally (same module),
 * we mock the fs module to control what readRecoveryFile returns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ──

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockUnlinkSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(true),
}))

const { mockRegisterCampaignWithRetry, mockResolveCast, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number
    body: unknown
    constructor(status: number, body: unknown, message: string) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }
  return {
    mockRegisterCampaignWithRetry: vi.fn(),
    mockResolveCast: vi.fn(),
    MockApiError,
  }
})

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  unlinkSync: mockUnlinkSync,
  existsSync: mockExistsSync,
}))

vi.mock('../src/api.js', () => ({
  resolveCast: mockResolveCast,
  registerCampaignWithRetry: mockRegisterCampaignWithRetry,
  ApiError: MockApiError,
}))

// Import AFTER mocks
import { resumeCommand } from '../src/resume.js'

// ── Fixtures ──

function makeRecoveryData(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: '550e8400-e29b-41d4-a716-446655440000',
    fundingTxHash: '0xabc123def456',
    baseFeePaid: '0.001',
    config: {
      network: 'base',
      platform: 'farcaster',
      host: {
        fid: 12345,
        walletAddress: '0x0000000000000000000000000000000000000000',
      },
      post: {
        url: 'https://warpcast.com/alice/0xabc123',
      },
      token: {
        address: '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB',
        symbol: 'DR',
        decimals: 18,
      },
      reward: {
        type: 'pool_split',
        totalAmount: '50000',
      },
      actions: {
        follow: true,
        like: false,
        recast: false,
        quote: false,
        comment: false,
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
      },
      schedule: {
        endsAt: '2026-03-10T00:00:00.000Z',
      },
    },
    createdAt: '2026-02-26T00:00:00.000Z',
    ...overrides,
  }
}

// ── Tests ──

describe('resumeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: resolveCast succeeds
    mockResolveCast.mockResolvedValue({
      hash: '0xdeadbeef',
      author: { fid: 1, username: 'alice', display_name: 'Alice', pfp_url: '' },
      text: 'Hello world',
      embeds: [],
    })

    // Default: register succeeds
    mockRegisterCampaignWithRetry.mockResolvedValue({
      status: 201,
      data: {
        success: true,
        campaign: { id: 'test-id', campaign_number: 42, status: 'active' },
      },
    })

    mockExistsSync.mockReturnValue(true)
  })

  it('successful resume: reads recovery -> registers -> deletes file', async () => {
    const recovery = makeRecoveryData()
    mockReadFileSync.mockReturnValue(JSON.stringify(recovery))

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await resumeCommand({ recovery: '.dropcast-cli/test.json', json: true })

    expect(mockReadFileSync).toHaveBeenCalledWith('.dropcast-cli/test.json', 'utf-8')
    expect(mockRegisterCampaignWithRetry).toHaveBeenCalledOnce()
    // deleteRecoveryFile calls existsSync + unlinkSync
    expect(mockUnlinkSync).toHaveBeenCalled()

    // JSON output should show resumed: true
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]
    const parsed = JSON.parse(lastCall[0] as string)
    expect(parsed.success).toBe(true)
    expect(parsed.resumed).toBe(true)
    expect(parsed.campaignNumber).toBe(42)

    consoleSpy.mockRestore()
  })

  it('uses stored baseFeePaid when present', async () => {
    const recovery = makeRecoveryData({ baseFeePaid: '0.0025' })
    mockReadFileSync.mockReturnValue(JSON.stringify(recovery))

    vi.spyOn(console, 'log').mockImplementation(() => {})

    await resumeCommand({ recovery: '.dropcast-cli/test.json', json: true })

    // Check the payload sent to registerCampaignWithRetry
    const call = mockRegisterCampaignWithRetry.mock.calls[0]
    expect(call[0].payload.baseFeePaid).toBe('0.0025')

    vi.mocked(console.log).mockRestore?.()
  })

  it('falls back to recalculation when baseFeePaid is not stored', async () => {
    const recovery = makeRecoveryData()
    delete (recovery as Record<string, unknown>).baseFeePaid
    mockReadFileSync.mockReturnValue(JSON.stringify(recovery))

    vi.spyOn(console, 'log').mockImplementation(() => {})

    await resumeCommand({ recovery: '.dropcast-cli/test.json', json: true })

    // Payload should have a recalculated baseFeePaid
    const call = mockRegisterCampaignWithRetry.mock.calls[0]
    expect(call[0].payload.baseFeePaid).toBeDefined()
    expect(typeof call[0].payload.baseFeePaid).toBe('string')
    expect(parseFloat(call[0].payload.baseFeePaid)).toBeGreaterThan(0)

    vi.mocked(console.log).mockRestore?.()
  })

  it('preserves recovery file on API failure', async () => {
    const recovery = makeRecoveryData()
    mockReadFileSync.mockReturnValue(JSON.stringify(recovery))

    // Import the mocked ApiError to get the exact class reference
    const { ApiError: ApiErrorClass } = await import('../src/api.js')
    mockRegisterCampaignWithRetry.mockRejectedValueOnce(
      new ApiErrorClass(500, null, 'Internal server error'),
    )

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const originalExit = process.exit
    process.exit = vi.fn().mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never

    await expect(
      resumeCommand({ recovery: '.dropcast-cli/test.json', json: true }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    // Recovery file should NOT be deleted (unlinkSync should NOT be called)
    expect(mockUnlinkSync).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)

    process.exit = originalExit
    consoleSpy.mockRestore()
    vi.mocked(console.error).mockRestore?.()
  })

  it('throws helpful error for missing recovery file', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    await expect(
      resumeCommand({ recovery: '/nonexistent/path.json' }),
    ).rejects.toThrow(/Cannot read recovery file/)
  })
})
