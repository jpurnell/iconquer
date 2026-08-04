# Design Proposal: Game Event Animation System for IconquerCLI TUI

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Integrate SwiftCLIKit Animation module (v1.1.0) into the TUI event loop for game event animations

---

## 1. Objective

Add animated visual feedback to game events in the IconquerCLI TUI, using SwiftCLIKit's shipped Animation module (Easing, Animation, AnimatedValue, Transition) to bring dice rolls, territory captures, army changes, turn transitions, and victory celebrations to life.

**Problems solved:**
1. **No visual feedback on game events.** Dice rolls, territory captures, and army changes happen instantly with no visual cue. Players miss important events, especially in fast AI-vs-AI games.
2. **Flat, lifeless game experience.** The TUI currently updates the board atomically between turns. There is no sense of action, tension, or celebration -- the game feels like a spreadsheet, not a strategy game.
3. **Difficult to follow combat outcomes.** When an attack resolves, the board state changes but the player has no visual indication of what happened unless they carefully compare before/after army counts.

**Master Plan Reference:** Phase 2 -- TUI polish and playability. Animations are the primary "game feel" improvement, building on the spatial map renderer to make the game visually engaging.

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `Sources/IconquerCLILib/Animation/GameAnimation.swift` | `GameAnimation` struct, `AnimationKind` enum, animation lifecycle |
| `Sources/IconquerCLILib/Animation/AnimationRenderer.swift` | Per-frame rendering logic for each animation kind |
| `Sources/IconquerCLILib/Animation/AnimationScheduler.swift` | Manages active animations, tick/completion, frame timing |
| `Sources/IconquerCLILib/Animation/DiceRollAnimation.swift` | Dice roll visual: random flash then settle |
| `Sources/IconquerCLILib/Animation/CaptureFlashAnimation.swift` | Territory color pulse on capture |
| `Sources/IconquerCLILib/Animation/ArmyTickerAnimation.swift` | Digit-by-digit army count change |
| `Sources/IconquerCLILib/Animation/TurnTransitionAnimation.swift` | Board dim + player name display |
| `Sources/IconquerCLILib/Animation/VictoryCelebrationAnimation.swift` | Multi-stage win celebration |

### Modified Files

| File | Change |
|------|--------|
| `Sources/IconquerCLILib/App/GameModel.swift` | Add `activeAnimations: [GameAnimation]`, `animationsEnabled: Bool`, `animationScheduler: AnimationScheduler` |
| `Sources/IconquerCLILib/App/GameUpdate.swift` | Trigger animations on game events (attack result, capture, placement, turn change, victory); enter animation render loop when animations are active |
| `Sources/IconquerCLILib/Components/BoardComponent.swift` | Overlay animation visuals onto the board frame during animation playback |
| `Sources/IconquerCLILib/App/GameApp.swift` | Integrate animation frame loop (~30fps) alongside normal event handling |

### Module Placement

All new code lives in `IconquerCLILib/Animation/`. No new modules. The animation system is internal to the CLI; `IconquerCore` is not modified. SwiftCLIKit's `Animation`, `AnimatedValue`, `Easing`, and `Transition` types are used as-is from the existing dependency.

---

## 3. API Surface

### GameAnimation (animation descriptor)

```swift
/// A single animation instance tied to a game event.
///
/// Created when a game event occurs and consumed by the animation scheduler.
/// Each animation tracks its own timing via the SwiftCLIKit `Animation` type.
public struct GameAnimation: Sendable, Identifiable {
    /// Unique identifier for this animation instance.
    public var id: String
    /// The kind of game event this animation represents.
    public var kind: AnimationKind
    /// The SwiftCLIKit animation controlling timing and easing.
    public var animation: Animation
    /// When this animation started playing, or nil if not yet started.
    public var startedAt: ContinuousClock.Instant?

    /// The category of game event being animated.
    public enum AnimationKind: Sendable {
        /// Dice rolling before revealing combat results.
        /// - Parameters:
        ///   - attacker: The actual attacker dice values.
        ///   - defender: The actual defender dice values.
        ///   - result: The sorted dice outcome for display.
        case diceRoll(attacker: [Int], defender: [Int], result: [Int])
        /// Territory color pulse when captured.
        /// - Parameters:
        ///   - country: The captured territory.
        ///   - newOwner: The player who captured it.
        case captureFlash(country: CountryId, newOwner: PlayerId)
        /// Army count ticking from one value to another.
        /// - Parameters:
        ///   - country: The territory whose army count changed.
        ///   - from: The previous army count.
        ///   - to: The new army count.
        case armyTicker(country: CountryId, from: Int, to: Int)
        /// Turn transition with board dim and player name.
        /// - Parameter player: The player whose turn is starting.
        case turnTransition(player: PlayerId)
        /// Victory celebration for the winning player.
        /// - Parameter winner: The player who won the game.
        case victory(winner: PlayerId)
    }
}
```

### AnimationScheduler (animation lifecycle manager)

```swift
/// Manages active animations, ticking them each frame and removing completed ones.
///
/// The scheduler is the single authority on animation state. The game event loop
/// delegates to the scheduler each frame to determine whether animations are
/// playing and what visual effects to apply.
public struct AnimationScheduler: Sendable {

    /// All currently active animations, in order of creation.
    public private(set) var activeAnimations: [GameAnimation]

    /// Whether any animations are currently playing.
    public var isAnimating: Bool

    /// Enqueue a new animation. It will start on the next frame tick.
    ///
    /// - Parameter animation: The animation to add.
    public mutating func enqueue(_ animation: GameAnimation)

    /// Advance all active animations by one frame tick.
    ///
    /// - Parameter now: The current instant from `ContinuousClock`.
    /// - Returns: Per-animation progress values (0.0 to 1.0) for rendering.
    public mutating func tick(now: ContinuousClock.Instant) -> [String: Double]

    /// Remove all completed animations.
    public mutating func pruneCompleted()

    /// Cancel all active animations immediately.
    public mutating func cancelAll()
}
```

### AnimationRenderer (per-frame visual effects)

```swift
/// Applies animation visual effects to the board frame.
///
/// Stateless renderer that reads animation progress and writes visual
/// overlays into the frame. Called once per frame during animation playback.
public enum AnimationRenderer {

    /// Render all active animation effects into the frame.
    ///
    /// - Parameters:
    ///   - animations: Active animations with their current progress (0.0-1.0).
    ///   - snapshot: Current game state for context (country positions, owners).
    ///   - layout: The map layout for spatial positioning.
    ///   - theme: The active visual theme.
    ///   - frame: The frame to render into.
    public static func render(
        animations: [(GameAnimation, Double)],
        snapshot: GameSnapshot,
        layout: MapLayout,
        theme: GameTheme,
        into frame: inout Frame
    )
}
```

### GameModel additions

```swift
// Added to GameModel:

/// Controls whether game event animations are enabled.
/// When false, all game events update the board instantly.
public var animationsEnabled: Bool = true

/// The animation scheduler managing active animations.
public var animationScheduler: AnimationScheduler = AnimationScheduler()
```

---

## 4. MCP Schema

No new MCP tools required. Animations are a presentation-layer feature confined to the TUI. AI agents interact with the game via `GameSnapshot` and MCP tools that expose game state and actions -- they never see or need to interact with animations.

**Interaction with AI thinking:** When an LLM agent is computing its move via MCP, no animations should be playing. The animation system is quiescent during the "waiting for player input" phase. Animations trigger only after a game action resolves (attack result, placement, etc.) and complete before the next player's input phase begins.

**Future consideration:** A `set_animation_speed` MCP tool could allow AI tournament runners to disable or speed up animations programmatically. This is deferred.

---

## 5. Constraints & Compliance

**Concurrency:** `GameAnimation` and `AnimationKind` are `Sendable` value types. `AnimationScheduler` is a `Sendable` struct with mutating methods -- no shared mutable state. The animation frame loop runs on the main event loop (no separate threads or actors). `ContinuousClock.Instant` is `Sendable`.

**No force unwraps:** All dictionary lookups for country positions, player data, and animation progress use optional binding with guard-let. Missing data causes the animation to be silently skipped (not crash).

**No hardcoded constants:** All timing values (durations, frame rates, pulse counts) are defined in a `AnimationConfig` struct:

```swift
public struct AnimationConfig: Sendable {
    /// Target frames per second during animation playback.
    public var targetFPS: Int = 30
    /// Duration of the dice roll flash phase.
    public var diceRollFlashDuration: Duration = .milliseconds(500)
    /// Duration of the territory capture pulse.
    public var captureFlashDuration: Duration = .milliseconds(500)
    /// Number of pulses during a capture flash.
    public var captureFlashPulseCount: Int = 3
    /// Duration of the army count ticker.
    public var armyTickerDuration: Duration = .milliseconds(300)
    /// Duration of the turn transition overlay.
    public var turnTransitionDuration: Duration = .seconds(1)
    /// Duration of the victory celebration.
    public var victoryCelebrationDuration: Duration = .seconds(3)
    /// Microseconds between frames (derived from targetFPS).
    public var frameSleepMicroseconds: UInt32 { UInt32(1_000_000 / targetFPS) }
}
```

**Division safety:** `frameSleepMicroseconds` guards against `targetFPS == 0` (clamped to minimum 1). Progress calculations use `max(duration, .milliseconds(1))` as denominator.

**Guard clauses:** All animation rendering functions use guard-let for country lookups, player lookups, and layout positions. Early returns when data is missing.

**Swift 6 strict concurrency:** All new types are `Sendable`. No escaping closures capture mutable state. The frame loop is synchronous within the main event loop.

**Coding rules compliance:**
- No `String(format:)` -- dice values rendered via interpolation
- All public APIs have DocC documentation
- No force casts or force unwraps

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Animation rendering is lightweight character-grid manipulation. At 30fps with a 120x40 canvas, the system writes at most 144,000 cells per second -- trivial for any CPU.

The only timing-sensitive operation is the frame sleep (`usleep`), which provides approximate frame pacing. Exact frame timing is not critical for terminal animations -- minor jitter is imperceptible.

No GPU, Metal, or Accelerate involvement.

---

## 7. Dependencies

**Internal Dependencies:**
- `SwiftCLIKit` v1.1.0 -- `Animation`, `AnimatedValue<Int>`, `Easing`, `Transition`, `Frame`, `Cell`, `Color`, `CellAttributes` (existing, no changes needed)
- `IconquerCore` -- `GameSnapshot`, `CountryId`, `PlayerId` (read-only, no changes)
- `IconquerCLILib/Support/MapLayout.swift` -- country spatial positions for animation targeting (must be implemented first; see Console Map proposal)
- `IconquerCLILib/Support/GameTheme.swift` -- player colors, background colors

**External Dependencies:** None.

**Ordering Dependency:** The Console Map Renderer proposal must be implemented first. Animations overlay onto the spatial map -- without country box positions, there is nothing to animate. The dice roll animation can work in isolation (it renders in a dedicated overlay area), but capture flash, army ticker, and selection highlight all require `MapLayout` positions.

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **Scheduler lifecycle** | Enqueue starts animation on next tick; tick advances progress; completed animations are pruned; cancelAll clears all |
| **Dice roll** | Flash phase shows random values; settle phase shows actual values; attacker dice colored red, defender white; total duration matches config |
| **Capture flash** | Color oscillates between owner color and bright variant; correct number of pulses; uses easeInOut curve; targets correct country box |
| **Army ticker** | Value interpolates from `from` to `to` over duration; uses `AnimatedValue<Int>`; intermediate frames show intermediate values |
| **Turn transition** | Board cells gain `.dim` attribute during transition; player name text appears centered; text visible for configured duration |
| **Victory celebration** | Three stages occur in sequence: dim, text scale, sparkle; sparkle hits random cells; total duration matches config |
| **Frame timing** | Frame loop sleeps approximately `1/targetFPS` seconds between frames; animations complete within expected wall-clock time (tolerance: +/- 50ms) |
| **Skip/cancel** | Any-key-to-skip removes all active animations; `animationsEnabled = false` prevents animations from being enqueued |
| **No-animation mode** | When `animationsEnabled` is false, game events update board instantly with no frame loop entry |
| **Overlapping animations** | Multiple simultaneous animations (e.g., capture flash + army ticker for the same territory) render correctly without visual corruption |
| **Edge cases** | Animation with zero duration completes immediately; animation for a country not in the layout is silently dropped; animation during resize gracefully adapts |

**Reference Truth:**
- Dice roll correctness: after the settle phase, the displayed values match the `attacker` and `defender` arrays from `AnimationKind.diceRoll`
- Army ticker correctness: at progress 0.0 the displayed value equals `from`; at progress 1.0 it equals `to`; at progress 0.5 it equals `from + (to - from) / 2` (integer division)
- Capture flash: at progress 0.0 and 1.0, the country box shows owner color; at progress 0.5 (peak of first pulse), it shows the bright variant

**Validation Trace (REQUIRED):**
- Create `GameAnimation(id: "test", kind: .armyTicker(country: "Alaska", from: 5, to: 12), animation: Animation(duration: .milliseconds(300), easing: .linear))`
- Tick at progress 0.0: rendered value is 5
- Tick at progress 0.5: rendered value is 8 (5 + (12 - 5) * 0.5 = 8.5, truncated to 8)
- Tick at progress 1.0: rendered value is 12
- Assert: all intermediate frames show values in the range [5, 12]

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-002
date: 2026-04-10
status: proposed
category: architecture
title: Event-driven animation system using SwiftCLIKit Animation module
context: |
  The TUI needs animated visual feedback for game events (dice rolls,
  captures, army changes, turn transitions, victory). Animations could be
  implemented as: (a) ad-hoc sleep+render loops per event, (b) a centralized
  animation scheduler using SwiftCLIKit's Animation types, or (c) a reactive
  system using Combine or AsyncSequence.
decision: |
  A centralized AnimationScheduler manages all active animations. Game events
  enqueue GameAnimation descriptors. The main event loop enters a 30fps
  render loop when animations are active, ticking the scheduler each frame.
  SwiftCLIKit's Animation (timing), AnimatedValue (interpolation), and Easing
  (curves) provide the timing infrastructure.
rationale: |
  - Centralized scheduler prevents overlapping/conflicting animation loops
  - SwiftCLIKit's Animation module is already a dependency and provides
    exactly the timing primitives needed (no new dependencies)
  - Synchronous frame loop on the main thread avoids concurrency complexity
  - Declarative animation descriptors (GameAnimation) decouple event
    detection from visual rendering
  - Skippable/disableable by design (cancel all or disable flag)
consequences: |
  + Clean separation: game logic triggers animations, renderer consumes them
  + Single frame loop prevents visual conflicts
  + Easy to add new animation kinds without changing the scheduler
  + Animations are skippable and globally disableable
  - Main thread blocks during animation playback (intentional -- animations
    are brief and the TUI is single-threaded by design)
  - 30fps frame loop uses ~3% CPU during animation (negligible)
  - Animation durations are wall-clock dependent (acceptable for a TUI)
alternatives_rejected:
  - "Ad-hoc sleep loops: Hard to coordinate, no skip support, spaghetti code"
  - "Reactive/AsyncSequence: Over-engineered for single-threaded TUI, adds concurrency complexity"
  - "CSS-style keyframe animations: Too complex to implement, terminal has no layout engine"
affected_files:
  - Sources/IconquerCLILib/Animation/GameAnimation.swift
  - Sources/IconquerCLILib/Animation/AnimationScheduler.swift
  - Sources/IconquerCLILib/Animation/AnimationRenderer.swift
  - Sources/IconquerCLILib/App/GameModel.swift
  - Sources/IconquerCLILib/App/GameUpdate.swift
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Should animations be skippable?** Players may not want to wait through every dice roll animation. **Proposed answer:** Yes. Any keypress during animation playback calls `animationScheduler.cancelAll()` and immediately shows the final board state. This is essential for playability.

2. **Should there be a "no animations" flag?** AI tournaments and fast games may want to skip all animations. **Proposed answer:** Yes. `GameModel.animationsEnabled` defaults to `true` but can be set to `false` via a CLI flag (`--no-animations`) or an in-game settings toggle. When disabled, the animation scheduler rejects all enqueue calls.

3. **How to handle animations during LLM thinking?** If an MCP-driven AI agent is computing its move, we should not be playing animations from the previous event. **Proposed answer:** Animations are synchronous and blocking -- they complete before the next player's input phase begins. The LLM agent's MCP call only happens after all animations from the preceding action have finished (or been skipped). No overlap is possible.

4. **Animation during board resize?** If the terminal is resized mid-animation, country box positions change. **Proposed answer:** Cancel all active animations on resize. The board re-renders at the new size and the game continues without animation. This is simpler than recalculating animation targets mid-flight.

5. **Sound effects?** Terminal bell (`\a`) could accompany dice rolls or victory. **Proposed answer:** Deferred. Most terminals have the bell disabled and users find it annoying. If added later, it would be a separate opt-in setting.

6. **Animation speed setting?** Some players may want faster or slower animations. **Proposed answer:** Deferred for v1. The `AnimationConfig` struct supports this naturally (multiply all durations by a speed factor), but the UI for adjusting it is out of scope for the initial implementation.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (GameAnimation, AnimationScheduler, AnimationRenderer, AnimationConfig, SwiftCLIKit Animation/Easing/AnimatedValue)
- Does explanation require 50+ lines? Yes (scheduler lifecycle, per-animation rendering, integration with event loop, skip behavior)
- Does it need theory/background context? Yes (frame-based animation loop, easing curves, interpolation)

**Article Name:** `GameAnimationSystemGuide.md`
(Placed in `.docc` catalog if/when IconquerCLI adds documentation. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what the animation system does and why
2. Animation kinds -- description and visual behavior of each animation type
3. Scheduler lifecycle -- enqueue, tick, prune, cancel flow
4. Integration with the event loop -- when and how the frame loop activates
5. SwiftCLIKit integration -- which Animation module types are used and how
6. Configuration -- AnimationConfig fields and how to tune timing
7. Skip and disable behavior -- user controls for animation playback
8. Adding new animation kinds -- how to extend the system with new event types

---

## Animation Detail: Per-Kind Rendering Specification

This section provides implementation-level detail for each animation kind.

### Dice Roll Animation

**Duration:** 0.5s flash + instant settle (total ~0.5s)
**Easing:** Linear during flash phase (random values change every 2 frames)

Rendering:
1. Display a dice overlay area above or beside the attacked territory.
2. **Flash phase (0.0-0.9 progress):** Show attacker dice (red background) and defender dice (white background) with random values 1-6, changing every ~66ms (2 frames at 30fps).
3. **Settle phase (0.9-1.0 progress):** Snap to actual roll values. Brief bright flash on the winning dice (higher values).
4. Dice are rendered as small boxes: `[3]` for each die, colored by side.

### Territory Capture Flash

**Duration:** 0.5s
**Easing:** `Easing.easeInOut` applied per pulse cycle

Rendering:
1. Target the captured country's box in the map layout.
2. Divide the 0.5s into 3 equal pulse cycles (~167ms each).
3. Each pulse: interpolate the country box fill color from owner color to bright white and back using `Easing.easeInOut`.
4. At progress 0.0 and 1.0: owner color. At each pulse peak: bright white.
5. The box border remains static; only the fill color oscillates.

### Army Count Ticker

**Duration:** 0.3s
**Easing:** Linear (for uniform digit ticking feel)
**Interpolation:** `AnimatedValue<Int>` from SwiftCLIKit

Rendering:
1. Target the army count display within the country's box.
2. Use `AnimatedValue<Int>(from: oldCount, to: newCount)` with linear easing.
3. Each frame: display the interpolated integer value.
4. For losses (to < from): render the ticking number in red during the animation.
5. For gains (to > from): render the ticking number in green during the animation.
6. At completion: render in the normal owner color.

### Turn Transition

**Duration:** 1.0s
**Easing:** `Transition.fade` (fade out board, hold, fade in)

Rendering:
1. **Fade out (0.0-0.2 progress):** Apply increasing `.dim` attribute to all board cells.
2. **Hold (0.2-0.8 progress):** Board fully dimmed. Display the new player's name centered on screen in the player's color, bold, large (simulated via padding/box).
3. **Fade in (0.8-1.0 progress):** Remove `.dim` attribute progressively, revealing the updated board state.

### Victory Celebration

**Duration:** 3.0s
**Easing:** Mixed (per stage)

Rendering:
1. **Stage 1 -- Board dim (0.0-0.2 progress):** Apply `.dim` to all board cells. Easing: `Easing.easeIn`.
2. **Stage 2 -- Winner text (0.2-0.5 progress):** Draw a growing box centered on screen. Start at 1x1, expand to full text size. Text: "{PlayerName} Wins!" in the winner's color, bold. Simulates "zoom in" by drawing progressively larger box-drawing borders.
3. **Stage 3 -- Sparkle (0.5-1.0 progress):** The winner text stays. Random cells around the text flash bright colors (cycle through player colors) for a sparkle/fireworks effect. Each frame: pick 5-10 random cells in the border region, set them to random bright colors with bold attribute. Previous sparkle cells revert to dim background.
