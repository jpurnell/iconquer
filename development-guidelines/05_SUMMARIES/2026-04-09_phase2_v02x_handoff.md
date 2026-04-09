# Phase 2 v0.2.x Handoff — Custom Maps + MCP Opponent Design

**Date:** 2026-04-09
**Status:** Mid-batch — v0.2.0 shipped, v0.3.0 designed but not started

## What shipped this session

### IconquerCLI@v0.2.0 (tagged, committed)

- `MapFileLoader`: loads a directory containing `Countries.json` + `Continents.json`
- `MapResolver`: tries built-in name first, falls back to directory path
- `StarterMaps.world`: bundled 42-country iConquer classic map from `iconquer/public/maps/iconquer-world/`
- All four subcommands (`simulate`, `play`, `replay`, `tournament`) accept `--map <name|path>`
- 66/66 tests passing across 11 suites
- Smoke-tested: `simulate --p1 greedy --p2 random --seed 7 --map world` → greedy wins (9 turns, 140 moves)

### Phase 2 v0.2.0 closed out

- Summary written: `05_SUMMARIES/2026-04-08_phase2_v0_2_0_ship.md`
- Checklist archived to `04_99_COMPLETED/`

### ADR-001 committed (IconquerCLI repo)

- `development-guidelines/00_CORE_RULES/06_ARCHITECTURE_DECISIONS.md`
- Decision: in-process MCP server over HTTP loopback for `play --opponent mcp`
- Three alternatives evaluated; shape #1 accepted

## What's next — v0.3.0 (`play --opponent mcp`)

Per ADR-001, the implementation plan is:

### Step A — Graduate `iconquer-mcp` to a real server
- `IconquerMCP/Sources/iconquer-mcp/main.swift`: replace wiring-verification exit with actual `config.run()` call
- This makes `iconquer-mcp` a standalone MCP server (also needed for Phase 3 tournament server on roseclub.org)
- Tag `IconquerMCP@v0.2.0` after this

### Step B — Wire `play --opponent mcp --mcp-port 8765` in CLI
- Add `--opponent mcp` alongside `random` and `greedy`
- When `mcp` is selected: construct `MatchHost.buildConfiguration()` in-process, bind `MCPAgent` to P2, run SwiftMCPServer on HTTP loopback
- Human plays P1 over stdio (existing PlayRunner); LLM connects to `http://localhost:<port>`
- PlayRunner needs a MatchRunner-driven async path (currently synchronous for v0.1.0)

### Step C — Tests + README + tag
- Integration test: MCPAgent delivers a scripted move, game resolves
- README documents the `play --opponent mcp` workflow
- Bump version → tag `IconquerCLI@v0.3.0`

## Current tag inventory

| Package | Latest tag | Tests |
| :--- | :--- | :--- |
| IconquerCore | v0.3.1 | 129 |
| IconquerMatch | v0.1.0 | 19 |
| IconquerAI | v0.1.0 | 12 |
| IconquerMCP | v0.1.0 | 11 |
| IconquerCLI | v0.2.0 | 66 |

## Key files to read on resume

1. `IconquerCLI/development-guidelines/00_CORE_RULES/06_ARCHITECTURE_DECISIONS.md` — ADR-001 (the plan)
2. `IconquerMCP/Sources/iconquer-mcp/main.swift` — wiring-verification mode to graduate
3. `IconquerMCP/Sources/IconquerMCP/MatchHost.swift` — `buildConfiguration()` already returns a runnable config
4. `IconquerMCP/Sources/IconquerMCP/MCPAgent.swift` — PlayerAgent with continuation-based deliver()
5. `IconquerCLI/Sources/IconquerCLILib/PlayRunner.swift` — needs async MatchRunner path
6. `IconquerCLI/Sources/iconquer-cli/IconquerCLICommand.swift` — `Play` subcommand to add `--opponent mcp`

## Deferred beyond v0.3.0

- Full-screen TUI mode
- Phase 3: LLM tournament server on roseclub.org
- Phase 2 v0.3.0: IconquerApp SwiftUI shell
