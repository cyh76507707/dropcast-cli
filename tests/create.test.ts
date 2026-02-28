/**
 * Tests for src/create.ts — createCommand integration tests.
 *
 * Mocks chain, api, resume, and config modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ──

const {
  mockResolveCast,
  mockGetTokenPrice,
  mockRegisterCampaignWithRetry,
  mockGetVerifiedAddresses,
  mockGetTargetingCount,
  MockApiError,
  mockGetBalances,
  mockGetRouterStats,
  mockFundCampaign,
  mockValidateChainId,
  mockGetWalletClient,
  mockWriteRecoveryFile,
  mockDeleteRecoveryFile,
} = vi.hoisted(() => {
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
    mockResolveCast: vi.fn(),
    mockGetTokenPrice: vi.fn(),
    mockRegisterCampaignWithRetry: vi.fn(),
    mockGetVerifiedAddresses: vi.fn(),
    mockGetTargetingCount: vi.fn(),
    MockApiError,
    mockGetBalances: vi.fn(),
    mockGetRouterStats: vi.fn(),
    mockFundCampaign: vi.fn(),
    mockValidateChainId: vi.fn(),
    mockGetWalletClient: vi.fn(),
    mockWriteRecoveryFile: vi.fn(),
    mockDeleteRecoveryFile: vi.fn(),
  }
})

vi.mock('../src/api.js', () => ({
  resolveCast: mockResolveCast,
  getTokenPrice: mockGetTokenPrice,
  registerCampaignWithRetry: mockRegisterCampaignWithRetry,
  getVerifiedAddresses: mockGetVerifiedAddresses,
  getTargetingCount: mockGetTargetingCount,
  ApiError: MockApiError,
}))

vi.mock('../src/chain.js', () => ({
  getBalances: mockGetBalances,
  getRouterStats: mockGetRouterStats,
  fundCampaign: mockFundCampaign,
  validateChainId: mockValidateChainId,
  getWalletClient: mockGetWalletClient,
}))

vi.mock('../src/resume.js', () => ({
  writeRecoveryFile: mockWriteRecoveryFile,
  deleteRecoveryFile: mockDeleteRecoveryFile,
}))

// Import after mocks
import { createCommand } from '../src/create.js'

const CONFIG_PATH = 'examples/campaign.farcaster.pool-split.json'

// ── Default mock implementations ──

function setupDefaultMocks() {
  mockResolveCast.mockResolvedValue({
    hash: '0xdeadbeef',
    author: { fid: 1, username: 'alice', display_name: 'Alice', pfp_url: '' },
    text: 'Hello world',
    embeds: [],
  })
  mockGetTokenPrice.mockResolvedValue(0.05)
  mockRegisterCampaignWithRetry.mockResolvedValue({
    status: 201,
    data: {
      success: true,
      campaign: { id: 'test-id', campaign_number: 42, status: 'active' },
    },
  })
  mockGetBalances.mockResolvedValue({
    ethBalance: 2000000000000000000n,
    ethFormatted: '2.0',
    tokenBalance: 100000000000000000000000n,
    tokenFormatted: '100000.0',
  })
  mockGetRouterStats.mockResolvedValue({
    totalCampaigns: 10n,
    totalFeesCollected: 500000000000000n,
    minBaseFee: 1000000000000n, // very small, should always pass
    minBaseFeeEth: '0.000001',
    buyBackBurner: '0x' + '00'.repeat(20),
    relayerWallet: '0x' + '00'.repeat(20),
  })
  mockFundCampaign.mockResolvedValue({
    txHash: '0xfundingtxhash',
    approvalTxHash: undefined,
  })
  mockValidateChainId.mockResolvedValue(undefined)
  mockGetWalletClient.mockReturnValue({
    account: { address: '0x0000000000000000000000000000000000000000' },
    walletClient: {},
  })
  mockGetVerifiedAddresses.mockResolvedValue({
    fid: 12345,
    verified_addresses: ['0x0000000000000000000000000000000000000000'],
    refreshed: false,
  })
  mockGetTargetingCount.mockResolvedValue({ count: 50, cached: false })
  mockWriteRecoveryFile.mockReturnValue('.dropcast-cli/test-id.json')
  mockDeleteRecoveryFile.mockReturnValue(undefined)
}

// ── Tests ──

describe('createCommand', () => {
  const originalExit = process.exit

  beforeEach(() => {
    // Make process.exit throw to actually halt execution (like real process.exit)
    process.exit = vi.fn().mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never
    // Reset and set up all mocks fresh for each test
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  afterEach(() => {
    process.exit = originalExit
  })

  it('dry-run works without PRIVATE_KEY', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      json: false,
    })

    // Should print dry-run output, not throw
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('DRY RUN complete')
    expect(mockFundCampaign).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('dry-run --json outputs valid JSON only', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      json: true,
    })

    // Should output exactly one JSON blob
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const jsonStr = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(jsonStr)
    expect(parsed.mode).toBe('dry-run')
    expect(parsed.campaignId).toBeDefined()
    expect(parsed.fee).toBeDefined()
    expect(parsed.totalAmount).toBeDefined()

    consoleSpy.mockRestore()
  })

  it('execute exits on wallet mismatch', async () => {
    // Make wallet client return a different address than config
    mockGetWalletClient.mockReturnValueOnce({
      account: { address: '0x9999999999999999999999999999999999999999' },
      walletClient: {},
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      createCommand({
        config: CONFIG_PATH,
        execute: true,
        yes: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(mockFundCampaign).not.toHaveBeenCalled()

    vi.mocked(console.error).mockRestore?.()
    vi.mocked(console.log).mockRestore?.()
  })

  it('execute exits when wallet not in verified addresses for FID', async () => {
    // Wallet matches config but is NOT in verified_addresses
    mockGetVerifiedAddresses.mockResolvedValueOnce({
      fid: 12345,
      verified_addresses: ['0x1111111111111111111111111111111111111111'],
      refreshed: true,
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      createCommand({
        config: CONFIG_PATH,
        execute: true,
        yes: true,
        json: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(mockFundCampaign).not.toHaveBeenCalled()

    // JSON output should contain the error
    const consoleSpy = vi.mocked(console.log)
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]
    const parsed = JSON.parse(lastCall[0] as string)
    expect(parsed.error).toContain('not a verified address')
    expect(parsed.verified_addresses).toBeDefined()

    vi.mocked(console.error).mockRestore?.()
    vi.mocked(console.log).mockRestore?.()
  })

  it('execute aborts when verified-addresses endpoint is unavailable', async () => {
    // Endpoint fails — should hard-fail to prevent funding without verification
    mockGetVerifiedAddresses.mockRejectedValueOnce(
      new MockApiError(500, null, 'Internal server error'),
    )

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      createCommand({
        config: CONFIG_PATH,
        execute: true,
        yes: true,
        json: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(mockFundCampaign).not.toHaveBeenCalled()

    vi.mocked(console.error).mockRestore?.()
    vi.mocked(console.log).mockRestore?.()
  })

  it('execute succeeds: fund -> register -> success output', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      execute: true,
      yes: true,
      json: true,
    })

    // Should call fund -> register -> cleanup
    expect(mockFundCampaign).toHaveBeenCalledOnce()
    expect(mockRegisterCampaignWithRetry).toHaveBeenCalledOnce()
    expect(mockDeleteRecoveryFile).toHaveBeenCalledOnce()

    // JSON output should include success
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]
    const parsed = JSON.parse(lastCall[0] as string)
    expect(parsed.success).toBe(true)
    expect(parsed.campaignNumber).toBe(42)

    consoleSpy.mockRestore()
  })

  it('execute writes recovery file and shows resume on API failure', async () => {
    mockRegisterCampaignWithRetry.mockRejectedValueOnce(
      new MockApiError(500, null, 'Server error'),
    )

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      createCommand({
        config: CONFIG_PATH,
        execute: true,
        yes: true,
        json: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    expect(mockFundCampaign).toHaveBeenCalledOnce()
    expect(mockWriteRecoveryFile).toHaveBeenCalledOnce()
    expect(process.exit).toHaveBeenCalledWith(1)

    // JSON output should include recovery info
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]
    const parsed = JSON.parse(lastCall[0] as string)
    expect(parsed.error).toContain('Server error')
    expect(parsed.recoveryFile).toBeDefined()

    consoleSpy.mockRestore()
    vi.mocked(console.error).mockRestore?.()
  })

  it('dry-run handles complete config with all fields', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      json: true,
    })

    const jsonStr = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(jsonStr)
    expect(parsed.campaignId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(parsed.config.platform).toBe('farcaster')
    expect(parsed.config.token.symbol).toBe('DR')

    consoleSpy.mockRestore()
  })

  it('execute aborts when count unavailable and no --allow-fee-uncertain', async () => {
    mockGetTargetingCount.mockResolvedValueOnce(null)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      createCommand({
        config: CONFIG_PATH,
        execute: true,
        yes: true,
        json: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/)

    expect(process.exit).toHaveBeenCalledWith(1)
    expect(mockFundCampaign).not.toHaveBeenCalled()

    // JSON output should contain feeUncertain
    const consoleSpy = vi.mocked(console.log)
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]
    const parsed = JSON.parse(lastCall[0] as string)
    expect(parsed.error).toContain('Cannot determine eligible user count')
    expect(parsed.feeUncertain).toBe(true)

    vi.mocked(console.error).mockRestore?.()
    vi.mocked(console.log).mockRestore?.()
    vi.mocked(console.warn).mockRestore?.()
  })

  it('execute proceeds with --allow-fee-uncertain when count unavailable', async () => {
    mockGetTargetingCount.mockResolvedValueOnce(null)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      execute: true,
      yes: true,
      json: true,
      allowFeeUncertain: true,
    })

    expect(mockFundCampaign).toHaveBeenCalledOnce()
    expect(mockRegisterCampaignWithRetry).toHaveBeenCalledOnce()

    consoleSpy.mockRestore()
    vi.mocked(console.warn).mockRestore?.()
  })

  it('fee includes surcharge when count is available', async () => {
    // Mock 200 eligible users → tier 101-500 → 0.0009 ETH surcharge
    mockGetTargetingCount.mockResolvedValueOnce({ count: 200, cached: false })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      execute: true,
      yes: true,
      json: true,
    })

    expect(mockFundCampaign).toHaveBeenCalledOnce()

    // Verify the fee passed to fundCampaign includes surcharge
    const fundCall = mockFundCampaign.mock.calls[0][0]
    const feeAmountWei = fundCall.feeAmountWei as bigint
    // Base fee for this config (follow+like+minFollowers+accountAge) = 0.0016
    // Plus surcharge for 200 users (tier 101-500) = 0.0009
    // Total = 0.0025 ETH = 2500000000000000 wei
    expect(feeAmountWei).toBe(2500000000000000n)

    // Verify baseFeePaid in recovery file includes surcharge
    const recoveryCall = mockWriteRecoveryFile.mock.calls[0][0]
    expect(recoveryCall.baseFeePaid).toBe('0.0025')

    consoleSpy.mockRestore()
  })

  it('dry-run JSON includes fee breakdown with quotaSurcharge', async () => {
    mockGetTargetingCount.mockResolvedValueOnce({ count: 50, cached: true })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createCommand({
      config: CONFIG_PATH,
      json: true,
    })

    const jsonStr = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(jsonStr)
    expect(parsed.fee.breakdown).toBeDefined()
    expect(parsed.fee.breakdown.quotaSurcharge).toBe(0.0006)
    expect(parsed.fee.breakdown.quotaSurchargeTier).toBe('1-100')

    consoleSpy.mockRestore()
  })
})
