# Phase 2 v0.2.x Complete — Custom Maps + MCP Opponent

**Date:** 2026-04-09
**Scope:** IconquerCLI v0.2.0 → v0.3.0, IconquerMCP v0.2.0

## What shipped

### IconquerCLI@v0.2.0 — Custom maps + world map
- `MapFileLoader`: loads directory containing `Countries.json` + `Continents.json`
- `MapResolver`: built-in name OR directory path for `--map`
- `StarterMaps.world`: bundled 42-country iConquer classic map
- 66/66 tests, 11 suites

### IconquerMCP@v0.2.0 — Real MCP server
- Graduated from wiring-verification to actual `MatchHost.runServer()` call
- `MatchHost.runServer(mode:)`: programmatic stdio or HTTP(port) transport
- Supports `--mcp-player`, `--seed`, `--map` CLI args
- 42/42 tests, 7 suites

### IconquerCLI@v0.3.0 — LLM opponent via MCP
- `MCPPlayRunner`: GameSession-driven REPL bridging human stdin and LLM MCP
- `play --opponent mcp --mcp-port 8765`: in-process HTTP MCP server on loopback
- `GameSession.waitForNextMove()`: async notification when MCP opponent submits
- ADR-001 committed: documents the in-process HTTP loopback design choice
- 69/69 tests, 12 suites

## Architecture (ADR-001)

The CLI hosts the game in-process via a `GameSession` actor. Both the
human (via stdin REPL → `session.apply()`) and the LLM (via MCP
`iconquer_submit_move` tool → `session.apply()`) mutate the same game.
When it's the LLM's turn, the REPL blocks on `session.waitForNextMove()`.

Three alternatives were evaluated (subprocess-owns-game, CLI-as-proxy);
in-process HTTP loopback was chosen for smallest delta, cleanest
channel separation, and direct reuse of `MatchHost.buildConfiguration()`.

## Current tag inventory

| Package | Latest tag | Tests |
| :--- | :--- | :--- |
| IconquerCore | v0.3.1 | 129 |
| IconquerMatch | v0.1.0 | 19 |
| IconquerAI | v0.1.0 | 12 |
| IconquerMCP | v0.2.0 | 42 |
| IconquerCLI | v0.3.0 | 69 |
| **Total** | | **271** |

## What's next

Phase 2 v0.2.x polish is complete. Next chunk options:
- Phase 3: LLM tournament server on roseclub.org
- Phase 2 v0.3.0: IconquerApp SwiftUI shell
- Full-screen TUI mode for the CLI
