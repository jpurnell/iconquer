# Design Proposal: SwiftCLIKit v0.2.0 — Color

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Rich color support, mouse events, alternate screen, cursor control, Kitty keyboard protocol
**Codename:** Color

---

## 1. Objective

**Objective:** Ship SwiftCLIKit v0.2.0 with unified color types (8/256/truecolor), automatic capability negotiation, mouse event parsing, alternate screen management, and cursor control. This release completes the "crossterm for Swift" low-level terminal abstraction layer.

**Master Plan Reference:** Phase 2 — TUI polish. SwiftCLIKit v0.2.0 is a hard dependency of IconquerCLI v0.5.0 (the TUI polish release for iConquer).

**Problems solved:**
1. **No color abstraction:** v0.1.0 only supports 8-color ANSI. Modern terminals support 256-color and 24-bit truecolor, but there is no unified type or auto-negotiation. Code that works in iTerm2 breaks in basic xterm.
2. **No mouse support:** Click-to-select on a map board requires mouse event parsing. Swift has no pure-Swift SGR 1006 mouse protocol implementation.
3. **No alternate screen:** Full-screen TUI apps should use the alternate screen buffer so the user's scrollback is preserved on exit. v0.1.0 clears the main buffer directly.
4. **Limited cursor control:** v0.1.0 has cursor-home only. Full-screen apps need absolute positioning, show/hide, save/restore, and shape control.
5. **No function keys or Kitty protocol:** F1-F12, PageUp/PageDown, and disambiguated modifier keys are unparsed in v0.1.0's KeyReader.
6. **HexColor is limited:** v0.1.0's HexColor maps hex to nearest 8-color only. Truecolor-capable terminals get washed-out results.

---

## 2. Proposed Architecture

All changes are within the existing `SwiftCLIKit` sibling repo. No new repos or modules.

### New Files

```
Sources/SwiftCLIKit/
├── Terminal/
│   ├── AlternateScreen.swift       — RAII wrapper: enter/leave alternate screen buffer
│   └── CursorControl.swift         — Show/hide, position, save/restore, shape
├── Input/
│   └── MouseEvent.swift            — MouseButton, MouseEvent, MouseMode (SGR 1006)
├── Rendering/
│   ├── Color.swift                 — Unified Color enum: .ansi8, .ansi256, .truecolor
│   └── ColorNegotiation.swift      — Detect capabilities, fgEscape/bgEscape, downsampling
```

### Modified Files

```
Sources/SwiftCLIKit/
├── Input/
│   └── KeyReader.swift             — Add mouse event case, F1-F12, PageUp/Down, Insert,
│                                     Kitty keyboard protocol enable/disable
├── Rendering/
│   ├── ANSICodes.swift             — Add fg256/bg256, fgRGB/bgRGB, extended underline styles
│   └── HexColor.swift              — Upgrade: hex -> Color type, capability-aware escape
```

### New Test Files

```
Tests/SwiftCLIKitTests/
├── ColorTests.swift                — Color creation, hex parsing, downsampling
├── ColorNegotiationTests.swift     — Capability detection, escape generation
├── AlternateScreenTests.swift      — Enter/leave sequence verification
├── CursorControlTests.swift        — All cursor escape sequences
├── MouseEventTests.swift           — SGR 1006 parsing, modifiers, edge cases
├── KeyReaderV2Tests.swift          — F-keys, PageUp/Down, mouse interleaving, Kitty
├── ANSICodesV2Tests.swift          — 256-color and truecolor escape sequences
└── HexColorV2Tests.swift           — Hex -> Color, capability-aware escapes
```

---

## 3. API Surface

### 3a. Color (unified type)

```swift
/// A terminal color at any fidelity level.
public enum Color: Sendable, Equatable, Hashable {
    /// Standard 8-color ANSI palette.
    case ansi8(ANSIColor)
    /// Extended 256-color xterm palette (index 0-255).
    case ansi256(UInt8)
    /// 24-bit RGB truecolor.
    case truecolor(r: UInt8, g: UInt8, b: UInt8)

    /// Parse a hex string like "#e53935" or "e53935" into truecolor.
    /// Returns nil for malformed input.
    public static func fromHex(_ hex: String) -> Color?

    /// Downsample this color to fit a target capability level.
    /// Pure function — no side effects, no environment reads.
    public func downsampled(to capability: ColorCapability) -> Color
}

/// Terminal color capability levels, ordered from least to most capable.
public enum ColorCapability: Sendable, Comparable {
    /// No color support (NO_COLOR set, dumb terminal).
    case none
    /// 8 standard ANSI colors.
    case basic
    /// 256-color xterm palette.
    case extended
    /// 24-bit RGB truecolor.
    case truecolor
}
```

### 3b. ColorNegotiation

```swift
/// Detects terminal color capabilities and generates appropriate escape sequences.
public enum ColorNegotiation {
    /// Detect the current terminal's color capability from environment variables.
    ///
    /// Detection order:
    /// 1. `NO_COLOR` env set (any value) -> `.none`
    /// 2. `COLORTERM=truecolor` or `COLORTERM=24bit` -> `.truecolor`
    /// 3. `TERM` contains `256color` -> `.extended`
    /// 4. `TERM` is `dumb` -> `.none`
    /// 5. Default -> `.basic`
    public static func detect() -> ColorCapability

    /// Generate the ANSI SGR foreground escape for a color at a given capability.
    /// Returns empty string for `.none` capability.
    public static func fgEscape(_ color: Color, capability: ColorCapability) -> String

    /// Generate the ANSI SGR background escape for a color at a given capability.
    /// Returns empty string for `.none` capability.
    public static func bgEscape(_ color: Color, capability: ColorCapability) -> String
}
```

**Auto-downsampling algorithm (pure, no side effects):**
- truecolor -> 256: Euclidean distance in RGB space against xterm-256 palette, pick nearest index.
- 256 -> 8: Map palette index to nearest ANSI base color (0-7). For indices 0-7, identity. For 8-15, map to 0-7. For 16-231, compute RGB from cube formula, then nearest base. For 232-255, grayscale to nearest base.
- Any -> none: Return empty string (strip color entirely).

### 3c. AlternateScreen

```swift
/// RAII wrapper for the terminal alternate screen buffer.
/// Enters alternate screen on init, restores main screen on deinit.
public final class AlternateScreen: @unchecked Sendable {
    // Justification: enter/leave only called from main thread at app lifecycle boundaries

    /// Enter alternate screen buffer. Writes \x1B[?1049h to the given fd.
    public init(fileDescriptor: Int32 = STDOUT_FILENO)

    /// Leave alternate screen buffer. Writes \x1B[?1049l.
    deinit

    /// Whether we are currently in the alternate screen.
    public var isActive: Bool { get }
}
```

### 3d. CursorControl

```swift
/// Static cursor manipulation escape sequences.
public enum CursorControl {
    /// Show the cursor: \x1B[?25h
    public static let show: String
    /// Hide the cursor: \x1B[?25l
    public static let hide: String

    /// Move cursor to absolute position. Row and column are 1-based.
    public static func moveTo(row: Int, column: Int) -> String  // \x1B[{row};{col}H

    /// Move cursor up by n rows.
    public static func moveUp(_ n: Int) -> String    // \x1B[{n}A
    /// Move cursor down by n rows.
    public static func moveDown(_ n: Int) -> String  // \x1B[{n}B
    /// Move cursor right by n columns.
    public static func moveRight(_ n: Int) -> String // \x1B[{n}C
    /// Move cursor left by n columns.
    public static func moveLeft(_ n: Int) -> String  // \x1B[{n}D

    /// Save cursor position: \x1B[s
    public static let save: String
    /// Restore cursor position: \x1B[u
    public static let restore: String

    /// Cursor shape options.
    public enum Shape: UInt8, Sendable {
        case block = 2
        case underline = 4
        case bar = 6
    }

    /// Set cursor shape. Non-blinking by default.
    /// blinking = true subtracts 1 from the raw value per DECSCUSR.
    public static func setShape(_ shape: Shape, blinking: Bool = false) -> String
}
```

### 3e. MouseEvent + MouseMode

```swift
/// Mouse button identity.
public enum MouseButton: Sendable, Equatable {
    case left
    case middle
    case right
    case scrollUp
    case scrollDown
    case release
}

/// A parsed mouse event from SGR 1006 protocol.
public struct MouseEvent: Sendable, Equatable {
    /// Which button was involved.
    public let button: MouseButton
    /// 1-based column.
    public let column: Int
    /// 1-based row.
    public let row: Int
    /// Active modifier keys.
    public let modifiers: KeyModifiers

    /// Modifier key flags for mouse events.
    public struct KeyModifiers: OptionSet, Sendable, Equatable {
        public let rawValue: UInt8
        public init(rawValue: UInt8)

        public static let shift = KeyModifiers(rawValue: 1 << 0)
        public static let alt   = KeyModifiers(rawValue: 1 << 1)
        public static let ctrl  = KeyModifiers(rawValue: 1 << 2)
    }
}

/// Mouse tracking mode control.
public enum MouseMode {
    /// Enable SGR 1006 mouse tracking: \x1B[?1000h\x1B[?1006h
    public static let enable: String
    /// Disable mouse tracking: \x1B[?1000l\x1B[?1006l
    public static let disable: String

    /// Parse a SGR 1006 mouse escape sequence into a MouseEvent.
    /// Input: the bytes after \x1B[ (e.g., "<0;10;20M" as [UInt8]).
    /// Returns nil on malformed input. Never traps.
    public static func parse(_ bytes: [UInt8]) -> MouseEvent?
}
```

### 3f. KeyReader v2 Additions

```swift
// Existing Key enum gains new cases:
public enum Key: Sendable, Equatable {
    // ... all existing v0.1.0 cases unchanged ...

    case mouse(MouseEvent)    // Mouse events interleaved with key events
    case functionKey(Int)     // F1-F12 (value 1-12)
    case pageUp               // \x1B[5~
    case pageDown             // \x1B[6~
    case insert               // \x1B[2~
}

// KeyReader gains Kitty keyboard protocol control:
extension KeyReader {
    /// Enable Kitty keyboard protocol (flags=1, disambiguate): \x1B[>1u
    public static let enableKittyProtocol: String
    /// Disable Kitty keyboard protocol: \x1B[<u
    public static let disableKittyProtocol: String
}
```

### 3g. ANSICodes v2 Additions

```swift
extension ANSICodes {
    // 256-color escapes
    /// Foreground 256-color: \x1B[38;5;{n}m
    public static func fg256(_ index: UInt8) -> String
    /// Background 256-color: \x1B[48;5;{n}m
    public static func bg256(_ index: UInt8) -> String

    // Truecolor escapes
    /// Foreground truecolor: \x1B[38;2;{r};{g};{b}m
    public static func fgRGB(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> String
    /// Background truecolor: \x1B[48;2;{r};{g};{b}m
    public static func bgRGB(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> String

    // Extended text attributes
    /// Strikethrough text: \x1B[9m
    public static let strikethrough: String
    /// Overline text: \x1B[53m
    public static let overline: String
    /// Curly underline: \x1B[4:3m
    public static let underlineCurly: String
    /// Double underline: \x1B[4:2m or \x1B[21m
    public static let underlineDouble: String
    /// Dotted underline: \x1B[4:4m
    public static let underlineDotted: String
}
```

### 3h. HexColor v2

```swift
public enum HexColor {
    /// Parse hex string to a Color (truecolor precision).
    /// Accepts "#RRGGBB", "RRGGBB", "#RGB", "RGB".
    /// Returns nil for malformed input.
    public static func toColor(_ hex: String) -> Color?

    /// Generate ANSI foreground escape for a hex color at the given capability.
    /// Returns empty string for .none capability or malformed hex.
    public static func toEscape(_ hex: String, capability: ColorCapability) -> String

    // v0.1.0 backward compatibility (retained, not deprecated in v0.2.0)
    /// Map hex to nearest ANSI 8-color.
    public static func toANSI8(_ hex: String) -> ANSIColor?
    /// Map hex to ANSI 8-color escape string.
    public static func toANSIEscape(_ hex: String) -> String
}
```

---

## 4. MCP Schema

Not applicable. Terminal color, mouse, and cursor control are local-only display features with no JSON-serializable input/output contract meaningful for MCP consumption.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | All parsing returns optionals. `Color.fromHex` returns `nil` on bad input. `MouseMode.parse` returns `nil` on malformed sequences. No `!` anywhere. |
| **No try!** | No throwing APIs in this release. Escape sequence generation is infallible. |
| **No force casts** | No `as!` usage. |
| **Guard clauses** | `MouseMode.parse` uses guard-driven validation, returning `nil` at each check. `Color.fromHex` guards hex string length and character validity. |
| **Division safety** | Color downsampling uses integer arithmetic only. Palette index calculations guard against divide-by-zero where applicable. |
| **Sendable** | `Color`, `ColorCapability`, `MouseEvent`, `MouseButton`, `Key` are all value types conforming to `Sendable`. `AlternateScreen` is `@unchecked Sendable` with justification comment. |
| **Swift 6 concurrency** | No mutable shared state. `ColorNegotiation.detect()` reads environment variables (thread-safe on Darwin/Linux). `AlternateScreen` writes to fd only in init/deinit. |
| **Pointer safety** | No `withUnsafe*` blocks. All escape sequences built via string interpolation. The xterm-256 palette is a static `[Color]` array, not a pointer. |
| **No hardcoded constants** | Fallback capability passed as parameter. Palette defined as named static constant. Detection thresholds documented in code. |
| **Zero C dependencies** | All escape sequences are string constants. Color distance is pure Swift arithmetic. No terminfo database, no ncurses, no C shims. |

---

## 6. Backend Abstraction

Not applicable. Color negotiation and escape generation are O(1) string operations. Mouse parsing is O(n) on sequence length (typically <20 bytes). No compute-intensive work.

---

## 7. Dependencies

### Internal Dependencies (within SwiftCLIKit)

- `Rendering/ANSICodes.swift` — v0.2.0 extends this with 256/truecolor escapes; `Color` and `ColorNegotiation` call through to these.
- `Util/HexColor.swift` — v0.2.0 upgrades this to return `Color` type; existing `toANSI8` reimplemented in terms of `Color.downsampled(to: .basic)`.
- `Input/KeyReader.swift` — v0.2.0 adds cases to `Key` enum and mouse sequence parsing branch in the escape parser state machine.

### External Dependencies

**None.** Foundation + Darwin/Glibc only. The xterm-256 palette is embedded as a static Swift array (256 entries of `(UInt8, UInt8, UInt8)` tuples). No terminfo database lookup, no external color libraries.

---

## 8. Test Strategy

### Color

| Test | Input | Expected |
|------|-------|----------|
| fromHex valid 6-digit | `"#e53935"` | `.truecolor(r: 229, g: 57, b: 53)` |
| fromHex valid no hash | `"ff0000"` | `.truecolor(r: 255, g: 0, b: 0)` |
| fromHex valid 3-digit | `"#f00"` | `.truecolor(r: 255, g: 0, b: 0)` |
| fromHex invalid | `"invalid"` | `nil` |
| fromHex empty | `""` | `nil` |
| Equatable | `.truecolor(r:255, g:0, b:0)` == `.truecolor(r:255, g:0, b:0)` | `true` |
| Downsample truecolor to basic | `.truecolor(r:255, g:0, b:0).downsampled(to: .basic)` | `.ansi8(.red)` |
| Downsample truecolor to extended | `.truecolor(r:128, g:0, b:128).downsampled(to: .extended)` | `.ansi256(N)` where N is nearest purple |
| Downsample to none | `.truecolor(r:0, g:0, b:0).downsampled(to: .none)` | `.ansi8(.default)` or stripped in escape |
| Downsample basic stays basic | `.ansi8(.red).downsampled(to: .basic)` | `.ansi8(.red)` (no change) |
| Downsample extended to basic | `.ansi256(196).downsampled(to: .basic)` | `.ansi8(.red)` |

### ColorNegotiation

| Test | Environment | Expected |
|------|-------------|----------|
| NO_COLOR set | `NO_COLOR=""` | `.none` |
| COLORTERM truecolor | `COLORTERM=truecolor` | `.truecolor` |
| COLORTERM 24bit | `COLORTERM=24bit` | `.truecolor` |
| TERM 256color | `TERM=xterm-256color` | `.extended` |
| TERM dumb | `TERM=dumb` | `.none` |
| Default fallback | No relevant env vars | `.basic` |
| fgEscape truecolor | `.truecolor(r:255, g:0, b:0)`, `.truecolor` | `"\u{001B}[38;2;255;0;0m"` |
| fgEscape 256 | `.ansi256(196)`, `.extended` | `"\u{001B}[38;5;196m"` |
| fgEscape basic | `.ansi8(.red)`, `.basic` | `"\u{001B}[31m"` |
| fgEscape none | any color, `.none` | `""` |
| bgEscape truecolor | `.truecolor(r:0, g:0, b:255)`, `.truecolor` | `"\u{001B}[48;2;0;0;255m"` |
| Auto-downsample in escape | `.truecolor(r:255, g:0, b:0)`, `.basic` | `"\u{001B}[31m"` (auto-downsampled to red) |

### AlternateScreen

| Test | Action | Expected |
|------|--------|----------|
| Init sequence | Capture fd output on init | Contains `"\u{001B}[?1049h"` |
| isActive after init | Check property | `true` |
| Deinit sequence | Let instance deallocate, capture fd | Contains `"\u{001B}[?1049l"` |

Test method: create `AlternateScreen` with a pipe fd, read from pipe to verify sequences.

### CursorControl

| Test | Call | Expected |
|------|------|----------|
| show | `CursorControl.show` | `"\u{001B}[?25h"` |
| hide | `CursorControl.hide` | `"\u{001B}[?25l"` |
| moveTo(1,1) | `CursorControl.moveTo(row: 1, column: 1)` | `"\u{001B}[1;1H"` |
| moveTo(10,20) | `CursorControl.moveTo(row: 10, column: 20)` | `"\u{001B}[10;20H"` |
| moveUp(3) | `CursorControl.moveUp(3)` | `"\u{001B}[3A"` |
| moveDown(5) | `CursorControl.moveDown(5)` | `"\u{001B}[5B"` |
| moveRight(2) | `CursorControl.moveRight(2)` | `"\u{001B}[2C"` |
| moveLeft(4) | `CursorControl.moveLeft(4)` | `"\u{001B}[4D"` |
| save | `CursorControl.save` | `"\u{001B}[s"` |
| restore | `CursorControl.restore` | `"\u{001B}[u"` |
| shape block | `CursorControl.setShape(.block)` | `"\u{001B}[2 q"` |
| shape bar | `CursorControl.setShape(.bar)` | `"\u{001B}[6 q"` |
| shape underline | `CursorControl.setShape(.underline)` | `"\u{001B}[4 q"` |
| shape block blinking | `CursorControl.setShape(.block, blinking: true)` | `"\u{001B}[1 q"` |
| shape bar blinking | `CursorControl.setShape(.bar, blinking: true)` | `"\u{001B}[5 q"` |

### MouseEvent + MouseMode

| Test | Input bytes (after \x1B[) | Expected |
|------|---------------------------|----------|
| Left click | `<0;10;20M` | `MouseEvent(button: .left, column: 10, row: 20, modifiers: [])` |
| Left release | `<0;10;20m` | `MouseEvent(button: .release, column: 10, row: 20, modifiers: [])` |
| Right click | `<2;5;5M` | `MouseEvent(button: .right, column: 5, row: 5, modifiers: [])` |
| Middle click | `<1;1;1M` | `MouseEvent(button: .middle, column: 1, row: 1, modifiers: [])` |
| Scroll up | `<64;15;10M` | `MouseEvent(button: .scrollUp, column: 15, row: 10, modifiers: [])` |
| Scroll down | `<65;15;10M` | `MouseEvent(button: .scrollDown, column: 15, row: 10, modifiers: [])` |
| Shift+click | `<4;10;20M` | `MouseEvent(button: .left, column: 10, row: 20, modifiers: [.shift])` |
| Ctrl+click | `<16;10;20M` | `MouseEvent(button: .left, column: 10, row: 20, modifiers: [.ctrl])` |
| Alt+click | `<8;10;20M` | `MouseEvent(button: .left, column: 10, row: 20, modifiers: [.alt])` |
| Malformed (no semicolons) | `<0M` | `nil` |
| Malformed (non-numeric) | `<abc;def;ghiM` | `nil` |
| Empty | `[]` | `nil` |
| Enable sequence | `MouseMode.enable` | `"\u{001B}[?1000h\u{001B}[?1006h"` |
| Disable sequence | `MouseMode.disable` | `"\u{001B}[?1000l\u{001B}[?1006l"` |

### KeyReader v2

| Test | Escape bytes | Expected Key |
|------|-------------|--------------|
| F1 | `\x1BOP` | `.functionKey(1)` |
| F2 | `\x1BOQ` | `.functionKey(2)` |
| F3 | `\x1BOR` | `.functionKey(3)` |
| F4 | `\x1BOS` | `.functionKey(4)` |
| F5 | `\x1B[15~` | `.functionKey(5)` |
| F12 | `\x1B[24~` | `.functionKey(12)` |
| PageUp | `\x1B[5~` | `.pageUp` |
| PageDown | `\x1B[6~` | `.pageDown` |
| Insert | `\x1B[2~` | `.insert` |
| Mouse left click | `\x1B[<0;10;20M` | `.mouse(MouseEvent(...))` |
| Kitty enable | `KeyReader.enableKittyProtocol` | `"\u{001B}[>1u"` |
| Kitty disable | `KeyReader.disableKittyProtocol` | `"\u{001B}[<u"` |
| Existing keys still work | `\x1B[A` | `.arrowUp` (regression guard) |

### ANSICodes v2

| Test | Call | Expected |
|------|------|----------|
| fg256(196) | `ANSICodes.fg256(196)` | `"\u{001B}[38;5;196m"` |
| bg256(21) | `ANSICodes.bg256(21)` | `"\u{001B}[48;5;21m"` |
| fg256(0) | `ANSICodes.fg256(0)` | `"\u{001B}[38;5;0m"` |
| fg256(255) | `ANSICodes.fg256(255)` | `"\u{001B}[38;5;255m"` |
| fgRGB red | `ANSICodes.fgRGB(255, 0, 0)` | `"\u{001B}[38;2;255;0;0m"` |
| bgRGB blue | `ANSICodes.bgRGB(0, 0, 255)` | `"\u{001B}[48;2;0;0;255m"` |
| fgRGB black | `ANSICodes.fgRGB(0, 0, 0)` | `"\u{001B}[38;2;0;0;0m"` |
| strikethrough | `ANSICodes.strikethrough` | `"\u{001B}[9m"` |
| overline | `ANSICodes.overline` | `"\u{001B}[53m"` |
| underlineCurly | `ANSICodes.underlineCurly` | `"\u{001B}[4:3m"` |
| underlineDouble | `ANSICodes.underlineDouble` | `"\u{001B}[4:2m"` |
| underlineDotted | `ANSICodes.underlineDotted` | `"\u{001B}[4:4m"` |

### HexColor v2

| Test | Call | Expected |
|------|------|----------|
| toColor valid | `HexColor.toColor("#e53935")` | `Color.truecolor(r: 229, g: 57, b: 53)` |
| toColor invalid | `HexColor.toColor("xyz")` | `nil` |
| toEscape truecolor | `HexColor.toEscape("#e53935", .truecolor)` | `"\u{001B}[38;2;229;57;53m"` |
| toEscape basic | `HexColor.toEscape("#e53935", .basic)` | `"\u{001B}[31m"` (nearest: red) |
| toEscape none | `HexColor.toEscape("#e53935", .none)` | `""` |
| toEscape extended | `HexColor.toEscape("#808080", .extended)` | `"\u{001B}[38;5;244m"` (gray) |
| Backward compat | `HexColor.toANSI8("#ff0000")` | `.red` |
| Backward compat escape | `HexColor.toANSIEscape("#ff0000")` | `"\u{001B}[31m"` |

### Validation Traces

**Trace 1: Truecolor red end-to-end**
```
Input:  "#ff0000"
Step 1: HexColor.toColor("#ff0000") -> Color.truecolor(r: 255, g: 0, b: 0)
Step 2: ColorNegotiation.fgEscape(.truecolor(r: 255, g: 0, b: 0), capability: .truecolor)
Result: "\x1B[38;2;255;0;0m"
```

**Trace 2: Downsample truecolor to 8-color**
```
Input:  Color.truecolor(r: 229, g: 57, b: 53)
Step 1: .downsampled(to: .basic)
Step 2: Euclidean distance to each of 8 ANSI colors in RGB space
         red(255,0,0)   = sqrt((229-255)^2 + (57-0)^2 + (53-0)^2) = sqrt(676+3249+2809) = ~82.0
         green(0,128,0) = sqrt(229^2 + 71^2 + 53^2) = much larger
         ... red is nearest
Result: .ansi8(.red)
```

**Trace 3: 256-color gray**
```
Input:  Color.truecolor(r: 128, g: 128, b: 128)
Step 1: .downsampled(to: .extended)
Step 2: Check grayscale ramp (indices 232-255): index 244 = RGB(128,128,128)
         Exact match at index 244.
Result: .ansi256(244)
```

**Trace 4: Mouse click parsing**
```
Input bytes: [0x3C, 0x30, 0x3B, 0x31, 0x30, 0x3B, 0x32, 0x30, 0x4D]
             which is ASCII "<0;10;20M"
Step 1: '<' prefix -> SGR mode
Step 2: Parse button code: 0 -> left button, no modifiers
Step 3: Parse column: 10
Step 4: Parse row: 20
Step 5: 'M' suffix -> press (not release)
Result: MouseEvent(button: .left, column: 10, row: 20, modifiers: [])
```

### Reference Truth

- ANSI escape sequences: ECMA-48 standard and xterm ctlseqs documentation (https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
- xterm-256 palette RGB values: standard xterm color cube formula: indices 16-231 map to 6x6x6 cube where component = index == 0 ? 0 : 55 + 40 * index; indices 232-255 map to grayscale 8 + 10 * (index - 232)
- SGR 1006 mouse protocol: xterm documentation for SGR mouse mode
- Kitty keyboard protocol: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- DECSCUSR cursor shape: DEC VT520 manual, values 0-6

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? No

No new ADRs for v0.2.0. All architectural decisions are covered by:
- **ADR-009** (SwiftCLIKit extracted as reusable terminal library) — v0.2.0 adds files to the same package.
- **ADR-010** (Raw terminal mode via POSIX termios, no ncurses) — v0.2.0's zero-C-dependency constraint follows from this decision. Color detection uses environment variables, not terminfo/ncurses.

---

## 10. Open Questions

1. **ColorNegotiation caching:** Should `detect()` cache its result or re-read env vars on every call?
   - **Recommendation:** Detect once at app startup, pass `ColorCapability` as a parameter to rendering code. Document this pattern. `detect()` itself remains stateless (no internal cache) so tests can manipulate env vars between calls.

2. **Mouse event opt-in:** Should mouse events be always parsed when present in the byte stream, or require explicit opt-in at the KeyReader level?
   - **Recommendation:** Opt-in. Caller enables mouse mode (writes `MouseMode.enable` to terminal) and configures KeyReader to expect mouse sequences. When mouse parsing is disabled, SGR sequences are returned as `Key.unknown` bytes. This avoids overhead and unexpected `.mouse` events for apps that do not need mouse support.

3. **Kitty protocol graceful degradation:** What happens if the terminal does not support Kitty keyboard protocol?
   - **Recommendation:** The enable/disable escapes are no-ops on non-Kitty terminals (they ignore unrecognized sequences). KeyReader continues to parse standard escape sequences. No detection needed — the protocol is purely additive.

4. **xterm-256 palette storage:** Should the 256-entry RGB lookup table be computed once at startup or be a compile-time constant?
   - **Recommendation:** Compile-time static array. The xterm-256 palette is well-defined and never changes. A static `let palette: [(UInt8, UInt8, UInt8)]` avoids any runtime cost.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Narrative Article

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (Color + ColorNegotiation + HexColor + ANSICodes + AlternateScreen + CursorControl + MouseEvent)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (color capabilities, SGR protocol, downsampling algorithm)

**Article Name:** `ColorGuide.md`

Contents:
1. Color capability levels and what they mean
2. Using the unified `Color` type
3. Auto-negotiation: how `ColorNegotiation.detect()` works
4. Downsampling: what happens when you use truecolor on an 8-color terminal
5. Mouse event handling: enabling, parsing, disabling
6. Alternate screen lifecycle
7. Migration guide from v0.1.0 `HexColor` to v0.2.0 `Color`

DocC comments on all public API. Every public function, type, enum case, and property gets a `///` doc comment with at least a one-line summary.
