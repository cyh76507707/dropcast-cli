/**
 * dropcast-cli — CLI for creating DropCast campaigns via API.
 *
 * Usage:
 *   dropcast-cli validate --config campaign.json [--offline] [--json]
 *   dropcast-cli create --config campaign.json [--execute] [--campaign-id UUID] [--yes] [--json]
 *   dropcast-cli resume --recovery .dropcast-cli/<id>.json [--json]
 *   dropcast-cli status --id <uuid|campaign_number> [--json]
 *   dropcast-cli list [--status active|ended|all] [--limit N] [--offset N] [--json]
 */

import { config as dotenvConfig } from 'dotenv'
import { Command } from 'commander'
import { validateCommand } from './validate.js'
import { createCommand } from './create.js'
import { resumeCommand } from './resume.js'
import { statusCommand, listCommand } from './status.js'

// Load .env from current working directory
dotenvConfig()

const program = new Command()

program
  .name('dropcast-cli')
  .description('CLI for creating DropCast campaigns via API')
  .version('0.1.0')

// ── validate ──

program
  .command('validate')
  .description('Validate a campaign config (offline or with live preview)')
  .requiredOption('-c, --config <path>', 'Path to campaign.json')
  .option('--offline', 'Schema validation only (no network)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      await validateCommand(opts)
    } catch (err) {
      handleError(err, opts.json)
    }
  })

// ── create ──

program
  .command('create')
  .description('Create a campaign (dry-run by default, --execute for live)')
  .requiredOption('-c, --config <path>', 'Path to campaign.json')
  .option('--execute', 'Execute for real (fund on-chain + register)')
  .option('--campaign-id <uuid>', 'Reuse UUID for idempotent retries')
  .option('-y, --yes', 'Skip interactive confirmation')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      await createCommand({
        config: opts.config,
        execute: opts.execute,
        campaignId: opts.campaignId,
        yes: opts.yes,
        json: opts.json,
      })
    } catch (err) {
      handleError(err, opts.json)
    }
  })

// ── resume ──

program
  .command('resume')
  .description('Resume a funded-but-unregistered campaign from recovery file')
  .requiredOption('-r, --recovery <path>', 'Path to recovery file (.dropcast-cli/<id>.json)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      await resumeCommand(opts)
    } catch (err) {
      handleError(err, opts.json)
    }
  })

// ── status ──

program
  .command('status')
  .description('Show campaign details')
  .requiredOption('--id <id>', 'Campaign UUID or campaign number')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      await statusCommand(opts)
    } catch (err) {
      handleError(err, opts.json)
    }
  })

// ── list ──

program
  .command('list')
  .description('List campaigns')
  .option('--status <status>', 'Filter: active, ended, or all', 'active')
  .hook('preAction', (thisCommand) => {
    const status = thisCommand.opts().status
    if (status && !['active', 'ended', 'all'].includes(status)) {
      console.error(`error: option '--status' must be one of: active, ended, all (received '${status}')`)
      process.exit(1)
    }
  })
  .option('--limit <n>', 'Results per page', '20')
  .option('--offset <n>', 'Offset for pagination', '0')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      await listCommand({
        status: opts.status,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
        json: opts.json,
      })
    } catch (err) {
      handleError(err, opts.json)
    }
  })

// ── Error handler ──

function handleError(err: unknown, json?: boolean): void {
  const message = err instanceof Error ? err.message : String(err)

  if (json) {
    console.log(JSON.stringify({ error: message }, null, 2))
  } else {
    console.error(`\nError: ${message}`)
  }

  process.exit(1)
}

// ── Run ──

program.parse()
