# Session Summary: Map Format, Console Map, Setup Screen, On-Device AI, Game Variants

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-12 → 2026-04-13 | Infrastructure + UX overhaul | COMPLETED |

## 1. Core Objective

Implement the unified map file format, console map renderer, interactive setup screen, on-device AI (Apple Foundation Models + Ollama), game variant system, and gameplay bug fixes.

## 2. Work Completed

### Unified Map File Format (IconquerCore)
- `UnifiedMapFile` — single JSON file with countries + continents + optional layouts array + defaultRuleset reference
- `MapLayout` — 2D positions with 3D provisions (z/depth for visionOS)
- `ConnectionRouter` — derives visual connections from neighbor graph, auto-detects cross-wrap
- `UnifiedMapLoader` — JSON loading + 4-check validation
- `CountryPosition`, `ConnectionOverride`, `MapLayout3D` types
- 12 new tests (UnifiedMapFileTests + ConnectionRouterTests)

### RulesetFile (IconquerCore)
- Standalone game rules configuration: `GameVariant`, `CardValueMode`, `FortifyMode`, `AttackDiceRule`
- `Mission` with `MissionCondition` (conquerContinents/destroyPlayer/controlTerritories/controlContinentsAny)
- Standard mission pool (10 missions)
- Built-in presets: .standard, .capital, .mission
- `RulesetLoader` for JSON loading
- Map references ruleset by filename (`defaultRuleset: String?`)

### Console Map Renderer (IconquerCLI)
- `MapRenderer` — 4-phase pipeline: connections → country boxes → selection overlay → viewport clipping
- `WorldMapLayout` — 42-country layout on 120x40 grid approximating world geography
- `MapAbbreviations` — 2-3 letter abbreviations for all countries
- `MapViewMode` (.spatial/.tree) — spatial is default for humans
- `m` key toggles between spatial map and tree view
- Arrow keys navigate between countries directionally (weighted distance favoring primary axis)
- Auto-scroll viewport to keep selected country visible
- Mouse click hit-testing on country boxes
- `[m]ap` / `[m]tree` mode indicator

### Interactive Setup Screen (IconquerCLI)
- `SetupModel` — players, map, ruleset, options, AI status
- `SetupView` — bordered form with Map/Rules → Players → Game Rules → Options → Buttons
- `SetupUpdate` — Tab/Shift-Tab/arrow navigation, left/right cycling, character input
- `SetupApp` — MVU event loop with alternate screen + mouse support
- `GameConfig` output type bridging setup → game engine
- Player name overwrite on first keystroke (nameEdited flag)
- Mouse click field focusing
- Launches automatically when `--tui` without `--player-config`
- CLI flags bypass setup screen for automation

### On-Device AI
- `AppleAIAgent` — Apple Foundation Models via `#if canImport(FoundationModels)`, macOS 26+
- `OllamaAgent` — localhost HTTP API with JSON schema structured output, preflight check
- `GamePromptBuilder` — extracted shared prompt/parse logic from LLMAgent
- Markdown code fence stripping (Apple models wrap JSON in ```json blocks)
- `debugLog()` centralized logging (only when ICONQUER_DEBUG=1 set)

### Game Variant System
- `GameVariant` enum: standard, capital, mission, twoPlayerNeutral
- `CardValueMode`: officialProgressive (4,6,8,10,15,20...), linear, fixed, escalating
- `FortifyMode`: adjacent, connected, multiple
- `AttackDiceRule`: standard, balanced, blitz
- Mission system with standard pool + custom mission support
- Neutral player with `isNeutral` flag and real PlayerId
- Setup screen exposes all variant options

### Gameplay Bug Fixes
- **Fortify army loss** — now places armies on destination before finishTurn
- **Card turn-in timing** — restricted to assignArmies phase
- **Forced card turn-in** — 5+ cards triggers awaitingCardTurnIn at turn start
- **Card display** — shows suit icons (♟♞♜★) + name instead of raw struct
- **Card turn-in UI** — arrow navigation, Enter toggles selection, 't' turns in 3 cards

### SwiftCLIKit Updates
- `Key.backtab` — Shift-Tab support (CSI Z)
- `DiffRenderer` — SGR reset after every render pass to prevent color bleed
- SwiftCLIKit v1.12.0 SSH committed earlier this session

### Design Proposals Written
- `IconquerCLI_AttackAnimations.md` — dice roll, capture flash, army ticker, turn transition, victory
- `IconquerCore_GameVariants.md` — all variant modes, card values, fortify, attack, missions
- `IconquerCLI_UnifiedMapFormat.md` — single-file format with layouts + ruleset reference
- `IconquerCLI_SetupScreen.md` — updated with variant selection + color picker + tournament mode
- `IconquerCLI_OnDeviceAI.md` — Apple Foundation Models + Ollama
- `IconquerCLI_ConsoleMap.md` — spatial map renderer (implemented)
- `IDEAS/mapBuilder.md` — expanded to Game Builder (maps + missions + scenarios)

## 3. Quality Gate

| Check | IconquerCore | IconquerCLI | SwiftCLIKit |
| :--- | :--- | :--- | :--- |
| build | ✅ | ✅ | ✅ |
| test | ✅ 56/56 | ✅ 132/132 | ✅ 503/503 |
| safety | ✅ | ✅ | ✅ |

## 4. Known Issues

- **Apple AI latency** — on-device Foundation Models takes 3-10 seconds per move. Game shows "thinking..." but feels slow. Could batch moves or use a smaller prompt.
- **Setup screen color cycling** — AI type and color left/right cycling may not work on all fields. Needs testing.
- **Setup screen Start button** — uses bg:.green which is fine but bright. Could tone down.
- **Spatial map layout** — some countries overlap or have cramped spacing at default 120x40. Layout needs manual tuning.
- **Connection routing** — orthogonal lines can overlap country boxes. Needs better obstacle avoidance.
- **StrategicAgent fortify** — mid-fortify placement targets weakest border, but may not be adjacent to the source. Needs BFS validation for connected fortify mode.

## 5. Next Session Priorities

### Tier 1: Implement remaining proposals
1. **Attack Animations** — dice roll, capture flash, army ticker, turn transition (answers resolved)
2. **Game Variants** — wire RulesetFile into Game.start(), implement variant-specific win conditions, card value schedules, connected fortify BFS
3. **World map layout tuning** — adjust positions to reduce overlap, improve readability

### Tier 2: Platform expansion
4. **IconquerApp (SwiftUI)** — port game logic to multiplatform app using GameViewModel
5. **MCP Agent** — full MCP client for multi-turn LLM reasoning
6. **Ollama integration** — test with actual Ollama instance, verify JSON schema output

### Tier 3: Polish
7. **Setup screen** — color picker, tournament mode options, load last/rematch
8. **Tests** — setup screen tests, map renderer tests, variant tests
9. **iConquer Map Format Guide** — `Docs/iConquerMapFormat.md`

## 6. Key Files

### IconquerCore
- `Sources/IconquerCore/Map/UnifiedMapFile.swift` — canonical map format
- `Sources/IconquerCore/Map/MapLayout.swift` — visual layout types
- `Sources/IconquerCore/Map/ConnectionRouter.swift` — connection derivation
- `Sources/IconquerCore/Rules/RulesetFile.swift` — game rules configuration

### IconquerCLI
- `Sources/IconquerCLILib/Setup/` — SetupModel, SetupView, SetupUpdate, SetupApp, GameConfig
- `Sources/IconquerCLILib/Support/MapRenderer.swift` — spatial map renderer
- `Sources/IconquerCLILib/Support/WorldMapLayout.swift` — 42-country positions
- `Sources/IconquerCLILib/GamePromptBuilder.swift` — shared LLM prompt/parse
- `Sources/IconquerCLILib/AppleAIAgent.swift` — Apple Foundation Models
- `Sources/IconquerCLILib/OllamaAgent.swift` — local Ollama
- `Sources/IconquerCLILib/DebugLog.swift` — centralized debug logging

### Proposals
- `project/plans/proposals/IconquerCLI_AttackAnimations.md`
- `project/plans/proposals/IconquerCore_GameVariants.md`
- `project/plans/ideas/mapBuilder.md` (expanded to Game Builder)

## 7. Context Warnings

- **RulesetFile vs Settings:** `RulesetFile` is the new portable rules config. The engine's `Settings` struct needs updating to consume RulesetFile fields — this hasn't been done yet.
- **debugLog():** All LLM/AI logging now goes through `debugLog()` which requires `ICONQUER_DEBUG=1` env var. No output without it.
- **Apple Foundation Models:** Wraps JSON in markdown code fences (```json). Parser strips them. On-device inference is 3-10 seconds per move.
- **Map/Ruleset separation:** Maps reference rulesets by filename (`defaultRuleset`). They're independent files — a map works with any ruleset.
- **Setup screen:** Only launches with `--tui` and no `--player-config`. CLI flags bypass it entirely.
- **AttackDiceRule vs AttackMode:** Renamed to avoid conflict with existing `AttackMode` enum in Combat.swift (which controls dice exchange repetition, not tie-breaking rules).

---

**Session Duration:** ~8 hours
**AI Model Used:** Claude Opus 4.6 (1M context)
