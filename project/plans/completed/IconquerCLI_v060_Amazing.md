# Design Proposal: IconquerCLI v0.6.0 — "Would Be Amazing" TUI Upgrade

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Full MVU architecture rewrite, multi-tab views, data visualization widgets, component architecture, theme support, syntax-highlighted history
**Depends on:** IconquerCLI v0.5.0 (CellBuffer, DiffRenderer, Layout, Tree, Menu, truecolor, alternate screen, mouse, accessibility), SwiftCLIKit v1.0.0 (TestBackend, SnapshotTesting, Theme, SyntaxHighlighter)

---

## 1. Objective

**Objective:** Replace IconquerCLI's imperative PlayRunner game loop with a full Elm-style MVU architecture using SwiftCLIKit's `App<Model, Message>` framework, then layer on rich data visualization (tables, gauges, sparklines, bar charts), multi-tab navigation, component-based panel composition, theme support, and syntax-highlighted move history to create a polished, feature-rich terminal strategy game interface.

**Master Plan Reference:** Phase 3 — TUI "would be amazing" tier. Builds on Phase 2 (v0.5.0 must-have TUI polish) and SwiftCLIKit v1.0.0 (Ship It).

**Problems solved:**
1. **Imperative game loop is fragile.** PlayRunner manually manages render/input/state transitions. A single `update` function with `GameMessage` makes every state transition explicit, testable, and composable.
2. **Single-view bottleneck.** The v0.5.0 tree view shows countries grouped by continent, but players need multiple perspectives: sortable stats, move history, card hand. Tabs provide view switching without screen clutter.
3. **No at-a-glance dominance indicators.** Players must count countries mentally. Gauges and bar charts provide instant visual feedback on territory control and army strength.
4. **No trend visibility.** Army counts over time reveal strategy effectiveness, but the current UI has no historical visualization. Sparklines fill this gap.
5. **Move history is plain text.** A syntax-highlighted, color-coded history log makes it easy to scan for attacks, placements, and fortifications at a glance.
6. **No panel focus management.** Keyboard navigation between sidebar, board, and action areas requires a FocusManager with clear visual indicators.
7. **Monolithic rendering.** The v0.5.0 renderer is one large view function. Component architecture allows each panel (sidebar, board, history, cards) to be developed, tested, and maintained independently.

---

## 2. Proposed Architecture

### New files in IconquerCLI

```
Sources/IconquerCLILib/
├── App/
│   ├── GameApp.swift               — Creates App<GameModel, GameMessage>, wires update/view/subscriptions
│   ├── GameModel.swift             — Complete game + UI state (wraps Game, panels, scroll, focus)
│   ├── GameMessage.swift           — Union of all user/system actions
│   ├── GameUpdate.swift            — Pure update function: (GameModel, GameMessage) -> (GameModel, Cmd<GameMessage>)
│   └── GameView.swift              — Pure view function: (GameModel) -> Frame, composing all panels
├── Components/
│   ├── SidebarComponent.swift      — Player stats, gauges, sparklines
│   ├── BoardComponent.swift        — Main area: tree/table/chart, tab-switched
│   ├── HistoryComponent.swift      — Move history with syntax highlighting
│   ├── CardComponent.swift         — Card hand display and turn-in selection
│   └── ActionMenuComponent.swift   — Phase-aware action menu (attack, fortify, end turn, etc.)
├── Themes/
│   ├── IconquerTheme.swift         — Game-specific theme with player color slots
│   └── DefaultThemes.swift         — Built-in dark and light themes
└── Syntax/
    └── MoveLanguage.swift          — Custom SyntaxLanguage tokenizer for iConquer move notation
```

### Modified files

```
Sources/IconquerCLILib/
├── PlayRunner.swift                — Replaced by GameApp; kept as thin wrapper for backward compat
├── TUIRenderer.swift               — Removed; rendering now lives in GameView + Components
└── CLISettings.swift               — Extended with theme selection, default tab, sparkline depth
```

### Module structure

```
IconquerCLI (executable)
  └── IconquerCLILib
        ├── depends on: SwiftCLIKit v1.0.0
        ├── depends on: IconquerCore
        ├── depends on: IconquerMatch
        └── depends on: IconquerAI
```

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
    public var treeExpansion: Set<String>       // Expanded continent names
    public var scrollPositions: [PanelId: Int]  // Per-panel scroll offsets
    public var tableSortColumn: TableColumn
    public var tableSortAscending: Bool
    public var cardSelection: Set<Int>          // Selected card indices for turn-in

    // --- Display state ---
    public var terminalSize: TerminalSize
    public var theme: IconquerTheme
    public var statusMessage: String?
    public var statusExpiry: ContinuousClock.Instant?
    public var opponentThinking: Bool

    // --- Historical data for visualization ---
    public var armyHistory: [PlayerId: [Int]]   // Army counts per turn, per player
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
    public let territoryRatio: Double         // 0.0...1.0
    public let continentsOwned: [String]
    public let armyTrend: [Int]               // Last N turns
}
```

### 3b. GameMessage

```swift
/// Union of all user and system actions that can modify GameModel.
/// Every interaction flows through this enum — no side-channel mutations.
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
/// Pure update function. No side effects — all async work returns as Cmd values.
///
/// ## Example
/// ```swift
/// let (newModel, cmd) = gameUpdate(model, .switchTab(.stats))
/// // newModel.activeTab == .stats
/// // cmd == .none (no side effects needed)
/// ```
public func gameUpdate(
    _ model: GameModel,
    _ message: GameMessage
) -> (GameModel, Cmd<GameMessage>) {
    // Implementation dispatches on message cases.
    // Returns updated model + optional Cmd for async work.
}
```

Key update behaviors:

| Message | Model change | Cmd |
|:---|:---|:---|
| `.keyPressed(.tab)` | Advance `focusedPanel` via FocusManager | `.none` |
| `.switchTab(.stats)` | Set `activeTab = .stats` | `.none` |
| `.selectCountry(id)` | Set `selectedCountry`; if `attackSource` set and valid target, prepare attack | `.none` |
| `.attack(from, to)` | Apply attack to `game`, append to `moveHistory`, update `armyHistory` | `.none` (or `.task` if AI needs to respond) |
| `.endTurn` | Advance turn in `game`, record history snapshot | `.task { .opponentThinking }` if next player is AI |
| `.opponentThinking` | Set `opponentThinking = true` | `.task { await aiMove(model) }` returning `.opponentMoved` |
| `.opponentMoved(move)` | Apply move to `game`, append history, set `opponentThinking = false` | `.none` or chain next AI action |
| `.resized(w, h)` | Update `terminalSize` | `.none` |
| `.sortTable(col)` | Toggle `tableSortAscending` if same column, else set new column ascending | `.none` |
| `.quit` | No model change | `.quit` |

### 3d. GameView (pure function)

```swift
/// Pure view function. Composes all panels into a single Frame from GameModel.
/// No side effects, no I/O — returns a declarative description of what to render.
public func gameView(_ model: GameModel) -> Frame {
    // 1. Compute layout constraints from terminalSize
    // 2. Split into sidebar (fixed 30 cols) + main area (flex) + status bar (fixed 1 row)
    // 3. Render sidebar: player summaries, gauges, sparklines
    // 4. Render main area: tab bar + active tab content
    // 5. Render status bar: current phase, status message, key hints
    // 6. Compose all into root Frame
}
```

Layout structure:

```
+--[ iConquer v0.6.0 ]-------------------------------------------+
|                    | [ Map | Stats | History | Cards ]          |
| P1 Human    12/42 |                                             |
| ████████░░  29%   | (active tab content fills this area)        |
| ▁▂▃▅▇▅▃▂         |                                             |
|                    |   Tree view (Map tab):                      |
| P2 AI       18/42 |   ▼ North America (+5)                      |
| ████████████ 43%  |     Alaska [P2] ■■■                         |
| ▂▃▅▇▇▅▃▂         |     Northwest Territory [P2] ■■              |
|                    |     ...                                     |
| P3 AI       12/42 |   ▶ South America (+2)                      |
| ████████░░  29%   |   ▼ Europe (+5)                             |
| ▅▃▂▁▁▂▃▅         |     ...                                     |
|                    |                                             |
+--------------------+---------------------------------------------+
| Attack Phase | Select source country (Tab: switch panel, Q: quit)|
+----------------------------------------------------------------+
```

### 3e. Component Interfaces

```swift
/// Sidebar component: player summaries with gauges and sparklines.
public struct SidebarComponent: Sendable {
    public struct Model: Sendable {
        public var players: [PlayerSummary]
        public var theme: IconquerTheme
        public var height: Int
        public var scrollOffset: Int
    }

    public enum Message: Sendable {
        case scrollUp(Int)
        case scrollDown(Int)
    }

    /// Pure update for sidebar-local state.
    public static func update(_ model: Model, _ message: Message) -> Model

    /// Pure view rendering the sidebar into a Frame.
    public static func view(_ model: Model, frame: Frame)

    /// Map sidebar messages to parent GameMessage.
    public static func toParent(_ message: Message) -> GameMessage
}

/// Board component: tab-switched main content area.
public struct BoardComponent: Sendable {
    public struct Model: Sendable {
        public var activeTab: Tab
        public var game: Game
        public var selectedCountry: CountryId?
        public var attackSource: CountryId?
        public var treeExpansion: Set<String>
        public var tableSortColumn: TableColumn
        public var tableSortAscending: Bool
        public var scrollPositions: [Tab: Int]
        public var moveHistory: [HistoryEntry]
        public var cardHand: [Card]
        public var cardSelection: Set<Int>
        public var theme: IconquerTheme
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

/// History component: syntax-highlighted move log.
public struct HistoryComponent: Sendable {
    public struct Model: Sendable {
        public var entries: [HistoryEntry]
        public var scrollOffset: Int
        public var theme: IconquerTheme
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
        public var theme: IconquerTheme
    }

    public enum Message: Sendable {
        case toggleSelection(Int)
        case confirmTurnIn
    }

    public static func update(_ model: Model, _ message: Message) -> Model
    public static func view(_ model: Model, frame: Frame)
    public static func toParent(_ message: Message) -> GameMessage
}
```

### 3f. GameApp (entry point)

```swift
/// Creates and runs the MVU game application.
///
/// ## Example
/// ```swift
/// let outcome = try await GameApp.run(
///     game: game,
///     players: players,
///     aiStrategies: strategies,
///     theme: .dark
/// )
/// ```
public enum GameApp {
    /// Run the game TUI. Returns the final PlayOutcome when the game ends or user quits.
    public static func run(
        game: Game,
        players: [Player],
        aiStrategies: [PlayerId: any Strategy],
        theme: IconquerTheme = .dark,
        backend: (any TerminalBackend)? = nil   // nil = real terminal; inject TestBackend for tests
    ) async throws -> PlayOutcome {
        let initialModel = GameModel(
            game: game,
            matchState: .playing,
            moveHistory: [],
            turnNumber: 1,
            activeTab: .map,
            selectedCountry: nil,
            attackSource: nil,
            focusedPanel: .board,
            menuSelection: 0,
            treeExpansion: Set(game.map.continents.map(\.name)),
            scrollPositions: [:],
            tableSortColumn: .country,
            tableSortAscending: true,
            cardSelection: [],
            terminalSize: TerminalSize.current(),
            theme: theme,
            statusMessage: nil,
            statusExpiry: nil,
            opponentThinking: false,
            armyHistory: [:],
            territoryHistory: [:]
        )

        let app = App(
            initialModel: initialModel,
            update: gameUpdate,
            view: gameView,
            subscriptions: gameSubscriptions,
            backend: backend
        )

        let finalModel = try await app.run()
        return finalModel.matchState.toPlayOutcome()
    }
}
```

### 3g. Subscriptions

```swift
/// Subscriptions that produce GameMessages from external sources.
public func gameSubscriptions(_ model: GameModel) -> [Subscription<GameMessage>] {
    var subs: [Subscription<GameMessage>] = []

    // Terminal resize events
    subs.append(.resize { width, height in
        .resized(width: width, height: height)
    })

    // AI opponent thinking (when it's an AI player's turn)
    if model.opponentThinking, let aiPlayer = model.currentAIPlayer {
        subs.append(.task(id: "ai-\(aiPlayer.id)") {
            let move = await aiPlayer.strategy.nextMove(for: model.game)
            return .opponentMoved(move)
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

### 3h. IconquerTheme

```swift
/// Game-specific theme extending SwiftCLIKit's Theme with player color slots.
public struct IconquerTheme: Sendable {
    /// Base SwiftCLIKit theme for chrome (borders, backgrounds, text).
    public var base: Theme

    /// Player-specific colors (index 0-5 for up to 6 players).
    public var playerColors: [Color]

    /// Move type colors for history highlighting.
    public var attackColor: Color
    public var placementColor: Color
    public var fortifyColor: Color
    public var cardTurnInColor: Color

    /// Tab bar styling.
    public var activeTabFg: Color
    public var activeTabBg: Color
    public var inactiveTabFg: Color
    public var inactiveTabBg: Color

    /// Focus ring color.
    public var focusBorder: Color

    /// Built-in dark theme.
    public static let dark: IconquerTheme

    /// Built-in light theme.
    public static let light: IconquerTheme
}
```

### 3i. MoveLanguage (custom syntax tokenizer)

```swift
/// Custom SyntaxLanguage tokenizer for iConquer move notation.
/// Tokenizes move history entries for color-coded rendering.
///
/// Token mapping:
/// - `.keyword` → action words (ATTACK, PLACE, FORTIFY, TURN-IN)
/// - `.number` → army counts, dice rolls
/// - `.variable` → country names
/// - `.type` → player names
/// - `.operator` → arrows (->), separators
/// - `.comment` → result annotations (CONQUERED, ELIMINATED)
///
/// ## Example input/output
/// ```
/// "P1 ATTACK Alaska -> Kamchatka [3v2] WON"
///  ^  ^^^^^^ ^^^^^^    ^^^^^^^^^  ^^^  ^^^
///  |  keyword variable  variable  num  comment
///  type
/// ```
public struct MoveLanguageTokenizer: LanguageTokenizer {
    public func tokenize(_ line: String) -> [Token]
}
```

---

## 4. MCP Schema

Not applicable. The TUI is a local-only interactive interface. Game actions flow through `GameMessage`, which is internal to the app. AI opponents interact via the existing `Strategy` protocol in IconquerAI, not via MCP.

Note: The existing IconquerMCP server (from Phase 2 v0.2.x) provides the machine-readable game interface. The TUI consumes the same `Game` model but through a human-facing visual interface, not a JSON schema.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | `GameModel` properties are all non-optional or use safe Optional access. Country lookups use `game.country(id:)` which returns Optional. Card indices are bounds-checked before access. |
| **No `try!` or `as!`** | Theme loading uses `try`/`throws`. AI strategy calls use `await` with error handling via `Cmd.task`. |
| **Sendable** | `GameModel` is a value type (`struct`) — automatically Sendable. `GameMessage` is an enum with Sendable payloads. All Component models are Sendable value types. `IconquerTheme` is a Sendable struct. |
| **Guard clauses** | `gameUpdate` guards invalid state transitions (e.g., attack during placement phase). Country selection guards existence. Card turn-in guards valid set size. |
| **Division safety** | `PlayerSummary.territoryRatio` guards `totalTerritories == 0` (returns 0.0). Gauge percentage guards zero denominator. |
| **Pointer safety** | No `withUnsafe*` blocks anywhere in this layer. All data is value types or actor-isolated. |
| **Concurrency** | AI moves run as `Cmd.task` — async, non-blocking, automatically cancelled on quit. No `DispatchQueue` usage. `App` event loop handles all message sequencing. No `@unchecked Sendable` needed (all value types). |
| **No hardcoded constants** | Sidebar width, sparkline depth, status message duration, scroll step size, tab order — all configurable via `GameModel` initialization or `CLISettings`. Player colors come from `IconquerTheme`. |

---

## 6. Backend Abstraction

Not applicable. No compute-intensive operations. The MVU render loop is driven by SwiftCLIKit's `App` framework, which already abstracts the terminal backend via `TerminalBackend` protocol (real vs. `TestBackend`).

---

## 7. Dependencies

### Internal Dependencies

| Package | Version | What it provides |
|:---|:---|:---|
| **SwiftCLIKit** | v1.0.0 | App, Cmd, Subscription, Component, FocusManager, CellBuffer, DiffRenderer, Layout, Frame, Tree, Table, Menu, Tabs, Gauge, Sparkline, BarChart, Scrollbar, Theme, SyntaxHighlighter, TestBackend, SnapshotTesting |
| **IconquerCore** | v0.1.0 | Game, Map, Country, Player, Card, TurnPhase, rules engine |
| **IconquerMatch** | v0.1.0 | MatchRunner, MatchState, PlayOutcome |
| **IconquerAI** | v0.1.0 | Strategy protocol, built-in AI strategies |

### External Dependencies

None. All rendering, input handling, and UI composition are provided by SwiftCLIKit. AI strategies are provided by IconquerAI.

### SwiftCLIKit widget usage map

| SwiftCLIKit Widget | Where used in v0.6.0 |
|:---|:---|
| `App<GameModel, GameMessage>` | GameApp.swift — entire game loop |
| `Cmd` | AI moves, status timers, quit |
| `Subscription` | Resize, AI thinking, status dismiss |
| `Component` | Sidebar, Board, History, Cards, ActionMenu |
| `FocusManager` | Tab-cycling between panels |
| `Tree` | Map tab: continent-grouped country tree |
| `Table` | Stats tab: sortable country data |
| `Menu` | Action menu: phase-specific commands |
| `Tabs` | Tab bar: Map / Stats / History / Cards |
| `Gauge` | Sidebar: territory control ratio per player |
| `Sparkline` | Sidebar: army count trend per player |
| `BarChart` | Stats tab: territory distribution chart |
| `Scrollbar` | All scrollable panels |
| `Block` | Panel borders with titles |
| `Paragraph` | Status messages, help text |
| `Theme` | Base chrome styling |
| `SyntaxHighlighter` | History tab: move notation highlighting |
| `TestBackend` | All integration tests |
| `SnapshotTesting` | Visual regression tests |

---

## 8. Test Strategy

### Full App integration tests (via TestBackend)

**Initial render:**
- Create `TestBackend(width: 120, height: 40)`, inject a known 3-player game setup.
- Assert initial `currentBuffer` contains: tab bar with "Map" active, sidebar with 3 player names, tree with 6 continent headers, action menu with placement options, status bar with phase indicator.

**Attack sequence:**
- Inject `.selectCountry(source)` then `.selectCountry(target)` → assert model transitions to attack confirmation.
- Inject `.attack(from: source, to: target)` → assert `moveHistory` grows by 1, `armyHistory` updated, tree reflects new army counts.
- Verify `currentBuffer` shows updated army numbers in tree view.

**Tab switching:**
- Inject `.switchTab(.stats)` → assert buffer contains table headers (Country, Continent, Owner, Armies, Neighbors, Bonus).
- Inject `.switchTab(.history)` → assert buffer contains move history entries.
- Inject `.switchTab(.cards)` → assert buffer contains card hand display.
- Inject `.switchTab(.map)` → assert tree view returns.

**Table sorting:**
- On Stats tab, inject `.sortTable(.armies)` → assert countries sorted by army count descending.
- Inject `.sortTable(.armies)` again → assert sort flips to ascending.
- Inject `.sortTable(.continent)` → assert sorted by continent name ascending.

**Focus cycling:**
- Inject `.focusNext` repeatedly → assert `focusedPanel` cycles through `.board`, `.actionMenu`, `.sidebar`, `.board`.
- Assert focused panel has highlighted border in `currentBuffer`.

**AI opponent turn:**
- Inject `.endTurn` when next player is AI → assert `opponentThinking` becomes true.
- Wait for AI subscription to produce `.opponentMoved` → assert move applied to game, history updated, `opponentThinking` becomes false.
- Assert `currentBuffer` shows AI move result (no spinner/thinking indicator remaining).

**Resize:**
- Inject `.resized(width: 80, height: 24)` → assert layout recomputes, all panels fit smaller terminal.
- Assert no clipping artifacts or out-of-bounds rendering.

**Card turn-in:**
- On Cards tab, inject `.toggleCardSelection(0)`, `.toggleCardSelection(1)`, `.toggleCardSelection(2)`.
- Assert `cardSelection` has 3 entries.
- Inject `.turnInCards(indices: [0, 1, 2])` → assert cards removed from hand, armies added.

**Quit:**
- Inject `.quit` → assert `App.run()` returns with final model.

### Snapshot tests

**Per-tab golden files:**
- `snapshot_map_tab_3player.txt` — Map tab with 3-player world game, all continents expanded.
- `snapshot_stats_tab_sorted_armies.txt` — Stats tab sorted by armies descending.
- `snapshot_history_tab_10moves.txt` — History tab with 10 color-coded move entries.
- `snapshot_cards_tab_5cards.txt` — Cards tab with 5 cards, 3 selected.
- `snapshot_sidebar_3player.txt` — Sidebar with gauges and sparklines for 3 players.

**Theme snapshots:**
- `snapshot_dark_theme.txt` vs `snapshot_light_theme.txt` — same game state, different themes.

### Component unit tests

**SidebarComponent:**
- 3 players with known territory counts → gauge widths proportional to territory ratio.
- Player with 0 territories → gauge shows empty bar, 0%.
- Sparkline with 10 data points → renders correct trend glyphs.
- Scroll up/down within sidebar bounds.

**BoardComponent:**
- Tree expansion: toggle continent → children hidden/shown.
- Table sort: verify row ordering for each sortable column.
- Country selection: selecting a country highlights it in both tree and table views.

**HistoryComponent:**
- Attack entry → rendered with attack color and "ATTACK" keyword highlighted.
- Placement entry → rendered with placement color.
- Fortify entry → rendered with fortify color.
- Card turn-in entry → rendered with card color.
- Scroll to bottom on new entry (auto-scroll behavior).

**CardComponent:**
- Toggle selection on/off → correct indices in selection set.
- Cannot turn in with fewer than 3 selected.
- Valid set detection (matching set or all-different set per game rules).

### MoveLanguage tokenizer tests

- `"P1 ATTACK Alaska -> Kamchatka [3v2] CONQUERED"` → tokens: type("P1"), keyword("ATTACK"), variable("Alaska"), operator("->"), variable("Kamchatka"), number("[3v2]"), comment("CONQUERED").
- `"P2 PLACE 5 on Brazil"` → tokens: type("P2"), keyword("PLACE"), number("5"), plain("on"), variable("Brazil").
- `"P1 FORTIFY 3 from Alaska to Kamchatka"` → tokens: type("P1"), keyword("FORTIFY"), number("3"), plain("from"), variable("Alaska"), plain("to"), variable("Kamchatka").
- `"P3 TURN-IN cards for 10 armies"` → tokens: type("P3"), keyword("TURN-IN"), plain("cards for"), number("10"), plain("armies").
- Empty string → empty token array.

### GameUpdate pure function tests

- Every `GameMessage` case has at least one test verifying model mutation and returned `Cmd`.
- Invalid transitions return unchanged model + `.none` (e.g., attack during placement phase).
- Deterministic: same model + same message = same result (no randomness in update; dice rolls are pre-resolved by the game engine before being sent as messages).

### FocusManager integration

- Tab cycles through all 4 panel IDs in order.
- Shift-Tab cycles in reverse.
- Focused panel border style matches `theme.focusBorder`.
- Only focused panel receives keyboard input (e.g., arrow keys scroll the focused panel only).

### Validation Trace

| Input | Expected Output |
|:---|:---|
| 3-player world game, initial render, Map tab | Sidebar shows "P1 ... 14/42", "P2 ... 14/42", "P3 ... 14/42" with ~33% gauges |
| `.switchTab(.stats)` | Buffer contains "Country" header, 42 rows of country data |
| `.sortTable(.armies)` on Stats tab | First row has highest army count |
| `.attack(from: alaska, to: kamchatka)` | `moveHistory.count == 1`, tree updates army counts |
| `.endTurn` with AI next | `opponentThinking == true`, Cmd is `.task` |
| `.resized(width: 80, height: 24)` | `terminalSize == TerminalSize(columns: 80, rows: 24)`, no crash |

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No (v0.5.0's imperative renderer is replaced, but no formal ADR existed for it)
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** — ADR-014

**New ADR Draft:**

**ADR-014:**
- **Title:** MVU architecture for IconquerCLI game loop
- **Category:** architecture
- **Key decision:** IconquerCLI v0.6.0 replaces the imperative PlayRunner game loop with SwiftCLIKit's `App<GameModel, GameMessage>` MVU architecture. All game state lives in a single `GameModel` value type. All user/system interactions are modeled as `GameMessage` enum cases. The `gameUpdate` function is pure (no side effects), and `gameView` is pure (no I/O). AI opponent moves are non-blocking `Cmd.task` effects. This makes every state transition explicit, testable via `TestBackend`, and snapshot-verifiable.
- **Rationale:** (1) The imperative game loop in PlayRunner interleaves state mutation, I/O, and rendering, making it hard to test and prone to state inconsistencies. (2) MVU's pure update/view functions enable deterministic testing without a real terminal. (3) Component architecture allows independent development and testing of sidebar, board, history, and card panels. (4) The architecture directly enables future features: session recording/replay (v1.11.0 stretch), time-travel debugging, and multiplayer synchronization.
- **Trade-offs:** (1) Requires rewriting the entire game loop (not incremental). (2) Learning curve for contributors unfamiliar with MVU/Elm architecture. (3) Slight overhead from full model copy on each update (mitigated by Swift's copy-on-write semantics for value types).

---

## 10. Open Questions

1. **Backward compatibility:** Should `PlayRunner` be kept as a thin wrapper that delegates to `GameApp.run()`, or removed entirely? **Recommendation:** Keep as deprecated wrapper for one version cycle (v0.6.0), remove in v0.7.0. Non-TUI mode (piped input) should still work via a simplified non-MVU path.

2. **AI move granularity:** Should AI turns produce one `.opponentMoved` per action (place, attack, fortify individually) or one batch message for the entire turn? **Recommendation:** Individual messages with short delays between them, so the human player can watch the AI's turn unfold step by step. This requires the AI subscription to produce a stream of messages, not a single result.

3. **Sparkline history depth:** How many turns of history should sparklines display? **Recommendation:** Configurable via `CLISettings`, default 20 turns. Sparkline widget width determines how many data points are visible.

4. **Theme persistence:** Should the selected theme be saved to `CLISettings` on disk, or is it a per-session choice? **Recommendation:** Persist to `CLISettings`. Dark is default. Users can switch via a command-line flag (`--theme light`) or in-game toggle.

5. **Table column widths:** Should the stats table use fixed column widths or auto-size based on content? **Recommendation:** Auto-size with minimum widths per column. The Table widget from SwiftCLIKit v0.4.0 supports constraint-based column widths.

6. **Mouse interaction scope:** v0.5.0 adds mouse clicks. Should v0.6.0 support mouse-driven country selection in the tree/table, tab clicking, and menu clicking? **Recommendation:** Yes — mouse clicks on tree nodes select countries, clicks on tab labels switch tabs, clicks on menu items activate actions. All mouse events are translated to equivalent `GameMessage` cases in the event handler.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (App, Component, Tree, Table, Gauge, Sparkline, BarChart, Tabs, Menu, FocusManager, Theme, SyntaxHighlighter)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (MVU architecture, component composition, message flow)

**Article Name:** `IconquerTUIArchitectureGuide.md`

**Contents:**
1. **MVU overview** — How `GameModel`, `GameMessage`, `gameUpdate`, and `gameView` fit together. Message flow diagram.
2. **Component architecture** — How sidebar, board, history, and card components compose. Message mapping from child to parent.
3. **Adding a new panel** — Step-by-step guide for contributors: define Component model/message/update/view, wire into GameModel and GameView.
4. **Theme customization** — How to create a custom `IconquerTheme`, override player colors, load from JSON.
5. **Testing your changes** — How to use `TestBackend` to inject events and assert on rendered output. Snapshot testing workflow.

DocC comments on all public types and functions in the `App/`, `Components/`, `Themes/`, and `Syntax/` directories. Each component gets an `/// ## Overview` and `/// ## Example` section.
