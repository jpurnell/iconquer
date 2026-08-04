# Design Proposal: SwiftCLIKit v1.0.0 — Ship It + v1.x Stretch Goals

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Production-ready release with testing infrastructure, theming, clipboard, documentation, CI, and performance targets; plus directional stretch goals for v1.x

---

## 1. Objective

**Objective:** Ship SwiftCLIKit 1.0.0 as a production-ready, fully documented, and thoroughly tested terminal UI framework. The release focuses on four pillars: (1) first-class testing infrastructure so every widget and app is testable without a real terminal, (2) theming for consistent visual design, (3) clipboard integration via OSC 52, and (4) documentation and CI that make the library trustworthy for production use. v1.x stretch goals define the directional vision beyond 1.0.

**Master Plan Reference:** SwiftCLIKit Roadmap v1.0.0 — Ship It, v1.x — Stretch. Builds on v0.5.0 (Framework) and all prior layers.

**Problems solved:**
1. **Testing requires a terminal.** Without a headless backend, widget and app tests cannot run in CI. `TestBackend` provides a fake terminal that captures `CellBuffer` output for assertions.
2. **No snapshot testing.** Visual regressions are caught only by manual inspection. `SnapshotTesting` renders buffers to deterministic strings for golden-file comparison.
3. **No theming.** Applications hardcode colors, leading to inconsistent visuals and no dark/light mode support. `Theme` provides semantic color palettes loaded from JSON.
4. **No clipboard access.** Copy/paste in terminal apps requires OSC 52 sequences that no Swift library provides.
5. **No documentation site.** API docs exist as inline comments but there is no browsable documentation site or guided tutorials.
6. **No Linux CI.** All development has been macOS-only. Linux compatibility must be verified continuously.

---

## 2. Proposed Architecture

### Module structure (additions to SwiftCLIKit)

```
Sources/SwiftCLIKit/
├── Testing/
│   ├── TestBackend.swift          — Headless terminal backend for unit testing
│   └── SnapshotTesting.swift      — CellBuffer/Frame → deterministic string + golden file comparison
├── Theme/
│   ├── Theme.swift                — Named color palette with semantic colors
│   └── ThemeLoader.swift          — Load Theme from JSON file or string
├── Clipboard/
│   └── Clipboard.swift            — OSC 52 read/write for terminal clipboard access
└── SyntaxHighlighting/
    ├── SyntaxHighlighter.swift    — Language-aware tokenizer → styled spans
    ├── SyntaxTheme.swift          — Token type → Color/attribute mapping
    ├── Languages/
    │   ├── SwiftSyntax.swift      — Swift keyword/literal/comment rules
    │   ├── JSONSyntax.swift       — JSON key/value/structural rules
    │   ├── MarkdownSyntax.swift   — Markdown heading/bold/code/link rules
    │   ├── PythonSyntax.swift     — Python keyword/decorator/string rules
    │   └── GenericSyntax.swift    — Fallback: string/number/comment heuristics
    └── SyntaxLanguage.swift       — Language enum + file extension detection
```

### Testing architecture

`TestBackend` replaces the real terminal in tests. It provides:
- A virtual terminal with configurable width/height
- An `EventStream` that accepts programmatically injected events
- Access to the current `CellBuffer` after each render cycle
- No actual terminal I/O — safe for CI, headless environments, and parallel test execution

`SnapshotTesting` converts a `CellBuffer` to a canonical string representation (one line per row, with style markers) that can be compared against golden files. This catches visual regressions that unit-level cell assertions might miss.

### CI architecture

GitHub Actions matrix:
- macOS 15 + Swift 6.x (latest)
- Ubuntu 24.04 + Swift 6.x (latest)
- All tests, linting, and DocC build on both platforms

### Performance target

`DiffRenderer` must complete a full 200x50 (10,000 cell) differential render in under 1ms on modern hardware. This ensures smooth 60 FPS rendering even on large terminal windows.

---

## 3. API Surface

### 3a. TestBackend

```swift
/// A headless terminal backend for unit and integration testing.
/// Replaces the real terminal so tests can run without TTY access.
///
/// ## Example
/// ```swift
/// let backend = TestBackend(width: 80, height: 24)
/// let app = App(
///     initialModel: MyModel(),
///     update: myUpdate,
///     view: myView,
///     backend: backend
/// )
///
/// // Inject events
/// await backend.inject(.key(.character("q")))
///
/// // Assert on rendered output
/// let buffer = backend.currentBuffer
/// XCTAssertEqual(buffer[0, 0].character, "H")
/// ```
public final class TestBackend: @unchecked Sendable {
    // Justification: internal lock protects buffer and event queue mutations

    /// Create a test backend with the given terminal dimensions.
    public init(width: Int, height: Int)

    /// The current rendered CellBuffer after the last render cycle.
    public var currentBuffer: CellBuffer { get }

    /// The width of the virtual terminal.
    public var width: Int { get }

    /// The height of the virtual terminal.
    public var height: Int { get }

    /// Inject an event into the backend's event stream.
    /// The event will be delivered to the App's event loop.
    public func inject(_ event: Event) async

    /// Inject a sequence of events with optional delay between each.
    public func injectSequence(
        _ events: [Event],
        delay: Duration = .zero
    ) async

    /// Wait for the next render cycle to complete.
    /// Useful for asserting state after an event has been processed.
    public func waitForRender() async

    /// The event stream for this backend (used by App internally).
    public var eventStream: AsyncStream<Event> { get }

    /// All rendered frames since creation or last `clearHistory()`.
    public var renderHistory: [CellBuffer] { get }

    /// Clear the render history.
    public func clearHistory()
}
```

### 3b. SnapshotTesting

```swift
/// Snapshot testing utilities for CellBuffer and Frame rendering.
public enum SnapshotTesting {
    /// Render a CellBuffer to a deterministic string representation.
    /// Each row is one line. Style information is encoded as inline markers.
    ///
    /// Format: plain text with `[fg:bg:attrs]` prefixes when style changes.
    /// Example: `[red:default:bold]Hello[default:default:] World`
    public static func render(_ buffer: CellBuffer) -> String

    /// Render a CellBuffer to plain text (no style markers).
    /// Useful for content-only assertions.
    public static func renderPlainText(_ buffer: CellBuffer) -> String

    /// Compare a CellBuffer against a golden file.
    /// Returns nil if they match, or a diff string describing mismatches.
    public static func compare(
        _ buffer: CellBuffer,
        goldenFile: String
    ) -> String?

    /// Write a CellBuffer snapshot to a file path.
    /// Used to create or update golden files.
    public static func write(
        _ buffer: CellBuffer,
        to path: String
    ) throws

    /// Assert that a CellBuffer matches a golden file.
    /// If the golden file does not exist, creates it (first-run behavior).
    /// If it exists and differs, fails with a descriptive diff.
    ///
    /// - Parameters:
    ///   - buffer: The rendered CellBuffer to verify.
    ///   - name: Snapshot name (used as filename).
    ///   - directory: Directory for golden files. Default: `__Snapshots__` next to test file.
    ///   - record: If true, always overwrite the golden file (for updating snapshots).
    public static func assertSnapshot(
        _ buffer: CellBuffer,
        name: String,
        directory: String? = nil,
        record: Bool = false,
        file: StaticString = #filePath,
        line: UInt = #line
    )
}
```

### 3c. Theme

```swift
/// A named color palette with semantic colors for consistent application styling.
public struct Theme: Sendable, Codable {
    /// Theme display name.
    public var name: String

    // Semantic colors
    public var primary: Color
    public var secondary: Color
    public var error: Color
    public var warning: Color
    public var success: Color
    public var muted: Color
    public var surface: Color
    public var onSurface: Color
    public var background: Color
    public var onBackground: Color
    public var border: Color
    public var highlight: Color
    public var highlightText: Color

    /// Built-in default dark theme.
    public static let dark: Theme

    /// Built-in default light theme.
    public static let light: Theme

    /// Create a CellStyle from semantic color roles.
    public func style(
        fg role: KeyPath<Theme, Color>,
        bg bgRole: KeyPath<Theme, Color> = \.background,
        attributes: CellAttributes = []
    ) -> CellStyle
}
```

### 3d. ThemeLoader

```swift
/// Load themes from JSON strings or files.
public enum ThemeLoader {
    /// Load a theme from a JSON string.
    /// Colors are specified as hex strings (e.g., "#e53935") or named ANSI colors
    /// (e.g., "red", "bright-blue").
    public static func load(json: String) throws -> Theme

    /// Load a theme from a JSON file at the given path.
    public static func load(path: String) throws -> Theme

    /// Load a theme from JSON Data.
    public static func load(data: Data) throws -> Theme
}
```

### 3e. Clipboard

```swift
/// Terminal clipboard access via the OSC 52 escape sequence protocol.
public enum Clipboard {
    /// Write text to the terminal clipboard.
    /// Emits an OSC 52 sequence to stdout. The terminal must support OSC 52
    /// for this to work (most modern terminals do).
    public static func write(_ text: String)

    /// Generate the OSC 52 escape sequence string for writing text to clipboard.
    /// Use this when you need the raw sequence (e.g., for inclusion in a CellBuffer render).
    public static func writeSequence(_ text: String) -> String

    /// Request clipboard contents from the terminal via OSC 52.
    /// Returns the clipboard text if the terminal responds, or nil on timeout.
    /// Note: Many terminals block clipboard read for security reasons.
    public static func read(timeout: Duration = .seconds(1)) async -> String?

    /// Generate the OSC 52 escape sequence string for requesting clipboard contents.
    public static func readSequence() -> String
}
```

### 3f. SyntaxHighlighter

```swift
/// Language-aware syntax highlighter that tokenizes source text into styled spans.
/// Uses simple regex/keyword-based tokenization — not a full parser. Designed for
/// TUI code display, not IDE-grade accuracy.
public struct SyntaxHighlighter: Sendable {
    /// Create a highlighter for the given language.
    public init(language: SyntaxLanguage, theme: SyntaxTheme = .default)

    /// Highlight a single line of source text.
    /// Returns an array of styled spans that can be rendered into a Frame.
    public func highlight(_ line: String) -> [StyledSpan]

    /// Highlight multiple lines. Tracks multi-line state (block comments, strings).
    public func highlight(lines: [String]) -> [[StyledSpan]]
}

/// A span of text with associated style from syntax highlighting.
public struct StyledSpan: Sendable, Equatable {
    public let text: String
    public let tokenType: TokenType
    public let fg: Color
    public let bg: Color
    public let attributes: CellAttributes
}

/// Token categories produced by the highlighter.
public enum TokenType: String, Sendable {
    case keyword        // if, let, func, class, struct, enum, etc.
    case type           // Type names (capitalized identifiers, built-in types)
    case string         // String literals
    case number         // Numeric literals
    case comment        // Line and block comments
    case decorator      // @attributes, #directives
    case `operator`     // Operators and punctuation
    case function       // Function/method names at call sites
    case variable       // Variable/property names
    case plain          // Unclassified text
}

/// Maps token types to colors and attributes.
public struct SyntaxTheme: Sendable, Codable {
    public var colors: [TokenType: Color]
    public var attributes: [TokenType: CellAttributes]

    /// Default theme designed for dark terminal backgrounds.
    public static let `default`: SyntaxTheme

    /// Light background variant.
    public static let light: SyntaxTheme
}

/// Supported languages with file extension detection.
public enum SyntaxLanguage: String, Sendable, CaseIterable {
    case swift, python, json, markdown, javascript, typescript
    case go, rust, ruby, shell, yaml, toml, sql, html, css
    case generic  // Fallback: string/number/comment heuristics

    /// Detect language from a file extension (e.g., "swift" → .swift).
    public static func detect(fileExtension: String) -> SyntaxLanguage

    /// Detect language from a filename (e.g., "Package.swift" → .swift).
    public static func detect(filename: String) -> SyntaxLanguage
}
```

**Implementation approach:**
- v1.0.0 ships with hand-written tokenizers for Swift, JSON, Markdown, Python, and Generic.
- Each language tokenizer is a struct conforming to an internal `LanguageTokenizer` protocol.
- No external dependencies (no tree-sitter, no TextMate grammars). Regex-based keyword matching.
- Additional languages (JS, TS, Go, Rust, etc.) ship as the tokenizers are written — the `SyntaxLanguage` enum is extensible, and unknown languages fall back to `.generic`.
- `SyntaxTheme` is `Codable` so users can define custom themes in JSON alongside `Theme`.

---

## 4. MCP Schema

Not applicable — testing, theming, and clipboard are local-only features.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | `ThemeLoader` uses `try`/`throws` for JSON parsing. `Clipboard.read` returns optional. `SnapshotTesting.compare` returns optional diff. |
| **Sendable** | `Theme` is a value type conforming to `Sendable` and `Codable`. `TestBackend` is `@unchecked Sendable` with justification (internal lock). `Clipboard` is a stateless enum with static methods. |
| **Guard clauses** | `ThemeLoader` guards malformed JSON with descriptive errors. `SnapshotTesting.assertSnapshot` guards missing directory. `TestBackend` guards event injection after shutdown. |
| **Division safety** | N/A — no division operations in this layer. |
| **Pointer safety** | No `withUnsafe*` blocks. Base64 encoding for OSC 52 uses Foundation's `Data.base64EncodedString()`. |
| **Concurrency** | `TestBackend` uses `AsyncStream` for event injection — no raw locks exposed to callers. `Clipboard.read` uses `Task.sleep` for timeout, not `DispatchQueue`. |
| **No hardcoded constants** | Theme colors are all configurable. Clipboard timeout is a parameter. Snapshot directory is configurable. TestBackend dimensions are parameters. |

---

## 6. Backend Abstraction

Not applicable — `TestBackend` is itself a backend abstraction, but it does not wrap platform-specific compute.

---

## 7. Dependencies

### v1.0.0

- **External:** None required. Optional integration with [swift-snapshot-testing](https://github.com/pointfreeco/swift-snapshot-testing) via a conditional import or separate target, but the core `SnapshotTesting` module is self-contained.
- **Internal:** Depends on all prior SwiftCLIKit layers (v0.1.0 through v0.5.0).
- **Platforms:** macOS, Linux. CI validates both.

### v1.x post-1.0 releases

Each post-1.0 release is scoped to ship independently. Order reflects dependency chain and impact.

**v1.1.0 — Animations & Transitions**
- **Dependency:** v1.0.0 (App framework + render loop)
- **What ships:**
  - `Animation` — Duration-based animation with easing curves (linear, easeIn, easeOut, easeInOut, spring)
  - `Transition` — Enter/exit transitions for widgets (fade, slide, expand)
  - `AnimationSubscription` — Integrated into the App render loop; produces tick messages at requestAnimationFrame-like intervals
  - `Easing` — Pure math functions: cubic bezier, spring damping, bounce
- **Implementation:** Animations produce intermediate values each frame. The App render loop checks active animations and re-renders when any are in-flight. No separate animation thread — driven by the event loop.
- **Tests:** Easing curve math (compare to known values), animation start/end values, transition lifecycle (enter → active → exit)

**v1.2.0 — Form Builder**
- **Dependency:** v1.1.0 (transitions for validation feedback)
- **What ships:**
  - `Form` — High-level form container with labeled fields, tab navigation, and validation
  - `TextField` — Single-line text input widget (builds on LineEditor from v0.1.0)
  - `TextArea` — Multi-line text input with scrolling
  - `Dropdown` — Single-select dropdown menu
  - `Checkbox` / `RadioGroup` — Boolean and single-select group controls
  - `FormValidation` — Per-field validation rules with error message display
- **Tests:** Form tab order, validation on submit, field state round-trips, dropdown selection

**v1.3.0 — Kitty/Sixel Image Protocol**
- **Dependency:** v1.0.0 (CellBuffer, TestBackend)
- **What ships:**
  - `InlineImage` — Widget that renders an image using Kitty graphics protocol (preferred) or Sixel (fallback)
  - `ImageProtocol` — Detection of terminal image capability (Kitty, Sixel, iTerm2, none)
  - `ImageEncoder` — PNG/JPEG → protocol-specific escape sequences
  - Graceful degradation: ASCII art fallback when no image protocol is supported
- **Platform notes:** Kitty protocol works in Kitty, Ghostty, WezTerm. Sixel works in xterm (with `-ti 340`), mlterm, foot. iTerm2 has its own protocol.
- **Tests:** Escape sequence generation for known image bytes, capability detection from TERM/TERM_PROGRAM env vars, fallback to ASCII

**v1.4.0 — Notification & Toast Area**
- **Dependency:** v1.1.0 (animations for auto-dismiss transitions)
- **What ships:**
  - `NotificationArea` — Overlay region (typically top-right or bottom-right) for transient messages
  - `Toast` — Timed notification with severity (info, success, warning, error), auto-dismiss with fade
  - Integration with App event loop — toasts are Cmd effects that resolve after their duration
- **Tests:** Toast lifecycle (appear → duration → dismiss), multiple concurrent toasts, severity styling

**v1.5.0 — Windows Support (ConPTY)**
- **Dependency:** v1.0.0 (TerminalBackend protocol)
- **What ships:**
  - `WindowsBackend` — `TerminalBackend` conformer using Win32 Console API + ConPTY for VT processing
  - `WindowsRawTerminal` — Raw mode equivalent using `SetConsoleMode` (disable line input + echo)
  - `WindowsTerminalSize` — Console buffer info queries
  - `WindowsKeyReader` — ReadConsoleInput for key/mouse events
  - CI: GitHub Actions Windows runner with Swift 6.x
- **Platform notes:** Windows Terminal supports VT100/ANSI natively. Legacy cmd.exe requires ConPTY. Swift on Windows is available via swift.org toolchain.
- **Tests:** All existing tests pass on Windows via the WindowsBackend. Platform-specific tests for console mode toggling.
- **Risk:** Swift on Windows maturity. May need to defer if toolchain issues block.

**v1.6.0 — WASM & Web Deployment**
- **Dependency:** v1.5.0 (TerminalBackend protocol proven extensible)
- **What ships:**
  - `WASMBackend` — `TerminalBackend` conformer that communicates with xterm.js via JavaScript interop
  - `WebServer` — Simple HTTP server that serves the WASM binary + xterm.js host page (like Textual's `textual serve`)
  - Build tooling: SwiftWasm compilation target in Package.swift
- **Platform notes:** Requires SwiftWasm toolchain. xterm.js provides the terminal emulator in-browser.
- **Tests:** Compile-only validation (WASM target builds). Integration test via headless browser (Playwright/Puppeteer) if feasible.
- **Risk:** Highest risk item. SwiftWasm support for Foundation and structured concurrency may have gaps. Recommend a proof-of-concept spike before committing.

**v1.7.0 — Additional Language Tokenizers**
- **Dependency:** v1.0.0 (SyntaxHighlighter framework)
- **What ships:** Tokenizers for remaining `SyntaxLanguage` cases: JavaScript, TypeScript, Go, Rust, Ruby, Shell, YAML, TOML, SQL, HTML, CSS
- **Tests:** Per-language keyword/string/comment golden tests

---

## 8. Test Strategy

### TestBackend tests

- **Create and inject:** Create `TestBackend(width: 80, height: 24)`, inject `.key(.character("a"))` → event appears in event stream.
- **Render capture:** Wire `TestBackend` to a minimal `App`, send an event that changes model → `currentBuffer` reflects the updated view.
- **Render history:** Three render cycles → `renderHistory` has 3 entries.
- **Event sequence:** Inject `[.key(.arrowDown), .key(.arrowDown), .key(.enter)]` → all three processed in order.
- **Concurrent safety:** Inject events from multiple tasks simultaneously → no crashes, all events delivered.

### SnapshotTesting tests

- **Render known buffer:** Create 10x3 CellBuffer with "Hello" in red on row 0 → `render()` produces expected string with style markers.
- **Plain text render:** Same buffer → `renderPlainText()` produces "Hello" without markers.
- **Golden file match:** Render buffer, write golden file, compare same buffer → returns nil (match).
- **Golden file mismatch:** Change one cell, compare → returns diff string describing the change.
- **First-run creation:** `assertSnapshot` with non-existent golden file → creates the file, does not fail.
- **Record mode:** `assertSnapshot(record: true)` → always overwrites golden file.

### Theme tests

- **Built-in themes:** `Theme.dark` and `Theme.light` have all semantic colors set to non-default values.
- **Style generation:** `theme.style(fg: \.error, bg: \.surface, attributes: .bold)` produces correct `CellStyle`.
- **Codable round-trip:** Encode `Theme.dark` to JSON → decode → equals original.

### ThemeLoader tests

- **Valid JSON:** Load well-formed JSON with hex colors → all 13 semantic colors parsed correctly.
- **Named ANSI colors:** `"primary": "red"` → resolves to `Color.ansi8(.red)`.
- **Hex colors:** `"primary": "#e53935"` → resolves to `Color.truecolor(r: 229, g: 57, b: 53)`.
- **Missing field:** JSON missing `"muted"` → throws descriptive error (not a crash).
- **Malformed JSON:** Invalid JSON string → throws parsing error.
- **File loading:** Write JSON to temp file → `load(path:)` succeeds.

### Clipboard tests

- **Write sequence:** `Clipboard.writeSequence("hello")` → produces `"\u{1B}]52;c;aGVsbG8=\u{07}"` (OSC 52 with base64-encoded "hello").
- **Read sequence:** `Clipboard.readSequence()` → produces `"\u{1B}]52;c;?\u{07}"`.
- **Empty string:** `Clipboard.writeSequence("")` → valid OSC 52 with empty base64 payload.
- **Unicode text:** `Clipboard.writeSequence("cafe\u{0301}")` → correct UTF-8 base64 encoding.
- **Actual clipboard read:** Not testable in CI (requires terminal support). Documented as manual-test-only.

### Performance tests

- **DiffRenderer benchmark:** Render 200x50 buffer with 50% changed cells → measure time. Assert < 1ms on CI hardware (with generous margin for CI variance, e.g., < 5ms).
- **Full render cycle:** Create App with TestBackend, inject event, measure time from event to buffer update. Target < 2ms for 200x50.
- **CellBuffer allocation:** Create and fill 200x50 buffer → measure. Ensure no unexpected allocations (flat array backing).

### SyntaxHighlighter tests

- **Swift keyword:** `"let x = 5"` → spans: `[keyword:"let", plain:" ", variable:"x", plain:" ", operator:"=", plain:" ", number:"5"]`
- **Swift string:** `"print(\"hello\")"` → function + string spans
- **Swift comment:** `"// this is a comment"` → single comment span
- **Swift decorator:** `"@MainActor"` → decorator span
- **JSON structure:** `{"key": "value"}` → correct key/string/structural tokens
- **Markdown heading:** `"# Title"` → heading token with bold attribute
- **Python decorator:** `"@property"` → decorator span
- **Generic fallback:** Unknown language still highlights strings, numbers, comments
- **Multi-line comment:** Swift `/* ... */` across 3 lines → all marked as comment
- **Empty line:** `""` → empty span array
- **Theme mapping:** Each TokenType maps to the correct Color from SyntaxTheme
- **Language detection:** `detect(fileExtension: "swift")` → `.swift`, `"py"` → `.python`, `"xyz"` → `.generic`

### CI validation

- **macOS 15 + Swift 6.x:** Full test suite passes.
- **Ubuntu 24.04 + Swift 6.x:** Full test suite passes.
- **DocC build:** `swift package generate-documentation` succeeds with zero warnings on both platforms.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** — ADR-013

**New ADR Draft:**

**ADR-013:**
- **Title:** TestBackend as first-class testing infrastructure
- **Category:** architecture / testing
- **Key decision:** `TestBackend` is a headless terminal backend that replaces the real terminal in tests. It is not an afterthought or test utility — it is a first-class component of the library, tested and documented alongside production code. Every widget, component, and full `App` must be testable through `TestBackend` without a real terminal.
- **Rationale:** (1) Terminal tests that require a TTY cannot run in CI headless environments. (2) Snapshot testing against golden files catches visual regressions that unit assertions miss. (3) Event injection enables deterministic integration tests of the full App lifecycle. (4) Libraries that lack testability are not production-ready — this is a 1.0 gate.
- **Implications:** The `App` type must accept a backend parameter (protocol or concrete `TestBackend`). The rendering pipeline must be injectable at the buffer level. `EventStream` must support programmatic event sources alongside real terminal input.

---

## 10. Open Questions

### v1.0.0

1. **Backend protocol vs. concrete type:** Should `App` accept a `TerminalBackend` protocol (allowing custom backends) or specifically `TestBackend`? **Recommendation:** Introduce a `TerminalBackend` protocol with two conformers: `RealBackend` (production) and `TestBackend` (testing). This future-proofs for the Windows ConPTY backend in v1.x.
2. **Snapshot format:** Should snapshot strings include style information or be plain text only? **Recommendation:** Both — `render()` includes style markers for full visual regression detection, `renderPlainText()` provides content-only comparison for simpler tests.
3. **Theme hot-reloading:** Should themes be reloadable at runtime (e.g., watching a JSON file)? **Recommendation:** Not for v1.0.0. Themes are loaded once at startup. Hot-reload can be added as a `Subscription` in v1.x.
4. **OSC 52 security:** Some terminals block clipboard read for security. Should `Clipboard.read` warn about this? **Recommendation:** Yes — DocC documentation should note which terminals support read and which block it. The API returns `nil` on timeout, which covers the blocked case gracefully.

### v1.x

5. ~~**Animation API design:** Frame-based or duration-based?~~ **Resolved:** Duration-based with automatic frame interpolation, integrated into the App render loop as a `Subscription`. Scoped to v1.1.0.
6. **WASM feasibility:** SwiftWasm's support for Foundation and structured concurrency needs validation before v1.6.0 can be committed. **Action:** Spike a minimal "Hello WASM" SwiftCLIKit app after v1.0.0 ships to assess feasibility.
7. **Windows Swift maturity:** Swift on Windows toolchain stability should be evaluated before v1.5.0. **Action:** Test SwiftCLIKit v1.0.0 compilation on Windows after release.
8. **Syntax highlighting extensibility:** Should users be able to register custom `LanguageTokenizer` implementations, or is the built-in set sufficient? **Recommendation:** Make `LanguageTokenizer` a public protocol in v1.0.0 so users can add languages without waiting for library releases. The built-in set covers the most common cases; the protocol enables the long tail.

---

## 11. Documentation Strategy

**Documentation Type:** Full DocC documentation site + tutorials + migration guide

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (entire library surface from v0.1.0 through v1.0.0)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (testing patterns, MVU architecture, terminal protocols)

### Documentation deliverables for v1.0.0:

1. **DocC site** — Generated from inline documentation on all public API across all modules.
2. **Getting Started tutorial** — Build a "Hello TUI" app in 20 lines: App + Model + view + run.
3. **Widget Gallery** — Visual catalog of every widget with code examples (from v0.4.0 guide, updated).
4. **Testing Guide** — How to use TestBackend and SnapshotTesting to test your TUI app.
5. **Theming Guide** — Creating custom themes, loading from JSON, semantic color usage.
6. **Architecture Guide** — Deep dive on the MVU pattern, Cmd, Subscription, Component (from v0.5.0 guide, updated).
7. **Migration Guide** — For each version boundary (v0.x to v1.0), document breaking changes and upgrade paths.
8. **Example apps** — At least 2 complete example applications in an `Examples/` directory:
   - `CounterApp` — Minimal MVU example (50 lines)
   - `FileExplorer` — Tree + List + Table + Tabs + keyboard navigation (200 lines)

DocC comments on every public symbol. Each type gets `/// ## Overview`, `/// ## Example`, and `/// ## See Also` sections.
