# Design Proposal: SwiftCLIKit v0.1.0 (Foundation)

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Raw terminal control, input parsing, line editing, rendering primitives -- the foundational layer for a pure-Swift terminal abstraction library.

---

## 1. Objective

**Objective:** Ship SwiftCLIKit v0.1.0 as a standalone sibling SPM package providing core terminal primitives -- raw mode, key parsing, single-line editing, command history, ANSI rendering, and screen management -- sufficient to build a full-screen TUI application by hand, with zero C dependencies.

**Master Plan Reference:** Phase 2 -- CLI infrastructure extraction. SwiftCLIKit is the reusable foundation that IconquerCLI v0.5.0 (and all future CLI projects) will depend on.

**Roadmap Reference:** `SwiftCLIKit_ROADMAP.md` -- v0.1.0 is the first of seven planned releases. It covers Layer 1 (Terminal) primitives only. Color negotiation, mouse, alternate screen, cell rendering, widgets, and the app framework come in later versions.

**Problems solved:**
1. **No pure-Swift terminal abstraction exists.** Every Swift TUI library wraps ncurses (C dependency) or hand-rolls incomplete ANSI handling. SwiftCLIKit fills this gap.
2. **Raw mode is unsafe without RAII.** Forgetting to restore termios leaves the user's terminal broken. The `RawTerminal` class guarantees restoration via deinit.
3. **Escape sequence parsing is error-prone.** Arrow keys, Home/End, Delete, and Ctrl sequences arrive as multi-byte escape sequences. `KeyReader` handles the state machine correctly.
4. **Line editing is missing from readLine().** Foundation's `readLine()` provides no cursor movement, no kill/yank, no history. `LineEditor` + `InputHistory` provide readline-like behavior.
5. **ANSI string metrics are wrong everywhere.** `String.count` includes invisible escape sequences. `ANSIStringMetrics` computes visible width correctly for padding and truncation.
6. **Terminal infrastructure is duplicated across projects.** ANSI codes, box drawing, screen buffers, terminal sizing, and color resolution are reimplemented in every CLI app. SwiftCLIKit extracts them once.

---

## 2. Proposed Architecture

### New sibling repo: `SwiftCLIKit`

A zero-dependency SPM package (Foundation + Darwin/Glibc only, swift-tools-version: 6.0, platforms: macOS 15+, Linux) providing generic terminal building blocks organized into four modules.

```
SwiftCLIKit/                          (sibling to IconquerCLI, IconquerCore, etc.)
├── Package.swift                     (swift-tools-version: 6.0, platforms: macOS 15+, linux)
├── Sources/SwiftCLIKit/
│   ├── Terminal/
│   │   ├── RawTerminal.swift         — RAII termios wrapper (raw mode on/off)
│   │   ├── TerminalSize.swift        — ioctl TIOCGWINSZ + SIGWINCH handler with ResizeToken
│   │   └── TerminalSettings.swift    — colorMode/asciiOnly/renderWidth + XDG persistence
│   ├── Input/
│   │   ├── KeyReader.swift           — Byte→Key parser (arrows, Home/End, Ctrl-*, backspace, delete)
│   │   ├── LineEditor.swift          — Single-line editor with cursor movement, Ctrl-A/E/K/W
│   │   └── InputHistory.swift        — Up/down arrow command recall
│   ├── Rendering/
│   │   ├── ANSICodes.swift           — Clear, home, cursor movement, SGR attributes, 8-color
│   │   ├── ScreenBuffer.swift        — Line-based string accumulator with clear-screen prefix
│   │   ├── BoxDrawing.swift          — ASCII/Unicode border chars + builder functions
│   │   └── StatusArea.swift          — Dynamic-height push/clear message buffer
│   └── Util/
│       ├── ANSIStringMetrics.swift   — visibleLength, padVisible, truncateVisible (Unicode-aware)
│       ├── UnicodeWidth.swift        — East Asian Width + emoji display width lookup
│       └── HexColor.swift            — Hex string → ANSI 8-color mapping
└── Tests/SwiftCLIKitTests/
    ├── RawTerminalTests.swift
    ├── KeyReaderTests.swift
    ├── LineEditorTests.swift
    ├── InputHistoryTests.swift
    ├── BoxDrawingTests.swift
    ├── ANSIStringMetricsTests.swift
    ├── StatusAreaTests.swift
    ├── HexColorTests.swift
    ├── UnicodeWidthTests.swift
    ├── TerminalSettingsTests.swift
    └── ScreenBufferTests.swift
```

### Module organization

| Module | Responsibility | Key types |
|--------|---------------|-----------|
| **Terminal/** | Low-level terminal control | `RawTerminal`, `TerminalSize`, `ResizeToken`, `TerminalSettings` |
| **Input/** | Key parsing and line editing | `Key`, `KeyReader`, `LineEditor`, `LineResult`, `InputHistory` |
| **Rendering/** | ANSI output and screen composition | `ANSICodes`, `ANSIColor`, `ScreenBuffer`, `BoxDrawing`, `StatusArea` |
| **Util/** | String measurement, Unicode width, and color mapping | `ANSIStringMetrics`, `UnicodeWidth`, `HexColor` |

### Data flow

```
stdin bytes
  │
  ▼
RawTerminal.readByte()    ← raw mode suppresses echo, reads char-by-char
  │
  ▼
KeyReader.readKey()       ← escape sequence state machine → Key enum
  │
  ▼
LineEditor.handleKey()    ← cursor movement, kill/yank, insert/delete → LineResult
  │
  ▼
InputHistory.add()        ← stores completed lines for recall
  │
  ▼
ScreenBuffer.appendLine() ← accumulates rendered output
  │
  ▼
ScreenBuffer.frame        ← clear + home + content → stdout
```

---

## 3. API Surface

### 3a. Terminal/RawTerminal

```swift
/// Switches stdin to raw mode on init; restores original settings on deinit.
/// Uses POSIX termios directly -- no ncurses dependency.
public final class RawTerminal: @unchecked Sendable {
    // Justification: original termios stored at init, restored at deinit only

    /// Enable raw mode on the given file descriptor.
    /// Stores original termios for restoration.
    /// Falls back to no-op on platforms without termios.
    public init(fileDescriptor: Int32 = STDIN_FILENO)

    /// Restore original terminal settings.
    deinit

    /// Read a single byte from the file descriptor. Returns nil on EOF or error.
    public func readByte() -> UInt8?

    /// Whether raw mode is currently active (false on unsupported platforms).
    public var isRawMode: Bool { get }
}
```

### 3b. Terminal/TerminalSize

```swift
/// Terminal dimensions in columns and rows, with SIGWINCH observation.
public struct TerminalSize: Sendable, Equatable {
    public var columns: Int
    public var rows: Int

    /// Query current terminal size via ioctl TIOCGWINSZ.
    /// Returns `fallback` when ioctl fails (e.g., piped stdin in CI).
    public static func current(
        fileDescriptor: Int32 = STDOUT_FILENO,
        fallback: TerminalSize = TerminalSize(columns: 80, rows: 24)
    ) -> TerminalSize

    /// Install a SIGWINCH handler that calls `onChange` with the new size.
    /// Returns a token; the handler is removed when the token is deallocated.
    public static func onResize(
        _ onChange: @escaping @Sendable (TerminalSize) -> Void
    ) -> ResizeToken
}

/// RAII token -- the SIGWINCH handler is deregistered when this is deallocated.
public final class ResizeToken: @unchecked Sendable {
    // Justification: signal handler registration is thread-safe; dealloc removes it
    deinit
}
```

### 3c. Terminal/TerminalSettings

```swift
/// Generic terminal presentation settings with XDG-compliant persistence.
public struct TerminalSettings: Codable, Sendable {
    public enum ColorMode: String, Codable, Sendable {
        case auto    // use isatty + NO_COLOR to decide
        case always  // force color on
        case never   // force color off
    }

    public var renderWidth: Int       // 0 = auto-detect from terminal
    public var colorMode: ColorMode   // default: .auto
    public var asciiOnly: Bool        // default: false (use Unicode box drawing)

    /// Resolve whether color output should be used right now.
    /// Checks colorMode, isatty(STDOUT_FILENO), and the NO_COLOR environment variable.
    public func resolveColor(isattyOverride: Bool? = nil) -> Bool

    /// Load settings from XDG config path (~/.config/<appName>/terminal.json).
    /// Returns defaults if the file is missing or malformed.
    public static func load(appName: String) -> TerminalSettings

    /// Save settings to XDG config path. Creates directories as needed.
    public func save(appName: String) throws
}
```

### 3d. Input/Key + KeyReader

```swift
/// A parsed key event from raw terminal input.
public enum Key: Sendable, Equatable {
    case character(Character)
    case backspace
    case delete
    case enter
    case tab
    case escape
    case arrowUp, arrowDown, arrowLeft, arrowRight
    case home, end
    case ctrlC, ctrlD, ctrlA, ctrlE, ctrlK, ctrlW, ctrlU, ctrlL
    case unknown(UInt8)
}

/// Reads raw bytes from a RawTerminal and parses them into Key values.
/// Handles multi-byte escape sequences (CSI arrows, Home/End, Delete).
public struct KeyReader: Sendable {
    public init(terminal: RawTerminal)

    /// Read the next key. Blocks until input is available. Returns nil on EOF.
    public func readKey() -> Key?
}
```

### 3e. Input/LineEditor + LineResult

```swift
/// Single-line text editor with cursor movement and editing commands.
/// Pure value type -- no I/O. Feed it Key events and read back the state.
public struct LineEditor: Sendable {
    public private(set) var text: String
    public private(set) var cursorPosition: Int

    public init(text: String = "")

    /// Process a key event and return the editing result.
    ///   - `.editing`: still editing, re-render prompt
    ///   - `.completed(String)`: user pressed Enter
    ///   - `.eof`: Ctrl-D on empty line
    ///   - `.interrupt`: Ctrl-C
    public mutating func handleKey(_ key: Key) -> LineResult

    /// The current text content for rendering (cursor position tracked separately).
    public var displayText: String { get }
}

/// Result of processing a key in LineEditor.
public enum LineResult: Sendable, Equatable {
    case editing
    case completed(String)
    case eof
    case interrupt
}
```

### 3f. Input/InputHistory

```swift
/// In-memory command history with up/down arrow navigation.
/// No disk persistence in v0.1.0 (planned for a future version).
public struct InputHistory: Sendable {
    /// Create a history buffer with a maximum number of retained entries.
    public init(maxEntries: Int = 100)

    /// Add a completed line to history. No-ops on empty strings.
    /// Consecutive duplicates are not stored.
    public mutating func add(_ line: String)

    /// Navigate up (older). Stashes `current` on first call.
    /// Returns the older entry, or nil if at the oldest.
    public mutating func navigateUp(current: String) -> String?

    /// Navigate down (newer). Returns the newer entry,
    /// or the stashed current text if at the bottom.
    public mutating func navigateDown() -> String?

    /// Reset navigation index (call after a line is committed).
    public mutating func reset()
}
```

### 3g. Rendering/ANSICodes + ANSIColor

```swift
/// ANSI escape sequence constants and builder functions.
/// Covers SGR attributes and standard 8-color (+ bright) palette.
public enum ANSICodes {
    // Screen control
    public static let clearScreen: String   // "\u{001B}[2J"
    public static let home: String          // "\u{001B}[H"
    public static let reset: String         // "\u{001B}[0m"

    // SGR text attributes
    public static let bold: String          // "\u{001B}[1m"
    public static let dim: String           // "\u{001B}[2m"
    public static let italic: String        // "\u{001B}[3m"
    public static let underline: String     // "\u{001B}[4m"
    public static let blink: String         // "\u{001B}[5m"
    public static let reverse: String       // "\u{001B}[7m"
    public static let hidden: String        // "\u{001B}[8m"

    // Color
    public static func fg(_ color: ANSIColor) -> String
    public static func bg(_ color: ANSIColor) -> String

    // Cursor control
    public static func cursorTo(row: Int, column: Int) -> String
    public static let cursorShow: String
    public static let cursorHide: String
    public static let saveCursor: String
    public static let restoreCursor: String
}

/// Standard ANSI color palette (8 normal + 8 bright).
public enum ANSIColor: UInt8, Sendable {
    case black, red, green, yellow, blue, magenta, cyan, white
    case brightBlack, brightRed, brightGreen, brightYellow
    case brightBlue, brightMagenta, brightCyan, brightWhite
}
```

### 3h. Rendering/ScreenBuffer

```swift
/// Line-based screen buffer for composing full-screen TUI output.
/// Accumulates lines, then flushes as a single string with an optional
/// clear-screen + cursor-home prefix for flicker-free rendering.
public struct ScreenBuffer: Sendable {
    /// Create a buffer targeting the given terminal width.
    public init(width: Int)

    /// Append raw text (no newline added).
    public mutating func append(_ text: String)

    /// Append text followed by a newline.
    public mutating func appendLine(_ text: String)

    /// The accumulated string including clear-screen + cursor-home prefix.
    /// Use this for writing to stdout.
    public var frame: String { get }

    /// The accumulated string WITHOUT clear/home prefix.
    /// Use this for test assertions.
    public var raw: String { get }
}
```

### 3i. Rendering/BoxDrawing

```swift
/// Box drawing character sets with border builder methods.
/// Provides both Unicode (default) and ASCII fallback sets.
public struct BoxDrawing: Sendable {
    public let topLeft: String      // "┌" or "+"
    public let topRight: String     // "┐" or "+"
    public let bottomLeft: String   // "└" or "+"
    public let bottomRight: String  // "┘" or "+"
    public let horizontal: String   // "─" or "-"
    public let vertical: String     // "│" or "|"
    public let leftTee: String      // "├" or "+"
    public let rightTee: String     // "┤" or "+"
    public let topTee: String       // "┬" or "+"
    public let bottomTee: String    // "┴" or "+"
    public let cross: String        // "┼" or "+"

    /// Unicode box drawing characters.
    public static let unicode: BoxDrawing

    /// ASCII-only box drawing characters.
    public static let ascii: BoxDrawing

    /// Build a top border with an embedded header: "┌ Header ──────┐"
    public func topBorder(_ header: String, width: Int) -> String

    /// Build a horizontal separator: "├──────────────┤"
    public func midBorder(width: Int) -> String

    /// Build a bottom border: "└──────────────┘"
    public func bottomBorder(width: Int) -> String
}
```

### 3j. Rendering/StatusArea

```swift
/// Thread-safe, dynamic-height status message buffer for TUI integration.
/// Holds the most recent N messages and renders them as terminal lines.
public final class StatusArea: @unchecked Sendable {
    // Justification: NSLock-protected mutations only

    /// Create a status area that retains at most `maxMessages` entries.
    public init(maxMessages: Int = 5)

    /// Push a status or error message. Drops the oldest if at capacity.
    public func push(_ message: String)

    /// Clear all messages.
    public func clear()

    /// Render the current messages as terminal-width lines.
    /// Returns an empty array if no messages are pending.
    public func render(width: Int, colorize: Bool) -> [String]

    /// Number of lines the status area currently occupies.
    public var lineCount: Int { get }
}
```

### 3k. Util/UnicodeWidth

```swift
/// Unicode display width calculation following UAX #11 (East Asian Width)
/// and UAX #51 (Emoji). This is the foundation that all string measurement
/// in SwiftCLIKit builds on — it must be correct from day one because
/// every pad, truncate, layout, and cell operation depends on it.
public enum UnicodeWidth {
    /// Display width of a single Unicode scalar in a monospace terminal.
    ///   - East Asian Wide/Fullwidth (W/F): 2 columns
    ///   - East Asian Ambiguous (A): 1 column (Western locale default)
    ///   - Emoji with Variation Selector-16 (VS16, U+FE0F): 2 columns
    ///   - Emoji ZWJ sequences: 2 columns total
    ///   - Combining marks (Mn, Mc, Me): 0 columns
    ///   - Control characters (Cc): 0 columns
    ///   - Zero Width Joiner (U+200D), Zero Width Space (U+200B): 0 columns
    ///   - Soft Hyphen (U+00AD): 1 column
    ///   - Default: 1 column
    public static func width(of scalar: Unicode.Scalar) -> Int

    /// Display width of a Character (may be a grapheme cluster).
    /// Handles emoji sequences, combining marks, and ZWJ sequences.
    public static func width(of character: Character) -> Int

    /// Total display width of a string (sum of character widths).
    /// Strips ANSI escape sequences before measuring.
    public static func displayWidth(_ s: String) -> Int
}
```

**Implementation notes:**
- The East Asian Width table is derived from Unicode 16.0 `EastAsianWidth.txt`.
  Stored as sorted ranges for binary search — no HashMap, no per-scalar allocation.
- Emoji detection uses `Character.unicodeScalars` to identify VS16, ZWJ sequences,
  and emoji presentation sequences.
- Ambiguous width defaults to 1 (Western locale). A future enhancement could accept
  a locale parameter for CJK terminals where ambiguous = 2.

### 3l. Util/ANSIStringMetrics

```swift
/// Pure functions for measuring and manipulating strings that contain
/// ANSI escape sequences. All width calculations use UnicodeWidth
/// for correct handling of CJK, emoji, and combining marks.
public enum ANSIStringMetrics {
    /// Visible display width in terminal columns, excluding ANSI escape sequences.
    /// Uses UnicodeWidth.displayWidth for correct CJK/emoji handling.
    public static func visibleLength(_ s: String) -> Int

    /// Pad with spaces to reach the target visible width (in columns).
    /// No-op if the string is already at or beyond `width`.
    public static func padVisible(_ s: String, to width: Int) -> String

    /// Truncate to at most `maxWidth` visible columns.
    /// Preserves ANSI sequences that start before the cut point.
    /// Correctly handles wide characters (won't split a 2-column char).
    /// Appends reset if any open sequences were truncated.
    public static func truncateVisible(_ s: String, to maxWidth: Int) -> String
}
```

### 3m. Util/HexColor

```swift
/// Maps CSS-style hex color strings to the nearest ANSI 8-color value.
/// Full 256-color and truecolor mapping deferred to v0.2.0.
public enum HexColor {
    /// Map a hex string (e.g., "#e53935") to the nearest ANSIColor.
    /// Returns nil if the hex string is malformed.
    public static func toANSI8(_ hex: String) -> ANSIColor?

    /// Map a hex string to an ANSI foreground escape sequence.
    /// Returns an empty string if the hex is malformed.
    public static func toANSIEscape(_ hex: String) -> String
}
```

---

## 4. MCP Schema

Not applicable. SwiftCLIKit is a local terminal library with no network or MCP integration.

---

## 5. Constraints & Compliance

| Rule | How it is satisfied |
|------|---------------------|
| **No force unwraps (`!`)** | All termios/ioctl calls are return-checked with guard; fallback values on failure. No `!`, `try!`, or `as!` anywhere. |
| **Swift 6 strict concurrency** | All value types (`TerminalSize`, `Key`, `LineEditor`, `LineResult`, `InputHistory`, `ScreenBuffer`, `BoxDrawing`, `TerminalSettings`, `ANSIColor`) are `Sendable`. `RawTerminal` and `ResizeToken` are `@unchecked Sendable` with `// Justification:` comments. `StatusArea` is `@unchecked Sendable` with NSLock protection and justification. |
| **Guard clauses** | All validation uses guard + early return. No nested if-else chains. |
| **Platform guards** | `#if canImport(Darwin)` / `#if canImport(Glibc)` for all POSIX-specific code. Graceful no-op fallback on unsupported platforms. |
| **Division safety** | Not applicable to this module (no arithmetic divisions in the API). |
| **Pointer safety** | `termios` is a C value type -- stored as a copy, never as a pointer. No `withUnsafe*` blocks. `ioctl` results are checked via return value, not pointer dereference. |
| **Concurrency model** | `RawTerminal.readByte()` is a blocking single-thread call (expected). `StatusArea` uses NSLock for thread safety. SIGWINCH handler sets state and calls the closure -- no actor isolation required. |
| **No hardcoded constants** | Max history entries (`InputHistory.init(maxEntries:)`), max status messages (`StatusArea.init(maxMessages:)`), fallback terminal size (`TerminalSize.current(fallback:)`), and render width (`TerminalSettings.renderWidth`) are all configurable via init parameters or settings. |
| **Recursion auditor** | No recursive functions, no self-referencing computed properties, no convenience inits forwarding to themselves. |
| **DocC documentation** | All public types, methods, and properties have `///` documentation comments. |

---

## 6. Backend Abstraction

Not applicable. SwiftCLIKit v0.1.0 operates directly on POSIX file descriptors and stdout. No compute-intensive operations, no backend switching needed.

A `TestBackend` (headless terminal for snapshot testing) is planned for v1.0.0 per the roadmap. The v0.1.0 architecture supports future abstraction via pipe-based fd injection in `RawTerminal.init(fileDescriptor:)`.

---

## 7. Dependencies

### SwiftCLIKit v0.1.0

| Dependency | Source |
|-----------|--------|
| Foundation | Apple / swift-corelibs-foundation |
| Darwin (macOS) | System framework |
| Glibc (Linux) | System library |

**External dependencies: None.** No C libraries, no ncurses, no Swift packages.

### Package.swift outline

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SwiftCLIKit",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "SwiftCLIKit", targets: ["SwiftCLIKit"]),
    ],
    targets: [
        .target(
            name: "SwiftCLIKit",
            swiftSettings: [.strictConcurrency(.complete)]
        ),
        .testTarget(
            name: "SwiftCLIKitTests",
            dependencies: ["SwiftCLIKit"]
        ),
    ]
)
```

---

## 8. Test Strategy

All tests run without a real TTY. I/O is injected via pipe file descriptors. Target: ~40-50 unit tests.

### RawTerminalTests

| Test | Assertion |
|------|-----------|
| Pipe round-trip | Write bytes to pipe write-end, read via `readByte()` from read-end -- bytes match |
| EOF on closed pipe | Close write-end, `readByte()` returns nil |
| isRawMode flag | True when constructed with a valid fd on Darwin; false on unsupported platform |

### KeyReaderTests

| Test | Input bytes | Expected Key |
|------|------------|--------------|
| Arrow up | `\x1B[A` | `.arrowUp` |
| Arrow down | `\x1B[B` | `.arrowDown` |
| Arrow right | `\x1B[C` | `.arrowRight` |
| Arrow left | `\x1B[D` | `.arrowLeft` |
| Home | `\x1B[H` | `.home` |
| End | `\x1B[F` | `.end` |
| Delete | `\x1B[3~` | `.delete` |
| Backspace | `0x7F` | `.backspace` |
| Enter | `0x0D` | `.enter` |
| Tab | `0x09` | `.tab` |
| Escape (bare) | `0x1B` (+ timeout) | `.escape` |
| Ctrl-C | `0x03` | `.ctrlC` |
| Ctrl-D | `0x04` | `.ctrlD` |
| Ctrl-A | `0x01` | `.ctrlA` |
| Ctrl-E | `0x05` | `.ctrlE` |
| Ctrl-K | `0x0B` | `.ctrlK` |
| Ctrl-W | `0x17` | `.ctrlW` |
| Ctrl-U | `0x15` | `.ctrlU` |
| Ctrl-L | `0x0C` | `.ctrlL` |
| Printable ASCII | `0x61` | `.character("a")` |
| UTF-8 multibyte | `0xC3 0xA9` | `.character("e\u{0301}")` or `.character("\u{00E9}")` |
| Unknown control | `0x00` | `.unknown(0x00)` |

### LineEditorTests

| Test | Sequence | Expected |
|------|----------|----------|
| Type + Enter | `"hello"` + `.enter` | `.completed("hello")` |
| Backspace | `"helo"` + `.backspace` + `"lo"` + `.enter` | `.completed("hello")` |
| Arrow left + insert | `"hllo"` + `.arrowLeft`x3 + `"e"` + `.enter` | `.completed("hello")` |
| Home jump | `"abc"` + `.home` + `"X"` + `.enter` | `.completed("Xabc")` |
| End jump | `"abc"` + `.home` + `.end` + `"X"` + `.enter` | `.completed("abcX")` |
| Ctrl-A (Home) | Same as Home | cursor at 0 |
| Ctrl-E (End) | Same as End | cursor at text.count |
| Ctrl-K (kill to end) | `"hello"` + `.arrowLeft`x2 + `.ctrlK` + `.enter` | `.completed("hel")` |
| Ctrl-W (delete word) | `"hello world"` + `.ctrlW` + `.enter` | `.completed("hello ")` |
| Ctrl-U (kill to start) | `"hello"` + `.ctrlU` | text is `""`, cursor at 0 |
| Ctrl-D on empty | `.ctrlD` | `.eof` |
| Ctrl-D on non-empty | `"abc"` + `.ctrlD` | `.editing` (deletes char under cursor or no-op) |
| Ctrl-C | `"abc"` + `.ctrlC` | `.interrupt` |
| Arrow right past end | `"ab"` + `.arrowRight` | cursor stays at 2 |
| Arrow left past start | `.arrowLeft` on empty | cursor stays at 0 |

### InputHistoryTests

| Test | Assertion |
|------|-----------|
| Add 3, navigate up 3x | Returns entries in reverse order |
| Navigate down | Returns toward current (stashed) text |
| Down past bottom | Returns stashed current text |
| Up past top | Returns nil (stays at oldest) |
| Consecutive duplicates | Second identical `add()` is ignored |
| Empty string | `add("")` is a no-op |
| Max entries | Add 101 entries (max 100) -- oldest is dropped |
| Reset | After reset, navigateUp with current returns last entry |

### BoxDrawingTests

| Test | Assertion |
|------|-----------|
| Unicode top border | `topBorder("Header", width: 20)` = `"┌ Header ──────────┐"` |
| ASCII top border | `topBorder("Header", width: 20)` = `"+- Header ---------+"` |
| Unicode mid border | `midBorder(width: 20)` = `"├──────────────────┤"` |
| Unicode bottom border | `bottomBorder(width: 20)` = `"└──────────────────┘"` |
| Width 0 | Graceful empty or minimal border (no crash) |
| Header longer than width | Truncated header with correct border chars |

### UnicodeWidthTests

| Test | Input | Expected |
|------|-------|----------|
| ASCII letter | `"A"` | width = 1 |
| CJK ideograph | `"中"` (U+4E2D) | width = 2 |
| CJK string | `"中文"` | displayWidth = 4 |
| Fullwidth letter | `"Ａ"` (U+FF21) | width = 2 |
| Halfwidth katakana | `"ｱ"` (U+FF71) | width = 1 |
| Combining mark | `"e\u{0301}"` (é as e + combining acute) | width = 1 (single grapheme) |
| Emoji (basic) | `"😀"` | width = 2 |
| Emoji with VS16 | `"☺\u{FE0F}"` | width = 2 |
| Emoji ZWJ sequence | `"👨‍👩‍👧"` | width = 2 |
| Flag emoji | `"🇯🇵"` | width = 2 |
| Zero-width joiner | `"\u{200D}"` | width = 0 |
| Zero-width space | `"\u{200B}"` | width = 0 |
| Control character | `"\u{0000}"` | width = 0 |
| Tab | `"\t"` | width = 0 (control) |
| Soft hyphen | `"\u{00AD}"` | width = 1 |
| Mixed string | `"Hello中文!"` | displayWidth = 9 (5+4+0... wait: 5+2+2+1 = 10... H=1,e=1,l=1,l=1,o=1,中=2,文=2,!=1 = 10) |
| Mixed ASCII+CJK | `"AB中CD"` | displayWidth = 6 (1+1+2+1+1) |
| Empty string | `""` | displayWidth = 0 |

### ANSIStringMetricsTests

| Test | Input | Expected |
|------|-------|----------|
| Plain text | `"hello"` | `visibleLength` = 5 |
| ANSI colored | `"\u{001B}[31mred\u{001B}[0m"` | `visibleLength` = 3 |
| Multiple escapes | bold + color + text + reset | correct visible length |
| CJK with ANSI | `"\u{001B}[31m中文\u{001B}[0m"` | `visibleLength` = 4 |
| Emoji with ANSI | `"\u{001B}[32m😀\u{001B}[0m"` | `visibleLength` = 2 |
| `padVisible` | `"hi"` padded to 10 | 8 trailing spaces |
| `padVisible` already wide | `"hello world"` padded to 5 | no padding added |
| `padVisible` CJK | `"中"` padded to 4 | 2 trailing spaces |
| `truncateVisible` | `"hello world"` to 5 | `"hello"` |
| `truncateVisible` with ANSI | colored text truncated mid-sequence | reset appended, no broken escape |
| `truncateVisible` wide char boundary | `"A中B"` to 2 | `"A "` (can't fit 中 in 1 remaining col, pad with space) |
| Empty string | `""` | `visibleLength` = 0 |

### StatusAreaTests

| Test | Assertion |
|------|-----------|
| Push 1 message | `render()` returns 1 line containing the message |
| Push 6 (max 5) | `render()` returns 5 lines; oldest message dropped |
| Clear | `render()` returns empty array |
| lineCount | Matches number of stored messages |
| Thread safety | Push from 10 concurrent threads -- no crash, no data corruption |
| Render with colorize | Output contains ANSI escapes |
| Render without colorize | Output is plain text |

### HexColorTests

| Test | Input | Expected |
|------|-------|----------|
| Red hex | `"#e53935"` | `.red` |
| Green hex | `"#4caf50"` | `.green` |
| Blue hex | `"#2196f3"` | `.blue` |
| White hex | `"#ffffff"` | `.white` |
| Black hex | `"#000000"` | `.black` |
| Lowercase/uppercase | `"#FF0000"` and `"#ff0000"` | both `.red` |
| Without hash | `"e53935"` | `.red` (tolerant parsing) |
| Malformed | `"not-a-color"` | `nil` |
| Empty string | `""` | `nil` |
| toANSIEscape valid | `"#e53935"` | `"\u{001B}[31m"` |
| toANSIEscape invalid | `"garbage"` | `""` |

### TerminalSettingsTests

| Test | Assertion |
|------|-----------|
| Load missing file | Returns defaults (renderWidth: 0, colorMode: .auto, asciiOnly: false) |
| Save + load round-trip | All fields preserved |
| resolveColor(.never) | Returns false regardless of isatty |
| resolveColor(.always) | Returns true regardless of isatty |
| resolveColor(.auto) + isatty true | Returns true |
| resolveColor(.auto) + isatty false | Returns false |
| resolveColor(.auto) + NO_COLOR env | Returns false even with isatty true |

### ScreenBufferTests

| Test | Assertion |
|------|-----------|
| Empty buffer | `frame` is clear+home only; `raw` is empty |
| appendLine | `raw` contains line + newline |
| append (no newline) | `raw` contains text without trailing newline |
| Multiple lines | Lines appear in order |
| frame includes prefix | `frame` starts with clearScreen + home |
| raw excludes prefix | `raw` has no clearScreen/home |

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** -- ADR-009, ADR-010

**New ADR Drafts:**

**ADR-009:**
- **Title:** SwiftCLIKit extracted as reusable terminal library
- **Category:** architecture
- **Key decision:** Generic terminal primitives (raw mode, ANSI codes, box drawing, line editing, screen buffer, terminal sizing, settings persistence) live in a standalone `SwiftCLIKit` SPM package as a sibling repo. Game-specific rendering stays in IconquerCLI. This avoids rebuilding terminal infrastructure for future CLI projects and establishes a reusable foundation for the Swift ecosystem.
- **Alternatives considered:** (a) Keep everything in IconquerCLI -- rejected because it couples game logic to terminal infrastructure. (b) Use an existing Swift TUI library -- rejected because none exist without C dependencies (ncurses).

**ADR-010:**
- **Title:** Raw terminal mode via POSIX termios (no ncurses)
- **Category:** architecture
- **Key decision:** Use POSIX `termios`/`cfmakeraw` directly for raw terminal mode rather than depending on ncurses or any C library. The `RawTerminal` class uses RAII pattern (init enables raw mode, deinit restores original termios) to guarantee the terminal is always restored, even on crash or early exit. `termios` is stored as a value-type copy, never as a pointer.
- **Alternatives considered:** (a) ncurses -- rejected because it is a C dependency and doesn't integrate well with Swift's type system. (b) Swift Termbox bindings -- rejected because Termbox is abandoned. (c) No raw mode -- rejected because it makes TUI development impossible (echo, buffered input).

---

## 10. Open Questions

All questions for v0.1.0 have been resolved:

1. ~~**Bare escape timeout:** How long to wait after receiving `0x1B` before declaring it a standalone escape vs. the start of a CSI sequence?~~ **Resolved:** Use a short timeout (50-100ms via `poll`/`select` on the fd). If no follow-up byte arrives, emit `.escape`.

2. ~~**Command history persistence:** Should `InputHistory` save to disk?~~ **Resolved:** In-memory only for v0.1.0. Disk persistence (XDG data dir) is a future enhancement.

3. ~~**Wide character support in ANSIStringMetrics:** Should emoji/CJK width be handled?~~ **Resolved:** Yes, from day one. `UnicodeWidth` ships in v0.1.0 with full East Asian Width (UAX #11) and emoji (UAX #51) support. All string measurement in SwiftCLIKit flows through it — deferring this would create a cascade of width bugs in every downstream consumer.

4. ~~**StatusArea rendering format:** Plain lines or decorated?~~ **Resolved:** Plain lines when `colorize: false`; dim/yellow prefixed when `colorize: true`. Caller controls decoration.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Brief Narrative Guide

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (RawTerminal + KeyReader + LineEditor + ScreenBuffer + BoxDrawing + StatusArea)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Mild (POSIX termios, ANSI escape sequences, CSI parsing)

**Approach:**

1. **DocC comments** on every public type, method, property, and enum case in SwiftCLIKit. Includes usage examples in `///` comments for key types (RawTerminal, KeyReader, LineEditor).

2. **Narrative guide** (`SwiftCLIKitGuide.md` in the repo root) covering:
   - Library overview and design philosophy (zero C deps, RAII safety, value-type-first)
   - Quick start: raw mode + key reading + line editing in 20 lines
   - Platform support and graceful degradation
   - Integration pattern for downstream apps (how to add as SPM dependency)

3. **No README bloat** -- README.md is short (badge, one-liner, link to guide).
