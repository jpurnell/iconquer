# Design Proposal: IconquerCLI v0.5.0 — Combined TUI Rewrite

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Full MVU architecture rewrite replacing PlayRunner, widget-based rendering with all SwiftCLIKit v1.0.0 widgets, component architecture, theme support, syntax-highlighted history, data visualization, accessibility via SwiftCLIKit v1.8.0, scoreboard rewrite with CellBuffer
**Supersedes:** `IconquerCLI_v050_MustHave.md`, `IconquerCLI_v060_Amazing.md`

---

## 1. Objective

**Objective:** Replace the entire IconquerCLI interactive layer -- PlayRunner game loop, TUIRenderer string concatenation, and Renderer scoreboard -- with a clean MVU architecture built on SwiftCLIKit's `App<GameModel, GameMessage>` framework, composing all available widgets (Tree, Table, Menu, Tabs, Gauge, Sparkline, BarChart, Scrollbar, Block, Paragraph) into a component-based panel system with focus management, theme support, syntax-highlighted move history, full mouse interaction, and accessibility via the AccessibleWidget protocol from SwiftCLIKit v1.8.0.

**Master Plan Reference:** Phase 2/3 -- CLI polish, combined "must-have" and "amazing" tiers into a single release.

**Problems solved:**

1. **Full-screen flicker.** The current renderer clears the entire screen (`\e[2J`) and rewrites every character on every frame. CellBuffer + DiffRenderer emits only changed cells, eliminating flicker during game state transitions.

2. **Imperative game loop is fragile.** PlayRunner manually manages render/input/state transitions with interleaved mutation and I/O. A single pure `gameUpdate` function with `GameMessage` makes every state transition explicit, testable, and composable.

3. **Manual column math.** `TUIRenderer.render()` manually calculates `boardWidth = termWidth - sidebarWidth - 3`. Constraint-based `Layout.split()` replaces all manual arithmetic with declarative constraints.

4. **Flat country list.** The 42-country world map renders as an unsorted list. A `Tree<CountryNode>` grouped by continent with expand/collapse (expanded by default) makes it scannable.

5. **Text prompt for actions.** The current text REPL (`> attack A B`) requires memorizing commands. A `Menu` widget with phase-contextual items and key hints provides discoverability.

6. **Single-view bottleneck.** Players need multiple perspectives: sortable stats, move history, card hand. Tabs with Tree, Table, History, and Cards views provide switching without screen clutter.

7. **No at-a-glance dominance indicators.** Players must count countries mentally. Gauges, sparklines, and bar charts provide instant visual feedback on territory control and army strength trends.

8. **Move history is plain text.** A syntax-highlighted, color-coded history log with a custom move tokenizer makes it easy to scan for attacks, placements, and fortifications at a glance.

9. **8-color palette only.** `hexToAnsi()` maps 6 hardcoded hex values to ANSI-8. `Color.fromHex()` + `ColorNegotiation` provides truecolor with automatic downsampling.

10. **Terminal scrollback destroyed.** The clear-screen approach wipes the user's scrollback. `AlternateScreen` preserves it.

11. **No mouse support.** All interaction is keyboard-only. Full mouse support (click countries, menus, tabs, scrollbars) enables intuitive two-click workflows.

12. **No accessibility.** Screen reader users get raw ANSI noise. The AccessibleWidget protocol from SwiftCLIKit v1.8.0 provides semantic labels on all interactive elements.

13. **No panel focus management.** Keyboard navigation between sidebar, board, and action areas requires a FocusManager with clear visual indicators and Tab/Shift-Tab cycling.

14. **Monolithic rendering.** One large view function. Component architecture allows each panel (Sidebar, Board, History, Cards, ActionMenu) to be developed, tested, and maintained independently.

15. **Scoreboard renderer is 160 lines of manual ANSI.** Rewritten to ~40 lines using CellBuffer + Table widget + `renderPlainText()`.

---

## 2. Proposed Architecture

### Deleted Files

```
Sources/IconquerCLILib/
  PlayRunner.swift              -- DELETED: replaced by App+MVU (GameApp)
  TUIRenderer.swift             -- DELETED: replaced by widget-based GameView + Components
  Renderer.swift                -- DELETED: replaced by ScoreboardRenderer using CellBuffer
```

### New Files

```
Sources/IconquerCLILib/
├── App/
│   ├── GameApp.swift               -- Creates App<GameModel, GameMessage>, entry point
│   ├── GameModel.swift             -- Complete game + UI state
│   ├── GameMessage.swift           -- All user/system messages (~25 cases)
│   ├── GameUpdate.swift            -- Pure update function
│   └── GameView.swift              -- Pure view function composing all panels
├── Components/
│   ├── SidebarComponent.swift      -- Player stats, gauges, sparklines
│   ├── BoardComponent.swift        -- Tree/table with tab switching
│   ├── HistoryComponent.swift      -- Syntax-highlighted move history
│   ├── CardComponent.swift         -- Card hand and turn-in selection
│   └── ActionMenuComponent.swift   -- Phase-contextual action menu
└── Support/
    ├── GameTreeDataSource.swift    -- Builds Tree<Country> from MapDefinition + GameSnapshot
    ├── GameLayout.swift            -- Layout constraints for screen panels
    ├── GameTheme.swift             -- Default theme with extensive documentation
    ├── MoveTokenizer.swift         -- Custom syntax highlighter for game moves
    └── ScoreboardRenderer.swift    -- Non-TUI mode using CellBuffer + renderPlainText()
```

### Modified Files

```
Sources/IconquerCLILib/
  CLISettings.swift                 -- Add theme name, mouse enable flag
Sources/iconquer-cli/
  IconquerCLICommand.swift          -- AlternateScreen lifecycle, GameApp entry, theme/mouse flags
```

### Architecture Diagram

```
IconquerCLICommand
    |
    +-- AlternateScreen (RAII)
    +-- RawTerminal (RAII)
    +-- ColorNegotiation.detect() -> ColorCapability
    +-- MouseMode.enable (enabled by default)
    |
    +-- GameApp.run(...)
         |
         +-- App<GameModel, GameMessage>
              |
              +-- Subscriptions:
              |    +-- Resize -> .resized(w, h)
              |    +-- AI turn -> .opponentMoved(move) (batch moves, animate per-move)
              |    +-- Status timer -> .statusDismissed
              |
              +-- gameUpdate(model, message) -> (model, Cmd)
              |    Pure function. Dispatches on ~25 GameMessage cases.
              |    All state transitions explicit and testable.
              |
              +-- gameView(model) -> Frame
                   Composes all Components:
                   |
                   +-- GameLayout.build(terminalSize) -> panel rects
                   +-- SidebarComponent.view(...)  -- gauges, sparklines
                   +-- BoardComponent.view(...)    -- tabs: tree/table/history/cards
                   +-- ActionMenuComponent.view(...)
                   +-- FocusManager              -- Tab/Shift-Tab panel cycling
                   +-- GameTheme                 -- semantic colors

Non-TUI path:
  ScoreboardRenderer.render(snapshot) -> String
    CellBuffer + Table widget + renderPlainText()
    ~40 lines replacing ~160 from old Renderer.swift
```

### Layout Structure

```
+--[ iConquer v0.5.0 ]-------------------------------------------+
|                    | [ Map | Stats | History | Cards ]          |
| P1 Human    12/42 |                                             |
| ||||||||..  29%   | (active tab content fills this area)        |
| _^#%#^#^_         |                                             |
|                    |   Tree view (Map tab):                      |
| P2 AI       18/42 |   v North America (+5)                      |
| |||||||||||| 43%  |     Alaska [P2] ###                         |
| ^#%##%#^_         |     Northwest Territory [P2] ##              |
|                    |     ...                                     |
| P3 AI       12/42 |   > South America (+2)                      |
| ||||||||..  29%   |   v Europe (+5)                             |
| %#^__^#%          |     ...                                     |
|                    |                                             |
+----[Actions]-------+---------------------------------------------+
| Attack             |                                             |
| Finish Attacks     |                                             |
| Fortify            |                                             |
| End Turn           |                                             |
+--------------------+---------------------------------------------+
| Attack Phase | Select source country (Tab: panel, Q: quit)      |
+----------------------------------------------------------------+
```

### Key Architectural Decisions

1. **Full MVU rewrite.** `App<GameModel, GameMessage>` replaces PlayRunner entirely. No backward compatibility wrapper -- PlayRunner is deleted.

2. **Component architecture.** Each panel (Sidebar, Board, History, Cards, ActionMenu) is a separate Component with its own model slice, message type, update, and view functions. Messages map to parent GameMessage.

3. **FocusManager** handles Tab/Shift-Tab cycling between panels with visual focus ring.

4. **Single default theme** shipped, but architecture supports multiple themes. The default theme is documented extensively (color purposes, contrast ratios, semantic meaning) so future themes can be built.

5. **Accessibility via AccessibleWidget protocol** from SwiftCLIKit v1.8.0 -- NOT custom a11y code in IconquerCLI. This creates a hard dependency: SwiftCLIKit v1.8.0 must ship before IconquerCLI v0.5.0.

6. **AI moves: batch + animate.** AI turns produce moves in batch, then animate per-move with short delays so the human can watch the AI's turn unfold step by step.

7. **Sparkline history depth: 20 turns.** Configurable via CLISettings.

8. **Mouse enabled by default** with `--no-mouse` opt-out. Full scope: click countries, menus, tabs, scrollbars.

9. **Tree expanded by default.** All continent nodes start expanded.

10. **Table columns auto-sized** based on content with minimum widths.

---

## 3. API Surface

### 3a. GameModel

```swift
/// Complete game + UI state for the MVU architecture.
/// This is the single source of truth for all rendering decisions.
public struct GameModel: Sendable {
    // --- Game state (from IconquerCore/IconquerMatch) ---
    public var game: Game
    public var matchState: MatchState
    public var moveHistory: [HistoryEntry]
    public var turnNumber: Int

    // --- UI state ---
    public var activeTab: Tab
    public var selectedCountry: CountryId?
    public var attackSource: CountryId?
    public var focusedPanel: PanelId
    public var menuSelection: Int
    public var treeState: TreeState                // All continents expanded by default
    public var tableState: TableState              // Sort column, direction, scroll
    public var scrollPositions: [PanelId: Int]     // Per-panel scroll offsets
    public var cardSelection: Set<Int>             // Selected card indices for turn-in

    // --- Display state ---
    public var terminalSize: TerminalSize
    public var theme: GameTheme
    public var statusMessage: String?
    public var statusExpiry: ContinuousClock.Instant?
    public var opponentThinking: Bool

    // --- Historical data for visualization ---
    public var armyHistory: [PlayerId: [Int]]      // Last 20 turns per player
    public var territoryHistory: [PlayerId: [Int]]

    // --- Derived (computed) ---
    public var currentPlayer: Player { get }
    public var currentPhase: TurnPhase { get }
    public var playerSummaries: [PlayerSummary] { get }
    public var isGameOver: Bool { get }
}

/// Identifies which tab is active in the main board area.
public enum Tab: String, Sendable, CaseIterable {
    case map        // Tree widget with continent grouping
    case stats      // Table widget with sortable country data
    case history    // Move history with syntax highlighting
    case cards      // Card hand and turn-in selection
}

/// Identifies focusable panels for keyboard navigation.
public enum PanelId: String, Sendable, CaseIterable {
    case sidebar
    case board
    case actionMenu
    case statusBar
}

/// Sortable columns in the stats table.
public enum TableColumn: String, Sendable, CaseIterable {
    case country, continent, owner, armies, neighbors, bonus
}

/// A single entry in the move history log.
public struct HistoryEntry: Sendable {
    public let turn: Int
    public let player: PlayerId
    public let move: GameMove
    public let timestamp: ContinuousClock.Instant
}

/// Summary statistics for a single player, derived from GameModel.
public struct PlayerSummary: Sendable {
    public let player: Player
    public let territoryCount: Int
    public let totalArmies: Int
    public let territoryRatio: Double              // 0.0...1.0
    public let continentsOwned: [String]
    public let armyTrend: [Int]                    // Last 20 turns
}
```

### 3b. GameMessage

```swift
/// Union of all user and system actions that can modify GameModel.
/// Every interaction flows through this enum -- no side-channel mutations.
public enum GameMessage: Sendable {
    // --- Input events ---
    case keyPressed(Key)
    case mouseClicked(MouseEvent)
    case resized(width: Int, height: Int)

    // --- Navigation ---
    case switchTab(Tab)
    case focusPanel(PanelId)
    case focusNext
    case focusPrevious
    case scrollUp(PanelId, lines: Int)
    case scrollDown(PanelId, lines: Int)

    // --- Board interaction ---
    case selectCountry(CountryId)
    case deselectCountry
    case toggleContinent(String)
    case sortTable(TableColumn)

    // --- Game actions ---
    case attack(from: CountryId, to: CountryId)
    case place(country: CountryId, count: Int)
    case fortify(from: CountryId, to: CountryId, count: Int)
    case endAttacks
    case endTurn
    case turnInCards(indices: Set<Int>)
    case toggleCardSelection(Int)

    // --- AI / async ---
    case opponentMoved(GameMove)
    case opponentThinking
    case opponentFinished

    // --- System ---
    case statusDismissed
    case quit
}
```

### 3c. GameUpdate (pure function)

```swift
/// Pure update function. No side effects -- all async work returns as Cmd values.
///
/// ## Example
/// ```swift
/// let (newModel, cmd) = gameUpdate(model, .switchTab(.stats))
/// // newModel.activeTab == .stats
/// // cmd == .none
/// ```
public func gameUpdate(
    _ model: GameModel,
    _ message: GameMessage
) -> (GameModel, Cmd<GameMessage>)
```

Key update behaviors:

| Message | Model change | Cmd |
|:---|:---|:---|
| `.keyPressed(.tab)` | Advance `focusedPanel` via FocusManager | `.none` |
| `.switchTab(.stats)` | Set `activeTab = .stats` | `.none` |
| `.selectCountry(id)` | Set `selectedCountry`; if `attackSource` set and valid target, prepare attack | `.none` |
| `.attack(from, to)` | Apply attack to `game`, append to `moveHistory`, update `armyHistory` | `.none` (or `.task` if AI responds) |
| `.endTurn` | Advance turn in `game`, record history snapshot | `.task { .opponentThinking }` if next player is AI |
| `.opponentThinking` | Set `opponentThinking = true` | `.task { await aiBatchMoves(model) }` returning sequence of `.opponentMoved` |
| `.opponentMoved(move)` | Apply move to `game`, append history, animate; set `opponentThinking = false` on last move | `.none` or chain next AI move animation |
| `.resized(w, h)` | Update `terminalSize` | `.none` |
| `.sortTable(col)` | Toggle `tableSortAscending` if same column, else set new column ascending | `.none` |
| `.mouseClicked(event)` | Translate to equivalent message: selectCountry, switchTab, menuAction, scrollbar | Depends on translated message |
| `.quit` | No model change | `.quit` |

### 3d. GameView (pure function)

```swift
/// Pure view function. Composes all Components into a single Frame from GameModel.
/// No side effects, no I/O -- returns a declarative description of what to render.
public func gameView(_ model: GameModel) -> Frame
```

### 3e. GameApp (entry point)

```swift
/// Creates and runs the MVU game application.
///
/// ## Example
/// ```swift
/// let outcome = try await GameApp.run(
///     game: game,
///     players: players,
///     aiStrategies: strategies,
///     theme: .default
/// )
/// ```
public enum GameApp {
    /// Run the game TUI. Returns the final PlayOutcome when the game ends or user quits.
    public static func run(
        game: Game,
        players: [Player],
        aiStrategies: [PlayerId: any Strategy],
        theme: GameTheme = .default,
        mouseEnabled: Bool = true,
        backend: (any TerminalBackend)? = nil   // nil = real terminal; inject TestBackend for tests
    ) async throws -> PlayOutcome
}
```

### 3f. Subscriptions

```swift
/// Subscriptions that produce GameMessages from external sources.
public func gameSubscriptions(_ model: GameModel) -> [Subscription<GameMessage>] {
    var subs: [Subscription<GameMessage>] = []

    // Terminal resize events
    subs.append(.resize { width, height in
        .resized(width: width, height: height)
    })

    // AI opponent: batch moves, animate per-move
    if model.opponentThinking, let aiPlayer = model.currentAIPlayer {
        subs.append(.task(id: "ai-\(aiPlayer.id)") {
            let moves = await aiPlayer.strategy.allMovesForTurn(model.game)
            // Return moves one at a time with animation delay
            for move in moves {
                return .opponentMoved(move)
            }
            return .opponentFinished
        })
    }

    // Auto-dismiss status messages
    if let expiry = model.statusExpiry {
        subs.append(.timer(id: "status-dismiss", deadline: expiry) {
            .statusDismissed
        })
    }

    return subs
}
```

### 3g. Component Interfaces

```swift
/// Sidebar component: player summaries with gauges and sparklines.
public struct SidebarComponent: Sendable {
    public struct Model: Sendable {
        public var players: [PlayerSummary]
        public var theme: GameTheme
        public var height: Int
        public var scrollOffset: Int
    }

    public enum Message: Sendable {
        case scrollUp(Int)
        case scrollDown(Int)
    }

    public static func update(_ model: Model, _ message: Message) -> Model
    public static func view(_ model: Model, frame: Frame)
    public static func toParent(_ message: Message) -> GameMessage
}

/// Board component: tab-switched main content area (tree, table, history, cards).
public struct BoardComponent: Sendable {
    public struct Model: Sendable {
        public var activeTab: Tab
        public var game: Game
        public var selectedCountry: CountryId?
        public var attackSource: CountryId?
        public var treeState: TreeState
        public var tableState: TableState
        public var scrollPositions: [Tab: Int]
        public var moveHistory: [HistoryEntry]
        public var cardHand: [Card]
        public var cardSelection: Set<Int>
        public var theme: GameTheme
    }

    public enum Message: Sendable {
        case switchTab(Tab)
        case selectCountry(CountryId)
        case toggleContinent(String)
        case sortTable(TableColumn)
        case scrollUp(Int)
        case scrollDown(Int)
        case toggleCard(Int)
    }

    public static func update(_ model: Model, _ message: Message) -> Model
    public static func view(_ model: Model, frame: Frame)
    public static func toParent(_ message: Message) -> GameMessage
}

/// History component: syntax-highlighted move log with custom MoveTokenizer.
public struct HistoryComponent: Sendable {
    public struct Model: Sendable {
        public var entries: [HistoryEntry]
        public var scrollOffset: Int
        public var theme: GameTheme
    }

    public enum Message: Sendable {
        case scrollUp(Int)
        case scrollDown(Int)
    }

    public static func update(_ model: Model, _ message: Message) -> Model
    public static func view(_ model: Model, frame: Frame)
    public static func toParent(_ message: Message) -> GameMessage
}

/// Card component: hand display with turn-in selection.
public struct CardComponent: Sendable {
    public struct Model: Sendable {
        public var cards: [Card]
        public var selectedIndices: Set<Int>
        public var canTurnIn: Bool
        public var theme: GameTheme
    }

    public enum Message: Sendable {
        case toggleSelection(Int)
        case confirmTurnIn
    }

    public static func update(_ model: Model, _ message: Message) -> Model
    public static func view(_ model: Model, frame: Frame)
    public static func toParent(_ message: Message) -> GameMessage
}

/// Action menu component: phase-contextual game commands.
public struct ActionMenuComponent: Sendable {
    public enum Action: String, Sendable, CaseIterable {
        case attack         = "Attack"
        case finishAttacks  = "Finish Attacks"
        case fortify        = "Fortify"
        case endTurn        = "End Turn"
        case cards          = "Cards"
        case pick           = "Pick Country"
        case place          = "Place Armies"
    }

    public static func build(
        snapshot: GameSnapshot,
        humanSeat: PlayerId
    ) -> (menu: Menu, actions: [Action])
}
```

### 3h. GameTreeDataSource

```swift
/// Builds a Tree<CountryNode> from game state, grouped by continent.
public enum GameTreeDataSource {

    /// A node in the game country tree.
    public struct CountryNode: Sendable, Equatable {
        public let countryId: String
        public let ownerId: PlayerId?
        public let ownerColor: String?
        public let armies: Int
        public let neighborCount: Int
    }

    /// Build tree roots from a map definition and game snapshot.
    ///
    /// Each root is a continent node whose label includes the bonus:
    /// `"North America (+5)"`. Children are countries sorted alphabetically.
    /// All continents start expanded by default.
    public static func buildRoots(
        map: MapDefinition,
        snapshot: GameSnapshot,
        capability: ColorCapability
    ) -> [Tree<CountryNode>.TreeNode]

    /// Render a single country node as display text for the tree.
    ///
    /// Format: `"Brazil [P1] ***** (5)"` with owner color applied.
    public static func renderNode(
        _ node: CountryNode,
        capability: ColorCapability
    ) -> String
}
```

### 3i. GameLayout

```swift
/// Layout configuration for the game TUI screen.
public enum GameLayout {

    public enum Panel: Int, CaseIterable {
        case board = 0
        case sidebar
        case actionMenu
        case status
    }

    public struct Config: Sendable {
        public var sidebarMinWidth: Int
        public var bottomBarHeight: Int
        public var sidebarWidthPercent: UInt16
        public var actionMenuHeight: Int

        public static let defaults = Config(
            sidebarMinWidth: 30,
            bottomBarHeight: 3,
            sidebarWidthPercent: 30,
            actionMenuHeight: 6
        )
    }

    /// Compute panel rectangles for the given terminal size.
    public static func build(
        terminalSize: TerminalSize,
        config: Config = .defaults
    ) -> [Panel: Rect]
}
```

### 3j. GameTheme

```swift
/// Game-specific theme with extensive documentation for future theme authors.
///
/// ## Color Purposes
/// Each color slot has a documented semantic meaning:
/// - `borderColor`: Panel borders and dividers. Should contrast with `background`.
///   Default: dim white. Contrast ratio vs background: >= 3:1.
/// - `focusBorderColor`: Border of the focused panel. Must be clearly distinct from `borderColor`.
///   Default: bright cyan. Contrast ratio vs background: >= 4.5:1.
/// - `headerColor`: Panel titles, tab labels, section headers.
///   Default: bold white. Contrast ratio vs background: >= 7:1.
/// - `textColor`: Body text, country names, menu items.
///   Default: white. Contrast ratio vs background: >= 4.5:1.
/// - `dimTextColor`: Secondary text, disabled menu items, hints.
///   Default: gray. Contrast ratio vs background: >= 3:1.
/// - `highlightColor`: Selected/hovered item background.
///   Default: dark blue. Must contrast with `textColor` at >= 4.5:1.
/// - `playerColors`: Array of 6 colors for players P1-P6. Each must be distinguishable
///   from all others and readable against both `background` and `highlightColor`.
///   Default: [red, blue, green, yellow, magenta, cyan].
/// - `attackColor`: History highlight for attack moves. Default: bright red.
/// - `placementColor`: History highlight for placements. Default: bright green.
/// - `fortifyColor`: History highlight for fortify moves. Default: bright blue.
/// - `cardTurnInColor`: History highlight for card turn-ins. Default: bright yellow.
/// - `gaugeFilledColor`: Filled portion of territory gauges. Default: matches player color.
/// - `gaugeEmptyColor`: Empty portion of territory gauges. Default: dark gray.
/// - `activeTabBg`: Background of the active tab label. Default: matches `highlightColor`.
/// - `inactiveTabFg`: Foreground of inactive tab labels. Default: `dimTextColor`.
///
/// ## Creating a New Theme
/// 1. Copy `GameTheme.default` and modify color slots.
/// 2. Verify contrast ratios meet WCAG AA (4.5:1 for text, 3:1 for large text/borders).
/// 3. Test with `ColorCapability.basic` downsampling -- 8-color palette must still be usable.
/// 4. Test with `NO_COLOR=1` -- all semantic meaning must survive without color.
public struct GameTheme: Sendable {
    public var base: Theme

    // Chrome
    public var borderColor: Color
    public var focusBorderColor: Color
    public var headerColor: Color
    public var textColor: Color
    public var dimTextColor: Color
    public var highlightColor: Color

    // Players
    public var playerColors: [Color]

    // Move history syntax
    public var attackColor: Color
    public var placementColor: Color
    public var fortifyColor: Color
    public var cardTurnInColor: Color

    // Gauges
    public var gaugeFilledColor: Color
    public var gaugeEmptyColor: Color

    // Tabs
    public var activeTabFg: Color
    public var activeTabBg: Color
    public var inactiveTabFg: Color
    public var inactiveTabBg: Color

    /// The single default theme shipped with v0.5.0.
    /// See documentation above for contrast ratios and semantic meanings.
    public static let `default`: GameTheme
}
```

### 3k. MoveTokenizer

```swift
/// Custom syntax tokenizer for iConquer move notation.
/// Used by HistoryComponent for color-coded move rendering.
///
/// Token mapping:
/// - `.keyword`  -> action words (ATTACK, PLACE, FORTIFY, TURN-IN)
/// - `.number`   -> army counts, dice rolls
/// - `.variable` -> country names
/// - `.type`     -> player names
/// - `.operator` -> arrows (->), separators
/// - `.comment`  -> result annotations (CONQUERED, ELIMINATED)
///
/// ## Example
/// ```
/// "P1 ATTACK Alaska -> Kamchatka [3v2] WON"
///  ^  ^^^^^^ ^^^^^^    ^^^^^^^^^  ^^^  ^^^
///  |  keyword variable  variable  num  comment
///  type
/// ```
public struct MoveTokenizer: LanguageTokenizer {
    public func tokenize(_ line: String) -> [Token]
}
```

### 3l. ScoreboardRenderer

```swift
/// Non-TUI scoreboard renderer using CellBuffer + Table widget + renderPlainText().
/// Replaces the old ~160-line Renderer.swift with ~40 lines.
///
/// Used by `simulate`, `tournament`, and non-`--tui` `play` modes.
public enum ScoreboardRenderer {

    /// Render a game snapshot as plain text suitable for piped/non-interactive output.
    ///
    /// Uses CellBuffer internally to compose a Table widget, then calls
    /// `renderPlainText()` to produce a string without ANSI escape codes.
    public static func render(
        snapshot: GameSnapshot,
        map: MapDefinition
    ) -> String
}
```

### 3m. Modified CLISettings

```swift
// Additions to existing CLISettings struct:
extension CLISettings {
    /// The active theme name. Persisted to disk. Default: "default".
    /// Toggleable in-game via key binding or via `--theme` CLI flag.
    public var themeName: String  // default: "default"

    /// Whether mouse input is enabled in TUI mode. Default: true.
    public var mouseEnabled: Bool  // default: true

    /// Number of turns of history to display in sparklines. Default: 20.
    public var sparklineDepth: Int  // default: 20
}
```

### 3n. Modified IconquerCLICommand

```swift
struct Play: AsyncParsableCommand {
    // ... existing flags ...

    @Flag(help: "Disable mouse input in TUI mode.")
    var noMouse: Bool = false

    @Option(name: .long, help: "Theme name for TUI mode.")
    var theme: String = "default"

    func run() async throws {
        let capability = ColorNegotiation.detect()
        var cliSettings = CLISettings.load()
        cliSettings.mouseEnabled = !noMouse
        cliSettings.themeName = theme

        if tui {
            let screen = AlternateScreen()
            _ = screen  // keep alive (RAII)

            let gameTheme = GameTheme.named(cliSettings.themeName) ?? .default

            let outcome = try await GameApp.run(
                game: game,
                players: players,
                aiStrategies: strategies,
                theme: gameTheme,
                mouseEnabled: cliSettings.mouseEnabled
            )
            // ... handle outcome ...
        } else {
            // Non-TUI: ScoreboardRenderer
            let output = ScoreboardRenderer.render(
                snapshot: game.snapshot(),
                map: mapDef
            )
            print(output)
        }
    }
}
```

---

## 4. MCP Schema

Not applicable. The TUI is a local-only interactive interface. Game actions flow through `GameMessage`, which is internal to the app. AI opponents interact via the existing `Strategy` protocol in IconquerAI, not via MCP. The existing IconquerMCP server (from Phase 2 v0.2.x) provides the machine-readable game interface.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | `GameModel` properties are all non-optional or use safe Optional access. Country lookups use `game.country(id:)` which returns Optional. Card indices are bounds-checked before access. `Color.fromHex()` returns are optional-checked. |
| **No `try!` or `as!`** | Theme loading uses `try`/`throws`. AI strategy calls use `await` with error handling via `Cmd.task`. No downcasting in the proposal. |
| **Guard clauses** | `gameUpdate` guards invalid state transitions (e.g., attack during placement phase). Country selection guards existence. Card turn-in guards valid set size. `GameLayout.build()` guards `terminalSize.columns > 0` and `terminalSize.rows > 0`. |
| **Division safety** | `PlayerSummary.territoryRatio` guards `totalTerritories == 0` (returns 0.0). Gauge percentage guards zero denominator. Layout percentage constraints handled by `Layout.split()` which guards internally. |
| **Sendable** | `GameModel` is a value type (`struct`) -- automatically Sendable. `GameMessage` is an enum with Sendable payloads. All Component models are Sendable value types. `GameTheme` is a Sendable struct. No `@unchecked Sendable` needed. |
| **Pointer safety** | No `withUnsafe*` blocks. All rendering goes through SwiftCLIKit's safe CellBuffer subscript API. |
| **Concurrency** | AI moves run as `Cmd.task` -- async, non-blocking, automatically cancelled on quit. No `DispatchQueue` usage. `App` event loop handles all message sequencing. No actors introduced. |
| **No hardcoded constants** | Sidebar width, bottom bar height, sparkline depth, scroll step, action menu height, tab order all configurable via `GameLayout.Config`, `CLISettings`, or `GameTheme`. Player hex colors come from `GameTheme.playerColors`. |
| **Recursion safety** | `GameTreeDataSource.buildRoots()` iterates flat continent/country arrays -- no recursive tree traversal. Tree widget handles rendering recursion internally with depth limit. |

---

## 6. Backend Abstraction

Not applicable. No compute-intensive operations. The MVU render loop is driven by SwiftCLIKit's `App` framework, which already abstracts the terminal backend via `TerminalBackend` protocol (real vs. `TestBackend`). All rendering is character-cell manipulation bounded by terminal size (typically < 20,000 cells).

---

## 7. Dependencies

### Internal Dependencies

| Package | Version | What it provides |
|:---|:---|:---|
| **SwiftCLIKit** | v1.8.0 | App, Cmd, Subscription, Component, FocusManager, CellBuffer, DiffRenderer, Layout, Frame, Rect, Tree, TreeState, Table, TableState, Menu, Tabs, Gauge, Sparkline, BarChart, Scrollbar, Block, Paragraph, Color, ColorNegotiation, ColorCapability, AlternateScreen, RawTerminal, KeyReader, Key, MouseMode, MouseEvent, TerminalSize, CellStyle, Theme, SyntaxHighlighter, LanguageTokenizer, AccessibleWidget, TestBackend, SnapshotTesting, renderPlainText |
| **IconquerCore** | existing | Game, GameSnapshot, GameMove, MapDefinition, Country, Continent, Player, PlayerId, Card, TurnPhase, Settings |
| **IconquerMatch** | existing | MatchRunner, MatchState, PlayOutcome |
| **IconquerAI** | existing | Strategy protocol, PlayerAgent, AgentFactory |

### External Dependencies

| Dependency | Version | Used For |
|:---|:---|:---|
| `swift-argument-parser` | >= 1.5.0 | CLI flags (`--no-mouse`, `--theme`) |

### Hard Dependency Chain

```
SwiftCLIKit v1.8.0 (AccessibleWidget) MUST ship FIRST
    |
    v
IconquerCLI v0.5.0 (this proposal)
```

SwiftCLIKit v1.0.0 (all other widgets/framework features) is already shipped.

### Package.swift

```swift
.package(path: "../SwiftCLIKit"),
```

Added to `IconquerCLILib` target:
```swift
.product(name: "SwiftCLIKit", package: "SwiftCLIKit"),
```

---

## 8. Test Strategy

### 1. GameUpdate pure function tests

Every `GameMessage` case has at least one test verifying model mutation and returned `Cmd`. All tests are deterministic: same model + same message = same result.

- **Tab switching:** `.switchTab(.stats)` -> `model.activeTab == .stats`, cmd == `.none`
- **Focus cycling:** `.focusNext` x4 -> cycles through all PanelId values in order; `.focusPrevious` reverses
- **Country selection:** `.selectCountry("Brazil")` -> `model.selectedCountry == "Brazil"`
- **Attack flow:** select source, then `.selectCountry(target)` -> model has attackSource + selectedCountry; `.attack(from, to)` -> moveHistory grows, armyHistory updated
- **Invalid transitions:** `.attack(from, to)` during placement phase -> model unchanged, cmd == `.none`
- **End turn with AI:** `.endTurn` when next player is AI -> `cmd == .task(...)`, triggers `.opponentThinking`
- **Table sorting:** `.sortTable(.armies)` -> ascending; again -> descending; `.sortTable(.continent)` -> ascending on new column
- **Card selection:** `.toggleCardSelection(0)` x3 cards -> `cardSelection.count == 3`; `.turnInCards(indices:)` -> cards removed, armies added
- **Resize:** `.resized(80, 24)` -> `terminalSize` updated
- **Quit:** `.quit` -> cmd == `.quit`
- **Mouse translation:** `.mouseClicked(event)` at tab bar position -> translates to `.switchTab`; at tree row -> `.selectCountry`; at menu item -> game action; at scrollbar -> `.scrollDown`

### 2. Component unit tests

**SidebarComponent:**
- 3 players with known territory counts -> gauge widths proportional to territory ratio
- Player with 0 territories -> gauge shows empty bar, 0%
- Sparkline with 20 data points -> renders correct trend glyphs
- Scroll up/down within sidebar bounds

**BoardComponent:**
- Tree: toggle continent -> children hidden/shown. Start expanded by default.
- Table: verify row ordering for each sortable column. Auto-sized columns.
- Country selection: selecting highlights in both tree and table views
- Tab bar: clicking tab labels switches active content

**HistoryComponent:**
- Attack entry -> rendered with attackColor and "ATTACK" keyword highlighted
- Placement -> placementColor. Fortify -> fortifyColor. Card turn-in -> cardTurnInColor.
- Auto-scroll to bottom on new entry

**CardComponent:**
- Toggle selection on/off -> correct indices
- Cannot turn in with fewer than 3 selected
- Valid set detection per game rules

**ActionMenuComponent:**
- Placement phase: "Pick Country" and "Place Armies" enabled; "Attack", "Fortify" disabled
- Attack phase: "Attack" and "Finish Attacks" enabled; "Pick Country" disabled
- Fortify phase: "Fortify" and "End Turn" enabled; "Attack" disabled
- Cards available: "Cards" enabled when player has >= 3 cards
- Key hints present: "a" for Attack, "f" for Fortify, "e" for End Turn

### 3. MoveTokenizer tests

- `"P1 ATTACK Alaska -> Kamchatka [3v2] CONQUERED"` -> tokens: type("P1"), keyword("ATTACK"), variable("Alaska"), operator("->"), variable("Kamchatka"), number("[3v2]"), comment("CONQUERED")
- `"P2 PLACE 5 on Brazil"` -> tokens: type("P2"), keyword("PLACE"), number("5"), plain("on"), variable("Brazil")
- `"P1 FORTIFY 3 from Alaska to Kamchatka"` -> tokens: type("P1"), keyword("FORTIFY"), number("3"), plain("from"), variable("Alaska"), plain("to"), variable("Kamchatka")
- `"P3 TURN-IN cards for 10 armies"` -> tokens: type("P3"), keyword("TURN-IN"), plain("cards for"), number("10"), plain("armies")
- Empty string -> empty token array

### 4. GameTreeDataSource tests

- World map: 6 continent roots, each with correct child count (e.g., North America = 9)
- Continent label format: `"North America (+5)"` (not `"North America"`)
- Country node format: `"Brazil [P1] ***** (5)"` with owner color
- All continents expanded by default in initial TreeState
- Duel map (2 countries): 1 continent root, 2 children

### 5. Layout tests (GameLayout)

- Terminal 80x24: board panel ~70% width, sidebar ~30%
- Terminal 40x10 (minimum): all panels have positive dimensions, no crash
- Terminal 200x60 (large): sidebar width capped at readable bounds
- Action menu gets configured height

### 6. ScoreboardRenderer tests

- Known 3-player game snapshot -> output matches expected plain text table
- No ANSI escape codes in output (renderPlainText strips them)
- Column headers present: Country, Owner, Armies

### 7. Full App integration tests (via TestBackend)

**Initial render:**
- Create `TestBackend(width: 120, height: 40)`, inject a known 3-player game.
- Assert buffer contains: tab bar with "Map" active, sidebar with 3 player names and gauges, tree with 6 continent headers (all expanded), action menu with placement options, status bar with phase indicator.

**Attack sequence:**
- Inject `.selectCountry(source)` then `.selectCountry(target)` -> assert model transitions to attack.
- Inject `.attack(from, to)` -> moveHistory grows, tree reflects new army counts.

**Tab switching:**
- `.switchTab(.stats)` -> buffer contains Table headers
- `.switchTab(.history)` -> buffer contains move history entries
- `.switchTab(.cards)` -> buffer contains card hand
- `.switchTab(.map)` -> tree view returns

**AI turn animation:**
- `.endTurn` with AI next -> `opponentThinking == true`
- AI subscription produces batch moves, animated per-move -> each move visible in history
- After all moves: `opponentThinking == false`, no spinner remaining

**Resize:**
- `.resized(80, 24)` -> layout recomputes, all panels fit, no clipping

**Focus ring:**
- `.focusNext` -> focused panel border changes to `focusBorderColor`
- Only focused panel receives keyboard input

**Mouse interaction:**
- Click tree row -> `selectCountry`
- Click tab label -> `switchTab`
- Click menu item -> game action
- Click scrollbar -> scroll
- Click empty area -> no action

**Theme rendering:**
- Default theme applies all documented semantic colors
- `ColorCapability.basic` downsampling -> 8-color palette still usable
- `NO_COLOR=1` -> no color escapes in output

### 8. Snapshot tests (via SnapshotTesting)

- `snapshot_map_tab_3player.txt` -- Map tab, 3-player world game, all expanded
- `snapshot_stats_tab_sorted_armies.txt` -- Stats tab sorted by armies descending
- `snapshot_history_tab_10moves.txt` -- History tab with 10 color-coded entries
- `snapshot_cards_tab_5cards.txt` -- Cards tab, 5 cards, 3 selected
- `snapshot_sidebar_3player.txt` -- Sidebar with gauges and sparklines
- `snapshot_scoreboard_plaintext.txt` -- ScoreboardRenderer non-TUI output

### Validation Trace (REQUIRED)

| Input | Expected Output | Assertion |
|:---|:---|:---|
| 3-player world game, initial render, Map tab | Sidebar: "P1 ... 14/42", 6 continent roots expanded | `snapshotContains("North America (+5)")`, gauge ~33% |
| `.switchTab(.stats)` | Buffer contains "Country" header, 42 data rows | `snapshotContains("Country")`, row count == 42 |
| `.sortTable(.armies)` on Stats tab | First row has highest army count | Verify first data row |
| `.attack(from: alaska, to: kamchatka)` | `moveHistory.count == 1`, tree army counts updated | Direct model assertion |
| `.endTurn` with AI next | `opponentThinking == true`, Cmd is `.task` | Model + Cmd assertion |
| `MoveTokenizer.tokenize("P1 ATTACK Alaska -> Kamchatka [3v2] CONQUERED")` | 7 tokens: type, keyword, variable, operator, variable, number, comment | Token array equality |
| `ScoreboardRenderer.render(snapshot, map)` | Plain text table, no ANSI escapes | String contains "Country", no `\e[` |
| `Color.fromHex("#e53935")?.downsampled(to: .basic)` | `.ansi8(.red)` | Direct equality |

**Reference Truth:** SwiftCLIKit's own SnapshotTesting golden files serve as the rendering reference. Game logic correctness is already validated by IconquerCore's parity tests against the TypeScript reference. Move tokenizer tokens are verified by string equality against hand-written expected arrays.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? Yes -> supersedes ADR-011 (Widget-based TUI without App+MVU)
- [x] Does this amend an existing ADR? Yes -> amends ADR-009 (SwiftCLIKit as reusable library)
- [x] New ADR required? **Yes** -> ADR-015

**Superseded ADR-011:**
- ADR-011 decided to use widgets without App+MVU for v0.5.0, deferring MVU to a later release. This combined proposal supersedes that decision: v0.5.0 now includes the full MVU rewrite. The incremental widget-only approach is skipped entirely.

**Amended ADR-009:**
- SwiftCLIKit dependency is now v1.8.0 (for AccessibleWidget), not just v1.0.0. All widget, framework, and accessibility features are consumed.

**New ADR Draft:**

```yaml
id: ADR-015
date: 2026-04-10
status: proposed
category: architecture
title: Full MVU architecture with component composition for IconquerCLI v0.5.0
context: |
  IconquerCLI's PlayRunner imperatively manages render/input/state in an
  interleaved loop. The v0.5.0 Must-Have proposal (ADR-011) planned to keep
  PlayRunner and add widgets incrementally. The v0.6.0 Amazing proposal
  planned a full MVU rewrite. Combining both tiers into a single v0.5.0
  release means the incremental approach is unnecessary overhead -- we go
  straight to MVU.
decision: |
  Replace PlayRunner entirely with App<GameModel, GameMessage> using
  SwiftCLIKit's MVU framework. All game state lives in a single GameModel
  value type. All interactions are GameMessage enum cases. gameUpdate is
  pure (no side effects). gameView is pure (no I/O). Components (Sidebar,
  Board, History, Cards, ActionMenu) compose independently. PlayRunner is
  deleted, not wrapped. No backward compatibility with the old game loop.
rationale: |
  - Clean break avoids maintaining two rendering paths simultaneously
  - Every state transition is explicit, testable, and deterministic
  - Component architecture enables parallel agent development
  - Pure update/view functions enable TestBackend-driven integration tests
  - Direct path to future features: session replay, time-travel debug
consequences: |
  + Single source of truth for all UI state
  + All state transitions testable without a real terminal
  + Components developed/tested independently
  + No backward compatibility burden
  - Complete rewrite of the game loop (not incremental)
  - Learning curve for MVU/Elm architecture
  - PlayRunner deletion is a breaking change (but clean break is intentional)
alternatives_rejected:
  - "Incremental widget adoption (ADR-011): Adds unnecessary intermediate
    step since both tiers are shipping together"
  - "Keep PlayRunner as deprecated wrapper: Adds maintenance burden for
    code that will be deleted in one release cycle anyway"
affected_files:
  - Sources/IconquerCLILib/App/GameApp.swift (new)
  - Sources/IconquerCLILib/App/GameModel.swift (new)
  - Sources/IconquerCLILib/App/GameMessage.swift (new)
  - Sources/IconquerCLILib/App/GameUpdate.swift (new)
  - Sources/IconquerCLILib/App/GameView.swift (new)
  - Sources/IconquerCLILib/Components/*.swift (new)
  - Sources/IconquerCLILib/Support/*.swift (new)
  - Sources/IconquerCLILib/PlayRunner.swift (deleted)
  - Sources/IconquerCLILib/TUIRenderer.swift (deleted)
  - Sources/IconquerCLILib/Renderer.swift (deleted)
  - Sources/IconquerCLILib/CLISettings.swift (modified)
  - Sources/iconquer-cli/IconquerCLICommand.swift (modified)
supersedes: ADR-011
amends: ADR-009
superseded_by: null
```

---

## 10. Open Questions

**All open questions from both v0.5.0 Must-Have and v0.6.0 Amazing are RESOLVED.**

| # | Question | Resolution |
|:--|:---------|:-----------|
| 1 | Tree default state: expanded or collapsed? | **RESOLVED: Expand all by default.** All continent nodes start expanded regardless of map size. |
| 2 | Mouse enabled by default? | **RESOLVED: Yes.** Mouse enabled by default with `--no-mouse` opt-out. Full scope: click countries, menus, tabs, scrollbars. |
| 3 | Scoreboard renderer: keep, deprecate, or rewrite? | **RESOLVED: Rewrite using SwiftCLIKit.** CellBuffer + Table widget + `renderPlainText()`. ~40 lines replacing ~160. |
| 4 | Accessibility: custom code or AccessibleWidget protocol? | **RESOLVED: AccessibleWidget protocol from SwiftCLIKit v1.8.0.** No custom a11y code in IconquerCLI. Hard dependency: SwiftCLIKit v1.8.0 must ship first. |
| 5 | Theme: single or multiple? | **RESOLVED: Ship one default theme.** Architecture supports multiple themes. The default is documented extensively (color purposes, contrast ratios, semantic meaning) for future theme authors. |
| 6 | Backward compatibility with PlayRunner? | **RESOLVED: No.** Clean break. PlayRunner is deleted entirely. |
| 7 | AI move granularity? | **RESOLVED: Batch moves, animate per-move.** AI computes all moves for the turn in batch, then they are applied and rendered one at a time with animation delay. |
| 8 | Sparkline history depth? | **RESOLVED: 20 turns.** Configurable via `CLISettings.sparklineDepth`. |
| 9 | Theme persistence? | **RESOLVED: Persist to CLISettings.** Toggleable in-game via key binding or via `--theme` CLI flag. |
| 10 | Table column sizing? | **RESOLVED: Auto-size.** Auto-size based on content with minimum widths per column. |
| 11 | Mouse interaction scope? | **RESOLVED: Full scope.** Click countries in tree/table, click tab labels, click menu items, click scrollbars. All mouse events translate to equivalent GameMessage cases. |

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? **Yes** -- App, Component, FocusManager, Tree, Table, Menu, Tabs, Gauge, Sparkline, BarChart, Scrollbar, Block, Paragraph, Theme, SyntaxHighlighter, AccessibleWidget, TestBackend, SnapshotTesting
- Does explanation require 50+ lines? **Yes**
- Does it need theory/background context? **Yes** -- MVU architecture, component composition, message flow, accessibility model

**Article Name:** `IconquerTUIArchitectureGuide.md`

**Contents:**
1. **MVU overview** -- How GameModel, GameMessage, gameUpdate, and gameView fit together. Message flow diagram showing user input -> GameMessage -> gameUpdate -> model delta -> gameView -> Frame -> DiffRenderer -> terminal.
2. **Component architecture** -- How Sidebar, Board, History, Cards, and ActionMenu components compose. Message mapping from child to parent.
3. **Adding a new panel** -- Step-by-step guide: define Component model/message/update/view, wire into GameModel and GameView.
4. **Theme customization** -- How to create a custom GameTheme, color slot documentation, contrast ratio requirements, testing with basic/no-color modes.
5. **Move tokenizer** -- How MoveTokenizer works, token types, adding new move types.
6. **Testing your changes** -- How to use TestBackend to inject events and assert on rendered output. Snapshot testing workflow. GameUpdate pure function testing.
7. **Accessibility** -- How AccessibleWidget protocol provides semantic labels. What screen reader users experience.

**DocC comments:** All public types and functions in `App/`, `Components/`, and `Support/` directories get full DocC documentation with parameter descriptions, examples, and cross-references to SwiftCLIKit types. Each Component gets `/// ## Overview` and `/// ## Example` sections.

---

## Implementation Order

The recommended implementation follows TDD (red/green/refactor) across 8 steps. Steps marked with "(parallel)" can run concurrently.

| Step | Files | What | Dependencies | Parallelizable |
|:-----|:------|:-----|:-------------|:---------------|
| **1** | SwiftCLIKit repo | Ship SwiftCLIKit v1.8.0 with AccessibleWidget protocol | Separate repo, prerequisite | No -- must complete first |
| **2** | `GameModel.swift`, `GameMessage.swift`, `GameUpdate.swift` + tests | Pure MVU logic: all ~25 message cases, model mutations, Cmd returns. No rendering. | Step 1 (SwiftCLIKit v1.8.0 available) | **Yes** -- parallel with Steps 3, 4, 5 |
| **3** | `GameLayout.swift`, `GameTheme.swift`, `ScoreboardRenderer.swift` + tests | Rendering infrastructure: layout constraints, theme definition with docs, plain-text scoreboard | Step 1 | **Yes** -- parallel with Steps 2, 4, 5 |
| **4** | `GameTreeDataSource.swift`, `ActionMenuComponent.swift` + tests | Game-specific widget adapters: tree node builder from GameSnapshot, phase-contextual menu | Step 1 | **Yes** -- parallel with Steps 2, 3, 5 |
| **5** | `SidebarComponent.swift` (gauges, sparklines), `HistoryComponent.swift`, `MoveTokenizer.swift` + tests | Data visualization and syntax highlighting components | Step 1 | **Yes** -- parallel with Steps 2, 3, 4 |
| **6** | `BoardComponent.swift` (tree + table + tabs), `CardComponent.swift` + tests | Main content area with tab switching and card management | Steps 4, 5 (depends on tree data source, history component) | No |
| **7** | `GameView.swift` (composes all components), `GameApp.swift` (wires App<>), `CLISettings.swift`, `IconquerCLICommand.swift` | Full composition: view function, app entry point, CLI lifecycle, alternate screen, mouse mode | Steps 2, 3, 6 (all components + update logic ready) | No |
| **8** | Integration test suite | Full App tests via TestBackend + SnapshotTesting golden files | Step 7 | No |

### Parallel Agent Assignment (Steps 2-5)

```
Agent A: Step 2 -- GameModel + GameMessage + GameUpdate (pure logic)
Agent B: Step 3 -- GameLayout + GameTheme + ScoreboardRenderer (rendering infra)
Agent C: Step 4 -- GameTreeDataSource + ActionMenuComponent (widget adapters)
Agent D: Step 5 -- SidebarComponent + HistoryComponent + MoveTokenizer (visualization)
```

All four agents work independently against their own test targets. No file overlap. Reconciliation happens at Step 6 when BoardComponent needs outputs from Steps 4 and 5.
