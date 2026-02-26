import { describe, it, expect, vi, afterEach } from 'vitest'
import { campaignIdToBytes32, getRouterAddress, DEFAULT_ROUTER_ADDRESS } from '../src/constants.js'

describe('campaignIdToBytes32', () => {
  it('converts a standard UUID to hex bytes32', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = campaignIdToBytes32(uuid)
    // Dashes removed: 550e8400e29b41d4a716446655440000 (32 hex chars) padded to 64
    expect(result).toBe('0x550e8400e29b41d4a71644665544000000000000000000000000000000000000')
  })

  it('pads shorter input to 32 bytes (64 hex chars)', () => {
    const short = 'abcd'
    const result = campaignIdToBytes32(short)
    expect(result).toBe('0x' + 'abcd'.padEnd(64, '0'))
  })

  it('returns result starting with 0x and 66 chars total', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = campaignIdToBytes32(uuid)
    expect(result).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(result.length).toBe(66)
  })
})

describe('getRouterAddress', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns DEFAULT_ROUTER_ADDRESS when no env var is set', () => {
    vi.stubEnv('DROPCAST_ROUTER_ADDRESS', '')
    const addr = getRouterAddress()
    expect(addr).toBe(DEFAULT_ROUTER_ADDRESS)
  })

  it('returns env var value when DROPCAST_ROUTER_ADDRESS is set', () => {
    const customAddr = '0x1234567890abcdef1234567890abcdef12345678'
    vi.stubEnv('DROPCAST_ROUTER_ADDRESS', customAddr)
    const addr = getRouterAddress()
    expect(addr).toBe(customAddr)
  })
})
