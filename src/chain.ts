/**
 * On-chain operations: wallet setup, balance checks, approve + fund.
 *
 * Uses viem for Base Mainnet interactions.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  encodeFunctionData,
  defineChain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  CHAIN_ID,
  ERC20_ABI,
  ROUTER_ABI,
  getRouterAddress,
  campaignIdToBytes32,
} from './constants.js'

// Define Base chain without OP Stack overrides (avoids viem type mismatch)
const baseChain = defineChain({
  id: CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://basescan.org' },
  },
})

// ============================================
// Client Setup
// ============================================

const publicClient = createPublicClient({
  chain: baseChain,
  transport: http(),
})

export function getPublicClient() {
  return publicClient
}

export function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }

  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
  const account = privateKeyToAccount(key as `0x${string}`)

  const walletClient = createWalletClient({
    account,
    chain: baseChain,
    transport: http(),
  })

  return { account, walletClient }
}

// ============================================
// Chain Validation
// ============================================

export async function validateChainId(): Promise<void> {
  const chainId = await publicClient.getChainId()
  if (chainId !== CHAIN_ID) {
    throw new Error(`Expected Base Mainnet (${CHAIN_ID}), got chain ${chainId}. Aborting.`)
  }
}

// ============================================
// Balance Checks
// ============================================

export interface BalanceInfo {
  ethBalance: bigint
  ethFormatted: string
  tokenBalance: bigint
  tokenFormatted: string
}

export async function getBalances(
  walletAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  tokenDecimals: number,
): Promise<BalanceInfo> {
  const [ethBalance, tokenBalance] = await Promise.all([
    publicClient.getBalance({ address: walletAddress }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    }) as Promise<bigint>,
  ])

  return {
    ethBalance,
    ethFormatted: formatEther(ethBalance),
    tokenBalance,
    tokenFormatted: formatUnits(tokenBalance, tokenDecimals),
  }
}

// ============================================
// Router Pre-flight Check
// ============================================

export interface RouterStats {
  totalCampaigns: bigint
  totalFeesCollected: bigint
  minBaseFee: bigint
  minBaseFeeEth: string
  buyBackBurner: `0x${string}`
  relayerWallet: `0x${string}`
}

export async function getRouterStats(): Promise<RouterStats> {
  const routerAddress = getRouterAddress()

  const stats = await publicClient.readContract({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: 'getStats',
  }) as [bigint, bigint, bigint, `0x${string}`, `0x${string}`]

  return {
    totalCampaigns: stats[0],
    totalFeesCollected: stats[1],
    minBaseFee: stats[2],
    minBaseFeeEth: formatEther(stats[2]),
    buyBackBurner: stats[3],
    relayerWallet: stats[4],
  }
}

// ============================================
// Approve + Fund Flow (Sequential)
// ============================================

/**
 * Approve token to Router if needed, then fund campaign on-chain.
 *
 * Returns the funding transaction hash.
 */
export async function fundCampaign(params: {
  tokenAddress: `0x${string}`
  tokenAmount: bigint
  campaignId: string
  feeAmountWei: bigint
}): Promise<{ txHash: `0x${string}`; approvalTxHash?: `0x${string}` }> {
  const { account, walletClient } = getWalletClient()
  const routerAddress = getRouterAddress()

  // 1. Check + approve
  const currentAllowance = await publicClient.readContract({
    address: params.tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, routerAddress],
  }) as bigint

  let approvalTxHash: `0x${string}` | undefined

  if (currentAllowance < params.tokenAmount) {
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routerAddress, params.tokenAmount],
    })

    const hash = await walletClient.sendTransaction({
      account,
      to: params.tokenAddress,
      data: approveData,
      value: 0n,
      chain: baseChain,
    })

    await publicClient.waitForTransactionReceipt({ hash })
    approvalTxHash = hash
  }

  // 2. Simulate first for better error messages
  const campaignIdBytes32 = campaignIdToBytes32(params.campaignId)

  await publicClient.simulateContract({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: 'fundCampaign',
    args: [params.tokenAddress, params.tokenAmount, campaignIdBytes32],
    value: params.feeAmountWei,
    account: account.address,
  })

  // 3. Fund
  const fundData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'fundCampaign',
    args: [params.tokenAddress, params.tokenAmount, campaignIdBytes32],
  })

  const txHash = await walletClient.sendTransaction({
    account,
    to: routerAddress,
    data: fundData,
    value: params.feeAmountWei,
    chain: baseChain,
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  return { txHash, approvalTxHash }
}
