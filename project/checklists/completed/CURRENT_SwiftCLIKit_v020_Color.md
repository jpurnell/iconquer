# Implementation Checklist: SwiftCLIKit v0.2.0 — Color

**Created:** 2026-04-10
**Design Proposal:** `project/plans/upcoming/SwiftCLIKit_v020.md`
**Depends on:** SwiftCLIKit v0.1.0 (shipped)

---

## Current Phase: SHIPPED

---

## Phase 1: Tests (RED) + Stubs

### New source stubs (compile targets)
- [ ] `Rendering/Color.swift` — Color enum, ColorCapability enum
- [ ] `Rendering/ColorNegotiation.swift` — detect, fgEscape, bgEscape
- [ ] `Terminal/AlternateScreen.swift` — RAII alternate screen
- [ ] `Terminal/CursorControl.swift` — cursor escape sequences
- [ ] `Input/MouseEvent.swift` — MouseButton, MouseEvent, MouseMode, KeyModifiers

### Modified source stubs
- [ ] `Input/Key.swift` — add mouse(MouseEvent), functionKey(Int), pageUp, pageDown, insert
- [ ] `Input/KeyReader.swift` — add enableKittyProtocol, disableKittyProtocol statics; extend readKey for F-keys, PageUp/Down, Insert, mouse
- [ ] `Rendering/ANSICodes.swift` — add fg256, bg256, fgRGB, bgRGB, strikethrough, overline, underline variants
- [ ] `Util/HexColor.swift` — add toColor, toEscape (keep existing v0.1.0 methods)

### Test files (all RED)
- [ ] `ColorTests.swift` — 11 tests: fromHex, equatable, downsampling
- [ ] `ColorNegotiationTests.swift` — 12 tests: detect, fgEscape, bgEscape, auto-downsample
- [ ] `AlternateScreenTests.swift` — 3 tests: init sequence, isActive, deinit sequence
- [ ] `CursorControlTests.swift` — 15 tests: show/hide, moveTo, moveUp/Down/Left/Right, save/restore, shapes
- [ ] `MouseEventTests.swift` — 14 tests: click/release/scroll/modifiers, malformed, enable/disable
- [ ] `KeyReaderV2Tests.swift` — 13 tests: F1-F4, F5, F12, PageUp/Down, Insert, mouse, Kitty, regression
- [ ] `ANSICodesV2Tests.swift` — 12 tests: fg256/bg256, fgRGB/bgRGB, extended attributes
- [ ] `HexColorV2Tests.swift` — 8 tests: toColor, toEscape at each capability, backward compat

### RED gate
- [ ] All v0.1.0 tests still pass (114)
- [ ] All new tests compile and FAIL (~88 new tests)

---

## Phase 2: Implementation (GREEN)

### Rendering/Color + ColorCapability
- [ ] Color enum with ansi8/ansi256/truecolor cases
- [ ] fromHex: parse #RRGGBB, RRGGBB, #RGB, RGB
- [ ] downsampled(to:): truecolor→256 (xterm palette nearest), 256→8, any→none
- [ ] xterm-256 palette as static compile-time array
- [ ] ColorTests pass

### Rendering/ColorNegotiation
- [ ] detect(): NO_COLOR, COLORTERM, TERM checks
- [ ] fgEscape/bgEscape: dispatch on capability, auto-downsample
- [ ] ColorNegotiationTests pass

### Rendering/ANSICodes v2
- [ ] fg256, bg256, fgRGB, bgRGB
- [ ] strikethrough, overline, underlineCurly/Double/Dotted
- [ ] ANSICodesV2Tests pass

### Util/HexColor v2
- [ ] toColor: hex → Color.truecolor
- [ ] toEscape: hex + capability → escape string
- [ ] Keep backward compat toANSI8/toANSIEscape
- [ ] HexColorV2Tests pass

### Terminal/AlternateScreen
- [ ] Init writes \x1B[?1049h to fd
- [ ] Deinit writes \x1B[?1049l
- [ ] isActive flag
- [ ] AlternateScreenTests pass

### Terminal/CursorControl
- [ ] All static escape sequences
- [ ] setShape with blinking support
- [ ] CursorControlTests pass

### Input/MouseEvent + MouseMode
- [ ] MouseButton, MouseEvent, KeyModifiers types
- [ ] MouseMode.enable/disable escape strings
- [ ] MouseMode.parse: SGR 1006 byte sequence → MouseEvent
- [ ] MouseEventTests pass

### Input/Key v2 + KeyReader v2
- [ ] New Key cases: mouse, functionKey, pageUp, pageDown, insert
- [ ] KeyReader: F1-F4 (ESC O P/Q/R/S), F5-F12 (ESC [ N~)
- [ ] KeyReader: PageUp (5~), PageDown (6~), Insert (2~)
- [ ] KeyReader: SGR mouse sequence parsing (ESC [ < ...)
- [ ] Kitty protocol enable/disable statics
- [ ] KeyReaderV2Tests pass
- [ ] All v0.1.0 KeyReader tests still pass (regression)

### GREEN gate
- [ ] `swift build` — zero warnings
- [ ] `swift test` — all tests pass (114 old + ~88 new = ~202)

---

## Phase 3: Refactoring + Safety Audit
- [ ] Safety audit: no !, as!, try!, fatalError
- [ ] All @unchecked Sendable have justification
- [ ] No pointer escapes
- [ ] Tests still pass after refactoring

---

## Phase 4: Documentation
- [ ] DocC on all new public API
- [ ] ColorGuide.md narrative article
- [ ] Update SwiftCLIKitGuide.md with v0.2.0 features
- [ ] Update README.md version reference

---

## Phase 5: Quality Gate + Ship
- [ ] `swift build` zero warnings
- [ ] `swift test` all pass
- [ ] Safety audit clean
- [ ] Git tag v0.2.0
- [ ] Move checklist to COMPLETED

---

**Last Updated:** 2026-04-10
