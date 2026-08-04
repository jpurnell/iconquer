# Implementation Checklist: SwiftCLIKit v0.1.0 — Foundation

**Created:** 2026-04-10
**Design Proposal:** `project/plans/upcoming/SwiftCLIKit_v010.md`
**Roadmap:** `project/plans/upcoming/SwiftCLIKit_ROADMAP.md`

---

## Current Phase: SHIPPED

### Completed
- [x] Design proposal written and approved
- [x] Roadmap written and approved
- [x] Phase 0: Scaffolding
- [x] Phase 1: Tests (RED) — 114 tests, all failing
- [x] Phase 2: Implementation (GREEN) — 114/114 passing
- [x] Phase 3: Refactoring + safety audit
- [x] Phase 4: Documentation (DocC + README + guide)
- [x] Phase 5: Quality gate (0 warnings, 0 forbidden patterns)
- [x] Phase 6: Ship — tagged v0.1.0 (5b6a5cf)

---

## Phase 0: Project Scaffolding

- [ ] Create sibling repo `/Users/jpurnell/Dropbox/Computer/Development/Swift/SwiftCLIKit/`
- [ ] Initialize git repo
- [ ] Write `Package.swift` (swift-tools-version: 6.0, macOS 15+, strictConcurrency: .complete)
- [ ] Create directory structure:
  - [ ] `Sources/SwiftCLIKit/Terminal/`
  - [ ] `Sources/SwiftCLIKit/Input/`
  - [ ] `Sources/SwiftCLIKit/Rendering/`
  - [ ] `Sources/SwiftCLIKit/Util/`
  - [ ] `Tests/SwiftCLIKitTests/`
- [ ] Verify `swift build` succeeds with empty targets
- [ ] Verify `swift test` runs (zero tests, zero failures)
- [ ] Clone `development-guidelines/` into the new repo (vendor as plain files, strip .git)

---

## Phase 1: Tests (RED) — Write All Failing Tests First

Each module gets its test file written before any implementation. Tests must compile against stub types (empty structs/enums with the correct signatures) and fail at runtime.

### 1a. Stub types (compile targets only)
- [ ] Create stub `RawTerminal.swift` (class with init, readByte, isRawMode — all no-op/false)
- [ ] Create stub `TerminalSize.swift` (struct with columns/rows, static current, static onResize)
- [ ] Create stub `TerminalSettings.swift` (struct with fields, load/save/resolveColor — defaults)
- [ ] Create stub `Key.swift` + `KeyReader.swift` (enum cases + struct with readKey)
- [ ] Create stub `LineEditor.swift` + `LineResult.swift` (struct + enum)
- [ ] Create stub `InputHistory.swift` (struct with add/navigateUp/navigateDown/reset)
- [ ] Create stub `ANSICodes.swift` + `ANSIColor.swift` (enum with static lets + cases)
- [ ] Create stub `ScreenBuffer.swift` (struct with append/appendLine/frame/raw)
- [ ] Create stub `BoxDrawing.swift` (struct with static unicode/ascii + border methods)
- [ ] Create stub `StatusArea.swift` (class with push/clear/render/lineCount)
- [ ] Create stub `UnicodeWidth.swift` (enum with width(of:) + displayWidth)
- [ ] Create stub `ANSIStringMetrics.swift` (enum with visibleLength/padVisible/truncateVisible)
- [ ] Create stub `HexColor.swift` (enum with toANSI8/toANSIEscape)
- [ ] Verify: `swift build` compiles, `swift test` runs (0 tests)

### 1b. RawTerminalTests (3 tests)
- [ ] Pipe round-trip: write bytes to pipe write-end, read via readByte() — bytes match
- [ ] EOF on closed pipe: close write-end, readByte() returns nil
- [ ] isRawMode flag: true on Darwin with valid fd

### 1c. KeyReaderTests (21 tests)
- [ ] Arrow up: `\x1B[A` → `.arrowUp`
- [ ] Arrow down: `\x1B[B` → `.arrowDown`
- [ ] Arrow right: `\x1B[C` → `.arrowRight`
- [ ] Arrow left: `\x1B[D` → `.arrowLeft`
- [ ] Home: `\x1B[H` → `.home`
- [ ] End: `\x1B[F` → `.end`
- [ ] Delete: `\x1B[3~` → `.delete`
- [ ] Backspace: `0x7F` → `.backspace`
- [ ] Enter: `0x0D` → `.enter`
- [ ] Tab: `0x09` → `.tab`
- [ ] Escape (bare): `0x1B` (+ timeout) → `.escape`
- [ ] Ctrl-C: `0x03` → `.ctrlC`
- [ ] Ctrl-D: `0x04` → `.ctrlD`
- [ ] Ctrl-A: `0x01` → `.ctrlA`
- [ ] Ctrl-E: `0x05` → `.ctrlE`
- [ ] Ctrl-K: `0x0B` → `.ctrlK`
- [ ] Ctrl-W: `0x17` → `.ctrlW`
- [ ] Ctrl-U: `0x15` → `.ctrlU`
- [ ] Ctrl-L: `0x0C` → `.ctrlL`
- [ ] Printable ASCII: `0x61` → `.character("a")`
- [ ] UTF-8 multibyte: `0xC3 0xA9` → `.character("\u{00E9}")`
- [ ] Unknown control: `0x00` → `.unknown(0x00)`

### 1d. LineEditorTests (14 tests)
- [ ] Type + Enter → `.completed("hello")`
- [ ] Backspace: `"helo"` + backspace + `"lo"` → `"hello"`
- [ ] Arrow left + insert: `"hllo"` + left×3 + `"e"` → `"hello"`
- [ ] Home jump: `"abc"` + home + `"X"` → `"Xabc"`
- [ ] End jump: `"abc"` + home + end + `"X"` → `"abcX"`
- [ ] Ctrl-A (= Home): cursor at 0
- [ ] Ctrl-E (= End): cursor at text.count
- [ ] Ctrl-K (kill to end): `"hello"` + left×2 + ctrlK → `"hel"`
- [ ] Ctrl-W (delete word): `"hello world"` + ctrlW → `"hello "`
- [ ] Ctrl-U (kill to start): `"hello"` + ctrlU → `""`
- [ ] Ctrl-D on empty → `.eof`
- [ ] Ctrl-D on non-empty → `.editing` (delete char or no-op)
- [ ] Ctrl-C → `.interrupt`
- [ ] Arrow past boundaries: right past end stays, left past start stays

### 1e. InputHistoryTests (8 tests)
- [ ] Add 3, navigate up 3× → reverse order
- [ ] Navigate down → toward current (stashed) text
- [ ] Down past bottom → stashed current text
- [ ] Up past top → nil (stays at oldest)
- [ ] Consecutive duplicates → second add ignored
- [ ] Empty string → add is no-op
- [ ] Max entries: add 101 (max 100) → oldest dropped
- [ ] Reset: after reset, navigateUp returns last entry

### 1f. BoxDrawingTests (6 tests)
- [ ] Unicode top border with header
- [ ] ASCII top border with header
- [ ] Unicode mid border
- [ ] Unicode bottom border
- [ ] Width 0 → graceful (no crash)
- [ ] Header longer than width → truncated

### 1g. UnicodeWidthTests (18 tests)
- [ ] ASCII letter → width 1
- [ ] CJK ideograph `"中"` → width 2
- [ ] CJK string `"中文"` → displayWidth 4
- [ ] Fullwidth letter `"Ａ"` → width 2
- [ ] Halfwidth katakana `"ｱ"` → width 1
- [ ] Combining mark `"e\u{0301}"` → width 1
- [ ] Emoji basic `"😀"` → width 2
- [ ] Emoji with VS16 `"☺\u{FE0F}"` → width 2
- [ ] Emoji ZWJ sequence → width 2
- [ ] Flag emoji `"🇯🇵"` → width 2
- [ ] Zero-width joiner → width 0
- [ ] Zero-width space → width 0
- [ ] Control character → width 0
- [ ] Tab → width 0
- [ ] Soft hyphen → width 1
- [ ] Mixed ASCII+CJK `"AB中CD"` → displayWidth 6
- [ ] Empty string → displayWidth 0
- [ ] ANSI-stripped displayWidth (delegated to ANSIStringMetrics)

### 1h. ANSIStringMetricsTests (12 tests)
- [ ] Plain text → visibleLength 5
- [ ] ANSI colored → visibleLength 3
- [ ] Multiple escapes → correct visible length
- [ ] CJK with ANSI → visibleLength 4
- [ ] Emoji with ANSI → visibleLength 2
- [ ] padVisible: `"hi"` to 10 → 8 spaces
- [ ] padVisible: already wide → no padding
- [ ] padVisible: CJK → correct padding
- [ ] truncateVisible: `"hello world"` to 5 → `"hello"`
- [ ] truncateVisible with ANSI → reset appended
- [ ] truncateVisible wide char boundary → pad with space
- [ ] Empty string → visibleLength 0

### 1i. StatusAreaTests (7 tests)
- [ ] Push 1 → render returns 1 line
- [ ] Push 6 (max 5) → only 5 lines, oldest dropped
- [ ] Clear → empty array
- [ ] lineCount matches stored messages
- [ ] Thread safety: 10 concurrent pushes → no crash
- [ ] Render with colorize → contains ANSI escapes
- [ ] Render without colorize → plain text

### 1j. HexColorTests (11 tests)
- [ ] Red `"#e53935"` → `.red`
- [ ] Green `"#4caf50"` → `.green`
- [ ] Blue `"#2196f3"` → `.blue`
- [ ] White `"#ffffff"` → `.white`
- [ ] Black `"#000000"` → `.black`
- [ ] Case insensitive: `"#FF0000"` = `"#ff0000"` → `.red`
- [ ] Without hash: `"e53935"` → `.red`
- [ ] Malformed → nil
- [ ] Empty string → nil
- [ ] toANSIEscape valid → `"\u{001B}[31m"`
- [ ] toANSIEscape invalid → `""`

### 1k. TerminalSettingsTests (7 tests)
- [ ] Load missing file → defaults
- [ ] Save + load round-trip → all fields preserved
- [ ] resolveColor(.never) → false
- [ ] resolveColor(.always) → true
- [ ] resolveColor(.auto) + isatty true → true
- [ ] resolveColor(.auto) + isatty false → false
- [ ] resolveColor(.auto) + NO_COLOR → false

### 1l. ScreenBufferTests (6 tests)
- [ ] Empty buffer → frame is clear+home; raw is empty
- [ ] appendLine → raw contains line + newline
- [ ] append → raw without trailing newline
- [ ] Multiple lines → order preserved
- [ ] frame starts with clearScreen + home
- [ ] raw excludes clearScreen/home

### 1m. RED gate
- [ ] `swift test` compiles and all ~113 tests **FAIL** (stubs return wrong values)
- [ ] No test passes accidentally

---

## Phase 2: Implementation (GREEN) — Make Tests Pass

Implement each module in dependency order: Util → Rendering → Terminal → Input.

### 2a. Util/UnicodeWidth
- [ ] East Asian Width lookup table (Unicode 16.0, binary search on sorted ranges)
- [ ] `width(of: Unicode.Scalar)` — W/F → 2, Mn/Mc/Me → 0, Cc → 0, default → 1
- [ ] `width(of: Character)` — grapheme cluster handling, emoji ZWJ → 2, VS16 → 2
- [ ] `displayWidth(_ s: String)` — sum of character widths
- [ ] All UnicodeWidthTests pass

### 2b. Util/ANSIStringMetrics
- [ ] `visibleLength` — strip ANSI escapes, delegate to UnicodeWidth.displayWidth
- [ ] `padVisible` — pad to target visible width
- [ ] `truncateVisible` — truncate respecting wide chars, append reset if needed
- [ ] All ANSIStringMetricsTests pass

### 2c. Util/HexColor
- [ ] Parse hex string (with/without #, case insensitive)
- [ ] RGB → nearest ANSI 8-color (Euclidean distance)
- [ ] `toANSI8` and `toANSIEscape`
- [ ] All HexColorTests pass

### 2d. Rendering/ANSICodes + ANSIColor
- [ ] All static escape sequence constants
- [ ] `fg(_:)` and `bg(_:)` for ANSIColor
- [ ] Cursor control sequences
- [ ] (No separate tests — constants are validated transitively by other tests)

### 2e. Rendering/ScreenBuffer
- [ ] init(width:), append, appendLine, frame, raw
- [ ] frame prefix: clearScreen + home
- [ ] All ScreenBufferTests pass

### 2f. Rendering/BoxDrawing
- [ ] Unicode and ASCII character sets
- [ ] topBorder, midBorder, bottomBorder with width/header handling
- [ ] All BoxDrawingTests pass

### 2g. Rendering/StatusArea
- [ ] NSLock-protected message buffer
- [ ] push, clear, render, lineCount
- [ ] Max messages cap
- [ ] All StatusAreaTests pass

### 2h. Terminal/TerminalSettings
- [ ] TerminalSettings struct with Codable conformance
- [ ] ColorMode enum
- [ ] resolveColor with isatty/NO_COLOR logic
- [ ] XDG load/save (~/.config/<appName>/terminal.json)
- [ ] All TerminalSettingsTests pass

### 2i. Terminal/TerminalSize
- [ ] ioctl TIOCGWINSZ query with fallback
- [ ] SIGWINCH handler with ResizeToken (deregister on deinit)
- [ ] Platform guards (#if canImport)

### 2j. Terminal/RawTerminal
- [ ] Store original termios on init
- [ ] cfmakeraw + tcsetattr
- [ ] Restore on deinit
- [ ] readByte via POSIX read(2)
- [ ] isRawMode flag
- [ ] Platform guard: no-op on unsupported
- [ ] All RawTerminalTests pass

### 2k. Input/KeyReader
- [ ] Escape sequence state machine
- [ ] CSI parsing: arrows, Home, End, Delete
- [ ] Control character mapping (Ctrl-A through Ctrl-Z)
- [ ] UTF-8 multibyte accumulation
- [ ] Bare escape timeout (50-100ms via poll/select)
- [ ] All KeyReaderTests pass

### 2l. Input/LineEditor + LineResult
- [ ] Text buffer with cursor position
- [ ] Character insert at cursor
- [ ] Backspace, delete, arrow left/right, home, end
- [ ] Ctrl-A, Ctrl-E, Ctrl-K, Ctrl-W, Ctrl-U
- [ ] Enter → .completed, Ctrl-D → .eof, Ctrl-C → .interrupt
- [ ] Boundary guards (cursor never negative or past text.count)
- [ ] All LineEditorTests pass

### 2m. Input/InputHistory
- [ ] Array-backed history with max cap
- [ ] Navigation index with stashed current text
- [ ] Consecutive duplicate suppression
- [ ] Empty string rejection
- [ ] All InputHistoryTests pass

### 2n. GREEN gate
- [ ] `swift build` — zero warnings
- [ ] `swift test` — all ~113 tests **PASS**

---

## Phase 3: Refactoring

- [ ] Remove any duplication across modules
- [ ] Verify naming consistency (Swift API guidelines)
- [ ] Simplify any over-engineered logic
- [ ] All tests still pass after refactoring
- [ ] **Safety audit:** search for `!`, `as!`, `try!`, `fatalError`, `precondition` — none found
- [ ] **Pointer audit:** no `withUnsafe*` pointer escapes
- [ ] **Concurrency audit:** all `@unchecked Sendable` have `// Justification:` comments
- [ ] **Hygiene:** no temp files, no commented-out code, no TODOs without tracking

---

## Phase 4: Documentation

- [ ] DocC `///` comments on every public type, method, property, enum case
- [ ] Usage examples in `///` for key types: RawTerminal, KeyReader, LineEditor
- [ ] `SwiftCLIKitGuide.md` narrative guide in repo root:
  - [ ] Library overview and design philosophy
  - [ ] Quick start: raw mode + key reading + line editing in 20 lines
  - [ ] Platform support and graceful degradation
  - [ ] Integration pattern (how to add as SPM dependency)
- [ ] README.md (short: badge, one-liner, link to guide)

---

## Phase 5: Quality Gates

- [ ] `swift build` — zero warnings
- [ ] `swift test` — zero failures, ~113 tests
- [ ] Safety audit: zero forbidden patterns in Sources/
- [ ] All `@unchecked Sendable` justified
- [ ] No hardcoded constants (all configurable via init params)
- [ ] DocC builds without errors: `swift package generate-documentation --target SwiftCLIKit`

---

## Phase 6: Ship

- [ ] ADR-009 and ADR-010 committed to `architecture_decisions.md`
- [ ] Git tag `v0.1.0`
- [ ] Move this checklist to `04_99_COMPLETED/`
- [ ] Update `MEMORY.md` with ship status
- [ ] Begin `CURRENT_SwiftCLIKit_v020_Color.md` checklist

---

## Module Status

| Module | Status | Tests | Docs | Warnings |
|--------|--------|-------|------|----------|
| Util/UnicodeWidth | Planned | 0/18 | No | — |
| Util/ANSIStringMetrics | Planned | 0/12 | No | — |
| Util/HexColor | Planned | 0/11 | No | — |
| Rendering/ANSICodes | Planned | — | No | — |
| Rendering/ScreenBuffer | Planned | 0/6 | No | — |
| Rendering/BoxDrawing | Planned | 0/6 | No | — |
| Rendering/StatusArea | Planned | 0/7 | No | — |
| Terminal/TerminalSettings | Planned | 0/7 | No | — |
| Terminal/TerminalSize | Planned | 0/0 | No | — |
| Terminal/RawTerminal | Planned | 0/3 | No | — |
| Input/KeyReader | Planned | 0/22 | No | — |
| Input/LineEditor | Planned | 0/14 | No | — |
| Input/InputHistory | Planned | 0/8 | No | — |
| **Total** | | **0/114** | | |

---

**Last Updated:** 2026-04-10
