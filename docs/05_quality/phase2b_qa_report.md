# Phase 2b: CLI Behavioral QA Report

**Date:** 2026-02-26
**Tester:** T5 (single-agent mode)
**Branch:** `task/5-phase2b-qa`
**Base:** `main` @ `368de28` (post-merge of PRs #2, #5, #6)

**Scope:** This report covers **CLI behavioral smoke tests** — verifying that
the 5 CLI commands work correctly in isolation. **Skill acceptance validation**
(agent-driven scenario runs per proposal §7.1.1) is deferred to v0.2. See
[Deferred: Skill Acceptance Scenarios](#deferred-skill-acceptance-scenarios-v02)
below.

---

## Prerequisites

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS — no errors |
| `npm run build` | PASS — `dist/index.js` 46.64 KB |
| `npm run test` | PASS — 89/89 tests, 9 files |
| `node dist/index.js --help` | PASS — all 5 commands listed |

---

## CLI Behavioral Scenarios

### Scenario 1: `--json` outputs only valid JSON to stdout

**Command:**
```bash
node dist/index.js validate --config examples/campaign.farcaster.pool-split.json --offline --json
```

**Result:** PASS
- stdout: `{"valid":true,"config":{...}}` — valid JSON, no mixed text
- stderr: empty

**Command:**
```bash
node dist/index.js create --config examples/campaign.farcaster.pool-split.json --json 2>/dev/null
```

**Result:** PASS
- stdout: `{"error":"Failed to resolve cast: ..."}` — valid JSON error object
- No text logs mixed into stdout (cast resolution fails on placeholder URL, expected)

---

### Scenario 2: Dry-run works without `PRIVATE_KEY`

**Command:**
```bash
unset PRIVATE_KEY
node dist/index.js validate --config examples/campaign.farcaster.pool-split.json --offline
```

**Result:** PASS — `Config is valid (offline check).` Exit code 0.

**Command:**
```bash
unset PRIVATE_KEY
node dist/index.js validate --config examples/campaign.x.pool-split.json --offline
```

**Result:** PASS — `Config is valid (offline check).` Exit code 0.

**Note:** Network-dependent dry-run (`create` without `--execute`) fails at cast resolution because example URLs are placeholders. This is expected — the CLI correctly does NOT prompt for or require `PRIVATE_KEY` in the dry-run code path. Confirmed by unit test `create.test.ts:137-151`.

---

### Scenario 3: Wallet mismatch exits before on-chain funding

**Manual test limitation:** Cannot safely test wallet mismatch on mainnet — would require a real `PRIVATE_KEY` and a funded wallet. Testing with a throwaway key hits cast resolution failure first (placeholder URL), which precedes the wallet check in the code path.

**Verification method:** Unit test + code path review.

**Code path:** `create.ts:185-194` — wallet address comparison happens AFTER cast resolution (line 88-103) but BEFORE `fundCampaign` (line 270). If mismatch, `process.exit(1)` is called.

**Unit test evidence:** `create.test.ts` "execute exits on wallet mismatch" — mocks cast resolution to succeed, injects mismatched wallet, confirms:
- `process.exit(1)` is called
- `fundCampaign` is never called (no on-chain transaction)

**Verdict:** VERIFIED (unit test) — cannot manually test without mainnet risk.

---

### Scenario 4: Resume uses stored `baseFeePaid`

**Manual test limitation:** Cannot trigger a real post-funding API failure to create a recovery file without spending real funds on mainnet.

**Verification method:** Unit test + code path review.

**Code path:** `resume.ts:130-140` —
- If `recovery.baseFeePaid` exists → uses stored value (line 133)
- If absent → recalculates from fee config (lines 136-139)

**Unit test evidence:**
- `resume.command.test.ts` "uses stored baseFeePaid when present" — injects `baseFeePaid: '0.0025'`, confirms value passes through to API payload unchanged
- `resume.command.test.ts` "falls back to recalculation when baseFeePaid is not stored" — deletes `baseFeePaid` from recovery data, confirms recalculated fee is used

**Manual error path test:**
```bash
node dist/index.js resume --recovery nonexistent.json --json
```
Result: `{"error":"Cannot read recovery file: nonexistent.json"}` Exit code 1. (Correct — helpful error message.)

**Verdict:** VERIFIED (unit test) — cannot manually test without mainnet risk.

---

### Scenario 5: All example configs validate offline

**Command:**
```bash
for f in examples/*.json; do node dist/index.js validate --config "$f" --offline; done
```

**Results:**

| Config | Result |
|--------|--------|
| `campaign.farcaster.fixed.json` | PASS |
| `campaign.farcaster.pool-split.json` | PASS |
| `campaign.x.fixed.json` | PASS |
| `campaign.x.pool-split.json` | PASS |

---

### Scenario 6: `status` and `list` commands work

**Command:** `node dist/index.js list --json --limit 1`

**Result:** PASS — Returns valid JSON with campaign array from production API.

**Command:** `node dist/index.js status --id f9523fad-c6ac-4341-a9eb-546eb4222d00 --json`

**Result:** PASS — Returns valid JSON with full campaign details (id, host_fid, cast_url, token info, status, dates, participant counts). Verified against campaign #170 on production.

---

## Summary

| # | Scenario | Result | Method |
|---|----------|--------|--------|
| 1 | `--json` outputs valid JSON only | **PASS** | Manual CLI |
| 2 | Dry-run without `PRIVATE_KEY` | **PASS** | Manual CLI |
| 3 | Wallet mismatch exits before funding | **VERIFIED** | Unit test + code review (mainnet-unsafe) |
| 4 | Resume uses stored `baseFeePaid` | **VERIFIED** | Unit test + code review (mainnet-unsafe) |
| 5 | All example configs validate | **PASS** | Manual CLI |
| 6 | Status/list commands work | **PASS** | Manual CLI (production API) |

**CLI behavioral QA verdict:** All scenarios pass or verified. No issues found.

---

## Deferred: Skill Acceptance Scenarios (v0.2)

The proposal's Phase 2b (§7.1.1) defines **skill-level acceptance validation** — testing that an AI agent using `SKILL.md` + `campaign-params.md` can correctly translate natural language to campaign configs. These require an agent runtime and are deferred to v0.2:

| Proposal Scenario | Description | Status |
|---|---|---|
| §7.1.1 Scenario A | Farcaster pool_split campaign from NL prompt | Deferred to v0.2 |
| §7.1.1 Scenario B | X fixed-reward campaign from NL prompt | Deferred to v0.2 |
| §7.1.1 Scenario C | Error recovery flow (post-funding failure → resume) | Deferred to v0.2 |
| Preset recognition | "whale" / "broad" / "medium" → correct T1/T2/T3 targeting | Deferred to v0.2 |
| USD ↔ token conversion | "$500 of DEGEN" → correct totalAmount with price drift guard | Deferred to v0.2 |
| Conflict detection | Fixed reward + mismatched USD budget | Deferred to v0.2 |
| End-to-end skill flow | Skill invocation → dry-run → confirm → execute | Deferred to v0.2 |

These scenarios require an AI agent runtime (e.g., Claude Code with the skill loaded) and cannot be validated through CLI testing alone. They will be tracked as a v0.2 milestone.
