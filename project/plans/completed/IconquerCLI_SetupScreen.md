# Design Proposal: Pre-Game Setup Screen

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Interactive pre-game setup screen using SwiftCLIKit Form widgets for player configuration, map selection, and AI settings

---

## 1. Objective

Replace CLI flags with an interactive pre-game setup screen that launches before the game starts. The setup screen uses SwiftCLIKit Form widgets (TextField, Dropdown, Button) for configuring players, selecting maps, managing Ollama/Apple AI availability, and launching the game.

**Problems solved:**
1. **Poor discoverability.** New users must read `--help` to discover player configuration flags. A visual setup screen makes all options immediately visible and explorable.
2. **No AI service management.** Ollama must be running before the game starts, but the CLI provides no way to start it or check its status. The setup screen shows Ollama status and offers a "Start Ollama" button.
3. **No model selection.** When using Ollama, users must know model names and pass them via flags. The setup screen queries running models and presents them in a dropdown.
4. **Rigid player configuration.** Adding/removing players or changing AI types requires restarting with different flags. The setup screen allows iterative configuration before committing.
5. **No platform-aware AI options.** Apple AI is only available on macOS 26+. The setup screen detects availability and shows/hides the option accordingly.

**Master Plan Reference:** Phase 2 -- TUI polish and playability. The setup screen is the entry point for the game; making it interactive and self-documenting is a major UX improvement.

---

## 2. Proposed Architecture

### New Files

| File | Module | Purpose |
|------|--------|---------|
| `Sources/IconquerCLILib/Setup/SetupModel.swift` | IconquerCLILib | `SetupModel`, `PlayerConfig`, `OllamaStatus` state types |
| `Sources/IconquerCLILib/Setup/SetupMessage.swift` | IconquerCLILib | `SetupMessage` enum for all setup screen interactions |
| `Sources/IconquerCLILib/Setup/SetupView.swift` | IconquerCLILib | Renders the setup form using SwiftCLIKit Form components |
| `Sources/IconquerCLILib/Setup/SetupUpdate.swift` | IconquerCLILib | Handles `SetupMessage` dispatches, state transitions, side effects |
| `Sources/IconquerCLILib/Setup/SetupApp.swift` | IconquerCLILib | `SetupApp`: top-level TEA app that runs the setup screen and returns config |
| `Sources/IconquerCLILib/Setup/OllamaServiceManager.swift` | IconquerCLILib | Starts Ollama, polls for readiness, queries available models |

### Modified Files

| File | Change |
|------|--------|
| `Sources/iconquer-cli/main.swift` or `IconquerCLICommand.swift` | Run `SetupApp` first when no `--player-config` is provided; pass resulting config to `GameApp` |
| `Sources/IconquerCLILib/App/GameApp.swift` | Accept a `GameConfig` (extracted from setup) instead of parsing flags at launch |
| `Sources/IconquerCLILib/CLISettings.swift` | Add `GameConfig` struct that bridges setup output to game initialization |
| `Sources/IconquerCLILib/AgentFactory.swift` | Accept `PlayerConfig` from setup to create agents (already partially supports this) |

### Module Placement

All setup code lives in `IconquerCLILib/Setup/`. The setup screen is a separate TEA application (`App<SetupModel, SetupMessage>`) that runs BEFORE the game TEA app. When the user presses "Start Game", SetupApp terminates and returns a `GameConfig` value that is passed to `GameApp.run()`.

### Data Flow

```
CLI launch
  |
  v
--player-config flag provided?
  |                     |
  YES                   NO
  |                     |
  v                     v
Parse flags          SetupApp.run()
  |                     |
  v                     v
GameConfig           User configures players, map, AI
  |                     |
  |                     v
  |                  "Start Game" pressed
  |                     |
  |                     v
  |                  GameConfig returned
  |                     |
  +----------+----------+
             |
             v
       GameApp.run(config:)
```

---

## 3. API Surface

### SetupModel (state)

```swift
/// State for the pre-game setup screen.
///
/// Tracks player configurations, map selection, AI service status,
/// and form focus state. Consumed by `SetupView` for rendering and
/// `SetupUpdate` for state transitions.
public struct SetupModel: Sendable {
    /// Player configurations (2-6 slots).
    public var players: [PlayerConfig]
    /// Currently selected built-in map name.
    public var selectedMap: String
    /// Path to a custom map file (overrides selectedMap if non-nil).
    public var customMapPath: String?
    /// Random seed for deterministic games.
    public var seed: String
    /// Selected game variant (Standard, Capital, Mission, Two-Player).
    public var variant: GameVariant
    /// Selected card value mode.
    public var cardValueMode: CardValueMode
    /// Selected fortify mode.
    public var fortifyMode: FortifyMode
    /// Selected attack mode.
    public var attackMode: AttackMode
    /// Whether the territory card bonus is enabled.
    public var territoryCardBonusEnabled: Bool
    /// Neutral army count for two-player variant.
    public var neutralArmyCount: Int
    /// Status of the Ollama service.
    public var ollamaStatus: OllamaStatus
    /// Whether Apple AI (on-device) is available on this platform.
    public var appleAIAvailable: Bool
    /// Index of the currently focused form field.
    public var focusedField: SetupField
    /// Validation errors to display.
    public var validationErrors: [String]
    /// Whether the setup is complete and game should start.
    public var shouldStartGame: Bool

    /// Create the initial setup model with defaults.
    public static func initial() -> SetupModel
}
```

### PlayerConfig

```swift
/// Configuration for a single player slot in the setup screen.
public struct PlayerConfig: Sendable, Hashable {
    /// Player display name.
    public var name: String
    /// AI type (or human).
    public var type: PlayerType
    /// Ollama model name (only relevant when type == .ollama).
    public var ollamaModel: String?
    /// Player color name (from theme palette).
    public var color: String
    /// Whether this slot is active. Inactive slots are hidden.
    public var isEnabled: Bool
}

/// The type of controller for a player slot.
public enum PlayerType: String, Sendable, CaseIterable, Hashable {
    case human
    case random
    case greedy
    case strategic
    case claude
    case openai
    case ollama
    case apple
}
```

### OllamaStatus

```swift
/// Current state of the Ollama service as detected by the setup screen.
public enum OllamaStatus: Sendable, Hashable {
    /// Haven't checked yet (initial state).
    case notChecked
    /// Ollama binary not found on PATH.
    case notInstalled
    /// Installed but not running.
    case notRunning
    /// Running and serving models.
    case running(models: [String])
    /// Currently starting up (after user pressed "Start Ollama").
    case starting
}
```

### SetupMessage

```swift
/// Messages dispatched by the setup screen.
public enum SetupMessage: Sendable {
    // -- Player configuration --
    case setPlayerName(index: Int, name: String)
    case setPlayerType(index: Int, type: PlayerType)
    case setPlayerOllamaModel(index: Int, model: String)
    case togglePlayer(index: Int)
    case addPlayer

    // -- Map selection --
    case selectMap(String)
    case setCustomMapPath(String)
    case setSeed(String)

    // -- Game rules --
    case setVariant(GameVariant)
    case setCardValueMode(CardValueMode)
    case setFortifyMode(FortifyMode)
    case setAttackMode(AttackMode)
    case toggleTerritoryCardBonus
    case setNeutralArmyCount(Int)

    // -- AI service management --
    case ollamaStatusUpdated(OllamaStatus)
    case startOllama
    case checkOllamaStatus
    case checkAppleAI

    // -- Navigation --
    case focusNext
    case focusPrevious
    case startGame
    case quit

    // -- Validation --
    case validate
}
```

### SetupApp

```swift
/// The pre-game setup application.
///
/// Runs as a standalone TEA app before the game. Returns a `GameConfig`
/// when the user presses "Start Game", or nil if the user quits.
public enum SetupApp {
    /// Run the interactive setup screen.
    ///
    /// - Returns: A `GameConfig` ready to pass to `GameApp`, or nil if the user quit.
    public static func run() async throws -> GameConfig?
}
```

### GameConfig (bridge type)

```swift
/// Fully resolved game configuration produced by the setup screen.
///
/// This is the contract between SetupApp and GameApp. It contains
/// everything needed to initialize a game: map definition, player
/// list with agent types, and game settings.
public struct GameConfig: Sendable {
    /// The map to play on.
    public var mapDefinition: MapDefinition
    /// Visual layout (if available from unified map format).
    public var mapLayout: MapLayout?
    /// Configured players with their agent types.
    public var players: [ResolvedPlayer]
    /// Random seed (nil = random).
    public var seed: UInt64?
    /// Game variant selection.
    public var variant: GameVariant
    /// Card value mode.
    public var cardValueMode: CardValueMode
    /// Fortify mode.
    public var fortifyMode: FortifyMode
    /// Attack mode.
    public var attackMode: AttackMode
    /// Whether territory card bonus is active.
    public var territoryCardBonusEnabled: Bool
    /// Neutral army count (two-player variant only).
    public var neutralArmyCount: Int

    public struct ResolvedPlayer: Sendable {
        public var name: String
        public var type: PlayerType
        public var ollamaModel: String?
        public var color: String
    }
}
```

### OllamaServiceManager

```swift
/// Manages the Ollama service lifecycle from the setup screen.
///
/// Handles checking if Ollama is installed and running, starting it
/// if requested, and querying available models.
public enum OllamaServiceManager {

    /// Check whether Ollama is installed and running.
    public static func checkStatus() async -> OllamaStatus

    /// Start the Ollama server process in the background.
    ///
    /// Spawns `ollama serve` as a child process. Returns immediately;
    /// use ``pollUntilRunning(timeout:)`` to wait for readiness.
    public static func startServer() throws

    /// Poll the Ollama API until it responds, or timeout.
    ///
    /// - Parameter timeout: Maximum wait time in seconds.
    /// - Returns: The updated status (running with models, or notRunning if timeout).
    public static func pollUntilRunning(timeout: Int) async -> OllamaStatus

    /// Query available models from a running Ollama instance.
    ///
    /// - Returns: Array of model name strings from `/api/tags`.
    public static func availableModels() async throws -> [String]
}
```

---

## 4. MCP Schema

The setup screen is a presentation-layer feature. No MCP tools are added.

**Tool Description:** No new MCP tools required. The setup screen produces a `GameConfig` that is functionally identical to what CLI flags produce today. AI agents that play the game do not interact with the setup screen -- they receive their configuration programmatically.

**Future consideration:** An MCP `configure_game` tool could accept a `GameConfig` JSON and bypass the setup screen entirely, enabling AI-driven tournament orchestration. This is deferred.

**REQUIRED STRUCTURE (JSON) -- GameConfig (output of setup, input to game):**

```json
{
  "map": "world",
  "seed": 42,
  "variant": "standard",
  "cardValueMode": "officialProgressive",
  "fortifyMode": "adjacent",
  "attackMode": "standard",
  "territoryCardBonusEnabled": true,
  "neutralArmyCount": 40,
  "players": [
    {
      "name": "Justin",
      "type": "human",
      "color": "red"
    },
    {
      "name": "Claude",
      "type": "claude",
      "color": "blue"
    },
    {
      "name": "Skynet",
      "type": "ollama",
      "ollamaModel": "llama3.2",
      "color": "green"
    }
  ]
}
```

**Parameter Types:**
- `map` (string): Map name or path. Built-in: `"world"`, `"duel"`, `"line4"`. Custom: file path string.
- `seed` (integer, optional): Random seed for deterministic play.
- `variant` (string, optional): Game variant. One of `"standard"`, `"capital"`, `"mission"`, `"twoPlayerNeutral"`. Default `"standard"`.
- `cardValueMode` (string, optional): Card value escalation mode. One of `"officialProgressive"`, `"linear"`, `"fixed"`, `"escalating"`. Default `"officialProgressive"`.
- `fortifyMode` (string, optional): Fortification rules. One of `"adjacent"`, `"connected"`, `"multiple"`. Default `"adjacent"`.
- `attackMode` (string, optional): Attack resolution. One of `"standard"`, `"balanced"`, `"blitz"`. Default `"standard"`.
- `territoryCardBonusEnabled` (boolean, optional): Whether the +2 territory card bonus is active. Default `true`.
- `neutralArmyCount` (integer, optional): Neutral player army count for two-player variant. Default `40`.
- `players` (array): 2-6 player configuration objects.
  - `name` (string): Display name. Must be non-empty.
  - `type` (string): One of `"human"`, `"random"`, `"greedy"`, `"strategic"`, `"claude"`, `"openai"`, `"ollama"`, `"apple"`.
  - `ollamaModel` (string, optional): Required when type is `"ollama"`.
  - `color` (string): Player color name from the theme palette.

---

## 5. Constraints & Compliance

**Concurrency:** `SetupModel`, `PlayerConfig`, `OllamaStatus`, `GameConfig` are all `Sendable` value types. `OllamaServiceManager` uses `async` for network checks and process spawning -- no shared mutable state. The setup TEA app runs on a single thread (same as the game TEA app).

**No force unwraps:** Player array access uses bounds checking. Ollama API responses are decoded with optional binding. Model dropdown defaults to the first available model or shows "(none)".

**No hardcoded constants:** Player count limits (min: 2, max: 6), default player names, default colors, Ollama poll interval (2 seconds), and poll timeout (30 seconds) are defined in a `SetupConfig` struct.

**Division safety:** No division in setup logic.

**Guard clauses:** Validation uses guard with early returns. `startGame` message is rejected if validation fails.

**Swift 6 strict concurrency:** All types are `Sendable`. `OllamaServiceManager` methods are `async` and use structured concurrency (`Task` groups for polling, not `DispatchQueue`).

**No `String(format:)`:** All string construction uses interpolation.

**No forbidden patterns:** No force casts, no `try!`, no recursive inits. Process spawning for `ollama serve` uses `Foundation.Process` with proper error handling.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. The setup screen is a form with dropdowns and text fields. The only I/O is Ollama API checks (HTTP GET to localhost) and Apple AI availability detection (compile-time `#available` check). No compute-intensive operations.

---

## 7. Dependencies

**Internal Dependencies:**
- `SwiftCLIKit` -- `App`, `Form`, `TextField`, `Dropdown`, `Button`, `Text`, `Frame`, `Color` (existing TUI framework)
- `IconquerCore` -- `MapDefinition`, `CountryId` (for map loading in GameConfig)
- `IconquerCLILib/StarterMaps.swift` -- built-in map list for the map dropdown
- `IconquerCLILib/OllamaAgent.swift` -- existing Ollama preflight/API code (partially reused)
- `IconquerCLILib/AppleAIAgent.swift` -- existing availability check (reused)
- `IconquerCLILib/AgentFactory.swift` -- creates game agents from PlayerConfig (modified to accept setup output)

**External Dependencies:** None new. Ollama communication uses existing `URLSession`-based HTTP code already in `OllamaAgent`.

**Platform Dependencies:**
- Apple AI detection requires `#available(macOS 26, *)` compile-time check (already implemented in `AppleAIAgent`)
- Ollama management requires `Foundation.Process` for spawning `ollama serve` (macOS/Linux only)

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **SetupModel: initial state** | Default model has 2 players (1 human, 1 strategic), map "line4", empty seed, ollamaStatus = .notChecked |
| **SetupModel: add player** | Adding a player appends a new enabled PlayerConfig with a default name and next available color |
| **SetupModel: remove player** | Toggling an enabled player sets isEnabled to false; minimum 2 enabled players enforced |
| **SetupModel: max players** | Cannot add more than 6 players; addPlayer message is ignored at capacity |
| **PlayerConfig: name editing** | setPlayerName updates the name; empty names are flagged by validation |
| **PlayerConfig: type change** | Changing type to .ollama shows model field; changing away from .ollama clears ollamaModel |
| **PlayerConfig: ollama model** | setPlayerOllamaModel stores the model name; validated against available models if Ollama is running |
| **OllamaStatus: transitions** | notChecked -> notRunning -> starting -> running(models); notChecked -> notInstalled |
| **OllamaServiceManager: check** | Mock: running instance returns .running with model list; stopped instance returns .notRunning |
| **OllamaServiceManager: start** | Mock: startServer spawns process; pollUntilRunning transitions to .running |
| **OllamaServiceManager: timeout** | Poll times out after configured seconds; returns .notRunning |
| **Validation: minimum players** | Fewer than 2 enabled players produces validation error |
| **Validation: at least 1 human or automation flag** | Zero human players produces a warning (valid for automation, warning for interactive) |
| **Validation: empty player name** | Empty name string produces validation error with player index |
| **Validation: ollama without model** | Player type .ollama with nil ollamaModel produces validation error |
| **Validation: ollama not running** | Player type .ollama when ollamaStatus is not .running produces validation error |
| **Validation: apple AI unavailable** | Player type .apple when appleAIAvailable is false produces validation error |
| **Map selection** | selectMap("world") sets selectedMap; custom path overrides built-in selection |
| **Seed parsing** | String "42" parses to UInt64(42); empty string parses to nil; "abc" produces validation error |
| **Variant selection** | setVariant(.capital) updates model.variant; variant info panel text changes accordingly |
| **Card value mode** | setCardValueMode(.officialProgressive) updates model; dropdown reflects selection |
| **Fortify mode** | setFortifyMode(.connected) updates model; dropdown reflects selection |
| **Attack mode** | setAttackMode(.blitz) updates model; dropdown reflects selection |
| **Territory card bonus** | toggleTerritoryCardBonus flips the boolean; checkbox reflects state |
| **Two-player variant: player count** | Selecting twoPlayerNeutral variant enforces exactly 2 player slots; shows neutral army count field |
| **Two-player variant: neutral armies** | setNeutralArmyCount(40) stores the value; validation rejects non-positive values |
| **Variant info panel** | Each variant shows its correct description text in the info panel |
| **GameConfig output** | Valid setup model produces correct GameConfig with resolved map, players, seed, and variant settings |
| **GameConfig variant fields** | GameConfig includes variant, cardValueMode, fortifyMode, attackMode, territoryCardBonusEnabled |
| **CLI flag bypass** | When --player-config is provided, SetupApp is not run; game launches directly |

**Reference Truth:**
- Ollama API responses validated against the Ollama `/api/tags` JSON schema (documented at ollama.com)
- No calculation-based reference truth needed; this is a UI configuration feature

**Validation Trace (REQUIRED):**
- Create initial SetupModel; assert players.count == 2
- Set player[0].name = "Justin", player[0].type = .human
- Set player[1].name = "Claude", player[1].type = .claude
- Select map "world"
- Set seed "42"
- Trigger validate; assert validationErrors.isEmpty
- Extract GameConfig; assert config.players.count == 2
- Assert config.players[0].name == "Justin"
- Assert config.players[1].type == .claude
- Assert config.seed == 42
- Assert config.mapDefinition.countries.count == 42

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-003
date: 2026-04-10
status: proposed
category: architecture
title: Pre-game setup screen as a separate TEA application
context: |
  The CLI currently configures games entirely through command-line flags.
  This works for automation but is hostile to interactive users who don't
  know the flag names. Player types, AI models, and map selection all
  require flag-based configuration. Ollama must be started separately.
decision: |
  Implement the setup screen as a separate TEA application (App<SetupModel,
  SetupMessage>) that runs before the game TEA app. The setup screen uses
  SwiftCLIKit Form widgets for interactive configuration. When the user
  presses "Start Game", SetupApp returns a GameConfig value that is passed
  to GameApp. CLI flags bypass the setup screen entirely for automation.
rationale: |
  - Separate TEA app keeps setup and game concerns cleanly separated
  - Form widgets provide familiar UI patterns (text fields, dropdowns, buttons)
  - Ollama service management (start, poll, model query) is self-contained
  - CLI flags remain for scripting/automation/tournament orchestration
  - The setup model is independently testable without the game engine
consequences: |
  + Interactive users discover all options visually
  + Ollama can be started from the setup screen
  + Model selection dropdown shows available models
  + Platform-specific AI options shown/hidden based on availability
  + Configuration is validated before game launch
  - Two TEA apps means two app lifecycles to manage (sequential, not concurrent)
  - Setup screen adds startup latency (~100ms for Ollama check)
  - CLI flag behavior must be kept in sync with setup screen options
alternatives_rejected:
  - "In-game settings panel only: Cannot configure players after game starts"
  - "Wizard-style multi-screen flow: Over-engineered for 5-10 settings"
  - "Web-based setup: Breaks the terminal-native experience"
  - "ncurses dialog: SwiftCLIKit Form already provides this capability"
affected_files:
  - Sources/IconquerCLILib/Setup/SetupModel.swift (new)
  - Sources/IconquerCLILib/Setup/SetupView.swift (new)
  - Sources/IconquerCLILib/Setup/SetupUpdate.swift (new)
  - Sources/IconquerCLILib/Setup/SetupApp.swift (new)
  - Sources/IconquerCLILib/Setup/OllamaServiceManager.swift (new)
  - Sources/IconquerCLILib/Setup/SetupMessage.swift (new)
  - Sources/IconquerCLILib/App/GameApp.swift (modified)
  - Sources/IconquerCLILib/CLISettings.swift (modified)
  - Sources/IconquerCLILib/AgentFactory.swift (modified)
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Should the setup screen remember last-used configuration?** It could save/load from `~/.iconquer/setup.json`. **Proposed answer:** Yes, but deferred to v2. For v1, the setup screen always starts with defaults. Persisting config is a polish feature.

2. **How does the in-game Settings tab relate to the setup screen?** The user mentioned that the Settings tab becomes editable for mid-game changes (theme, etc.). **Proposed answer:** The setup screen handles pre-game configuration (players, map, AI). The in-game Settings tab handles runtime preferences (theme, animation speed, sound). They are complementary, not overlapping. Player configuration is locked once the game starts.

3. **Should the setup screen support tournament mode configuration?** Tournaments have additional settings (number of rounds, bracket format). **Proposed answer:** No. Tournament configuration stays as CLI flags via `iconquer-cli tournament`. The setup screen is for interactive single-game play only.

4. **What happens if Ollama crashes mid-game after being started from setup?** **Proposed answer:** The game's existing error handling for Ollama agent failures applies. The OllamaAgent already handles connection errors gracefully (falls back to random moves with a warning). The setup screen's "Start Ollama" is a convenience, not a lifecycle manager.

5. **Should the "Start Ollama" button also handle model pulls?** If Ollama is running but has no models, the user needs to `ollama pull <model>`. **Proposed answer:** Deferred. For v1, if Ollama is running with zero models, show "No models available. Run `ollama pull <model>` in another terminal." A future version could add a model pull UI.

6. **How does Apple AI model selection work?** Unlike Ollama, Apple AI does not have user-selectable models -- it uses the system model. **Proposed answer:** Apple AI has no model dropdown. When selected, it shows "System model" as a static label. The `AppleAIAgent` handles model selection internally.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (SetupApp, SetupModel, OllamaServiceManager, form widgets, GameConfig, agent factory)
- Does explanation require 50+ lines? Yes (setup flow, Ollama management, validation rules, CLI bypass)
- Does it need theory/background context? Yes (TEA architecture for the setup app, Ollama API, Apple AI availability detection)

**Article Name:** `SetupScreenGuide.md`
(Placed in `.docc` catalog if/when IconquerCLI adds documentation. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what the setup screen does and when it appears
2. Player configuration -- adding, removing, renaming, changing types
3. AI provider setup -- Ollama (start, model selection), Apple AI (detection), Claude/OpenAI (API key status)
4. Map selection -- built-in maps, custom map paths, map preview
5. Validation rules -- what must be true before "Start Game" is enabled
6. CLI bypass -- using `--player-config` to skip the setup screen for automation
7. Keyboard navigation -- tab order, enter to confirm, escape to quit

---

## Setup Screen Layout Reference

```
┌─ iConquer Setup ──────────────────────────────────────────┐
│                                                            │
│  Map: [World ▾]                    Seed: [42        ]     │
│                                                            │
│  Players:                                                  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 1. [Justin       ] [Human    ▾] ● Red               │ │
│  │ 2. [Claude       ] [Claude   ▾] ● Blue    API: ✓    │ │
│  │ 3. [Skynet       ] [Ollama   ▾] ● Green   llama3.2  │ │
│  │ 4. [              ] [         ▾] ● Orange  [Add]     │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Game Rules:                                               │
│  Variant:    [Standard    ▾]                               │
│  Cards:      [Official    ▾]                               │
│  Fortify:    [Adjacent    ▾]                               │
│  Attack:     [Standard    ▾]                               │
│  Card Bonus: [x] +2 armies for owning territory on card    │
│                                                            │
│  ┌─ Variant Info ────────────────────────────────────────┐ │
│  │ Standard Risk: Conquer all territories to win.        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                            │
│  Ollama: ○ Not Running  [Start Ollama]                    │
│  Apple AI: ✓ Available                                     │
│                                                            │
│  [Start Game]                          [Quit]             │
└────────────────────────────────────────────────────────────┘

Variant-specific info panels (shown conditionally in the "Variant Info" box):

Standard:    "Conquer all territories to win."
Capital:     "Select your capital after picking countries. Win by capturing
              all opponent capitals."
Mission:     "Secret mission will be assigned at game start. Complete your
              mission before anyone else to win."
Two-Player:  "Neutral player armies: [40  ]. The non-active player places
              neutral armies each turn."
```

**Form widget mapping:**
- "Map" -- `Dropdown` with items from `StarterMaps.names` + "Custom..."
- "Seed" -- `TextField` accepting numeric input
- Player name -- `TextField` per player row
- Player type -- `Dropdown` per player row; items filtered by availability (Apple AI hidden if unavailable, Ollama models shown only if running)
- Player color -- static `Text` label (auto-assigned from palette, could be made selectable later)
- "Variant" -- `Dropdown` with items from `GameVariant.allCases` display names
- "Cards" -- `Dropdown` with items from `CardValueMode.allCases` display names
- "Fortify" -- `Dropdown` with items from `FortifyMode.allCases` display names
- "Attack" -- `Dropdown` with items from `AttackMode.allCases` display names
- "Card Bonus" -- `Checkbox` toggling `territoryCardBonusEnabled`
- "Neutral player armies" -- `TextField` (numeric), visible only when `variant == .twoPlayerNeutral`
- "Variant Info" -- `Text` block showing contextual description; content changes with selected variant
- "Start Ollama" -- `Button` visible only when `ollamaStatus == .notRunning`
- "Start Game" -- `Button` enabled only when validation passes
- "Quit" -- `Button` always enabled
