/**
 * DropCast CLI Constants
 *
 * Contract addresses and ABIs for Base Mainnet.
 */

// ============================================
// Contract Addresses (Base Mainnet)
// ============================================

export const DEFAULT_ROUTER_ADDRESS = '0xd216801c9B658f9bEcB8125387a2A02c0d7Cc3d2' as const

export function getRouterAddress(): `0x${string}` {
  const envAddr = process.env.DROPCAST_ROUTER_ADDRESS
  if (envAddr) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(envAddr)) {
      throw new Error(`Invalid DROPCAST_ROUTER_ADDRESS: ${envAddr}`)
    }
    return envAddr as `0x${string}`
  }
  return DEFAULT_ROUTER_ADDRESS
}

export const CHAIN_ID = 8453 // Base Mainnet — DropCast only supports Base

// ============================================
// API Configuration
// ============================================

export function getApiBaseUrl(): string {
  return process.env.DROPCAST_API_BASE_URL || 'https://dropcast.xyz'
}

// ============================================
// ABIs (minimal, from dropcast/lib/funding.ts)
// ============================================

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const ROUTER_ABI = [
  {
    name: 'fundCampaign',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'campaignId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'getStats',
    type: 'function',
    inputs: [],
    outputs: [
      { name: '_totalCampaigns', type: 'uint256' },
      { name: '_totalFeesCollected', type: 'uint256' },
      { name: '_minBaseFee', type: 'uint256' },
      { name: '_buyBackBurner', type: 'address' },
      { name: '_relayerWallet', type: 'address' },
    ],
    stateMutability: 'view',
  },
  // Error definitions for viem decoding
  {
    name: 'SafeERC20FailedOperation',
    type: 'error',
    inputs: [{ name: 'token', type: 'address' }],
  },
  {
    name: 'InsufficientFee',
    type: 'error',
    inputs: [
      { name: 'sent', type: 'uint256' },
      { name: 'required', type: 'uint256' },
    ],
  },
  { name: 'FeeTransferFailed', type: 'error', inputs: [] },
  { name: 'ZeroAmount', type: 'error', inputs: [] },
  { name: 'ZeroAddress', type: 'error', inputs: [] },
] as const

// ============================================
// Helpers
// ============================================

/**
 * Convert UUID to bytes32 for on-chain campaignId.
 * Matches dropcast/lib/funding.ts campaignIdToBytes32
 */
export function campaignIdToBytes32(campaignId: string): `0x${string}` {
  return campaignId.startsWith('0x')
    ? (campaignId as `0x${string}`)
    : (`0x${campaignId.replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`)
}
