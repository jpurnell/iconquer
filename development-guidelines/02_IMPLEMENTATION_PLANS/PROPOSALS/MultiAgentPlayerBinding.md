# Design Proposal: Multi-Agent Player Binding (Humans + AIs in the Same Match)

**Status:** DRAFT — awaiting approval
**Author:** Claude (Opus 4.6)
**Date:** 2026-04-07
**Related:** Phase 2 AI modernization, Phase 3+ LLM tournament vision

---

## 1. Objective

Enable any mix of human players and AI agents (including LLMs over MCP) to share a
single iconquer match, without IconquerCore knowing or caring which seat is which.
Lock this abstraction in *now*, before Phase 2 AI work hardens assumptions that
would force a painful refactor later.

**Master Plan Reference:** Phase 2 — AI modernization; enabler for Phase 3+ LLM
tournament server.

**Problem Statement:**
Today the engine implicitly assumes a single move source per game ("the AI" vs
"the human"). The Phase 2 architecture already separates `IconquerCore` (pure
rules) from `IconquerAI` (strategies), but there is no formal seat → move-source
binding. Without one:

- Mixing 2 humans + 2 LLMs in one game requires ad-hoc glue per caller.
- Per-seat latency, timeouts, identity, and audit logs have no home.
- Replays cannot faithfully reproduce AI moves because the producing strategy is
  not recorded alongside the move.
- MCP integration will tempt us to bolt "the MCP player" in as a special case,
  re-introducing the asymmetry we just removed.

**Motivation:**
LLM dogfooding (Phase 2) and the tournament server (Phase 3+) both assume N
independent agents can be seated arbitrarily. The cheapest time to guarantee
that is before the first AI seat is wired up.

---

## 2. Proposed Architecture

**New Module:** `IconquerMatch` — a thin orchestration layer that sits *above*
`IconquerCore` and *below* any UI or tournament runner. It owns the seat → agent
binding, turn pump, per-seat timeouts, and move log.

**Rationale for a new module (not folding into Core):** `IconquerCore` must stay
pure, synchronous, and Sendable-trivial. Player binding is inherently async
(network, LLM, user input) and needs actor isolation. Keeping it separate
preserves Core's testability and the hard rule that Core has no I/O.

**New Files:**
- `Sources/IconquerMatch/PlayerAgent.swift` — the agent protocol
- `Sources/IconquerMatch/SeatBinding.swift` — seat ↔ agent mapping + identity
- `Sources/IconquerMatch/MatchRunner.swift` — turn pump, timeouts, barriers
- `Sources/IconquerMatch/MoveRecord.swift` — audited move log entry
- `Sources/IconquerMatch/MatchSettings.swift` — per-match tunables (no magic numbers)
- `Tests/IconquerMatchTests/…`

**Modified Files:** None in `IconquerCore`. `IconquerAI` strategies gain a thin
conformance to `PlayerAgent` (adapter, not rewrite).

**Module Placement:**
```
IconquerCore      (pure rules, unchanged)
    ▲
IconquerMatch     (NEW — seat binding, turn pump, audit log)
    ▲          ▲
IconquerAI    iconquer app / tournament server
```

`IconquerMatch` depends on `IconquerCore` only. `IconquerAI` depends on
`IconquerCore` and conforms to `IconquerMatch.PlayerAgent` via an adapter so
there is no circular dependency: the app wires them together.

---

## 3. API Surface

```swift
// MARK: - Agent protocol

/// A source of moves for a single seat in a match.
///
/// Implementations may be synchronous (scripted strategy), interactive
/// (human UI), or remote (LLM over MCP). The runner never assumes which.
public protocol PlayerAgent: Sendable {
    /// Stable identity for audit logs and replays.
    var identity: AgentIdentity { get }

    /// Produce a move for the given state. Must respect the deadline.
    /// Throws `AgentError.timeout` if the deadline elapses.
    func requestMove(
        state: GameState,
        seat: SeatID,
        deadline: ContinuousClock.Instant
    ) async throws -> Move

    /// Optional: called when the match ends, for cleanup / final logging.
    func matchDidEnd(result: MatchResult) async
}

public extension PlayerAgent {
    func matchDidEnd(result: MatchResult) async {}
}

// MARK: - Identity (audit + replay)

public struct AgentIdentity: Sendable, Hashable, Codable {
    public let kind: Kind
    public let displayName: String
    public let version: String          // e.g. "claude-opus-4-6" or "human-v1"
    public let promptFingerprint: String? // hash of system prompt, if any
    public let metadata: [String: String]

    public enum Kind: String, Sendable, Codable {
        case human
        case scripted       // deterministic strategy in IconquerAI
        case llm            // LLM via MCP or direct API
        case remote         // generic network-backed agent
    }
}

// MARK: - Seat binding

public struct SeatBinding: Sendable {
    public let seat: SeatID
    public let agent: any PlayerAgent
    public let timeout: Duration
    public let fallback: FallbackPolicy

    public enum FallbackPolicy: Sendable {
        case forfeitTurn                // pass / no-op legal move
        case randomLegalMove(seed: UInt64)
        case abortMatch
    }
}

// MARK: - Match runner

public actor MatchRunner {
    public init(
        initialState: GameState,
        bindings: [SeatBinding],
        settings: MatchSettings,
        clock: any Clock<Duration> = ContinuousClock()
    ) throws

    /// Drives the match to completion, yielding each recorded move.
    /// Back-pressures on the active seat's agent.
    public func run() -> AsyncThrowingStream<MoveRecord, Error>

    /// Current immutable snapshot. Safe to read from any task.
    public func snapshot() -> GameState
}

// MARK: - Audited move record

public struct MoveRecord: Sendable, Codable {
    public let turn: Int
    public let seat: SeatID
    public let agent: AgentIdentity     // who produced the move
    public let move: Move
    public let stateHashBefore: String  // for replay verification
    public let latency: Duration
    public let fallbackUsed: Bool
}

// MARK: - Settings (no hardcoded constants)

public struct MatchSettings: Sendable {
    public var defaultTimeout: Duration
    public var humanTimeout: Duration
    public var llmTimeout: Duration
    public var barrierTimeout: Duration       // for simultaneous phases
    public var maxConcurrentLLMRequests: Int  // tournament throughput cap
    public var recordStateHashes: Bool
    public var fallbackSeed: UInt64
}

// MARK: - Errors

public enum AgentError: Error, Sendable {
    case timeout(seat: SeatID)
    case illegalMove(seat: SeatID, move: Move, reason: String)
    case transportFailure(seat: SeatID, underlying: String)
    case cancelled(seat: SeatID)
}

public enum MatchError: Error, Sendable {
    case duplicateSeat(SeatID)
    case missingSeat(SeatID)
    case seatCountMismatch(expected: Int, got: Int)
    case agentFailed(seat: SeatID, AgentError)
}
```

**Key design points:**

1. **Symmetry.** The runner holds `[SeatBinding]` — it cannot express "the human"
   or "the AI" as distinct concepts. A 2h+2ai game is the same code path as 4ai.
2. **Per-seat timeouts.** Humans get long deadlines, LLMs get shorter ones with
   explicit fallback policies. Timeouts live in the binding, not the agent.
3. **Identity travels with every move.** `MoveRecord.agent` captures model
   version + prompt fingerprint so replays are faithful even across model
   upgrades.
4. **Simultaneous phases supported via barrier.** `MatchRunner` can collect
   moves from multiple seats in parallel bounded by `barrierTimeout`; the
   turn-based path is just the degenerate case of barrier size 1.
5. **Isolation.** Each agent receives only `GameState` (public info). Hidden
   info (when added later) will flow through a per-seat `GameView` derived
   inside the runner — never shared across seats.

---

## 4. MCP Schema

**Tool Description:** Seat an LLM agent in an iconquer match. The server exposes
one tool per seat binding; the LLM's response is consumed as that seat's move.

**REQUIRED STRUCTURE (JSON):**
```json
{
  "tool": "iconquer_submit_move",
  "arguments": {
    "match_id": "uuid-string",
    "seat_id": 2,
    "turn": 14,
    "state_hash": "sha256-hex",
    "move": {
      "kind": "deploy",
      "territory": "alaska",
      "armies": 3
    },
    "reasoning": "optional short rationale, logged but not validated"
  }
}
```

**Parameter Types:**
- `match_id` (string, uuid): Match identity; rejects stale requests.
- `seat_id` (integer, ≥0): Which seat is submitting; rejected if not active.
- `turn` (integer, ≥0): Turn counter; rejected if not current (prevents replay).
- `state_hash` (string, hex): Hash the LLM saw; rejected on mismatch (detects
  stale context).
- `move` (object): Discriminated union by `kind`. Exhaustive `kind` values:
  `"deploy"`, `"attack"`, `"fortify"`, `"pass"`.
  - `territory` (string): Territory id (enum derived from board).
  - `armies` (integer, >0): Army count where applicable.
- `reasoning` (string, optional): Opaque audit field, max 2000 chars.

**State query tool** (read-only):
```json
{
  "tool": "iconquer_get_state",
  "arguments": {"match_id": "uuid-string", "seat_id": 2}
}
```
Returns the per-seat `GameView` (public info only), the current `state_hash`,
and the legal move set.

---

## 5. Constraints & Compliance

- **Concurrency:** `MatchRunner` is an actor. `PlayerAgent` is `Sendable`.
  All value types (`MoveRecord`, `SeatBinding`, `MatchSettings`, `AgentIdentity`)
  are `Sendable` by virtue of being immutable structs.
- **Swift 6 strict concurrency:** No shared mutable state crossing actor
  boundaries. Agents communicate only via `async throws` methods.
- **No force unwraps / try! / as!:** All seat lookups go through
  `throws MatchError.missingSeat`. Timeouts surface as `AgentError.timeout`,
  never as crashes.
- **No hardcoded constants:** Every duration, retry count, and concurrency cap
  lives in `MatchSettings`. Per the standing feedback rule, no magic numbers in
  logic.
- **No `String(format:)`:** Identity/version strings use interpolation only.
- **Determinism:** Fallback moves use a seeded RNG (`MatchSettings.fallbackSeed`).
  Scripted agents remain fully deterministic. LLM agents are explicitly
  non-deterministic but their outputs are captured in `MoveRecord` for replay.
- **MCP Ready:** Schema defined above; all enums exhaustive; state hashing makes
  context staleness a first-class error rather than a silent bug.
- **Core purity preserved:** Zero changes to `IconquerCore`. This is the
  decisive test that the abstraction is in the right place.

---

## 6. Backend Abstraction

Not applicable — this is orchestration, not compute. No Metal/Accelerate path.
The only "backend" concern is LLM transport (MCP vs direct API vs local), which
is absorbed by conforming types to `PlayerAgent`.

---

## 7. Dependencies

**Internal:**
- `IconquerCore` (GameState, Move, SeatID, legal-move enumeration, state hashing)

**External:** None for `IconquerMatch` itself. LLM-backed agents in
`IconquerAI` will depend on an MCP client library, but that dependency does not
leak into `IconquerMatch`.

**Required additions to IconquerCore (minimal):**
- Public `GameState.hash() -> String` (stable, order-independent). Needed for
  the state-hash replay check. This is a pure function with no behavior change.
- Public `GameState.legalMoves(for: SeatID) -> [Move]`. Likely already exists;
  confirm during RED phase.

If either is missing, they land as a tiny separate PR against Core *before*
`IconquerMatch` work begins, to keep the two modules' histories clean.

---

## 8. Test Strategy

**Test Categories:**

1. **Golden path — homogeneous seats**
   - 4 scripted agents play a deterministic match; full `MoveRecord` log is
     byte-stable across runs with fixed seeds.
   - *Reference truth:* A committed JSON fixture of the expected move log,
     generated once and reviewed by hand.

2. **Golden path — mixed seats**
   - 2 scripted + 2 `MockLLMAgent` (returns pre-scripted responses) complete a
     match. Verify every `MoveRecord.agent.kind` matches its binding and the
     final state matches the all-scripted baseline when the mock returns the
     same moves.

3. **Timeouts and fallback**
   - `SlowAgent` sleeps past its deadline. Verify `AgentError.timeout` is
     raised, `FallbackPolicy.randomLegalMove` produces a legal move, and
     `MoveRecord.fallbackUsed == true`.
   - Verify `.abortMatch` policy surfaces `MatchError.agentFailed`.

4. **Illegal move rejection**
   - `CheatingAgent` returns a move not in `legalMoves`. Verify
     `AgentError.illegalMove` and that fallback (if configured) engages without
     corrupting state.

5. **State-hash staleness (MCP)**
   - Submit a move with a stale `state_hash`. Verify rejection and that the
     runner does not advance turn.

6. **Isolation**
   - Two `MockLLMAgent` instances in the same match. Verify neither receives
     the other's `requestMove` payload and that per-seat `GameView` (once
     hidden info exists) is derived from state, not shared.

7. **Concurrency — simultaneous barrier phase**
   - Four agents submit in parallel under a barrier. Verify all four
     `requestMove` calls run concurrently (measured via a test clock) and the
     barrier respects `barrierTimeout`.

8. **Determinism — fallback reproducibility**
   - Same `fallbackSeed` → identical fallback move sequence across runs, even
     when real agents time out at different wall-clock moments.

9. **Replay**
   - Feed a recorded `[MoveRecord]` log into a replay runner with stub agents
     that return the logged move; final state hash must equal the original.

**Reference Truth:**
- Move legality and state transitions: `IconquerCore` itself (already tested).
- Move-log byte-stability: committed JSON fixtures, reviewed by hand on first
  generation.
- LLM agent behavior: `MockLLMAgent` with scripted responses — no live LLM in
  CI. Live LLM is only exercised in a separate, opt-in integration target.

**Validation Trace:**
- `MatchRunner` with `[Scripted(seed=1), Scripted(seed=2)]` on a 2-player
  `GameState.initial()` → `MoveRecord[0].move == <expected first move>` (exact
  value captured from first green run and frozen as the golden fixture).

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `06_ARCHITECTURE_DECISIONS.md` for related decisions
- [ ] Supersedes existing ADR? **No**
- [ ] Amends existing ADR? **No** (Phase 2 module split stands; this extends it)
- [x] New ADR required? **Yes**

**New ADR Draft:**
- **Title:** Seat-agnostic player binding via `IconquerMatch`
- **Category:** architecture
- **Key decision:** All move sources — human, scripted, LLM — conform to a
  single `PlayerAgent` protocol owned by `IconquerMatch`. `IconquerCore` remains
  unaware of agent identity. This is a hard boundary: any future feature that
  needs to distinguish "the AI" from "the human" at the Core level must first
  amend this ADR.

---

## 10. Open Questions

1. **Hidden information timing.** iconquer currently has full-information state.
   Do we want `GameView` (per-seat filtered state) stubbed now, or deferred
   until a hidden-info feature actually lands? *Recommendation: stub the type,
   have it equal `GameState` for now, so the signature doesn't change later.*

2. **Human agent UX.** Should the `HumanAgent` conformance live in
   `IconquerMatch` (as a reference implementation backed by an
   `AsyncStream<Move>` input) or in the app layer? *Recommendation: reference
   implementation in `IconquerMatch` so tests can exercise human-in-the-loop
   without the app.*

3. **MCP server ownership.** Does the MCP server live in `IconquerMatch` or in
   a separate `IconquerMCP` target? *Recommendation: separate target, to keep
   `IconquerMatch` dependency-free and testable offline.*

4. **Concurrency cap.** `maxConcurrentLLMRequests` — is this per-match or
   per-tournament? *Recommendation: per-match in v1; tournament-wide cap is a
   Phase 3 concern and belongs in the tournament runner, not here.*

5. **Reasoning field retention.** LLM `reasoning` strings could become large
   over a tournament. Store inline in `MoveRecord` or in a side log? *Defer
   to Phase 3.*

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Combines 3+ APIs? **Yes** (`PlayerAgent`, `MatchRunner`, `SeatBinding`,
  `MoveRecord`, MCP schema)
- Explanation requires 50+ lines? **Yes**
- Needs theory/background context? **Yes** (symmetry principle, why Core stays
  pure, replay semantics)

**Article Name:** `MultiAgentMatchesGuide.md` (in `IconquerMatch.docc`)

Plus standard DocC API docs on every public symbol.

---

## Performance Considerations

- **Turn pump overhead:** The actor hop per turn is ~µs and dwarfed by any real
  agent's think time. Not a concern.
- **Parallel barrier phases:** `maxConcurrentLLMRequests` bounds fan-out so a
  tournament with many LLM seats cannot overwhelm the transport. Default value
  lives in `MatchSettings`, not hardcoded.
- **State hashing:** Required for replay verification; must be O(state size)
  and allocation-light. A rolling hash over canonical-order fields is
  sufficient; benchmarked against a 100k-turn synthetic match target of
  <5ms/turn overhead (threshold captured in `MatchSettings`, not inlined).
- **MoveRecord log growth:** Linear in turn count. For tournament runs the log
  streams to disk via the `AsyncThrowingStream` rather than accumulating in
  memory.
- **LLM latency asymmetry:** Handled structurally by per-seat timeouts +
  fallback, not by performance tuning. A slow LLM cannot stall a human's turn
  in a mixed match because only the active seat blocks.

---

## Approval

- [ ] User reviewed
- [ ] User approved → move to `UPCOMING/`
- [ ] Checklist created in `04_IMPLEMENTATION_CHECKLISTS/`
