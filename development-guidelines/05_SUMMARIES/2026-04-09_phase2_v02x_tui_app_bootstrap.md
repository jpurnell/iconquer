# Session Summary — TUI, SwiftUI App, Accessibility, Architecture

**Date:** 2026-04-09
**Scope:** Phase 2 v0.2.x polish → TUI → cross-platform architecture → iOS app bootstrap

## What shipped

### IconquerCLI@v0.2.0 — Custom maps + world map
- `MapFileLoader`: loads directory with `Countries.json` + `Continents.json`
- `MapResolver`: built-in name OR directory path for `--map`
- `StarterMaps.world`: bundled 42-country iConquer classic map
- 66/66 tests

### IconquerMCP@v0.2.0 — Real MCP server
- `MatchHost.runServer(mode:)`: programmatic stdio or HTTP transport
- `iconquer-mcp` graduated from wiring-verification to real server
- `GameSession.waitForNextMove()`: async notification for REPL ↔ MCP bridging
- 42/42 tests

### IconquerCLI@v0.3.0 — LLM opponent via MCP
- `MCPPlayRunner`: GameSession-driven REPL with async wait for MCP moves
- `play --opponent mcp --mcp-port 8765`: in-process HTTP MCP server on loopback
- ADR-001 committed: in-process HTTP loopback design choice
- 69/69 tests

### IconquerCLI@v0.4.0 — Full-screen TUI
- `TUIRenderer`: ANSI full-screen layout (board, sidebar, history, prompt)
- `play --tui` flag wired into play command
- Fixed interactive stdin hang (lazy `nextLine` closure instead of upfront buffering)
- Box drawing with ASCII fallback, map border connections, army indicators
- 82/82 tests across 13 suites

### IconquerGameKit@v0.1.0 — Shared game brain
- `GameViewModel` (`@Observable`): wraps Game, mediates human + AI turns
- `BuiltInMaps`: duel + line4 (no CLI dependency needed)
- Targets iOS/macOS/tvOS/watchOS/visionOS 26+
- 7/7 tests

### IconquerApp@v0.1.0 — SwiftUI multiplatform app
- `StartView`: map picker, opponent picker, seed, Start button
- `GameView`: scrollable country list with owner colors, army counts, neighbor info
- Two-tap attack flow: select source (blue scope) → tap target (red burst)
- `ActionBar`: contextual phase buttons (Attack Phase, End Attacks, End Turn)
- `SelectionBanner`: red gradient bar showing attack context
- Victory banner with trophy
- Accessibility labels on all interactive elements
- xcodegen project targeting iOS/macOS/tvOS/visionOS 26+
- Verified working in macOS app (start → pick → place → attack → victory)

### quality-gate-swift — AccessibilityAuditor
- 3 enforced rules: `missing-accessibility-label`, `fixed-font-size`, `missing-reduce-motion`
- Feature × Ability matrix reference doc (low vision / blind / color blind / motor / hearing)
- Registered in CLI defaults, 11/11 tests

### ADRs 002-008 (IconquerCLI repo)
- ADR-002: IconquerGameKit as shared Layer 3 brain
- ADR-003: Workspace + separate repos, one Xcode project with platform targets
- ADR-004: `@Observable`, Apple OS 26+ minimums
- ADR-005: Data-driven BoardLayout from JSON
- ADR-006: Accessibility-first design
- ADR-007: No IconquerNet — MCPClientAgent in IconquerMCP
- ADR-008: tvOS as first-class platform target

## Current tag inventory

| Package | Latest tag | Tests |
| :--- | :--- | :--- |
| IconquerCore | v0.3.1 | 129 |
| IconquerMatch | v0.1.0 | 19 |
| IconquerAI | v0.1.0 | 12 |
| IconquerMCP | v0.2.0 | 42 |
| IconquerCLI | v0.4.0 | 82 |
| IconquerGameKit | v0.1.0 | 7 |
| IconquerApp | v0.1.0 | — |
| **Total** | | **291+** |

## Known issues / next iteration targets

### TUI
- Input echo + error messages print below the frame (need raw terminal mode to capture stdin within the TUI redraw area)
- No clear-screen between redraws for error/status messages
- World map (42 countries) would benefit from continent grouping in the list

### iOS/macOS App
- `place` only places 1 army at a time (no bulk placement UI)
- No world map in `BuiltInMaps` yet (need to bundle the JSON resources like IconquerCLI does)
- Attack mode defaults to `once` — no UI for `until-end` or `until-loss`
- No fortify destination selection (only `beginFortifyFrom`)
- No card turn-in UI
- No game-over "Play Again" button

### Architecture
- `IconquerApp` doesn't have watchOS or AudioExperience targets yet
- BoardLayout (ADR-005) data-driven JSON positions not implemented
- `MCPClientAgent` (ADR-007) not implemented yet
- No Xcode workspace file tying all sibling repos together

## Key files to read on resume

1. `development-guidelines/05_SUMMARIES/` — this file
2. `IconquerCLI/development-guidelines/00_CORE_RULES/06_ARCHITECTURE_DECISIONS.md` — ADRs 001-008
3. `IconquerGameKit/Sources/IconquerGameKit/GameViewModel.swift` — the shared brain
4. `IconquerApp/IconquerApp/Views/GameView.swift` — the SwiftUI game view
5. `IconquerCLI/Sources/IconquerCLILib/TUIRenderer.swift` — the terminal UI
6. `IconquerCLI/Sources/IconquerCLILib/PlayRunner.swift` — lazy stdin fix
7. `quality-gate-swift/Sources/AccessibilityAuditor/ACCESSIBILITY_MATRIX.md` — accessibility reference
