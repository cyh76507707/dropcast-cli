/**
 * Tests for src/resume.ts — Recovery file I/O functions.
 *
 * Uses real filesystem with temp directories.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  writeRecoveryFile,
  readRecoveryFile,
  deleteRecoveryFile,
  type RecoveryData,
} from '../src/resume.js'

// ── Fixtures ──

const STUB_RECOVERY: RecoveryData = {
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
      url: 'https://farcaster.xyz/alice/0xabc123',
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
  } as RecoveryData['config'],
  createdAt: '2026-02-26T00:00:00.000Z',
}

describe('Recovery file I/O', () => {
  let originalCwd: string
  let tempDir: string

  beforeEach(() => {
    // Change cwd to a temp directory so .dropcast-cli/ is created there
    originalCwd = process.cwd()
    tempDir = mkdtempSync(join(tmpdir(), 'dropcast-test-'))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  it('write + read roundtrip preserves data', () => {
    const filePath = writeRecoveryFile(STUB_RECOVERY)

    expect(existsSync(filePath)).toBe(true)

    const recovered = readRecoveryFile(filePath)

    expect(recovered.campaignId).toBe(STUB_RECOVERY.campaignId)
    expect(recovered.fundingTxHash).toBe(STUB_RECOVERY.fundingTxHash)
    expect(recovered.baseFeePaid).toBe(STUB_RECOVERY.baseFeePaid)
    expect(recovered.config.platform).toBe('farcaster')
    expect(recovered.config.token.symbol).toBe('DR')
    expect(recovered.createdAt).toBe(STUB_RECOVERY.createdAt)
  })

  it('read throws for non-existent file', () => {
    expect(() => readRecoveryFile('/nonexistent/path/recovery.json')).toThrow(
      /Cannot read recovery file/,
    )
  })

  it('read throws for corrupt JSON', () => {
    const filePath = join(tempDir, 'corrupt.json')
    writeFileSync(filePath, '{not valid json!!!', 'utf-8')

    expect(() => readRecoveryFile(filePath)).toThrow(/Invalid JSON/)
  })

  it('read throws when required fields are missing', () => {
    const filePath = join(tempDir, 'incomplete.json')
    writeFileSync(
      filePath,
      JSON.stringify({ fundingTxHash: '0x123', config: {} }),
      'utf-8',
    )

    expect(() => readRecoveryFile(filePath)).toThrow(/missing required fields/)
  })

  it('delete removes existing file and does not throw for non-existent', () => {
    // Write a file first
    writeRecoveryFile(STUB_RECOVERY)
    const filePath = join('.dropcast-cli', `${STUB_RECOVERY.campaignId}.json`)
    expect(existsSync(filePath)).toBe(true)

    // Delete should succeed
    deleteRecoveryFile(STUB_RECOVERY.campaignId)
    expect(existsSync(filePath)).toBe(false)

    // Delete again should not throw
    expect(() => deleteRecoveryFile(STUB_RECOVERY.campaignId)).not.toThrow()

    // Delete a totally random ID should not throw
    expect(() => deleteRecoveryFile('nonexistent-id')).not.toThrow()
  })
})
