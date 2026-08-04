# Design Proposal: SwiftCLIKit v0.5.0 — Framework

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Elm-like application architecture with structured concurrency, event streams, and composable components

---

## 1. Objective

**Objective:** Provide an opinionated application framework that manages the terminal lifecycle, event loop, and render cycle so developers only write three things: an initial `Model`, an `update` function, and a `view` function. Side effects are expressed as `Cmd` values that integrate with Swift structured concurrency. Long-running effects are expressed as `Subscription` values.

**Master Plan Reference:** SwiftCLIKit Roadmap v0.5.0 — Framework. Builds on v0.4.0 (Widgets) and all prior layers.

**Problems solved:**
1. **Boilerplate event loop.** Every TUI app needs: enter alternate screen, enable raw mode, read events, render, handle resize, restore terminal. `App` encapsulates this lifecycle.
2. **Ad-hoc state management.** Without a principled architecture, state scatters across mutable variables. MVU provides a single `Model` as the source of truth, updated only through pure `update` functions.
3. **Unstructured side effects.** Async operations (file I/O, network, timers) are hard to manage alongside a render loop. `Cmd` and `Subscription` integrate with Swift `Task` and `AsyncSequence` to keep effects structured and cancellable.
4. **No focus management.** Navigating between interactive widgets (tables, lists, inputs) requires tab ordering and focus tracking. `FocusManager` provides this.
5. **No composition model.** Large apps need to break the model into sub-models with their own update/view logic. `Component` provides this with message mapping.

---

## 2. Proposed Architecture

### Module structure (additions to SwiftCLIKit)

```
Sources/SwiftCLIKit/
└── Framework/
    ├── App.swift              — Top-level application runner
    ├── Cmd.swift              — Async side-effect type
    ├── Subscription.swift     — Long-running async effect
    ├── EventStream.swift      — Unified AsyncSequence<Event>
    ├── Event.swift            — Key, mouse, resize, timer, custom events
    ├── FocusManager.swift     — Tab ordering and focus ring
    └── Component.swift        — Composable sub-model with message mapping
```

### Architecture: Elm MVU adapted for Swift

The core loop:

```
                  ┌───────────────────────┐
                  │        Model          │
                  │   (single source of   │
                  │       truth)          │
                  └─────┬─────────┬───────┘
                        │         │
                   view │         │ update
                        │         │
                        v         │
                  ┌───────────┐   │
  Terminal  <──── │   Frame   │   │
                  └───────────┘   │
                                  │
  EventStream ──> Message ────────┘
                                  │
                            ┌─────v──────┐
                            │  [Cmd]     │──> Task ──> Message
                            └────────────┘
```

1. `App.run()` enters alternate screen, enables raw mode, starts the event stream.
2. Render initial `view(model)` into a `CellBuffer`.
3. Wait for next `Event` from `EventStream`.
4. Map `Event` to `Message` (caller-defined mapping or direct forwarding).
5. Call `update(&model, message)` which returns `[Cmd<Message>]`.
6. Execute each `Cmd` as a child `Task`; when a task completes, its result `Message` re-enters the loop.
7. Re-render `view(model)` and diff against previous buffer.
8. Repeat until quit message or `EventStream` ends.
9. Restore terminal on exit (alternate screen off, raw mode off).

---

## 3. API Surface

### 3a. App

```swift
/// Top-level application runner. Generic over user-defined Model and Message types.
///
/// ## Example
/// ```swift
/// let app = App(
///     initialModel: MyModel(),
///     update: { model, msg in
///         switch msg {
///         case .increment: model.count += 1; return []
///         case .quit: return [.quit]
///         }
///     },
///     view: { model in
///         { frame in
///             var f = frame
///             Paragraph(text: "Count: \(model.count)").render(into: &f)
///         }
///     }
/// )
/// try await app.run()
/// ```
public struct App<Model: Sendable, Message: Sendable>: Sendable {
    /// Create an application.
    /// - Parameters:
    ///   - initialModel: The starting state.
    ///   - update: Pure function that mutates model and returns side-effect commands.
    ///   - view: Pure function that returns a render closure for the current model.
    ///   - subscriptions: Optional long-running effects based on current model.
    ///   - mapEvent: Optional event-to-message mapper. If nil, events are not
    ///     automatically forwarded (use subscriptions or Cmd to handle input).
    public init(
        initialModel: Model,
        update: @Sendable @escaping (inout Model, Message) -> [Cmd<Message>],
        view: @Sendable @escaping (Model) -> (inout Frame) -> Void,
        subscriptions: (@Sendable (Model) -> [Subscription<Message>])? = nil,
        mapEvent: (@Sendable (Event) -> Message?)? = nil
    )

    /// Run the application. Blocks until the app exits.
    /// Enters alternate screen, enables raw mode, runs the event loop,
    /// and restores the terminal on exit (even on error).
    public func run() async throws
}
```

### 3b. Cmd

```swift
/// An async side-effect that can produce a message when complete.
/// Commands are executed as child Tasks within the App's TaskGroup.
public struct Cmd<Message: Sendable>: Sendable {
    /// Create a command that runs async work and produces a message.
    public static func task(
        _ work: @Sendable @escaping () async -> Message
    ) -> Cmd

    /// Create a command that runs async throwing work and maps the result.
    public static func task(
        perform: @Sendable @escaping () async throws -> Message,
        onError: @Sendable @escaping (any Error) -> Message
    ) -> Cmd

    /// Combine multiple commands into one. All run concurrently.
    public static func batch(_ cmds: [Cmd]) -> Cmd

    /// A command that does nothing. Use when no side effects are needed.
    public static var none: Cmd { get }

    /// A command that signals the app to quit.
    public static var quit: Cmd { get }

    /// Create a command that produces a message after a delay.
    public static func delay(
        _ duration: Duration,
        then message: Message
    ) -> Cmd
}
```

### 3c. Subscription

```swift
/// A long-running async effect that produces messages over time.
/// Subscriptions are identified by a string key and are automatically
/// started/stopped as the model changes.
public struct Subscription<Message: Sendable>: Sendable {
    /// Unique identifier for this subscription. Subscriptions with the same
    /// key are considered identical and will not be restarted.
    public var key: String

    /// Create a subscription from an AsyncSequence.
    public static func asyncSequence<S: AsyncSequence & Sendable>(
        key: String,
        _ sequence: S,
        map: @Sendable @escaping (S.Element) -> Message
    ) -> Subscription where S.Element: Sendable

    /// Create a timer subscription that produces a message at a fixed interval.
    public static func timer(
        key: String,
        every interval: Duration,
        message: @Sendable @escaping () -> Message
    ) -> Subscription

    /// No subscriptions.
    public static var none: Subscription { get }
}
```

### 3d. Event

```swift
/// A terminal event from the event stream.
public enum Event: Sendable {
    /// A key was pressed.
    case key(Key)
    /// A mouse event occurred.
    case mouse(MouseEvent)
    /// The terminal was resized.
    case resize(width: Int, height: Int)
    /// A custom event injected by the application.
    case custom(any Sendable)
}
```

### 3e. EventStream

```swift
/// An AsyncSequence that unifies all terminal input sources into a single
/// stream of Events. Handles raw mode key reading, mouse events, and
/// SIGWINCH resize notifications.
public struct EventStream: AsyncSequence, Sendable {
    public typealias Element = Event

    /// Create an event stream reading from the given terminal.
    public init(terminal: RawTerminal)

    public func makeAsyncIterator() -> AsyncIterator

    public struct AsyncIterator: AsyncIteratorProtocol {
        public mutating func next() async -> Event?
    }
}
```

### 3f. FocusManager

```swift
/// Manages tab ordering and focus state for interactive widgets.
public struct FocusManager: Sendable {
    /// A focusable widget identifier.
    public typealias FocusID = String

    /// The ordered list of focusable widget IDs.
    public var focusOrder: [FocusID]

    /// The currently focused widget ID, or nil if nothing is focused.
    public var focused: FocusID? { get }

    public init(focusOrder: [FocusID] = [])

    /// Move focus to the next widget in the focus order. Wraps around.
    public mutating func focusNext()

    /// Move focus to the previous widget in the focus order. Wraps around.
    public mutating func focusPrevious()

    /// Set focus to a specific widget ID. No-op if ID is not in focusOrder.
    public mutating func focus(_ id: FocusID)

    /// Remove focus from all widgets.
    public mutating func blur()

    /// Whether the given widget ID is currently focused.
    public func isFocused(_ id: FocusID) -> Bool
}
```

### 3g. Component

```swift
/// A composable sub-model with its own update/view cycle.
/// Maps child messages to parent messages for integration.
///
/// ## Example
/// ```swift
/// let sidebar = Component(
///     initialModel: SidebarModel(),
///     update: sidebarUpdate,
///     view: sidebarView,
///     toParent: { .sidebarMessage($0) }
/// )
/// ```
public struct Component<Model: Sendable, Message: Sendable, ParentMessage: Sendable>: Sendable {
    public var model: Model
    public var update: @Sendable (inout Model, Message) -> [Cmd<Message>]
    public var view: @Sendable (Model) -> (inout Frame) -> Void
    public var toParent: @Sendable (Message) -> ParentMessage

    public init(
        initialModel: Model,
        update: @Sendable @escaping (inout Model, Message) -> [Cmd<Message>],
        view: @Sendable @escaping (Model) -> (inout Frame) -> Void,
        toParent: @Sendable @escaping (Message) -> ParentMessage
    )

    /// Process a child message: update the child model and return
    /// parent-mapped commands.
    public mutating func send(_ message: Message) -> [Cmd<ParentMessage>]

    /// Render the child view into the given frame.
    public func render(into frame: inout Frame)
}
```

---

## 4. MCP Schema

Not applicable — the application framework is a local-only runtime.

---

## 5. Constraints & Compliance

| Rule | How |
|------|-----|
| **No force unwraps** | `FocusManager` indexing bounds-checked. `EventStream` iterator returns nil on EOF. `Subscription` key lookups use dictionary subscript (optional). |
| **Sendable** | `App`, `Cmd`, `Subscription`, `Component` are all `Sendable`. `update` and `view` closures are `@Sendable`. `Model` and `Message` have `Sendable` constraints. |
| **Guard clauses** | `App.run()` guards terminal initialization failure. `FocusManager.focus()` guards unknown IDs. `Cmd.batch` guards empty array. |
| **Division safety** | N/A — no division operations in framework layer. |
| **Pointer safety** | No `withUnsafe*` blocks. |
| **Concurrency** | `App` runs within Swift structured concurrency (`TaskGroup`). `Cmd` tasks are child tasks — automatically cancelled when the app exits. `Subscription` tasks managed by the app loop with cancellation on model change. No `DispatchQueue` usage. |
| **No hardcoded constants** | Frame rate, event poll interval, and terminal fallback size are configurable (or derived from terminal). |

---

## 6. Backend Abstraction

Not applicable — no compute-intensive or platform-variant operations beyond terminal I/O (already abstracted in v0.1.0/v0.2.0).

---

## 7. Dependencies

- **External:** None. Pure Swift using Foundation only.
- **Internal:** Depends on all prior SwiftCLIKit layers:
  - v0.1.0: `RawTerminal`, `KeyReader`, `TerminalSize`, `ANSICodes`, `ScreenBuffer`
  - v0.2.0: `Color`, `AlternateScreen`, `CursorControl`, `MouseEvent`, `MouseMode`
  - v0.3.0: `Cell`, `CellBuffer`, `DiffRenderer`, `Rect`, `Layout`, `Frame`
  - v0.4.0: All widgets (used in `view` functions but not depended on by framework types)
- **Platforms:** macOS, Linux. All code is platform-independent at the framework layer.

---

## 8. Test Strategy

### App tests

- **Event-driven update:** Create `App` with `TestBackend` (see v1.0.0) or mock `EventStream`. Inject key event → verify `update` called with mapped message → verify `view` rendered.
- **Cmd execution:** `update` returns `Cmd.task { .loaded(data) }` → verify the produced message re-enters `update`.
- **Cmd.batch:** Return `Cmd.batch([cmd1, cmd2])` → both execute, both messages delivered.
- **Cmd.none:** Return `Cmd.none` → no side effects.
- **Cmd.quit:** Return `Cmd.quit` → app exits cleanly, terminal restored.
- **Cmd.delay:** Return `Cmd.delay(.seconds(1), then: .tick)` → message arrives after delay.
- **Terminal restoration:** App throws during update → terminal still restored (alternate screen off, raw mode off).
- **Resize handling:** Inject resize event → view re-rendered with new dimensions.

### Subscription tests

- **Timer subscription:** Subscribe to `.timer(key: "tick", every: .seconds(1), message: { .tick })` → messages arrive at interval.
- **Subscription lifecycle:** Model change removes a subscription key → that subscription's task is cancelled.
- **Duplicate key:** Same subscription key across frames → not restarted.
- **AsyncSequence subscription:** Custom `AsyncStream` → messages forwarded correctly.

### FocusManager tests

- **Tab cycles focus:** 3 widgets, focus on first → `focusNext()` → second → `focusNext()` → third → `focusNext()` → wraps to first.
- **Shift-tab reverses:** `focusPrevious()` from first → wraps to third.
- **Focus specific ID:** `focus("sidebar")` → `isFocused("sidebar")` is true.
- **Unknown ID:** `focus("nonexistent")` → no change.
- **Blur:** `blur()` → `focused` is nil, `isFocused` returns false for all.
- **Empty focus order:** `focusNext()` and `focusPrevious()` → no crash, focused stays nil.

### Component tests

- **Child message mapped to parent:** Send child `.selected(item)` → parent receives `.sidebarMessage(.selected(item))`.
- **Child model updated:** Send message → child model reflects change.
- **Child commands mapped:** Child returns `Cmd.task { .childDone }` → parent receives `Cmd` producing `.sidebarMessage(.childDone)`.
- **Child view renders:** Call `component.render(into: &frame)` → cells written to frame match child view output.

### EventStream tests

- **Key event:** Write arrow-up escape sequence to pipe → stream yields `.key(.arrowUp)`.
- **Mouse event:** Write SGR mouse sequence to pipe → stream yields `.mouse(...)`.
- **Resize event (simulated):** Trigger SIGWINCH → stream yields `.resize(width:height:)`.
- **EOF:** Close pipe → stream ends (iterator returns nil).
- **Interleaved events:** Write key + mouse sequences → both events yielded in order.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] New ADR required? **Yes** — ADR-012

**New ADR Draft:**

**ADR-012:**
- **Title:** Elm MVU architecture for TUI application framework
- **Category:** architecture
- **Key decision:** The application framework uses the Elm Model-View-Update (MVU) pattern adapted for Swift structured concurrency. The `App` type is generic over user-defined `Model` and `Message` types. State updates happen through a pure `update(inout Model, Message) -> [Cmd<Message>]` function. Views are pure functions from `Model` to render closures. Side effects are expressed as `Cmd` values executed as child `Task`s.
- **Alternatives considered:**
  - *Reactive (RxSwift/Combine-style):* More flexible but harder to reason about, requires understanding of operators, and introduces reference-type complexity. Combine is Apple-only.
  - *Imperative (TermKit-style):* Familiar but leads to scattered state, callback hell, and difficult testing. Widget state management becomes the app's problem.
  - *SwiftUI-like (@State/@Binding):* Attractive but property wrappers with magic invalidation are not reproducible outside Apple's frameworks. Would require a custom runtime.
- **Why MVU:** (1) Pure `update` functions are trivially testable — assert on model output given model input + message. (2) Single source of truth prevents state desynchronization. (3) `Cmd` integrates cleanly with Swift `Task` — no custom scheduler needed. (4) Value-type `Model` aligns with Swift idioms. (5) Proven at scale in Elm, BubbleTea (Go), and Iced (Rust).

---

## 10. Open Questions

1. **Event-to-Message mapping location:** Should event mapping live in `App.init(mapEvent:)` (current design) or in a separate middleware layer? **Recommendation:** Keep `mapEvent` on `App.init` for simplicity. Middleware can be added in v1.x if demand exists.
2. **Render throttling:** Should the app enforce a maximum frame rate (e.g., 60 FPS) to avoid overwhelming slow terminals? **Recommendation:** Yes — add a configurable `maxFrameRate: Int` parameter (default 60) that coalesces rapid model updates into a single render per frame interval.
3. **Component nesting depth:** Should `Component` support arbitrary nesting (Component within Component)? **Recommendation:** Yes, by design — `Component` is generic and composable. However, document that deep nesting increases message-mapping boilerplate, and suggest flat model structures for most apps.
4. **Error handling in Cmd:** The current `Cmd.task(perform:onError:)` requires explicit error mapping. Should there be a default error-to-message path? **Recommendation:** No default — forcing explicit error handling is safer and more testable. Provide a convenience `Cmd.tryTask` that wraps throwing work with a `Result<Success, Error>` message.

---

## 11. Documentation Strategy

**Documentation Type:** API Docs + Architecture Guide + Tutorial

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (App, Cmd, Subscription, EventStream, FocusManager, Component, Event)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (Elm architecture, MVU pattern, structured concurrency)

**Article Name:** `AppArchitectureGuide.md` — covers:
1. The MVU pattern and why it fits Swift
2. Building a minimal counter app (App + Model + Message + update + view)
3. Adding async effects with Cmd
4. Long-running effects with Subscription
5. Composing with Component
6. Focus management and keyboard navigation
7. Testing strategies for each layer

DocC comments on all public API. `App` gets an extended `/// ## Tutorial` section with a complete 30-line working example.
