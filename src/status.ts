/**
 * campaign status — view campaign details.
 * campaign list — list campaigns with pagination.
 */

import { getCampaignDetails, listCampaigns } from './api.js'
import { jsonOutput, printCampaignStatus, printCampaignList } from './output.js'

// ============================================
// Status Command
// ============================================

export async function statusCommand(options: {
  id: string
  json?: boolean
}): Promise<void> {
  const campaign = await getCampaignDetails(options.id)

  if (options.json) {
    jsonOutput(campaign)
  } else {
    printCampaignStatus(campaign)
  }
}

// ============================================
// List Command
// ============================================

export async function listCommand(options: {
  status?: 'active' | 'ended' | 'all'
  limit?: number
  offset?: number
  json?: boolean
}): Promise<void> {
  const status = options.status || 'active'
  const limit = options.limit || 20
  const offset = options.offset || 0

  const result = await listCampaigns({ status, limit, offset })

  if (options.json) {
    jsonOutput(result)
  } else {
    printCampaignList(result.campaigns, result.total, limit, offset)
  }
}
