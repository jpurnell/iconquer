# Design Proposal: SwiftCLIKit v0.3.0 — Cells

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Cell-based rendering with differential updates, layout engine, and foundational widgets

---

## 1. Objective

**Objective:** Build the cell-based rendering layer that transforms SwiftCLIKit from a raw terminal library into an efficient TUI rendering engine. Introduce `CellBuffer` for 2D grid management, `DiffRenderer` for minimal-redraw performance, `Layout` for constraint-based rectangle splitting, and foundational content widgets (`Paragraph`, `Block`).

**Master Plan Reference:** SwiftCLIKit Roadmap v0.3.0 — Cells. Builds on v0.2.0 (Color, mouse, alternate screen).

**Problems solved:**
1. **Full-screen redraws are slow.** Without differential rendering, every frame redraws the entire terminal. `DiffRenderer` compares old/new buffers and emits ANSI sequences only for changed cells.
2. **No structured layout.** Manually computing x/y coordinates for every widget is error-prone. `Layout` provides constraint-based splitting of rectangular areas.
3. **No clipping.** Without bounded render targets, widgets can overwrite each other. `Frame` clips all writes to a defined `Rect`.
4. **No text reflow.** Multi-line text with word wrap, alignment, and ANSI-awareness requires dedicated logic. `Paragraph` handles this.
5. **No container abstraction.** Borders, titles, and padding are boilerplate. `Block` encapsulates the container pattern and returns an inner `Frame` for content.

---

## 2. Proposed Architecture

### Module structure (additions to SwiftCLIKit)

```
Sources/SwiftCLIKit/
├── Cell/
│   ├── Cell.swift              — Single terminal cell value type
│   ├── CellAttributes.swift    — OptionSet for bold, dim, italic, etc.
│   └── CellBuffer.swift        — 2D grid of Cells with write/fill operations
├── Rendering/
│   └── DiffRenderer.swift      — Compare old/new CellBuffer, emit minimal ANSI
├── Layout/
│   ├── Rect.swift              — Layout rectangle with intersection/contains/split
│   ├── Layout.swift            — Constraint solver: fixed, percentage, min, max, ratio
│   └── Frame.swift             — Rect-bounded render target with clipping
└── Widgets/
    ├── Paragraph.swift         — Multi-line text with wrap and alignment
    └── Block.swift             — Container: borders + title + padding → inner Frame
```

### Design philosophy

**Immediate-mode rendering.** Widgets are pure render functions with no internal state. The caller owns all state (selection indices, scroll offsets, text content) and passes it to widgets each frame. This follows the ratatui model rather than retained-mode (TermKit-style).

The render cycle is:
1. Create a fresh `CellBuffer` (or reuse a cleared one)
2. Split the buffer area into `Rect`s via `Layout`
3. Create `Frame`s from those `Rect`s
4. Call widget `render(into:)` methods, passing `Frame`s
5. Pass current and previous `CellBuffer` to `DiffRenderer` to produce the ANSI output string
6. Write the output string to stdout

---

## 3. API Surface

### 3a. Cell

```swift
/// Attributes that modify cell appearance.
public struct CellAttributes: OptionSet, Sendable, Equatable {
    public let rawValue: UInt8
    public init(rawValue: UInt8)

    public static let bold: CellAttributes
    public static let dim: CellAttributes
    public static let italic: CellAttributes
    public static let underline: CellAttributes
    public static let blink: CellAttributes
    public static let reverse: CellAttributes
    public static let strikethrough: CellAttributes
}

/// A single terminal cell: one character with styling.
public struct Cell: Sendable, Equatable {
    public var character: Character
    public var fg: Color
    public var bg: Color
    public var attributes: CellAttributes

    public init(
        character: Character = " ",
        fg: Color = .default,
        bg: Color = .default,
        attributes: CellAttributes = []
    )

    /// A blank cell with default colors and no attributes.
    public static let empty: Cell

    /// Display width of this cell's character in terminal columns.
    /// Uses `UnicodeWidth.width(of:)` from v0.1.0.
    /// Wide characters (CJK, emoji) return 2; combining marks return 0.
    public var displayWidth: Int { get }
}
```

### 3b. CellBuffer

```swift
/// A 2D grid of Cells representing the terminal screen contents.
/// Wide characters (displayWidth == 2) occupy two cell slots;
/// the second slot is automatically filled with a continuation marker.
public struct CellBuffer: Sendable {
    /// Create a buffer filled with `Cell.empty`.
    public init(width: Int, height: Int)

    /// Buffer width in columns.
    public var width: Int { get }

    /// Buffer height in rows.
    public var height: Int { get }

    /// Access a cell by coordinates. Out-of-bounds access returns `Cell.empty`
    /// for reads and is a no-op for writes.
    public subscript(x: Int, y: Int) -> Cell { get set }

    /// Fill a rectangular region with a given cell.
    public mutating func fill(_ rect: Rect, with cell: Cell)

    /// Write a text string starting at (x, y) with the given style.
    /// Characters that fall outside the buffer bounds are silently clipped.
    public mutating func writeText(
        _ text: String,
        at position: (x: Int, y: Int),
        fg: Color = .default,
        bg: Color = .default,
        attributes: CellAttributes = []
    )

    /// Reset all cells to `Cell.empty`.
    public mutating func clear()
}
```

### 3c. DiffRenderer

```swift
/// Compares two CellBuffers and produces the minimal ANSI escape sequence
/// string to transform the terminal from the previous state to the current state.
public struct DiffRenderer: Sendable {
    public init()

    /// Render the difference between `current` and `previous`.
    /// If `previous` is nil, a full redraw is performed.
    /// Returns an ANSI escape sequence string ready to write to stdout.
    public mutating func render(current: CellBuffer, previous: CellBuffer?) -> String
}
```

### 3d. Rect

```swift
/// A rectangle in terminal cell coordinates (origin at top-left).
public struct Rect: Sendable, Equatable {
    public var x: Int
    public var y: Int
    public var width: Int
    public var height: Int

    public init(x: Int, y: Int, width: Int, height: Int)

    /// The area (width * height) of this rectangle.
    public var area: Int { get }

    /// Whether this rectangle has zero area.
    public var isEmpty: Bool { get }

    /// The intersection of this rectangle with another, or nil if they do not overlap.
    public func intersection(_ other: Rect) -> Rect?

    /// Whether this rectangle contains the given point.
    public func contains(x: Int, y: Int) -> Bool

    /// Split this rectangle into sub-rectangles along the given direction
    /// using the given constraints.
    public func split(
        direction: Layout.Direction,
        constraints: [Layout.Constraint]
    ) -> [Rect]
}
```

### 3e. Layout

```swift
/// Constraint-based layout solver for splitting rectangles.
public enum Layout {
    /// The direction to split a rectangle.
    public enum Direction: Sendable {
        case horizontal
        case vertical
    }

    /// A constraint for how a sub-rectangle should be sized.
    public enum Constraint: Sendable {
        /// Exact size in cells.
        case fixed(Int)
        /// Percentage of available space (0-100).
        case percentage(UInt16)
        /// Minimum size in cells (fills remaining space, but no smaller than this).
        case min(Int)
        /// Maximum size in cells (fills remaining space, but no larger than this).
        case max(Int)
        /// Ratio of available space (numerator, denominator).
        case ratio(Int, Int)
    }

    /// Split `area` into sub-rectangles along `direction` using `constraints`.
    /// Returns one Rect per constraint. If constraints exceed available space,
    /// later constraints receive zero-width/height rectangles.
    public static func split(
        area: Rect,
        direction: Direction,
        constraints: [Constraint]
    ) -> [Rect]
}
```

### 3f. Frame

```swift
/// A bounded render target that clips writes to a specific Rect within a CellBuffer.
public struct Frame: Sendable {
    /// The rectangle this frame covers in buffer coordinates.
    public let rect: Rect

    /// Set a cell at buffer-relative coordinates. Writes outside `rect` are silently ignored.
    public mutating func setCell(x: Int, y: Int, cell: Cell)

    /// Write a text string at frame-relative coordinates with the given style.
    /// Characters outside the frame are clipped.
    public mutating func writeText(
        _ text: String,
        x: Int,
        y: Int,
        fg: Color = .default,
        bg: Color = .default,
        attributes: CellAttributes = []
    )

    /// Create a sub-frame bounded to the given rect (intersected with this frame's rect).
    public func subFrame(_ rect: Rect) -> Frame
}
```

### 3g. Paragraph

```swift
/// Multi-line text renderer with word wrap and alignment.
public struct Paragraph: Sendable {
    /// Text alignment within the frame.
    public enum Alignment: Sendable {
        case left
        case center
        case right
    }

    /// The raw text to render (may contain ANSI escape sequences).
    public var text: String

    /// Text alignment. Default: `.left`.
    public var alignment: Alignment

    /// Whether to word-wrap long lines. Default: `true`.
    public var wrap: Bool

    public init(text: String, alignment: Alignment = .left, wrap: Bool = true)

    /// Render this paragraph into the given frame with the specified style.
    public func render(
        into frame: inout Frame,
        fg: Color = .default,
        bg: Color = .default
    )
}
```

### 3h. Block

```swift
/// A container widget that renders borders and an optional title,
/// returning an inner Frame for content rendering.
public struct Block: Sendable {
    /// Optional title displayed in the top border.
    public var title: String?

    /// Which borders to draw.
    public var borders: BorderSet

    /// The box drawing character set to use.
    public var boxDrawing: BoxDrawing

    /// Title alignment within the top border.
    public var titleAlignment: Paragraph.Alignment

    public init(
        title: String? = nil,
        borders: BorderSet = .all,
        boxDrawing: BoxDrawing = .unicode,
        titleAlignment: Paragraph.Alignment = .left
    )

    /// Render the block's borders and title into `frame`, returning an inner
    /// Frame for content. The inner frame is inset by borders and padding.
    public func render(into frame: inout Frame) -> Frame
}

/// Which borders to draw on a Block.
public struct BorderSet: OptionSet, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8)

    public static let top: BorderSet
    public static let bottom: BorderSet
    public static let left: BorderSet
    public static let right: BorderSet
    public static let all: BorderSet
    public static let none: BorderSet
}
```

---

## 4. MCP Schema

Not applicable — cell rendering is a local-only feature.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | All subscript access bounds-checked; out-of-range returns `.empty` or no-ops |
| **Sendable** | All types are value types conforming to `Sendable`. No `@unchecked Sendable` needed. |
| **Guard clauses** | `CellBuffer` subscripts guard bounds. `Layout.split` guards zero-area rects. `Frame.setCell` guards clipping. |
| **Division safety** | `Layout.Constraint.ratio(n, d)` guards `d == 0` (treated as zero-width). `percentage` guards against values > 100. |
| **Pointer safety** | No `withUnsafe*` blocks. `CellBuffer` backed by flat `[Cell]` array. |
| **Concurrency** | All types are value types — no shared mutable state. `DiffRenderer` is a struct with internal previous-buffer state (copy-on-write). |
| **No hardcoded constants** | `Cell.empty` uses `.default` colors. Buffer dimensions come from caller. No magic numbers. |

---

## 6. Backend Abstraction

Not applicable — no compute-intensive or platform-variant operations.

---

## 7. Dependencies

- **External:** None. Pure Swift value types using Foundation only.
- **Internal:** Depends on SwiftCLIKit v0.2.0 types: `Color` (for cell foreground/background), `BoxDrawing` (for `Block` borders), `ANSICodes` (for `DiffRenderer` escape sequence generation).
- **Platforms:** macOS, Linux. All code is platform-independent (no Darwin/Glibc-specific calls).

---

## 8. Test Strategy

### CellBuffer tests

- **Write/read round-trip:** Set cell at (3, 5), read back, verify character/fg/bg/attributes match.
- **Fill region:** Fill `Rect(x: 1, y: 1, width: 3, height: 2)` with a styled cell, verify all 6 cells match.
- **Out-of-bounds write:** Write at negative coordinates and beyond buffer bounds — no crash, values unchanged.
- **Out-of-bounds read:** Read at negative coordinates — returns `Cell.empty`.
- **writeText:** Write `"hello"` at (2, 0), verify 5 consecutive cells contain h-e-l-l-o with correct style.
- **writeText clipping:** Write long string that extends past buffer width — truncated, no crash.
- **Clear:** Fill buffer, call `clear()`, verify all cells are `Cell.empty`.

### DiffRenderer tests

- **Identical buffers:** Same current and previous — returns empty string (no escape sequences emitted).
- **Single cell change:** Change one cell at (5, 3) — output contains exactly one cursor-position sequence and one character write.
- **Full change (nil previous):** Pass `previous: nil` — output contains complete redraw of all non-empty cells.
- **Style-only change:** Same character, different foreground color — emits SGR change + character.
- **Cell count verification:** Count characters written in output, verify it matches number of changed cells.
- **Adjacent changes:** Two horizontally adjacent changed cells — no redundant cursor movement between them.

### Layout tests

- **Fixed + percentage:** Split 100-wide rect into `[.fixed(20), .percentage(50), .fixed(30)]` — widths are 20, 50, 30.
- **Ratio constraints:** Split 120-wide rect into `[.ratio(1, 3), .ratio(2, 3)]` — widths are 40, 80.
- **Min/max clamping:** `.min(30)` in a 20-wide area — gets 20 (clamped). `.max(10)` in a 50-wide area with one constraint — gets 10.
- **Zero-width edge case:** Split a zero-width rect — returns rects with zero width, no crash.
- **Vertical split:** Same tests but splitting height instead of width.
- **Overflow:** Constraints that total more than available space — later constraints get zero.

### Rect tests

- **Intersection:** Two overlapping rects — correct overlap region. Non-overlapping — returns nil.
- **Contains:** Point inside, on edge, and outside rect.
- **Area and isEmpty:** Zero-width rect has area 0, isEmpty true.

### Frame tests

- **Clipping:** Create frame at `Rect(x: 5, y: 5, width: 10, height: 5)`, write at (-1, 0) — ignored. Write at (10, 0) — ignored.
- **Valid write:** Write within frame bounds — cell appears in underlying buffer at correct offset.
- **Nested frames (subFrame):** Create sub-frame from frame — writes clipped to intersection.
- **writeText:** Text starting inside frame but extending past right edge — truncated at frame boundary.

### Paragraph tests

- **Word wrap:** 40-char text in 20-wide frame — wraps at word boundary, producing 2 lines.
- **No wrap:** `wrap: false` — long line truncated at frame width.
- **Left alignment:** Text left-justified (no leading spaces).
- **Center alignment:** Text centered with equal padding on both sides (within 1 cell for odd widths).
- **Right alignment:** Text right-justified.
- **Empty text:** Renders nothing, no crash.
- **ANSI-aware splitting:** Text with embedded ANSI codes — visible length calculated correctly for wrap.

### Block tests

- **All borders:** Block with all borders in 20x10 frame — corners, horizontals, verticals present.
- **Title rendering:** Block with title "Status" — title appears in top border.
- **Inner frame dimensions:** 20x10 outer with all borders — inner frame is 18x8.
- **Partial borders:** Only top+bottom — inner frame width equals outer width.
- **Title alignment:** Center-aligned title appears centered in top border.
- **BoxDrawing.ascii fallback:** Block with `.ascii` box drawing uses `+`, `-`, `|` characters.

### Validation trace

- Create 80x24 `CellBuffer` → split into 3 horizontal rects → create `Frame`s → render `Block` with title into first → render `Paragraph` into inner frame → pass to `DiffRenderer` with nil previous → verify output contains border characters, title text, and wrapped paragraph text.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** — ADR-011

**New ADR Draft:**

**ADR-011:**
- **Title:** Immediate-mode rendering (ratatui-style) for widget architecture
- **Category:** architecture
- **Key decision:** Widgets are pure render functions with no internal state. The caller owns all state (selection, scroll, text) and passes it to widgets each frame. Chosen over retained-mode (TermKit-style) for: (1) testability — render functions are pure and deterministic, (2) simplicity — no widget lifecycle management, (3) composability — widgets are just functions that write to Frames, (4) alignment with Swift value types — no reference-type widget trees.

---

## 10. Open Questions

1. ~~**Wide characters (CJK, emoji):** Should `Cell` track display width?~~ **Resolved:** Yes. `Cell.displayWidth` is a computed property backed by `UnicodeWidth.width(of:)` from v0.1.0. `CellBuffer.writeText` handles wide characters by filling continuation cells. No deferred work — Unicode width ships in the foundation layer.
2. **CellBuffer backing store:** Flat `[Cell]` array vs. array-of-rows `[[Cell]]`? **Recommendation:** Flat array with `y * width + x` indexing for cache locality and copy-on-write efficiency.
3. **DiffRenderer cursor optimization:** Should the renderer use absolute cursor positioning (`\e[row;colH`) or relative movement (`\e[nC`, `\e[nB`)? **Recommendation:** Absolute positioning for simplicity in v0.3.0; optimize to relative in a later version if profiling shows benefit.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Narrative Article

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (Cell, CellBuffer, DiffRenderer, Layout, Rect, Frame, Paragraph, Block)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (immediate-mode rendering, differential updates, constraint-based layout)

**Article Name:** `CellRenderingGuide.md` — covers the render cycle (buffer → layout → frame → widget → diff → output), with a worked example building a two-panel layout with bordered content.

DocC comments on all public API. Each type gets a `/// ## Example` section showing minimal usage.
