# Design Proposal: IconquerCLI v0.5.0 — Must-Have TUI Overhaul

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Complete TUI rewrite using SwiftCLIKit v1.0.0 widgets, CellBuffer rendering, Layout panels, Tree/Menu widgets, truecolor, alternate screen, mouse input, and accessibility
**Supersedes:** `UPCOMING/TUIPolish_v050.md` (which targeted SwiftCLIKit v0.2.0 only)

---

## 1. Objective

**Objective:** Replace the hand-rolled ANSI TUI in IconquerCLI with a widget-based architecture built on SwiftCLIKit v1.0.0. The current `TUIRenderer` concatenates strings, redraws the entire screen on every frame, uses 8-color hardcoded ANSI codes, and renders countries as a flat alphabetical list. This proposal replaces it with CellBuffer-backed differential rendering, constraint-based panel Layout, a Tree widget for continent-grouped country browsing, a Menu widget for phase-contextual actions, truecolor player colors with auto-downsampling, alternate screen lifecycle, mouse-click country selection, and semantic accessibility labels.

**Master Plan Reference:** Phase 2 -- CLI polish. This is the foundational "must-have" tier that every subsequent feature (ASCII map rendering, App+MVU architecture, chart widgets) builds on.

**Problems solved:**

1. **Full-screen flicker.** The current renderer clears the entire screen (`\e[2J`) and rewrites every character on every frame. `DiffRenderer` emits only changed cells, eliminating flicker during game state transitions.
2. **Manual column math.** `TUIRenderer.render()` manually calculates `boardWidth = termWidth - sidebarWidth - 3`. Constraint-based `Layout.split()` replaces all manual arithmetic with declarative constraints.
3. **Flat country list.** The 42-country world map renders as an unsorted list. A `Tree<CountryNode>` grouped by continent with expand/collapse makes it scannable.
4. **Text prompt for actions.** The current text REPL (`> attack A B`) requires memorizing commands. A `Menu` widget with phase-contextual items and key hints provides discoverability.
5. **8-color palette only.** `hexToAnsi()` maps 6 hardcoded hex values to ANSI-8. `Color.fromHex()` + `ColorNegotiation` provides truecolor with automatic downsampling.
6. **Terminal scrollback destroyed.** The clear-screen approach wipes the user's scrollback. `AlternateScreen` preserves it.
7. **No mouse support.** All interaction is keyboard-only. `MouseMode` + click-to-select enables two-click attack flow.
8. **No accessibility.** Screen reader users get raw ANSI noise. Semantic labels on all interactive elements provide meaningful descriptions.

---

## 2. Proposed Architecture

### Modified Files

```
IconquerCLI/
├── Package.swift                              -- add SwiftCLIKit dependency
├── Sources/IconquerCLILib/
│   ├── TUIRenderer.swift                      -- COMPLETE REWRITE: widget-based rendering
│   ├── PlayRunner.swift                       -- integrate RawTerminal, KeyReader,
│   │                                             mouse handling, DiffRenderer loop
│   ├── CLISettings.swift                      -- add theme, mouseEnabled, a11yLabels
│   └── Renderer.swift                         -- unchanged (scoreboard mode kept)
├── Sources/iconquer-cli/
│   └── IconquerCLICommand.swift               -- AlternateScreen lifecycle,
│                                                 ColorNegotiation.detect()
```

### New Files

```
IconquerCLI/Sources/IconquerCLILib/
├── GameTreeDataSource.swift                   -- builds Tree<CountryNode> from
│                                                 MapDefinition + GameSnapshot
├── ActionMenu.swift                           -- phase-contextual Menu construction
├── GameLayout.swift                           -- Layout constraints for game screen
└── AccessibilityLabels.swift                  -- semantic label generation
```

### Architecture Diagram

```
IconquerCLICommand
    │
    ├── AlternateScreen (RAII)
    ├── RawTerminal (RAII)
    ├── ColorNegotiation.detect() → ColorCapability
    │
    └── PlayRunner.runGame(...)
         │
         ├── Input: KeyReader + LineEditor + MouseMode
         │    └── Key / MouseEvent dispatched to:
         │         ├── Tree<CountryNode> (expand/collapse, selection)
         │         ├── Menu (action selection)
         │         └── LineEditor (text commands)
         │
         ├── State: Game + GameSnapshot (from IconquerCore)
         │
         ├── Layout: GameLayout.build(terminalSize, capability)
         │    └── Layout.split() → [boardRect, sidebarRect, statusRect, promptRect]
         │
         ├── Rendering:
         │    ├── CellBuffer(width, height)
         │    ├── Frame(buffer, rect) per panel
         │    ├── Block (bordered panels)
         │    ├── Tree<CountryNode> → board frame
         │    ├── Menu → sidebar frame
         │    ├── Paragraph → status frame
         │    ├── LineEditor → prompt frame
         │    └── DiffRenderer.render(current, previous) → ANSI string
         │
         └── Accessibility: labels on Tree nodes, Menu items, status
```

The key architectural decision is to use SwiftCLIKit's widget layer (Tree, Menu, Block, Paragraph) and rendering pipeline (CellBuffer + Frame + DiffRenderer) **without** adopting the full App+MVU framework (`App`, `Component`, `Cmd`, `Subscription`). The existing `PlayRunner` game loop stays, gaining SwiftCLIKit primitives for rendering and input. The full App+MVU migration is the "amazing" tier for a future proposal.

---

## 3. API Surface

### 3a. GameTreeDataSource

```swift
/// A node in the game country tree.
public struct CountryNode: Sendable, Equatable {
    /// The country identifier (e.g., "Brazil").
    public let countryId: String
    /// The owning player's identifier, or nil if unowned.
    public let ownerId: PlayerId?
    /// The hex color string of the owning player (e.g., "#e53935").
    public let ownerColor: String?
    /// The number of armies on this country.
    public let armies: Int
    /// The number of neighboring countries.
    public let neighborCount: Int
}

/// Builds a Tree<CountryNode> from game state, grouped by continent.
public enum GameTreeDataSource {

    /// Build tree roots from a map definition and game snapshot.
    ///
    /// Each root is a continent node whose label includes the bonus:
    /// `"North America (+5)"`. Children are countries sorted alphabetically.
    ///
    /// - Parameters:
    ///   - map: The map definition providing continent/country structure.
    ///   - snapshot: The current game snapshot.
    ///   - capability: The terminal's color capability for player colors.
    /// - Returns: An array of `Tree.TreeNode<CountryNode>` roots.
    public static func buildRoots(
        map: MapDefinition,
        snapshot: GameSnapshot,
        capability: ColorCapability
    ) -> [Tree<CountryNode>.TreeNode]

    /// Build an accessibility label for a country node.
    ///
    /// Example: "Brazil, owned by Player 1, 5 armies, 3 neighbors"
    public static func accessibilityLabel(for node: CountryNode) -> String

    /// Render a single country node as display text for the tree.
    ///
    /// Format: `"Brazil [P1] ●●●●● (5)"` with owner color applied.
    public static func renderNode(
        _ node: CountryNode,
        capability: ColorCapability
    ) -> String
}
```

### 3b. ActionMenu

```swift
/// Phase-contextual action menu for the game sidebar.
public enum ActionMenu {

    /// Identifiers for menu actions, mapped to game moves.
    public enum Action: String, Sendable, CaseIterable {
        case attack         = "Attack"
        case finishAttacks  = "Finish Attacks"
        case fortify        = "Fortify"
        case endTurn        = "End Turn"
        case cards          = "Cards"
        case pick           = "Pick Country"
        case place          = "Place Armies"
    }

    /// Build a Menu for the current game phase.
    ///
    /// Returns a `Menu` with items enabled/disabled based on phase
    /// and key hints shown (e.g., "a" for Attack).
    ///
    /// - Parameters:
    ///   - snapshot: The current game snapshot.
    ///   - humanSeat: The human player's seat.
    /// - Returns: A configured `Menu` widget and the mapping from
    ///   index to `Action`.
    public static func build(
        snapshot: GameSnapshot,
        humanSeat: PlayerId
    ) -> (menu: Menu, actions: [Action])

    /// Build an accessibility label for a menu action.
    ///
    /// Example: "Attack action, press A or Enter to activate"
    public static func accessibilityLabel(
        for action: Action,
        enabled: Bool
    ) -> String
}
```

### 3c. GameLayout

```swift
/// Layout configuration for the game TUI screen.
public enum GameLayout {

    /// Panel identifiers.
    public enum Panel: Int, CaseIterable {
        case board = 0    // Left panel: country tree + borders
        case sidebar      // Right panel: players + action menu
        case status       // Bottom-left: status messages
        case prompt       // Bottom-right: input line
    }

    /// Configuration constants for panel sizing.
    public struct Config: Sendable {
        /// Minimum width for the sidebar in columns.
        public var sidebarMinWidth: Int
        /// Height of the status/prompt bar in rows.
        public var bottomBarHeight: Int
        /// Percentage of width allocated to the sidebar (0-100).
        public var sidebarWidthPercent: UInt16

        public static let defaults = Config(
            sidebarMinWidth: 30,
            bottomBarHeight: 3,
            sidebarWidthPercent: 30
        )
    }

    /// Compute panel rectangles for the given terminal size.
    ///
    /// Uses `Layout.split()` with a vertical split (main area + bottom bar),
    /// then a horizontal split for the main area (board + sidebar).
    ///
    /// - Parameters:
    ///   - terminalSize: The terminal dimensions.
    ///   - config: Panel sizing configuration.
    /// - Returns: A dictionary mapping `Panel` to `Rect`.
    public static func build(
        terminalSize: TerminalSize,
        config: Config = .defaults
    ) -> [Panel: Rect]
}
```

### 3d. AccessibilityLabels

```swift
/// Semantic accessibility label generation for game UI elements.
public enum AccessibilityLabels {

    /// Label for a country in the tree.
    /// "Brazil, owned by Player 1, 5 armies, 3 neighbors"
    public static func country(
        name: String,
        owner: String?,
        armies: Int,
        neighbors: Int
    ) -> String

    /// Label for a continent header in the tree.
    /// "North America continent, bonus 5 armies, 9 countries, expanded"
    public static func continent(
        name: String,
        bonus: Int,
        countryCount: Int,
        expanded: Bool
    ) -> String

    /// Label for an action menu item.
    /// "Attack action, press A or Enter to activate"
    /// "Fortify action, disabled during attack phase"
    public static func menuAction(
        name: String,
        keyHint: String?,
        enabled: Bool,
        disabledReason: String?
    ) -> String

    /// Label for a status message.
    /// "Status: Player 1 attacks Brazil from Argentina, 3 vs 2"
    public static func statusMessage(_ message: String) -> String

    /// Label for focus change.
    /// "Focus moved to action menu"
    public static func focusChange(to element: String) -> String
}
```

### 3e. Modified TUIRenderer (complete rewrite)

```swift
/// Widget-based terminal UI renderer for IconquerCLI.
///
/// Replaces the string-concatenation approach with SwiftCLIKit
/// CellBuffer + DiffRenderer + Layout + Widget pipeline.
public final class TUIRenderer: @unchecked Sendable {
    // Justification: NSLock protects mutable state (history, treeState, menuIndex)

    /// The terminal color capability detected at startup.
    public let capability: ColorCapability

    /// The current tree expand/collapse and selection state.
    public private(set) var treeState: TreeState

    /// The current action menu selection index.
    public private(set) var menuIndex: Int

    /// The diff renderer that tracks previous frame for delta updates.
    private var diffRenderer: DiffRenderer

    /// The previous CellBuffer for diff comparison.
    private var previousBuffer: CellBuffer?

    public init(settings: CLISettings, capability: ColorCapability)

    /// Render the game state into a CellBuffer and return the ANSI
    /// diff string to write to the terminal.
    ///
    /// - Parameters:
    ///   - snapshot: Current game state.
    ///   - map: Map definition for continent grouping.
    ///   - prompt: Current input line text.
    ///   - statusMessage: Status line text.
    ///   - terminalSize: Current terminal dimensions.
    /// - Returns: An ANSI escape string representing only the changed cells.
    public func render(
        _ snapshot: GameSnapshot,
        map: MapDefinition,
        prompt: String?,
        statusMessage: String?,
        terminalSize: TerminalSize
    ) -> String

    /// Process a tree navigation event (expand, collapse, select).
    public func handleTreeEvent(_ key: Key)

    /// Process a menu navigation event (up, down, select).
    public func handleMenuEvent(_ key: Key) -> ActionMenu.Action?

    /// Process a mouse click and determine what was hit.
    public func handleMouseClick(
        _ event: MouseEvent,
        panelRects: [GameLayout.Panel: Rect]
    ) -> ClickResult

    /// Append a move to the history log.
    public func appendHistory(_ entry: String)

    /// Clear move history.
    public func clearHistory()
}

/// Result of a mouse click hit test.
public enum ClickResult: Sendable {
    /// Clicked on a country in the tree.
    case country(String)
    /// Clicked on a menu action.
    case menuAction(ActionMenu.Action)
    /// Clicked outside any interactive element.
    case none
}
```

### 3f. Modified PlayRunner

```swift
// Existing signatures preserved. New overload for widget-based TUI:

extension PlayRunner {

    /// Run a full game with the widget-based TUI.
    ///
    /// Uses RawTerminal for input, DiffRenderer for output,
    /// KeyReader for keyboard events, and MouseMode for click handling.
    ///
    /// - Parameters:
    ///   - seed: RNG seed.
    ///   - players: Player list.
    ///   - settings: Game settings.
    ///   - terminal: The raw terminal for character-by-character input.
    ///   - output: Output sink (stdout or capturing for tests).
    /// - Returns: The game outcome.
    public func runGameTUI(
        seed: UInt32,
        players: [Player],
        settings: Settings = Settings(),
        terminal: RawTerminal,
        output: PlayOutput = ConsoleOutput()
    ) async throws -> PlayOutcome
}
```

### 3g. Modified CLISettings

```swift
// Additions to existing CLISettings struct:

extension CLISettings {
    /// Whether mouse input is enabled in TUI mode.
    public var mouseEnabled: Bool  // default: true

    /// Whether accessibility labels are generated.
    public var accessibilityLabels: Bool  // default: true

    /// Theme name for TUI rendering ("default", "high-contrast", "solarized").
    public var theme: String  // default: "default"
}
```

### 3h. Modified IconquerCLICommand (Play subcommand)

```swift
// Changes to the Play subcommand:

struct Play: AsyncParsableCommand {
    // ... existing flags ...

    @Flag(help: "Disable mouse input in TUI mode.")
    var noMouse: Bool = false

    @Flag(help: "Enable verbose accessibility labels.")
    var accessible: Bool = false

    func run() async throws {
        // ... map resolution ...

        let capability = ColorNegotiation.detect()
        var cliSettings = CLISettings.load()
        cliSettings.mouseEnabled = !noMouse
        cliSettings.accessibilityLabels = accessible

        if tui {
            // Enter alternate screen (RAII -- restored on scope exit)
            let screen = AlternateScreen()
            _ = screen  // keep alive

            // Enter raw mode (RAII -- restored on scope exit)
            let rawTerminal = RawTerminal()

            // Enable mouse if requested
            if cliSettings.mouseEnabled {
                print(MouseMode.enable, terminator: "")
            }
            defer {
                if cliSettings.mouseEnabled {
                    print(MouseMode.disable, terminator: "")
                }
            }

            let tuiRenderer = TUIRenderer(
                settings: cliSettings,
                capability: capability
            )
            let runner = PlayRunner(
                humanSeat: PlayerId("P1"),
                opponentAgent: opponentAgent,
                map: mapDef,
                renderer: renderer,
                tuiRenderer: tuiRenderer
            )
            _ = try await runner.runGameTUI(
                seed: seed,
                players: players,
                settings: Settings(assignCountries: false),
                terminal: rawTerminal
            )
        } else {
            // ... existing non-TUI path unchanged ...
        }
    }
}
```

---

## 4. MCP Schema

Not applicable -- TUI rendering, terminal lifecycle, and input handling are local-only features with no MCP exposure. The game state and moves continue to use the existing MCP schema from IconquerMCP.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | All `Color.fromHex()` returns are optional-checked. `Layout.split()` returns empty on bad input. Tree node lookups use `guard let`. |
| **No `try!`** | N/A -- no throwing calls in new code except `Game.start()` which is already `try`. |
| **No force casts** | N/A -- no downcasting in the proposal. |
| **Guard clauses** | All validation uses early-return guards: terminal size > 0, panel rects non-empty, snapshot non-nil. |
| **Division safety** | `GameLayout.build()` guards `terminalSize.columns > 0` and `terminalSize.rows > 0` before any division. Percentage constraints handled by `Layout.split()` which already guards internally. |
| **Sendable** | `TUIRenderer`: `@unchecked Sendable` with justification (NSLock). `CountryNode`, `ClickResult`, `GameLayout.Config`: value types, automatically Sendable. `ActionMenu.Action`: enum, Sendable. |
| **Pointer safety** | No `withUnsafe*` blocks. All rendering goes through SwiftCLIKit's safe CellBuffer subscript API. |
| **Concurrency** | No actors introduced. `TUIRenderer` uses NSLock for mutable state (same pattern as current). `PlayRunner.runGameTUI()` is `async` but single-threaded input loop. No `DispatchQueue` usage. |
| **No hardcoded constants** | Sidebar width, bottom bar height, max history lines, indent width all live in `GameLayout.Config` and `CLISettings`. Player hex colors come from `IconquerCore.Player.color`. |
| **Recursion safety** | `GameTreeDataSource.buildRoots()` iterates flat continent/country arrays -- no recursive tree traversal. Tree widget handles rendering recursion internally with depth limit. |

---

## 6. Backend Abstraction

Not applicable -- no compute-intensive operations. All rendering is character-cell manipulation at terminal refresh rates (< 60 Hz). The `DiffRenderer` diff algorithm is O(width * height) per frame which is bounded by terminal size (typically < 20,000 cells).

---

## 7. Dependencies

### Internal Dependencies

| Dependency | Used For |
|------------|----------|
| `SwiftCLIKit` v1.0.0 | CellBuffer, DiffRenderer, Layout, Frame, Rect, Tree, TreeState, Menu, Block, Paragraph, Color, ColorNegotiation, ColorCapability, AlternateScreen, RawTerminal, KeyReader, Key, LineEditor, MouseMode, MouseEvent, TerminalSize, CellStyle, BoxDrawing, TestBackend, SnapshotTesting |
| `IconquerCore` (existing) | Game, GameSnapshot, GameMove, MapDefinition, Country, Continent, Player, PlayerId, Settings |
| `IconquerMatch` (existing) | MatchRunner (unchanged, used by MCP mode) |
| `IconquerAI` (existing) | PlayerAgent, AgentFactory (unchanged) |

### External Dependencies

| Dependency | Version | Used For |
|------------|---------|----------|
| `swift-argument-parser` | >= 1.5.0 | CLI flags (`--no-mouse`, `--accessible`) |

### New Package.swift dependency line

```swift
.package(path: "../SwiftCLIKit"),
```

Added to `IconquerCLILib` target:
```swift
.product(name: "SwiftCLIKit", package: "SwiftCLIKit"),
```

---

## 8. Test Strategy

### Test Categories

**1. CellBuffer rendering (TUIRenderer integration)**

Use `TestBackend` + `SnapshotTesting` to render known game states and assert cell contents.

- **Golden path:** Render a 6-player world map at turn 5, attack phase. Assert:
  - Top border contains `"iConquer"`, turn number, phase
  - Board panel contains continent headers `"North America (+5)"`
  - Sidebar contains player summaries with correct army totals
  - Status area shows provided status message
  - Prompt area shows `"> "` prefix

- **Differential rendering:** Render frame A (placement phase), then frame B (attack phase, one country army count changed). Assert the `DiffRenderer` output string is shorter than a full redraw.

- **Small map:** Render duel map (2 countries). Assert both countries visible, no continent grouping (only 1 continent).

**2. Layout (GameLayout)**

- Terminal 80x24: assert board panel gets ~70% width, sidebar gets ~30%
- Terminal 40x10 (minimum): assert all panels have positive dimensions
- Terminal 200x60 (large): sidebar width does not exceed readable bounds

**3. Tree widget (GameTreeDataSource)**

- World map: 6 continent roots, each with correct child count (e.g., North America = 9)
- Continent label format: `"North America (+5)"` (not `"North America"`)
- Country node format: `"Brazil [P1] ***** (5)"` with owner color (verified via CellStyle in snapshot)
- Expand/collapse: start expanded, press Enter on continent -> children hidden, press again -> children shown
- Selection: arrow down to country -> highlight style applied
- Empty continent (no countries owned): still shown, 0 children

**4. Menu widget (ActionMenu)**

- Placement phase: "Pick Country" and "Place Armies" enabled; "Attack", "Fortify" disabled
- Attack phase: "Attack" and "Finish Attacks" enabled; "Pick Country" disabled
- Fortify phase: "Fortify" and "End Turn" enabled; "Attack" disabled
- Cards available: "Cards" enabled when player has >= 3 cards
- Key hints present: "a" for Attack, "f" for Fortify, "e" for End Turn

**5. Mouse interaction**

- Click coordinates inside board panel tree row -> `ClickResult.country("Brazil")`
- Click coordinates inside sidebar menu row -> `ClickResult.menuAction(.attack)`
- Click coordinates in empty area -> `ClickResult.none`
- Two-click attack flow: click source country, then click target country -> attack move generated

**6. Color rendering**

- `Color.fromHex("#e53935")` with `.truecolor` capability -> truecolor red in cell foreground
- Same hex with `.basic` capability -> downsampled to `ansi8(.red)`
- `NO_COLOR` environment -> all cells have default foreground (no color escapes)

**7. Accessibility labels**

- Country node: `AccessibilityLabels.country(name: "Brazil", owner: "Player 1", armies: 5, neighbors: 3)` -> `"Brazil, owned by Player 1, 5 armies, 3 neighbors"`
- Unowned country: owner `nil` -> `"Brazil, unowned, 0 armies, 3 neighbors"`
- Continent: `"North America continent, bonus 5 armies, 9 countries, expanded"`
- Menu action (enabled): `"Attack action, press A or Enter to activate"`
- Menu action (disabled): `"Fortify action, disabled during attack phase"`

**8. Alternate screen lifecycle**

- `AlternateScreen` init writes `\e[?1049h` to output
- `AlternateScreen` deinit writes `\e[?1049l`
- Verified via `TestBackend` event capture or string assertion

**Validation Trace (REQUIRED):**

| Input | Expected Output | Assertion |
|-------|----------------|-----------|
| World map, 6 players, turn 1, placement | Tree shows 6 continent roots with bonuses | `snapshotContains("North America (+5)")` |
| Duel map, 2 players, attack phase | Menu shows "Attack" enabled, "Pick Country" disabled | `menu.items[0].enabled == true`, `menu.items[4].enabled == false` |
| `Color.fromHex("#e53935")?.downsampled(to: .basic)` | `.ansi8(.red)` | Direct equality assertion |
| Click at (5, 3) inside board rect (0,0,60,20) | `ClickResult.country("Alaska")` (row 3 of tree) | Pattern match on enum |
| `AccessibilityLabels.country(name: "Brazil", owner: "Player 1", armies: 5, neighbors: 3)` | `"Brazil, owned by Player 1, 5 armies, 3 neighbors"` | String equality |

**Reference Truth:** SwiftCLIKit's own `SnapshotTesting` golden files serve as the rendering reference. Game logic correctness is already validated by IconquerCore's parity tests against the TypeScript reference.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No (ADR-009 and ADR-010 from the original TUI proposal still hold -- SwiftCLIKit as reusable library, POSIX termios without ncurses)
- [x] Does this amend an existing ADR? Yes -> amends ADR-009
- [x] New ADR required? **Yes** -> ADR-011

**Amended ADR-009:**
- **Amendment:** SwiftCLIKit is now at v1.0.0 with full widget/framework layer, not just the v0.2.0 terminal primitives. IconquerCLI v0.5.0 consumes CellBuffer, DiffRenderer, Layout, Tree, Menu, Block, Paragraph, Color, ColorNegotiation, AlternateScreen, RawTerminal, KeyReader, LineEditor, MouseMode, TestBackend, and SnapshotTesting. The original decision to keep game-specific rendering in IconquerCLI still holds.

**New ADR Draft:**

```yaml
id: ADR-011
date: 2026-04-10
status: proposed
category: architecture
title: Widget-based TUI without full App+MVU framework
context: |
  SwiftCLIKit v1.0.0 ships both a widget layer (Tree, Menu, Block, etc.)
  and a full App+MVU framework (App, Component, Cmd, Subscription).
  IconquerCLI's PlayRunner already has a working game loop. Adopting
  App+MVU would require rewriting the entire game loop as a Component
  with Model/update/view, which is a large refactor for uncertain benefit.
decision: |
  Use SwiftCLIKit's rendering pipeline (CellBuffer, DiffRenderer, Frame,
  Layout) and widgets (Tree, Menu, Block, Paragraph) directly from the
  existing PlayRunner game loop. Do NOT adopt App+MVU for v0.5.0.
  The game loop calls render functions imperatively each frame.
  App+MVU migration is deferred to the "amazing" tier.
rationale: |
  - Lower risk: existing game loop is tested and working
  - Incremental adoption: widgets can be used without the framework
  - Clear upgrade path: when App+MVU is needed, PlayRunner becomes
    a Component with the same widgets
consequences: |
  + Smaller diff, lower risk for v0.5.0
  + Existing PlayRunner tests remain valid with minimal changes
  - No automatic re-render on state change (must call render manually)
  - No subscription-based event routing (must poll KeyReader manually)
  - Future App+MVU migration will require rewriting PlayRunner
alternatives_rejected:
  - "Full App+MVU adoption: Too large a refactor for v0.5.0; game loop
    would need complete rewrite as Component.update()"
  - "Keep string-based rendering: Misses the entire point of SwiftCLIKit"
affected_files:
  - Sources/IconquerCLILib/TUIRenderer.swift
  - Sources/IconquerCLILib/PlayRunner.swift
  - Sources/iconquer-cli/IconquerCLICommand.swift
supersedes: null
amends: ADR-009
superseded_by: null
```

---

## 10. Open Questions

1. **Tree default state: expanded or collapsed?** For the world map (42 countries, 6 continents), should all continents start expanded (all countries visible, requires scrolling) or collapsed (continent headers only, user expands as needed)? **Recommendation:** Start expanded for small maps (<= 12 countries), collapsed for larger maps.

2. **Mouse mode default: on or off?** Some terminal emulators (especially over SSH) handle mouse mode poorly. Should `--tui` enable mouse by default, or require `--mouse` to opt in? **Recommendation:** On by default with `--no-mouse` to opt out, matching the spec above.

3. **Scoreboard renderer deprecation:** The existing `Renderer` (non-TUI scoreboard mode) is still used by `simulate`, `tournament`, and non-`--tui` `play`. Should v0.5.0 deprecate it, keep it as-is, or rewrite it using SwiftCLIKit too? **Recommendation:** Keep as-is. The scoreboard renderer is deterministic and used in test assertions. Rewriting it risks breaking simulate/tournament output.

4. **Accessibility without AccessibleWidget protocol:** SwiftCLIKit v1.8.0 plans an `AccessibleWidget` protocol. For v0.5.0, accessibility labels are generated in IconquerCLI-specific code (`AccessibilityLabels.swift`). When v1.8.0 ships, should we migrate to the protocol or keep the custom implementation? **Recommendation:** Migrate when v1.8.0 ships; design `AccessibilityLabels` to make migration straightforward by matching the expected protocol shape.

5. **Theme integration:** SwiftCLIKit v1.0.0 ships `Theme` and `ThemeLoader`. Should the `CLISettings.theme` setting load a SwiftCLIKit `Theme` for semantic colors (border, highlight, disabled, etc.), or should v0.5.0 hardcode a single theme? **Recommendation:** Support a single "default" theme initially, with the `theme` setting wired up so users can switch when additional themes are added.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Narrative Article

**Complexity Threshold Check:**
- Does it combine 3+ APIs? **Yes** -- CellBuffer, DiffRenderer, Layout, Frame, Tree, Menu, Block, Color, ColorNegotiation, AlternateScreen, RawTerminal, KeyReader, MouseMode, TestBackend, SnapshotTesting
- Does explanation require 50+ lines? **Yes**
- Does it need theory/background context? **Yes** -- terminal rendering pipeline, immediate-mode widget pattern, accessibility model

**Article Name:** `IconquerCLITUIGuide.md`

**Scope:**
- Overview of the widget-based TUI architecture
- How `GameLayout` splits the screen into panels
- How `GameTreeDataSource` maps game state to tree nodes
- How `ActionMenu` builds phase-contextual menus
- How `DiffRenderer` provides flicker-free updates
- How mouse and keyboard input flow through `PlayRunner`
- How to run TUI integration tests with `TestBackend` + `SnapshotTesting`
- Accessibility label conventions

**DocC comments:** All public types and functions in the 4 new files get full DocC documentation with parameter descriptions, examples, and cross-references to SwiftCLIKit types.

---

## Implementation Order

The recommended implementation sequence follows TDD (red/green/refactor) across 8 steps:

| Step | Files | What | Dependencies |
|------|-------|------|-------------|
| 1 | `Package.swift` | Add SwiftCLIKit dependency, verify SPM resolution | SwiftCLIKit v1.0.0 published |
| 2 | `GameLayout.swift` + tests | Layout constraint builder; pure function, easy to test | Step 1 |
| 3 | `AccessibilityLabels.swift` + tests | Pure string functions, no dependencies | Step 1 |
| 4 | `GameTreeDataSource.swift` + tests | Tree node builder from GameSnapshot | Steps 1-2 |
| 5 | `ActionMenu.swift` + tests | Menu builder from GameSnapshot phase | Steps 1-2 |
| 6 | `TUIRenderer.swift` rewrite + snapshot tests | Wire up CellBuffer + DiffRenderer + widgets | Steps 2-5 |
| 7 | `PlayRunner.swift` TUI integration | RawTerminal + KeyReader + MouseMode input loop | Step 6 |
| 8 | `IconquerCLICommand.swift` lifecycle | AlternateScreen, ColorNegotiation, CLI flags | Step 7 |

Steps 2-5 can be parallelized across agents (they are independent pure-function modules with their own test targets).
