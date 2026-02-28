/**
 * Tests for src/chain.ts — On-chain operations with mocked viem clients.
 *
 * Mocks viem's createPublicClient and createWalletClient at the module level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatEther, formatUnits } from 'viem'

// ── Hoisted mock functions (must be declared before vi.mock) ──

const {
  mockReadContract,
  mockSimulateContract,
  mockGetBalance,
  mockGetChainId,
  mockWaitForTransactionReceipt,
  mockSendTransaction,
  mockWriteContract,
} = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  mockSimulateContract: vi.fn(),
  mockGetBalance: vi.fn(),
  mockGetChainId: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockWriteContract: vi.fn(),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      simulateContract: mockSimulateContract,
      getBalance: mockGetBalance,
      getChainId: mockGetChainId,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      sendTransaction: mockSendTransaction,
      writeContract: mockWriteContract,
      account: { address: '0x1111111111111111111111111111111111111111' },
    })),
  }
})

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111' as const,
  })),
}))

// Import AFTER mocks are set up
import {
  fundCampaign,
  getBalances,
  getRouterStats,
  validateChainId,
} from '../src/chain.js'

// ── Tests ──

describe('fundCampaign', () => {
  beforeEach(() => {
    vi.stubEnv('PRIVATE_KEY', '0x' + 'ab'.repeat(32))
    vi.stubEnv('DROPCAST_ROUTER_ADDRESS', '0x' + 'ff'.repeat(20))
    mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    mockSimulateContract.mockResolvedValue({ result: undefined })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    mockReadContract.mockReset()
    mockSimulateContract.mockReset()
    mockGetBalance.mockReset()
    mockGetChainId.mockReset()
    mockWaitForTransactionReceipt.mockReset()
    mockSendTransaction.mockReset()
    mockWriteContract.mockReset()
  })

  it('skips approval when allowance is sufficient', async () => {
    // Allowance >= tokenAmount, so no approve needed
    mockReadContract.mockResolvedValueOnce(1000000n) // allowance
    mockSendTransaction.mockResolvedValueOnce('0xtxhash1') // fundCampaign tx
    mockWriteContract.mockResolvedValueOnce('0xtxhash1') // alternative

    const result = await fundCampaign({
      tokenAddress: '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB' as `0x${string}`,
      tokenAmount: 500000n,
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      feeAmountWei: 1000000000000000n, // 0.001 ETH
    })

    expect(result.txHash).toBeDefined()
    expect(result.approvalTxHash).toBeUndefined()
    // Simulation should have been called
    expect(mockSimulateContract).toHaveBeenCalledOnce()
  })

  it('approves first when allowance is insufficient (with non-zero reset)', async () => {
    // Allowance < tokenAmount and non-zero — triggers reset-to-0 then approve
    mockReadContract.mockResolvedValueOnce(100n) // allowance (too low, non-zero)
    mockSendTransaction
      .mockResolvedValueOnce('0xreset_hash')   // approve(router, 0)
      .mockResolvedValueOnce('0xapprove_hash') // approve(router, amount)
      .mockResolvedValueOnce('0xfund_hash')    // fund tx

    const result = await fundCampaign({
      tokenAddress: '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB' as `0x${string}`,
      tokenAmount: 500000n,
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      feeAmountWei: 1000000000000000n,
    })

    expect(result.approvalTxHash).toBe('0xapprove_hash')
    expect(result.txHash).toBe('0xfund_hash')
    // 3 sends: reset, approve, fund
    expect(mockSendTransaction).toHaveBeenCalledTimes(3)
    expect(mockWaitForTransactionReceipt).toHaveBeenCalled()
  })

  it('resets allowance to 0 before approving when stale non-zero allowance exists', async () => {
    // Stale allowance: non-zero but less than required (e.g. leftover from previous campaign)
    mockReadContract.mockResolvedValueOnce(8000000n) // stale allowance (8 USDC)
    mockSendTransaction
      .mockResolvedValueOnce('0xreset_hash')   // approve(router, 0)
      .mockResolvedValueOnce('0xapprove_hash') // approve(router, amount)
      .mockResolvedValueOnce('0xfund_hash')    // fundCampaign tx

    const result = await fundCampaign({
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
      tokenAmount: 12000000n, // 12 USDC — more than stale 8 USDC
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      feeAmountWei: 1000000000000000n,
    })

    // 3 sendTransaction calls: reset-to-0, approve, fund
    expect(mockSendTransaction).toHaveBeenCalledTimes(3)
    expect(result.approvalTxHash).toBe('0xapprove_hash')
    expect(result.txHash).toBe('0xfund_hash')
  })

  it('skips reset when allowance is already 0', async () => {
    // Allowance is 0 — no reset needed, just approve
    mockReadContract.mockResolvedValueOnce(0n)
    mockSendTransaction
      .mockResolvedValueOnce('0xapprove_hash') // approve(router, amount)
      .mockResolvedValueOnce('0xfund_hash')    // fundCampaign tx

    const result = await fundCampaign({
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
      tokenAmount: 12000000n,
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      feeAmountWei: 1000000000000000n,
    })

    // 2 sendTransaction calls: approve, fund (no reset)
    expect(mockSendTransaction).toHaveBeenCalledTimes(2)
    expect(result.approvalTxHash).toBe('0xapprove_hash')
    expect(result.txHash).toBe('0xfund_hash')
  })

  it('propagates simulation failure without sending real tx', async () => {
    mockReadContract.mockResolvedValueOnce(1000000n) // sufficient allowance
    mockSimulateContract.mockRejectedValueOnce(new Error('InsufficientFee: sent 0, required 1000'))

    await expect(
      fundCampaign({
        tokenAddress: '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB' as `0x${string}`,
        tokenAmount: 500000n,
        campaignId: '550e8400-e29b-41d4-a716-446655440000',
        feeAmountWei: 0n,
      }),
    ).rejects.toThrow(/InsufficientFee/)
  })
})

describe('getBalances', () => {
  afterEach(() => {
    mockReadContract.mockReset()
    mockGetBalance.mockReset()
  })

  it('returns formatted ETH and token balances', async () => {
    const ethBal = 2000000000000000000n // 2 ETH
    const tokenBal = 50000000000000000000000n // 50000 tokens (18 decimals)

    mockGetBalance.mockResolvedValueOnce(ethBal)
    mockReadContract.mockResolvedValueOnce(tokenBal)

    const result = await getBalances(
      '0x1111111111111111111111111111111111111111',
      '0xe8f5314e8DBE7EA9978190eC243f7b4258eaD7FB',
      18,
    )

    expect(result.ethBalance).toBe(ethBal)
    expect(result.ethFormatted).toBe(formatEther(ethBal))
    expect(result.tokenBalance).toBe(tokenBal)
    expect(result.tokenFormatted).toBe(formatUnits(tokenBal, 18))
  })
})

describe('getRouterStats', () => {
  beforeEach(() => {
    vi.stubEnv('DROPCAST_ROUTER_ADDRESS', '0x' + 'ff'.repeat(20))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    mockReadContract.mockReset()
  })

  it('parses 5-element tuple correctly', async () => {
    const tuple: [bigint, bigint, bigint, `0x${string}`, `0x${string}`] = [
      42n, // totalCampaigns
      5000000000000000n, // totalFeesCollected
      1000000000000000n, // minBaseFee (0.001 ETH)
      '0x2222222222222222222222222222222222222222', // buyBackBurner
      '0x3333333333333333333333333333333333333333', // relayerWallet
    ]
    mockReadContract.mockResolvedValueOnce(tuple)

    const stats = await getRouterStats()

    expect(stats.totalCampaigns).toBe(42n)
    expect(stats.totalFeesCollected).toBe(5000000000000000n)
    expect(stats.minBaseFee).toBe(1000000000000000n)
    expect(stats.minBaseFeeEth).toBe(formatEther(1000000000000000n))
    expect(stats.buyBackBurner).toBe('0x2222222222222222222222222222222222222222')
    expect(stats.relayerWallet).toBe('0x3333333333333333333333333333333333333333')
  })
})

describe('validateChainId', () => {
  afterEach(() => {
    mockGetChainId.mockReset()
  })

  it('throws when chain ID does not match Base Mainnet', async () => {
    mockGetChainId.mockResolvedValueOnce(1) // Ethereum Mainnet, not Base

    await expect(validateChainId()).rejects.toThrow(/Expected Base Mainnet/)
  })

  it('does not throw when chain ID matches', async () => {
    mockGetChainId.mockResolvedValueOnce(8453) // Base Mainnet

    await expect(validateChainId()).resolves.toBeUndefined()
  })
})
