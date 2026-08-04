# Design Proposal: TUI Polish — IconquerCLI v0.5.0 + SwiftCLIKit Library

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Extract reusable terminal library; raw mode, line editor, SIGWINCH, integrated errors, continent grouping
**Depends on:** SwiftCLIKit v0.2.0 (Color release — truecolor for player colors, alternate screen, mouse)

---

## 1. Objective

**Objective:** Extract generic terminal infrastructure into a standalone `SwiftCLIKit` library (sibling repo), then use it to ship a production-quality IconquerCLI v0.5.0 with raw terminal mode, arrow-key line editing, resize handling, integrated error display, and continent grouping.

**Master Plan Reference:** Phase 2 — CLI polish before architecture/app work.

**Problems solved:**
1. **Input echo:** Terminal is in canonical (cooked) mode — user keystrokes echo below the TUI frame. Need raw mode via `termios` to suppress echo and read character-by-character.
2. **No line editing:** `readLine()` provides no arrow key navigation or command history. Users expect readline-like behavior.
3. **No resize handling:** Terminal resize (SIGWINCH) is ignored. The TUI should re-render to fit.
4. **Error display outside frame:** Errors (`⚠ illegal move`, parse failures) print below the TUI via `output.write()`. They must render *inside* the TUI status area.
5. **Flat country list:** The 42-country world map is one unsorted list. Grouping by continent makes it scannable.
6. **Non-reusable infrastructure:** ANSI codes, box drawing, screen buffer, terminal sizing, and color resolution are baked into IconquerCLI with no way to reuse them in other CLI apps.

---

## 2. Proposed Architecture

### New sibling repo: `SwiftCLIKit`

A zero-dependency SPM package (Foundation + Darwin/Glibc only) providing generic terminal building blocks.

```
SwiftCLIKit/                          (sibling to IconquerCLI, IconquerCore, etc.)
├── Package.swift
├── Sources/SwiftCLIKit/
│   ├── Terminal/
│   │   ├── RawTerminal.swift       — RAII termios wrapper (raw mode on/off)
│   │   ├── TerminalSize.swift      — ioctl TIOCGWINSZ + SIGWINCH handler
│   │   └── TerminalSettings.swift  — colorMode, asciiOnly, renderWidth + persistence
│   ├── Input/
│   │   ├── LineEditor.swift        — Arrow keys, Home/End, backspace, Ctrl-A/E/K/W
│   │   ├── InputHistory.swift      — Up/Down arrow command recall
│   │   └── KeyReader.swift         — Byte→Key mapping (escape sequence parser)
│   ├── Rendering/
│   │   ├── ANSICodes.swift         — Escape constants + 8/256/truecolor helpers
│   │   ├── ScreenBuffer.swift      — Line-based buffer with append/appendLine
│   │   ├── BoxDrawing.swift        — ASCII/Unicode border chars + border builders
│   │   └── StatusArea.swift        — Push/clear status messages, dynamic height
│   └── Util/
│       ├── ANSIStringMetrics.swift — visibleLength(), padVisible(), truncateVisible()
│       └── HexColor.swift          — hex string → ANSI escape mapping
└── Tests/SwiftCLIKitTests/
    ├── KeyReaderTests.swift
    ├── LineEditorTests.swift
    ├── InputHistoryTests.swift
    ├── BoxDrawingTests.swift
    ├── ANSIStringMetricsTests.swift
    ├── StatusAreaTests.swift
    ├── HexColorTests.swift
    ├── TerminalSettingsTests.swift
    └── RawTerminalTests.swift
```

### Modified in IconquerCLI

```
IconquerCLI/
├── Package.swift                   — add SwiftCLIKit dependency
├── Sources/IconquerCLILib/
│   ├── TUIRenderer.swift           — use SwiftCLIKit primitives; add continent grouping
│   └── PlayRunner.swift            — use RawTerminal + LineEditor for input;
│                                     route errors through StatusArea
└── Sources/iconquer-cli/
    └── IconquerCLICommand.swift    — enable raw mode when --tui
```

**Removed from IconquerCLILib** (migrated to SwiftCLIKit):
- ANSI constants (private lets at bottom of TUIRenderer)
- `Screen` struct
- Box drawing helpers
- `terminalSize()` method
- `visibleLength()` / `padVisible()`
- `hexToAnsi()`
- Color resolution logic from `Renderer.swift`
- `renderWidth`, `colorMode`, `asciiOnly` from `CLISettings`

---

## 3. API Surface

### 3a. SwiftCLIKit — Terminal/RawTerminal

```swift
/// Switches stdin to raw mode on init; restores original settings on deinit.
public final class RawTerminal: @unchecked Sendable {
    // Justification: original termios stored at init, restored at deinit only

    /// Enable raw mode. Stores original termios for restoration.
    /// Falls back to no-op on platforms without termios.
    public init(fileDescriptor: Int32 = STDIN_FILENO)

    /// Restore original terminal settings.
    deinit

    /// Read a single byte from stdin. Returns nil on EOF.
    public func readByte() -> UInt8?

    /// Whether raw mode is active (false on unsupported platforms).
    public var isRawMode: Bool { get }
}
```

### 3b. SwiftCLIKit — Terminal/TerminalSize

```swift
/// Terminal dimensions with SIGWINCH observation.
public struct TerminalSize: Sendable {
    public var columns: Int
    public var rows: Int

    /// Query current terminal size via ioctl.
    public static func current(
        fileDescriptor: Int32 = STDOUT_FILENO,
        fallback: TerminalSize = TerminalSize(columns: 80, rows: 24)
    ) -> TerminalSize

    /// Install a SIGWINCH handler that calls `onChange` on resize.
    /// Returns a token; handler is removed when token is deallocated.
    public static func onResize(_ onChange: @escaping @Sendable (TerminalSize) -> Void) -> ResizeToken
}

/// RAII token — removing the handler when deallocated.
public final class ResizeToken: @unchecked Sendable {
    // Justification: signal handler registration is thread-safe; dealloc removes it
    deinit
}
```

### 3c. SwiftCLIKit — Input/KeyReader

```swift
/// Parsed key from raw terminal input.
public enum Key: Sendable, Equatable {
    case character(Character)
    case backspace
    case delete
    case enter
    case tab
    case escape
    case arrowUp, arrowDown, arrowLeft, arrowRight
    case home, end
    case ctrlC, ctrlD, ctrlA, ctrlE, ctrlK, ctrlW
    case unknown(UInt8)
}

/// Reads raw bytes from a RawTerminal and parses them into Key values.
public struct KeyReader: Sendable {
    public init(terminal: RawTerminal)

    /// Read the next key. Blocks until input available. Returns nil on EOF.
    public func readKey() -> Key?
}
```

### 3d. SwiftCLIKit — Input/LineEditor

```swift
/// Single-line text editor with cursor movement and editing commands.
public struct LineEditor: Sendable {
    public private(set) var text: String
    public private(set) var cursorPosition: Int

    public init(text: String = "")

    /// Process a key event. Returns the completed line if Enter was pressed,
    /// nil to continue editing. Returns `.eof` on Ctrl-D.
    public mutating func handleKey(_ key: Key) -> LineResult

    /// The current display string with cursor position for rendering.
    public var displayText: String { get }
}

public enum LineResult: Sendable, Equatable {
    case editing          // Still editing, re-render prompt
    case completed(String) // User pressed Enter
    case eof              // Ctrl-D
    case interrupt        // Ctrl-C
}
```

### 3e. SwiftCLIKit — Input/InputHistory

```swift
/// Command history with up/down navigation.
public struct InputHistory: Sendable {
    public init(maxEntries: Int = 100)

    public mutating func add(_ line: String)
    public mutating func navigateUp(current: String) -> String?
    public mutating func navigateDown() -> String?
    public mutating func reset()
}
```

### 3f. SwiftCLIKit — Rendering/ScreenBuffer

```swift
/// Line-based screen buffer for composing full-screen TUI output.
public struct ScreenBuffer: Sendable {
    public init(width: Int)

    public mutating func append(_ text: String)
    public mutating func appendLine(_ text: String)

    /// The accumulated string including clear-screen + cursor-home prefix.
    public var frame: String { get }
}
```

### 3g. SwiftCLIKit — Rendering/BoxDrawing

```swift
/// Box drawing character sets with ASCII fallback.
public struct BoxDrawing: Sendable {
    public let topLeft, topRight, bottomLeft, bottomRight: String
    public let horizontal, vertical: String
    public let leftTee, rightTee, topTee, bottomTee, cross: String

    public static let unicode: BoxDrawing
    public static let ascii: BoxDrawing

    /// Build a top border with embedded header text.
    public func topBorder(_ header: String, width: Int) -> String

    /// Build a horizontal separator.
    public func midBorder(width: Int) -> String

    /// Build a bottom border.
    public func bottomBorder(width: Int) -> String
}
```

### 3h. SwiftCLIKit — Rendering/StatusArea

```swift
/// Dynamic-height status message buffer for TUI integration.
public final class StatusArea: @unchecked Sendable {
    // Justification: NSLock-protected mutations only

    public init(maxMessages: Int = 5)

    /// Push a status/error message.
    public func push(_ message: String)

    /// Clear all messages.
    public func clear()

    /// Render status lines for the given width. Returns empty array if no messages.
    public func render(width: Int, colorize: Bool) -> [String]

    /// Number of lines the status area currently needs.
    public var lineCount: Int { get }
}
```

### 3i. SwiftCLIKit — Terminal/TerminalSettings

```swift
/// Generic terminal presentation settings, persisted to XDG config.
public struct TerminalSettings: Codable, Sendable {
    public enum ColorMode: String, Codable, Sendable {
        case auto, always, never
    }

    public var renderWidth: Int       // 0 = auto-detect
    public var colorMode: ColorMode   // default: .auto
    public var asciiOnly: Bool        // default: false

    /// Resolve whether color should be used right now.
    public func resolveColor(isattyOverride: Bool? = nil) -> Bool

    /// Load from XDG config path, falling back to defaults.
    public static func load(appName: String) -> TerminalSettings

    /// Save to XDG config path.
    public func save(appName: String) throws
}
```

### 3j. IconquerCLI — TUIRenderer changes

```swift
// render() signature unchanged. Internal changes:
// - renderBoard() groups by continent when map.continents is non-empty
// - Status area uses SwiftCLIKit.StatusArea
// - Box drawing uses SwiftCLIKit.BoxDrawing
// - Screen uses SwiftCLIKit.ScreenBuffer
```

### 3k. IconquerCLI — PlayRunner changes

```swift
// runGame() signature gains optional RawTerminal parameter:
public func runGame(
    seed: UInt32,
    players: [Player],
    settings: Settings = Settings(),
    nextLine: @Sendable () -> String?,       // kept for non-TUI / test mode
    terminal: RawTerminal? = nil,             // NEW: for TUI raw mode
    output: PlayOutput = ConsoleOutput()
) async throws -> PlayOutcome
```

When `terminal` is provided:
- Input read via `KeyReader` + `LineEditor` + `InputHistory` instead of `nextLine()`
- Errors routed through `tuiRenderer.statusArea.push()` + re-render
- SIGWINCH triggers re-render via `TerminalSize.onResize`

---

## 4. MCP Schema

Not applicable — TUI and terminal primitives are local-only features.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | All termios/ioctl calls return-checked; fallback on failure |
| **Sendable** | `RawTerminal`: `@unchecked Sendable` + justification (init/deinit). `StatusArea`: `@unchecked Sendable` + justification (NSLock). All value types are `Sendable`. |
| **Guard clauses** | Platform guarded via `#if canImport(Darwin) \|\| canImport(Glibc)` |
| **Division safety** | N/A |
| **Pointer safety** | `termios` is a value type copy, never stored as pointer. `withUnsafe*` not used. |
| **Concurrency** | Single-thread stdin reads in `RawTerminal`; `StatusArea` NSLock-protected. SIGWINCH handler sets atomic flag, no actor isolation needed. |
| **No hardcoded constants** | Max history entries, max status messages, fallback terminal size all configurable via init parameters |

---

## 6. Backend Abstraction

Not applicable — no compute-intensive operations.

---

## 7. Dependencies

### SwiftCLIKit (the new library)
- **External:** None. Foundation + Darwin/Glibc only.
- **Platforms:** macOS, Linux. Graceful no-op fallback on other platforms.

### IconquerCLI
- **New dependency:** `SwiftCLIKit` (local path sibling)
- **Existing:** `IconquerCore`, `IconquerMatch`, `IconquerAI` (unchanged)

---

## 8. Test Strategy

### SwiftCLIKit tests

**KeyReader:**
- Escape sequence parsing: `\x1B[A` → `.arrowUp`, `\x1B[B` → `.arrowDown`, etc.
- Control characters: `\x03` → `.ctrlC`, `\x04` → `.ctrlD`, `\x7F` → `.backspace`
- Printable characters: `a` → `.character("a")`
- UTF-8 multibyte: `é` (2 bytes) → `.character("é")`
- Inject bytes via pipe fd (no TTY needed in CI)

**LineEditor:**
- Golden path: type `"hello"` + Enter → `.completed("hello")`
- Backspace: `"helo\x7Flo"` → text is `"hello"`
- Arrow left + insert: `"hllo"` → left×3 → type `"e"` → `"hello"`
- Home/End: cursor jumps to 0 / text.count
- Ctrl-K: kill to end of line
- Ctrl-W: delete word backward
- Ctrl-A/Ctrl-E: same as Home/End
- Empty + Ctrl-D → `.eof`
- Ctrl-C → `.interrupt`

**InputHistory:**
- Add 3 entries, navigate up 3× → retrieves in reverse order
- Navigate down returns toward current
- Duplicates not added consecutively
- Max entries respected (oldest dropped)

**BoxDrawing:**
- Unicode top border with header → `"┌ Header ──────┐"`
- ASCII top border with header → `"+- Header -----+"`
- Mid/bottom borders at various widths

**ANSIStringMetrics:**
- `visibleLength("plain")` → 5
- `visibleLength("\u{001B}[31mred\u{001B}[0m")` → 3
- `padVisible()` pads to visible width
- `truncateVisible()` at ANSI boundary doesn't break escape

**StatusArea:**
- Push 1 message → render returns 1 line
- Push 6 messages (max 5) → only last 5 rendered
- Clear → render returns empty
- Thread safety: push from multiple threads, no crashes

**HexColor:**
- Known hex values map correctly: `"#e53935"` → `"\u{001B}[31m"`
- Unknown hex → empty string (no crash)

**TerminalSettings:**
- Load missing file → returns defaults
- Round-trip save → load preserves values
- `resolveColor(.never)` → false, `resolveColor(.always)` → true
- `resolveColor(.auto)` with `NO_COLOR` env → false

**RawTerminal:**
- Pipe-based test: write bytes to pipe, read via `readByte()` → matches
- `isRawMode` true on Darwin, false on unsupported platform

**TerminalSize:**
- `current()` returns non-zero on Darwin (may be fallback in CI)
- Fallback values used when ioctl fails

### IconquerCLI tests

**TUIRenderer — continent grouping:**
- World map (42 countries, 6 continents) → output contains continent headers: `"North America (+5)"`, `"Europe (+5)"`, `"Asia (+7)"`, etc.
- Small map (duel, 2 countries, 1 continent) → single group
- Map with empty continents array → flat alphabetical list (backward compat)
- Country not in any continent → listed under "Other" section

**TUIRenderer — integrated status:**
- `pushStatus("⚠ illegal move")` → status appears in rendered frame
- Dynamic height: 0 messages → 0 extra lines; 3 messages → 3 lines
- Status area between mid-border and prompt line

**PlayRunner — error routing:**
- TUI mode: illegal move appears in rendered frame, NOT in `CapturingOutput`
- Non-TUI mode: errors still go through `output.write()` (regression guard)
- SIGWINCH flag triggers re-render (test via mock resize callback)

**Validation Trace:**
- Render `StarterMaps.world` → verify `"North America (+5)"` present
- Push status `"⚠ illegal move: attack X Y"` → verify string in render output
- Type `"hello"` via LineEditor → verify `.completed("hello")`
- Arrow left×2, type `"XY"` into `"abc"` → verify text is `"aXYbc"`

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** → ADR-009, ADR-010

**New ADR Drafts:**

**ADR-009:**
- **Title:** SwiftCLIKit extracted as reusable terminal library
- **Category:** architecture
- **Key decision:** Generic terminal primitives (raw mode, ANSI, box drawing, line editing, screen buffer, terminal sizing) live in a standalone `SwiftCLIKit` SPM package (sibling repo). Game-specific rendering stays in IconquerCLI. This avoids rebuilding terminal infrastructure for future CLI projects.

**ADR-010:**
- **Title:** Raw terminal mode via POSIX termios (no ncurses)
- **Category:** architecture
- **Key decision:** Use POSIX `termios`/`cfmakeraw` directly for raw terminal mode rather than depending on ncurses or a Swift TUI framework. RAII pattern ensures terminal is always restored on exit.

---

## 10. Open Questions

1. ~~**Line editing:** Arrow key support?~~ **Resolved: Yes.** Full arrow key, Home/End, Ctrl-A/E/K/W support.
2. ~~**SIGWINCH:** Handle terminal resize?~~ **Resolved: Yes.** `TerminalSize.onResize` token-based handler.
3. ~~**Status area height:** Fixed or dynamic?~~ **Resolved: Dynamic.** `StatusArea.lineCount` drives layout.
4. ~~**Library name:** Collision risk?~~ **Resolved: `SwiftCLIKit`.**
5. **Command history persistence:** Should `InputHistory` save to disk (like `.bash_history`) or stay in-memory only for v1? (Recommend: in-memory for v1; disk persistence as a future enhancement.)

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Brief Narrative Article

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (RawTerminal + KeyReader + LineEditor + ScreenBuffer + BoxDrawing)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Mild (termios, ANSI escape sequences)

**Article Name:** `SwiftCLIKitGuide.md` — covers library overview, integration pattern, and platform support.

DocC comments on all public API in SwiftCLIKit. IconquerCLI changes get inline comments only (internal).
