# Playtest Summary — IconquerCLI v0.5.0 TUI

**Date:** 2026-04-10
**Tester:** Justin Purnell
**Build:** commit 39e14a2

## What works
- Terminal lifecycle: alternate screen, raw mode, clean exit on q
- Sidebar: player names, truecolor gauges, territory counts
- Tab switching: 1-4 switches Map/Stats/History/Cards tabs
- Tab bar rendering with active highlight
- Continent tree: expanded by default, continent headers with bonus
- Country list with owner colors (red P1, blue P2, gray unclaimed)
- Arrow key navigation through tree in visual order
- Selection highlight (reverse video) visible
- Tree scrolling when selection goes past viewport
- Country picking: Enter picks, AI auto-plays after human
- Auto-advance to next unclaimed country after pick
- Status bar with phase/selection/turn info
- Action menu with phase-contextual items and key hints
- Status messages (errors, pick confirmation)

## Critical bugs to fix

### 1. Frame value-type buffer isolation (SwiftCLIKit)
**Root cause:** Frame owns a copy of CellBuffer. subFrame() copies the buffer.
Widget writes into sub-frames are lost — they never merge back to the parent.
**Impact:** Block borders don't render. Gauge/Sparkline widgets can't be used.
Widgets that compose via sub-frames (Table, Tree, Menu, Block) all broken.
**Fix:** Introduce BufferRef (reference-type wrapper) in SwiftCLIKit. Frame
holds a BufferRef so all sub-frames share the same underlying storage.
This is the #1 priority fix — everything else depends on it.

### 2. No scrollbar indicator
The tree scrolls but there's no visual indicator of scroll position
or how much content is above/below the viewport.

### 3. Resize doesn't always trigger
SIGWINCH handler sets a flag, but the flag is only checked when a key
event arrives. If the user resizes without pressing a key, the layout
doesn't update until the next keypress.

## UX issues (bare minimum → consumer-grade)

### Navigation
- Arrow up/down works but is slow for 48-row tree — need Page Up/Down
- No way to jump to a specific continent (could use left/right to collapse/expand)
- Left/right arrow collapse/expand not implemented yet
- No search/filter to find a country by name

### Pick phase
- No visual distinction between "available to pick" and "already taken"
  beyond the [—] vs [P1] label — needs stronger visual (dim taken countries)
- No count of remaining picks or total picked
- No indicator of whose turn it is beyond the status bar

### Army placement phase
- Not tested — game never reached this phase in playtest
- Needs: select country you own → Enter to place 1 → show army count update
- Needs: show how many armies remain to place

### Attack phase
- Not tested
- Needs: select source (your country) → Enter → select target (enemy neighbor) → Enter
- Needs: show attack result (dice, casualties)
- Needs: clear attack source on Escape

### Visual polish
- No Block borders (blocked by Frame bug)
- No visual panel separation — sidebar and board blend together
- No focused panel indicator (border highlight)
- Status bar is debug-heavy — needs clean consumer-facing info
- Country display format "Alaska [P1] 0a 3n" is dense — needs better layout
- Army bars/indicators missing (just "0a" text)
- No victory screen tested

### Missing features (designed but not wired)
- Mouse click selection (mouse events arrive but aren't translated to country clicks)
- Theme is applied but background color isn't set (terminal default shows through)
- History tab works but has no entries until game progresses
- Cards tab shows "No cards" — needs card display once cards are earned
- Stats tab shows raw text table — needs proper Table widget (blocked by Frame bug)

## Architecture notes for next session

### SwiftCLIKit BufferRef fix (priority 1)
```swift
// In SwiftCLIKit/Sources/SwiftCLIKit/Cell/BufferRef.swift
public final class BufferRef: @unchecked Sendable {
    // Justification: Frame is always used on single thread within render pass
    public var buffer: CellBuffer
    public init(_ buffer: CellBuffer) { self.buffer = buffer }
}

// Frame changes from:
private var buffer: CellBuffer
// to:
private let bufferRef: BufferRef

// subFrame() shares the same BufferRef:
public func subFrame(_ subRect: Rect) -> Frame {
    Frame(bufferRef: bufferRef, rect: clipped)
}

// All writes go through bufferRef.buffer[x,y]
```

This unblocks: Block borders, Table widget, Tree widget (native),
Menu widget (native), Gauge widget, Sparkline widget, all widget
composition via sub-frames.

### After BufferRef: rewrite GameView to use proper widgets
- Block for each panel (sidebar, board, menu) with borders + titles
- Tree widget for continent grouping (native, not hand-rolled)
- Table widget for stats tab
- Menu widget for action menu
- Gauge widget for player strength
- Sparkline widget for army trends

### Consumer-facing UX target
The TUI should feel like a polished game, not a debug tool:
- Clean panel borders with titles
- Obvious selection cursor with color contrast
- Dimmed unavailable options
- Turn/phase indicator prominent (not buried in status bar)
- Army counts as visual bars, not text
- Smooth transitions between phases
- Victory celebration screen
- Help overlay (? key)

## Key files for next session
1. `SwiftCLIKit/Sources/SwiftCLIKit/Layout/Frame.swift` — needs BufferRef
2. `SwiftCLIKit/Sources/SwiftCLIKit/Cell/CellBuffer.swift` — BufferRef wraps this
3. `IconquerCLI/Sources/IconquerCLILib/App/GameView.swift` — rewrite after BufferRef
4. `IconquerCLI/Sources/IconquerCLILib/Components/BoardComponent.swift` — use native Tree
5. `IconquerCLI/Sources/IconquerCLILib/Components/SidebarComponent.swift` — use Gauge/Sparkline
6. This playtest summary
