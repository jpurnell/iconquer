# Design Proposal: SwiftCLIKit v0.4.0 — Widgets

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Production-grade widget set for common TUI patterns

---

## 1. Objective

**Objective:** Deliver a comprehensive widget library covering the most common TUI patterns — data tables, selectable lists, tree views, progress indicators, charts, navigation tabs, menus, scrollbars, and a calendar. Every widget follows the immediate-mode rendering pattern established in v0.3.0: pure render functions with no internal state.

**Master Plan Reference:** SwiftCLIKit Roadmap v0.4.0 — Widgets. Builds on v0.3.0 (Cells, Layout, Frame, Block).

**Problems solved:**
1. **No reusable data display.** Applications need tables, lists, and trees but must hand-roll cell-by-cell rendering. These widgets handle column sizing, row selection, scroll position, and overflow.
2. **No progress visualization.** Long-running operations need gauges and progress bars. Sparklines and bar charts visualize data series inline.
3. **No navigation patterns.** Tab bars, menus, and scrollbars are universal TUI elements that require careful keyboard interaction design.
4. **No date display.** Calendar views are common in scheduling and planning applications.

---

## 2. Proposed Architecture

### Module structure (additions to SwiftCLIKit)

```
Sources/SwiftCLIKit/
└── Widgets/
    ├── Table.swift           — Column headers, typed rows, selection, sort indicator
    ├── List.swift            — Selectable item list with highlight and scrollbar
    ├── Tree.swift            — Collapsible tree with indent guides and selection
    ├── Gauge.swift           — Horizontal fill bar with label
    ├── ProgressBar.swift     — Stepped progress with percentage label
    ├── Sparkline.swift       — Inline mini-chart from [Double] data
    ├── BarChart.swift        — Vertical bars with labels and values
    ├── Tabs.swift            — Tab bar with active indicator
    ├── Menu.swift            — Single-level selectable menu with key bindings
    ├── Scrollbar.swift       — Standalone scrollbar (vertical/horizontal)
    └── Calendar.swift        — Month-view with date highlighting and selection
```

### Design philosophy

Every widget is a **struct** with a `render(into: inout Frame)` method. Widgets hold no mutable state — the caller owns selection indices, scroll positions, expanded node sets, and active tab indices. This means:

- Widgets are trivially testable (render into a `CellBuffer`, assert specific cells).
- No widget lifecycle, no subscriptions, no internal event handling.
- Composition is natural: a `Table` can contain a `Scrollbar`, a `Block` can wrap any widget.

State types (e.g., `TableState`, `ListState`) are separate value types the caller maintains between frames.

---

## 3. API Surface

### 3a. Table

```swift
/// A data table with column headers, rows, optional selection, and sort indicator.
public struct Table<Row: Sendable>: Sendable {
    /// Column definition: header text + width constraint + cell renderer.
    public struct Column: Sendable {
        public var header: String
        public var width: Layout.Constraint
        public var render: @Sendable (Row) -> String

        public init(
            header: String,
            width: Layout.Constraint = .min(1),
            render: @escaping @Sendable (Row) -> String
        )
    }

    public var columns: [Column]
    public var rows: [Row]
    public var state: TableState

    /// Style for the selected row.
    public var highlightStyle: CellStyle
    /// Style for column headers.
    public var headerStyle: CellStyle
    /// Optional sort indicator column index and direction.
    public var sortIndicator: (column: Int, ascending: Bool)?
    /// Whether to show a scrollbar when rows overflow.
    public var showScrollbar: Bool

    public init(columns: [Column], rows: [Row], state: TableState = TableState())

    /// Render the table into the given frame.
    public func render(into frame: inout Frame)
}

/// Caller-owned table state: selected row and scroll offset.
public struct TableState: Sendable {
    public var selectedRow: Int?
    public var scrollOffset: Int

    public init(selectedRow: Int? = nil, scrollOffset: Int = 0)

    /// Move selection down, scrolling if needed.
    public mutating func selectNext(rowCount: Int, visibleRows: Int)
    /// Move selection up, scrolling if needed.
    public mutating func selectPrevious()
}

/// Reusable cell style: foreground, background, and attributes.
public struct CellStyle: Sendable {
    public var fg: Color
    public var bg: Color
    public var attributes: CellAttributes

    public init(fg: Color = .default, bg: Color = .default, attributes: CellAttributes = [])
}
```

### 3b. List

```swift
/// A selectable item list with highlight style and optional scrollbar.
public struct List: Sendable {
    /// A single list item.
    public struct Item: Sendable {
        public var text: String
        public var style: CellStyle

        public init(text: String, style: CellStyle = CellStyle())
    }

    public var items: [Item]
    public var state: ListState
    public var highlightStyle: CellStyle
    public var showScrollbar: Bool

    public init(items: [Item], state: ListState = ListState())

    /// Render the list into the given frame.
    public func render(into frame: inout Frame)
}

/// Caller-owned list state.
public struct ListState: Sendable {
    public var selectedIndex: Int?
    public var scrollOffset: Int

    public init(selectedIndex: Int? = nil, scrollOffset: Int = 0)

    public mutating func selectNext(itemCount: Int, visibleItems: Int)
    public mutating func selectPrevious()
}
```

### 3c. Tree

```swift
/// A collapsible tree view with indent guides, expand/collapse state, and selection.
public struct Tree<Node: Sendable>: Sendable {
    /// A tree node with children.
    public struct TreeNode: Sendable {
        public var value: Node
        public var children: [TreeNode]
        public var id: String

        public init(value: Node, children: [TreeNode] = [], id: String)
    }

    public var roots: [TreeNode]
    public var state: TreeState
    public var renderNode: @Sendable (Node, Int) -> String  // (node, depth) -> display text
    public var highlightStyle: CellStyle
    public var indentWidth: Int

    public init(
        roots: [TreeNode],
        state: TreeState = TreeState(),
        renderNode: @escaping @Sendable (Node, Int) -> String
    )

    /// Render the tree into the given frame.
    public func render(into frame: inout Frame)
}

/// Caller-owned tree state: expanded node IDs and selected node ID.
public struct TreeState: Sendable {
    public var expandedNodes: Set<String>
    public var selectedNode: String?
    public var scrollOffset: Int

    public init()

    public mutating func toggle(_ nodeID: String)
    public mutating func expandAll(in roots: [Tree<some Sendable>.TreeNode])
    public mutating func collapseAll()
}
```

### 3d. Gauge

```swift
/// A horizontal fill bar showing a ratio (0.0 to 1.0) with an optional label.
public struct Gauge: Sendable {
    /// The fill ratio (clamped to 0.0...1.0).
    public var ratio: Double
    /// Optional label displayed over the bar (e.g., "75%").
    public var label: String?
    /// Style for the filled portion.
    public var filledStyle: CellStyle
    /// Style for the unfilled portion.
    public var unfilledStyle: CellStyle
    /// The character used for the filled portion. Default: block character.
    public var filledChar: Character
    /// The character used for the unfilled portion. Default: space.
    public var unfilledChar: Character

    public init(ratio: Double, label: String? = nil)

    /// Render the gauge into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3e. ProgressBar

```swift
/// A stepped progress bar with percentage label, wrapping Gauge with
/// convenience for discrete step tracking.
public struct ProgressBar: Sendable {
    public var current: Int
    public var total: Int
    public var style: CellStyle
    public var showPercentage: Bool

    public init(current: Int, total: Int, showPercentage: Bool = true)

    /// Render the progress bar into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3f. Sparkline

```swift
/// An inline mini-chart rendering a [Double] data series using braille or
/// block characters, auto-scaled to frame height.
public struct Sparkline: Sendable {
    public var data: [Double]
    public var style: CellStyle
    /// Maximum value for scaling. If nil, auto-scales to data max.
    public var max: Double?

    public init(data: [Double], style: CellStyle = CellStyle())

    /// Render the sparkline into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3g. BarChart

```swift
/// Vertical bar chart with labels and values, auto-scaled to frame height.
public struct BarChart: Sendable {
    /// A single bar in the chart.
    public struct Bar: Sendable {
        public var label: String
        public var value: Double
        public var style: CellStyle

        public init(label: String, value: Double, style: CellStyle = CellStyle())
    }

    public var bars: [Bar]
    /// Width of each bar in columns.
    public var barWidth: Int
    /// Gap between bars in columns.
    public var barGap: Int
    /// Maximum value for scaling. If nil, auto-scales to data max.
    public var max: Double?
    /// Whether to show value labels above bars.
    public var showValues: Bool

    public init(bars: [Bar], barWidth: Int = 3, barGap: Int = 1)

    /// Render the bar chart into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3h. Tabs

```swift
/// A horizontal tab bar with an active tab indicator.
public struct Tabs: Sendable {
    public var titles: [String]
    public var activeIndex: Int
    public var activeStyle: CellStyle
    public var inactiveStyle: CellStyle
    /// Separator between tabs. Default: " | ".
    public var separator: String
    /// Highlight character under active tab. Default: "─".
    public var underline: Character?

    public init(titles: [String], activeIndex: Int = 0)

    /// Render the tab bar into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3i. Menu

```swift
/// A single-level selectable menu with key binding display.
public struct Menu: Sendable {
    /// A menu item with a label and optional key binding hint.
    public struct MenuItem: Sendable {
        public var label: String
        public var keyHint: String?
        public var enabled: Bool

        public init(label: String, keyHint: String? = nil, enabled: Bool = true)
    }

    public var items: [MenuItem]
    public var selectedIndex: Int
    public var highlightStyle: CellStyle
    public var disabledStyle: CellStyle

    public init(items: [MenuItem], selectedIndex: Int = 0)

    /// Render the menu into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3j. Scrollbar

```swift
/// A standalone scrollbar widget (vertical or horizontal).
public struct Scrollbar: Sendable {
    public enum Orientation: Sendable {
        case vertical
        case horizontal
    }

    public var orientation: Orientation
    /// Total content length (e.g., total row count).
    public var contentLength: Int
    /// Viewport size (e.g., visible row count).
    public var viewportSize: Int
    /// Current scroll offset.
    public var offset: Int
    /// Style for the scrollbar track.
    public var trackStyle: CellStyle
    /// Style for the scrollbar thumb.
    public var thumbStyle: CellStyle

    public init(
        orientation: Orientation = .vertical,
        contentLength: Int,
        viewportSize: Int,
        offset: Int = 0
    )

    /// Render the scrollbar into the given frame.
    public func render(into frame: inout Frame)
}
```

### 3k. Calendar

```swift
/// A month-view calendar with date highlighting and selection.
public struct CalendarView: Sendable {
    /// The year to display.
    public var year: Int
    /// The month to display (1-12).
    public var month: Int
    /// The selected day (1-31), if any.
    public var selectedDay: Int?
    /// Days to highlight (e.g., days with events).
    public var highlightedDays: Set<Int>
    /// Style for the selected day.
    public var selectedStyle: CellStyle
    /// Style for highlighted days.
    public var highlightStyle: CellStyle
    /// Whether to show week numbers in the left column.
    public var showWeekNumbers: Bool

    public init(year: Int, month: Int, selectedDay: Int? = nil)

    /// Render the calendar into the given frame.
    public func render(into frame: inout Frame)
}
```

---

## 4. MCP Schema

Not applicable — widgets are local rendering primitives.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | All array indexing bounds-checked. `Table` column access guarded. `Calendar` day calculations use `DateComponents` safely. |
| **Sendable** | All widget types are value types. `@Sendable` closures on `Table.Column.render` and `Tree.renderNode`. State types (`TableState`, etc.) are plain value types. |
| **Guard clauses** | Empty data arrays → render nothing. Zero-area frames → early return. `Gauge.ratio` clamped to 0.0...1.0. `ProgressBar.total` guarded against zero (division safety). |
| **Division safety** | `Gauge`: ratio clamped before multiplication. `BarChart`: max value guarded against zero. `Sparkline`: auto-scale max guarded against zero. `Scrollbar`: viewport/content ratio guarded. |
| **Pointer safety** | No `withUnsafe*` blocks. All data is Swift value types. |
| **Concurrency** | All types are value types — no shared mutable state. Render closures are `@Sendable`. |
| **No hardcoded constants** | All visual parameters (bar width, gap, indent, separator) are configurable properties with sensible defaults. |

---

## 6. Backend Abstraction

Not applicable — no compute-intensive or platform-variant operations.

---

## 7. Dependencies

- **External:** None. Pure Swift value types using Foundation only (Foundation.Calendar for `CalendarView` date math).
- **Internal:** Depends on SwiftCLIKit v0.3.0 types: `Cell`, `CellBuffer`, `CellAttributes`, `Color`, `Frame`, `Rect`, `Layout`, `Block`, `Paragraph`, `BoxDrawing`.
- **Platforms:** macOS, Linux. All code is platform-independent.

---

## 8. Test Strategy

### Per-widget test pattern

Every widget gets three categories of tests:

**Golden-path rendering test:** Render into a known-size `CellBuffer`, assert specific cells at specific coordinates contain expected characters and styles.

**Empty data test:** Pass empty rows/items/data/bars — verify no crash, frame is untouched or shows placeholder.

**Overflow/scrolling test:** Data exceeds frame height — verify scroll offset is respected, correct subset of data is visible, scrollbar thumb position is accurate.

### Table tests

- 3 columns, 5 rows, 40x10 frame — headers in row 0, data in rows 1-5, column widths match constraints.
- Selected row highlighted with `highlightStyle`.
- Sort indicator: column 1 ascending — header shows up-arrow character.
- 20 rows in 10-row frame with `scrollOffset: 5` — rows 5-14 visible.
- Zero rows — headers still render, body empty.

### List tests

- 5 items, selected index 2 — item 2 has `highlightStyle`.
- 100 items in 10-row frame — scrollbar visible, thumb proportional to viewport/content ratio.
- Empty items list — no crash, frame untouched.

### Tree tests

- 3-level tree, all expanded — indent increases per level, guide characters present.
- Collapse a node — its children disappear from output.
- Selected node highlighted.
- Empty tree — no crash.

### Gauge tests

- Ratio 0.5 in 20-wide frame — 10 filled chars, 10 unfilled chars.
- Ratio 0.0 — all unfilled. Ratio 1.0 — all filled.
- Label "75%" centered over the bar.
- Negative ratio clamped to 0.0. Ratio > 1.0 clamped to 1.0.

### ProgressBar tests

- Current 3, total 10 — shows "30%" label, gauge at 0.3 ratio.
- Total 0 — no division crash, renders empty or 0%.

### Sparkline tests

- `[1, 3, 2, 5, 4]` in 5x3 frame — 5 columns, height-scaled values.
- Empty data — no crash.
- All same values — flat line at top.
- Single data point — one column filled.

### BarChart tests

- 3 bars with values `[10, 20, 15]` — bars proportional to values, labels below.
- `showValues: true` — value labels above bars.
- Zero bars — no crash.
- All zero values — empty bars (no division by zero).

### Tabs tests

- 3 tabs, active index 1 — tab 1 has `activeStyle`, others have `inactiveStyle`.
- Separator between tabs present.
- Single tab — no separator.

### Menu tests

- 4 items, selected 2 — item 2 highlighted.
- Key hints right-aligned.
- Disabled item uses `disabledStyle`.
- Empty menu — no crash.

### Scrollbar tests

- 100 content, 10 viewport, offset 0 — thumb at top, size proportional (10%).
- Offset 50 — thumb at midpoint.
- Content equals viewport — no thumb (or full-size thumb), no scrolling needed.
- Horizontal orientation — same logic along width axis.

### Calendar tests

- April 2026 — correct number of days (30), starts on correct weekday (Wednesday).
- Selected day 15 — day 15 cell has `selectedStyle`.
- Highlighted days {1, 10, 20} — those cells have `highlightStyle`.
- February leap year (2028) — 29 days displayed.
- Week numbers shown when `showWeekNumbers: true`.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? No — widgets follow the immediate-mode pattern established in ADR-011 (v0.3.0). No new architectural decisions.

---

## 10. Open Questions

1. **Generic vs. concrete Table:** Should `Table` be generic over `Row` (current design) or take `[[String]]` and handle formatting externally? **Recommendation:** Keep generic — the render closure provides flexibility without losing type safety. String-based convenience can be added as an extension.
2. **Sparkline character set:** Use Unicode block characters (more compatible) or braille dots (higher resolution)? **Recommendation:** Default to block characters with a `useBraille: Bool` option for terminals that support it.
3. **Calendar locale:** Should `CalendarView` respect the user's locale for first day of week (Sunday vs Monday)? **Recommendation:** Accept a `firstDayOfWeek: Int` parameter, defaulting to system locale via `Foundation.Calendar.current.firstWeekday`.
4. **Widget protocol:** Should there be a `Widget` protocol with a `render(into: inout Frame)` requirement? **Recommendation:** Not yet — adding a protocol is easy later if needed, but premature abstraction adds complexity. Individual widget structs are sufficient for v0.4.0.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Widget Gallery Article

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (10 widget types + state types + CellStyle)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Mild (immediate-mode pattern recap, state ownership)

**Article Name:** `WidgetGalleryGuide.md` — showcases each widget with a screenshot-equivalent ASCII rendering, minimal code example, and notes on state management. Organized as a visual catalog developers can scan to find the right widget.

DocC comments on all public API. Each widget gets a `/// ## Example` section showing construction and rendering.
