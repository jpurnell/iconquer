# Design Proposal: MCTSAgent

**Status:** PROPOSAL
**Author:** Justin Purnell + Claude
**Date:** 2026-04-26
**Supersedes:** None
**Related:** `IconquerAI_AccelerateGVN.md` (the value network this builds on), `IconquerAI_GraphValueNetwork.md` (the MLX baseline this also works with)

---

## 1. Objective

Build an MCTS-based inference agent for IconquerAI that **beats Greedy in head-to-head play.** This is the explicit success criterion, not a stretch goal — the architectural pattern is well-validated (AlphaZero, GG-Net), our value network math is verified (finite-diff gradient checks pass), and our self-play loop is in place to provide the missing ingredient (network trained on MCTS-grade play).

**Master Plan reference:** Phase 2 — AI + Tournament infrastructure. Three prior learned agents (T5 MLP, MLX graph value network, Accelerate graph value network) all topped out at Elo 1330–1410, all losing to Greedy (1651) and Strategic (1517). **The diagnosis is structural**, not bug-level: value head + 1-ply argmax cannot recover lookahead, and the network was trained on heuristic-vs-heuristic transcripts so its position evaluation mirrors what those heuristics already see. MCTS addresses the lookahead gap; self-play training addresses the data-bias gap. Both are required.

### Staged Elo path

Beating Greedy is not a one-shot from "ship MCTS." It's a multi-stage journey, and the proposal commits to all stages:

| Stage | Expected Elo | What gets us there |
|---|---|---|
| Today (accelerate-learned, 1-ply) | 1332 | We have it. |
| Stage 1: MCTS @ 100ms, current weights | ~1450 | +120 from search depth alone, bottlenecked by network trained on heuristic data |
| Stage 2: MCTS @ 1s, current weights | ~1500 | More search isn't a substitute for a better network; diminishing returns |
| Stage 3: MCTS + 3-5 self-play iterations | ~1600 | Network learns from MCTS-vs-MCTS games; this is where Greedy starts losing in some matches |
| Stage 4: MCTS + policy head + joint training (v2 proposal) | ~1700+ | AlphaZero pattern; comfortably beats Greedy and Strategic |

**This proposal covers stages 1–3.** Stage 4 (policy head + joint training) is a separate proposal that builds on this one.

### Concrete deliverables

- v1 ships **MCTSAgent** that runs at configurable per-turn budget
- v1 ships **concurrent game execution** in the tournament runner (separate but blocking — without it the iteration loop is unworkable)
- v1 ships **batched leaf evaluation** in the simulator (~2× speedup at the same wall time)
- Default tournament settings target **17 min per pairing** for fast iteration (200 games × 100ms × 8 concurrent), with 1000-game high-fidelity runs for tagged release benchmarks
- Stays deterministic given a fixed seed (required for tournament reproducibility)
- Reuses all of AccelerateGVN — no network changes for v1

---

## 2. Proposed Architecture

### New files

```
IconquerAI/Sources/IconquerAI/Search/
├── ValueNetworkBackend.swift     # Protocol + default batch impl, ~50 LOC
├── MCTSConfig.swift              # Hyperparameters + budget mode, ~100 LOC
├── MCTSNode.swift                # Tree node representation, ~150 LOC
├── MCTSTree.swift                # Tree management + subtree reuse + state-divergence detection, ~280 LOC
├── PUCTSelector.swift            # Selection policy (PUCT formula), ~80 LOC
├── MCTSSimulator.swift           # One-simulation traversal + backup + batched eval, ~330 LOC
├── MCTSAgent.swift               # PlayerAgent conformance, per-turn clock, ~300 LOC
└── MoveEnumerator.swift          # Valid-move enumeration per phase, ~200 LOC

IconquerAI/Sources/IconquerAI/Learned/Accelerate/
└── AccelerateValueNetwork.swift  # ValueNetworkBackend conformance for AccelerateGVN, ~120 LOC

IconquerAI/Tests/IconquerAITests/
├── PUCTSelectorTests.swift           # Selection-formula correctness, ~100 LOC
├── MCTSSimulatorTests.swift          # End-to-end one-simulation tests, ~150 LOC
├── MCTSTreeSubtreeReuseTests.swift   # Subtree reuse + divergence fallback, ~120 LOC
├── MCTSAgentDeterminismTests.swift   # Same-seed → same-move, ~100 LOC
├── MCTSAgentBudgetTests.swift        # Per-turn clock semantics + clock-expiry fallback, ~120 LOC
└── MCTSAgentBenchmarkTests.swift     # Head-to-head budget tests, ~150 LOC
```

### Modified files

```
IconquerTournament/Sources/iconquer-tournament/TournamentCommand.swift
  — Add "mcts-accelerate" to agent factory
  — Add --mcts-budget-seconds, --mcts-c-puct, --mcts-threads CLI flags
  — Add --concurrent-games CLI flag (default 8 on macOS)

IconquerTournament/Sources/IconquerTournament/Orchestrator/TournamentAgentFactory.swift
  — Register "mcts-accelerate" agent

IconquerTournament/Sources/IconquerTournament/Orchestrator/TournamentOrchestrator.swift
  — Run games in parallel via withTaskGroup with N in-flight tasks
  — ~150 LOC change; preserves per-game seed reproducibility

IconquerTournament/scripts/accelerate-self-play-loop.sh
  — Add mcts-accelerate to the tournament agent list
  — Drop default ROUNDS_PER_PAIRING from 10000 to 200 for fast iteration
```

### Module placement

Lives under `IconquerAI/Sources/IconquerAI/Search/` — a new sibling to `Learned/`. The search layer is independent of the learning code, but depends on it (uses `AccelerateGVN.evaluate` for leaf scoring). Keeping `Search/` separate keeps the boundary clean and avoids polluting `Learned/` with non-network concerns.

The agent itself (`MCTSAgent`) lives in `Search/` rather than alongside `AccelerateGraphLearnedAgent` in `Learned/Accelerate/` — because MCTS is a search technique that could equally wrap any value network (MLX, Accelerate, future architectures). The composition is `MCTSAgent(valueNetwork:)`, so the network is a parameter.

---

## 3. API Surface

### MCTSConfig

```swift
public struct MCTSConfig: Sendable, Codable {

    // Budget — simulation count is primary. Time is a safety cap.
    //
    // Why sim-count primary: algorithmic depth is what determines move
    // quality, and sim count is hardware-independent. A 1000-sim search
    // on this Mac in 2026 produces the same move as a 1000-sim search on
    // a 2030 Mac (modulo combat sampling, which is also seed-deterministic).
    // Time budgets bind the algorithm to today's hardware and force us to
    // re-tune defaults every chip generation.

    /// Simulations per decision. The primary budget knob. Search stops
    /// when this many simulations have completed (or `maxWallTimeSeconds`
    /// trips first, whichever).
    public var maxSimulations: Int

    /// Wall-clock safety cap per decision (seconds). Catches runaway
    /// search if simulations themselves are slow for any reason. Generous
    /// by default; set lower if a deployment has hard latency requirements.
    public var maxWallTimeSeconds: Double

    // Selection
    /// Exploration constant in the PUCT formula. Higher = explore more.
    /// AlphaZero used 1.0–4.0; we default to 1.5.
    public var cPuct: Float

    /// Temperature for root-level move selection.
    /// 0 = pick most-visited (greedy); >0 = sample proportional to N^(1/τ).
    /// Tournaments: 0. Self-play data generation: 1.0 for first N moves, then 0.
    public var temperature: Float

    /// Number of plies after expansion to roll out before falling back to
    /// network evaluation. 0 = pure network eval at every leaf (AlphaZero style).
    /// >0 = hybrid: short rollout then network. Default 0.
    public var rolloutDepth: Int

    // Determinism + parallelism
    /// Seed for tie-breaking and any chance-node sampling.
    public var seed: UInt64

    /// Root-parallel search threads. 1 = sequential; > 1 runs N independent
    /// searches and aggregates visit counts. Tree-parallel search (with
    /// virtual loss) is a v2 option; root parallelism is simpler and
    /// deterministic given seeded RNG per thread.
    public var threadCount: Int

    // Combat handling (Risk-specific)
    /// How to evaluate stochastic combat outcomes during simulation.
    /// - `.expected`: use deterministic expected-value combat (fast, biased)
    /// - `.sampled(trials:)`: roll combat N times with seeded RNG, average the
    ///   resulting child-state evaluations. Higher trials = lower variance,
    ///   slower simulation.
    public var combatEvaluation: CombatEvaluation

    public enum CombatEvaluation: Sendable, Codable, Equatable {
        case expected
        case sampled(trials: Int)
    }

    /// Tournament default. 1000 simulations per decision is the AlphaZero
    /// training-time budget; experimentally enough for meaningful lookahead
    /// at our network size while keeping wall time tractable on current
    /// hardware (~200 ms/decision today; will improve automatically as
    /// hardware does). 5s wall cap is a safety net, not a target.
    public static let `default` = MCTSConfig(
        maxSimulations: 1000,
        maxWallTimeSeconds: 5.0,
        cPuct: 1.5,
        temperature: 0.0,
        rolloutDepth: 0,
        seed: 42,
        threadCount: 1,            // 1-thread agent; concurrency is at the tournament level
        combatEvaluation: .sampled(trials: 5)
    )

    /// High-fidelity benchmark preset. 5000 sims gives strong play at any
    /// network size; used for tagged-release benchmarks where we want the
    /// best-possible decisions and accept longer wall time.
    public static let benchmark = MCTSConfig(
        maxSimulations: 5000,
        maxWallTimeSeconds: 30.0,
        cPuct: 1.5,
        temperature: 0.0,
        rolloutDepth: 0,
        seed: 42,
        threadCount: 1,
        combatEvaluation: .sampled(trials: 10)
    )

    /// Fast smoke-test preset for CI: 50 sims is enough to verify the
    /// pipeline works end-to-end without spending real wall time.
    public static let smoke = MCTSConfig(
        maxSimulations: 50,
        maxWallTimeSeconds: 1.0,
        cPuct: 1.5,
        temperature: 0.0,
        rolloutDepth: 0,
        seed: 42,
        threadCount: 1,
        combatEvaluation: .expected
    )

    public init(...)
}
```

### MCTSNode and MCTSTree

```swift
/// One node in the search tree. Holds aggregated statistics over the
/// edge entering the node from its parent. Game state itself is not
/// stored on the node — it is reconstructed during traversal by replaying
/// moves from root, which keeps the per-node memory footprint small.
final class MCTSNode {
    /// Move that produced this child from the parent. nil at root.
    let incomingMove: GameMove?
    /// Player whose turn it is at this node.
    let activeSeat: PlayerId
    /// Accumulated value (from the parent's perspective) over all visits.
    var totalValue: Float
    /// Visit count.
    var visitCount: Int
    /// Policy prior P(s, a) for this incoming move. Uniform in v1.
    var prior: Float
    /// Lazily-expanded children, keyed by GameMove.
    var children: [GameMove: MCTSNode]
    /// True once this node has been expanded (children populated).
    var isExpanded: Bool
}

/// Tree manager: owns the root, handles subtree reuse across turns,
/// exposes statistics for debugging.
public final class MCTSTree {

    public init(rootSeat: PlayerId)

    /// Replace the root with the child reached by `move`, dropping all
    /// other branches. Used at the start of each turn so the work done
    /// during the opponent's turn (if we kept searching) carries over.
    public func advance(by move: GameMove)

    /// Reset to a fresh root. Called when game-state divergence is
    /// detected (e.g. opponent did something we didn't simulate).
    public func reset(rootSeat: PlayerId)

    /// Diagnostics — visit counts, mean values per child of root.
    public func rootStatistics() -> [(move: GameMove, visits: Int, value: Float)]
}
```

### MCTSSimulator

```swift
/// Runs one MCTS simulation: traversal → expansion → evaluation → backup.
/// Stateless — operates on a tree and game state passed in.
struct MCTSSimulator {

    let valueNetwork: AccelerateGVN
    let graphEncoder: GraphEncoder
    let globalEncoder: GlobalEncoder
    let adjacency: [Float]
    let map: MapDefinition
    let combatSimulator: CombatSimulator
    let config: MCTSConfig

    /// Run one simulation from the tree root. Mutates the tree.
    /// `rootState` is the canonical game state at the root (caller-owned,
    /// not mutated; we operate on a deep copy internally).
    func runOneSimulation(
        tree: MCTSTree,
        rootState: GameSnapshot,
        rng: inout SplitMix64
    )
}
```

### MCTSAgent

```swift
public final class MCTSAgent: PlayerAgent, @unchecked Sendable {
    // Justification: holds an MCTSTree for cross-turn subtree reuse;
    // the tree is mutated only inside requestMove, which the match
    // runner serializes per agent.

    public init(
        map: MapDefinition,
        valueNetwork: AccelerateGVN,
        playerCount: Int,
        config: MCTSConfig = .default,
        name: String = "mcts-accelerate"
    )

    /// Convenience: load weights from disk and construct the agent.
    public convenience init(
        map: MapDefinition,
        weightsURL: URL,
        playerCount: Int,
        config: MCTSConfig = .default,
        name: String = "mcts-accelerate"
    ) throws

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

### MoveEnumerator

```swift
/// Enumerates valid GameMoves for a given state + seat. The match runner
/// has its own validation (used to gate moves the agent submits); this
/// helper produces the candidate set for MCTS to expand.
///
/// Splits by phase to keep each method narrowly scoped:
/// - pickCountries → list of unowned countries
/// - initializeArmies → placement choices on owned countries
/// - assignArmies → placement choices on owned countries with continent bias
/// - attack → (from, to) pairs satisfying attacker armies ≥ 2 + adjacency + opponent owned
/// - fortify → just .finishTurn for now (matches existing agent behavior)
struct MoveEnumerator {
    let map: MapDefinition
    func validMoves(state: GameSnapshot, seat: PlayerId) -> [GameMove]
}
```

---

## 4. MCP Schema

`MCTSAgent` ships through the existing tournament CLI. New flag surface:

```json
{
  "command": "iconquer-tournament run",
  "arguments": {
    "agents": "greedy,strategic,mcts-accelerate",
    "maps": "world",
    "rounds": 1000,
    "storage": "/tmp/mcts-tournament-v1"
  },
  "agentBudget": {
    "mcts-sims": 1000,
    "mcts-max-wall-time-seconds": 5.0,
    "mcts-max-sims": 0,
    "mcts-c-puct": 1.5,
    "mcts-threads": 1
  }
}
```

**Parameter Types:**
- `mcts-sims` (int): simulations per decision. Primary algorithmic budget. > 0.
- `mcts-max-wall-time-seconds` (float): wall-clock safety cap per decision. > 0.
- `mcts-c-puct` (float): exploration constant. Typical 1.0–4.0.
- `mcts-threads` (int): root-parallel thread count. 1 by default.

The agent factory matches `mcts-accelerate` and constructs an `MCTSAgent` with weights loaded from `~/.iconquer/models/accelerate_gvn_p2.agvn`. If weights are missing, agent falls back to an untrained network (will play poorly but won't crash).

---

## 5. Constraints & Compliance

**Concurrency:**
- `MCTSAgent` is `@unchecked Sendable` with justification (holds mutable tree; mutation is serialized per-agent by the match runner).
- `MCTSTree` and `MCTSNode` are reference types accessed only by the agent that owns them. Not Sendable.
- Root parallelism uses `DispatchQueue.concurrentPerform`. Each thread builds its own private subtree, then aggregates visit counts at the root via a serial reduction (microseconds).

**Determinism:**
- All randomness flows through a `SplitMix64` seeded from `MCTSConfig.seed`. Includes:
  - PUCT tie-breaking (ties broken by lowest move-hash, not random — already deterministic)
  - Temperature sampling at root (used for self-play; tournaments use τ=0)
  - Combat sampling when `combatEvaluation == .sampled(trials:)`
- Multi-thread root parallelism: each thread gets a derived seed (`config.seed + threadIndex * 0x9E3779B97F4A7C15`). Same total seed + same thread count → bit-identical outcomes.
- Single-thread + same seed = bit-identical move on every run.

**Pointer safety:** MCTS code uses no `withUnsafe*` blocks. All state is in standard Swift collections. The only pointer code lives inside `AccelerateGVN.forward` which we call as a black box.

**Recursion:** MCTS traversal is iterative (a stack of visited nodes), not recursive. No stack-depth concern.

**Safety:**
- No force unwraps. Move enumeration validates all candidates against `state` before returning.
- Bounded loops: simulations stop on time budget OR `maxSimulations`. If both are 0, default to a hard-coded 100 simulations (avoids infinite loop bug).
- Division: PUCT formula has `1 + N(s, a)` in denominator (always > 0). Visit-count normalization checks for zero before dividing.

**MCP Ready:** flag schema documented above.

---

## 6. Backend Abstraction

MCTSAgent is **value-network-agnostic by protocol**, decided in v1. The search code talks to a `ValueNetworkBackend` protocol; concrete implementations include `AccelerateValueNetwork` (wraps `AccelerateGVN`) and a future `MLXValueNetwork` (wraps `GraphValueNetwork` if needed).

```swift
/// A pluggable value network for MCTS leaf evaluation.
///
/// All MCTS code talks to this protocol; concrete implementations live in
/// IconquerAI/Learned/Accelerate/AccelerateValueNetwork.swift (and could be
/// extended to wrap the MLX graph value network or future architectures).
public protocol ValueNetworkBackend: Sendable {

    /// Evaluate a single state from the perspective of `seat`.
    /// Returns a scalar in some range — the search doesn't care if it's
    /// a probability or raw value, only that "higher = better for seat".
    func evaluate(state: GameSnapshot, seat: PlayerId) -> Float

    /// Batched evaluation. Used by MCTSSimulator when batched leaf eval is
    /// enabled (the v1 throughput optimization). Default implementation
    /// loops over `evaluate(state:seat:)`; concrete backends override for
    /// real batching where it pays off.
    func evaluateBatch(states: [GameSnapshot], seats: [PlayerId]) -> [Float]
}

extension ValueNetworkBackend {
    public func evaluateBatch(states: [GameSnapshot], seats: [PlayerId]) -> [Float] {
        precondition(states.count == seats.count)
        return zip(states, seats).map { evaluate(state: $0, seat: $1) }
    }
}

/// Wraps an AccelerateGVN, holding the encoders + adjacency the network
/// expects. Constructed once per agent at init.
public final class AccelerateValueNetwork: ValueNetworkBackend, @unchecked Sendable {
    // Justification: AccelerateGVN is a class with mutable weights. After
    // weight load this object is read-only for inference; multiple search
    // threads can share one instance safely.

    public init(map: MapDefinition, network: AccelerateGVN, playerCount: Int)

    public func evaluate(state: GameSnapshot, seat: PlayerId) -> Float
    public func evaluateBatch(states: [GameSnapshot], seats: [PlayerId]) -> [Float]
}
```

**MCTSAgent then takes the protocol:**

```swift
public final class MCTSAgent<Backend: ValueNetworkBackend>: PlayerAgent {
    public init(
        map: MapDefinition,
        valueNetwork: Backend,
        playerCount: Int,
        config: MCTSConfig,
        name: String
    )
    // ...
}
```

For the typical use site (loading from a file), a non-generic `MCTSAcceleratedAgent` typealias / wrapper provides the convenience init that loads weights and constructs `AccelerateValueNetwork`.

**Why pay this cost in v1:** the user explicitly called for it; future networks (MLX policy+value head, alternative architectures, transformer-based) will land in this same slot. Building the protocol while the call site has exactly one implementation costs ~30 LOC; retrofitting it later means touching every test that mocks the network.

**No CPU/GPU split for the search itself.** The tree lives in CPU memory; node operations are pointer chases and small float arithmetic. Search is overwhelmingly bound by the value-network calls (evaluations), not the search bookkeeping.

---

## 7. Dependencies

**Internal:**
- `IconquerCore` — `MapDefinition`, `GameSnapshot`, `Game`, `GameMove`, `Player`, `Settings`, `CombatSimulator`, `SeededRNG`, `PlayerId`, `CountryId`
- `IconquerAI/Learned/Accelerate/AccelerateGVN.swift` — for `evaluate()` and `buildNormalizedAdjacency`
- `IconquerAI/Learned/GraphEncoder.swift`, `GlobalEncoder.swift` — for state encoding (already used by AccelerateGraphLearnedAgent)
- `IconquerMatch` — for `PlayerAgent` protocol and `AgentIdentity`

**External:** none. Pure Swift + Foundation + Dispatch.

---

## 8. Test Strategy

### Test Categories

**Unit: PUCT selection (PUCTSelectorTests)**
1. Given hand-rolled visit/value/prior numbers, assert the selector picks the move with the highest UCB score
2. Tie-breaking: equal UCB scores broken deterministically by move hash, not RNG
3. Cold start (all child visits = 0): selector should fall back to highest prior
4. Numerical edge: very large visit counts shouldn't overflow `sqrt(parentVisits)` (use `Double` internally for the parentVisit term)

**Unit: One-simulation correctness (MCTSSimulatorTests)**
1. Single simulation from a fresh root: should expand the root, evaluate one leaf, propagate one value, end with `root.visitCount == 1`
2. Two simulations: root visits = 2; second simulation should pick a different child than the first (PUCT exploration term dominates when only one child has been visited)
3. Backup signs: in 2-player zero-sum, value at depth N flips sign N times on the way back to root (Q values along the path alternate)
4. Terminal state: simulation that hits `state.phase == .victory` should return ±1.0 (winner from root's perspective) and not call the value network

**Determinism (MCTSAgentDeterminismTests)**
1. Same seed + same state → same move (run agent twice, assert equality)
2. Same seed + different thread count → DIFFERENT but reproducible moves (we change parallelism, results change, but each is reproducible)
3. Different seeds → at least sometimes different moves (sanity that seed actually flows through)

**Integration: head-to-head benchmark (MCTSAgentBenchmarkTests)**
1. **Smoke test (CI-friendly):** MCTS with 50ms budget vs Greedy, 50 games, just verify it runs to completion
2. **Quality test (manual):** MCTS with 1s budget vs Greedy, 200 games, target ≥ 60% win rate. Skipped in CI (too slow); run manually before each tag.
3. **Self-consistency:** MCTS vs MCTS with identical config → close to 50/50 split (within statistical noise)

**Combat handling (MCTSCombatTests)**
1. `.expected` mode: simulate an attack, assert deterministic outcome matches `CombatSimulator.evaluateAttack` mean
2. `.sampled(trials: 10)` mode: same simulation twice with same seed → same outcome; different seeds → different outcomes

### Reference Truth

- **PUCT formula:** AlphaZero paper (Silver et al. 2017), eq. 1, with our constant naming. Independent reference: GG-Net (Heinrich et al. 2023) uses the same formula with c_puct ∈ [1.0, 4.0].
- **MCTS algorithm structure:** Browne et al. 2012 "A Survey of Monte Carlo Tree Search Methods," sections 3.1–3.4 (selection, expansion, simulation, backup).
- **Win-rate benchmarks:** the existing tournament infrastructure (`iconquer-tournament run` + `status`) produces Elo standings. Compared agent: `accelerate-learned` (current best learned agent at Elo 1332).

### Validation Trace

Specific input → expected output for the PUCT golden test:

- Parent has 100 visits total; child A has visits=50, totalValue=30 (Q=0.6), prior=0.5
- Child B has visits=50, totalValue=20 (Q=0.4), prior=0.5
- c_puct = 1.5
- Expected UCB(A) = 0.6 + 1.5 × 0.5 × √100 / (1 + 50) = 0.6 + 7.5/51 = 0.6 + 0.147 = 0.747
- Expected UCB(B) = 0.4 + 1.5 × 0.5 × √100 / (1 + 50) = 0.4 + 0.147 = 0.547
- Selector returns A. Asserted with tolerance 1e-5.

Inline-computed in the test source so the golden number is verifiable by reading the test alongside the AlphaZero formula.

---

## 9. Architecture Decision Review

**ADR check:**
- [x] Reviewed `architecture_decisions.md` — no existing ADR specifies search vs. heuristic vs. learned-only as the agent paradigm
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] **New ADR required? Yes** — draft below

### New ADR Draft

**Title:** ADR-001 — Tree search is the path to competitive learned agents (committed to `architecture_decisions.md` as YAML)

**Category:** architecture

**Status:** Proposed

**Context:** Three learned-agent attempts (T5 MLP, MLX graph value network, Accelerate graph value network) have all topped out around Elo 1330–1410 — all losing to Greedy (1651) and Strategic (1517). The diagnostic pattern is consistent: 1-ply argmax over a value network cannot recover lookahead. This is well-documented in the literature (TD-Gammon needed roll-outs, AlphaZero needed MCTS).

**Decision:** From now on, the path to competitive learned agents in IconquerAI is **search-augmented**. Pure value-network-only agents remain available for benchmarking, but the *competitive* tier requires MCTS or equivalent lookahead.

**Consequences:**
- (+) Unblocks the goal of beating heuristic agents (the architectural pattern is well-validated)
- (+) Reuses all existing value-network work — no model retraining required for v1
- (+) Provides the substrate for AlphaZero-style policy+value training in v2
- (−) Per-turn inference cost rises from microseconds to 100 ms (tournament) / 1 s (benchmark) — but parallel game execution keeps tournament wall time tractable
- (−) New search code adds ~1100 LOC of new surface area
- (−) Tree-search bugs are subtle; finite-difference equivalent doesn't exist for "did the search find the right move"

**Alternatives considered:**
- **Larger value network:** would help, but the 1-ply ceiling is structural. A bigger network with the same selection rule still loses to Greedy.
- **Better TD reward shaping:** would shift the value calibration but not extend lookahead. Doesn't address root cause.
- **Pure heuristic improvement:** already evolved Strategic via 300k-game evolutionary search; further gains there are sublinear.

---

## 10. Open Questions

1. **Combat evaluation default. RESOLVED: `.sampled(trials: 5)` for tournament default, `.sampled(trials: 10)` for benchmark.** Sampled gives a higher-fidelity signal than expected-value combat at ~1.5–2× per-sim cost (mostly limited to attack-phase nodes; placement and fortify pay nothing). The cost is acceptable when paired with batched leaf evaluation, which roughly halves per-sim cost in the other direction.

2. **Subtree reuse across turns. RESOLVED: ship in v1.** When the opponent makes a move, descend into the matching child subtree instead of resetting the tree. Effectively doubles per-turn search budget, since work done while the opponent was thinking carries forward. Adds ~100 LOC + one correctness test for state-divergence detection (if the opponent did something we didn't simulate, fall back to a fresh tree).

3. **Attack-mode enumeration. RESOLVED: `.untilWinOrLose` only in v1.** Matches the existing agents' behavior. Revisit if MCTS post-benchmark shows obvious value in single-roll attacks.

4. **Per-move vs per-turn budget. RESOLVED: per-move (per-decision) simulation count.** See §10a below for the reasoning — the short version is that simulation count is the algorithmically meaningful unit, and a per-decision sim count gives every decision the same MCTS depth regardless of how many decisions a turn happens to contain. Wall time is allowed to vary; that's a hardware concern, not a design one.

5. **Policy prior. RESOLVED: uniform in v1.** The value-only network doesn't produce a policy distribution. Adding a learned policy head is the v2 (Stage 4) proposal.

6. **Tree-parallel search vs root-parallel. RESOLVED: root-parallel.** Simpler, deterministic per-thread. Tree-parallel with virtual loss is harder to debug and adds non-determinism from interleaving. Defer indefinitely unless v1 hits a hard scaling wall.

### 10a. Per-move vs per-turn budget — resolution

The earlier draft of this section debated **clock allocation strategies** (per-move clock vs. per-turn clock with dynamic allocation). That framing was wrong. Both options were variations of "how do we allocate wall time," which binds the algorithm to whatever computer it's running on.

**Reframed as the right question:** what's the *algorithmically* meaningful budget unit? **Simulation count.** Each MCTS simulation is one selection-expansion-evaluation-backup cycle; the number of them determines tree depth, which determines move quality. Wall time is downstream of sim count and hardware speed.

**Decision: per-decision simulation count.** Each `requestMove` runs `config.maxSimulations` simulations, regardless of how many decisions are in the turn. Trade-offs:

- (+) Algorithmically consistent: every decision gets the same MCTS depth
- (+) Hardware-independent: 1000 sims today produces the same move as 1000 sims on a 2030 chip (modulo seeded combat sampling)
- (+) Reproducible benchmarks: "MCTS at 1000 sims/decision beat Greedy 62%" is a claim that ages well
- (+) Self-play data quality is consistent across hardware generations
- (−) Per-game wall time varies with how many decisions a turn contains; the concurrent-game scheduler's bin-packing is slightly less predictable
- (−) Faster hardware doesn't automatically make games shorter — it just makes them *better played at the same depth*. To exploit faster hardware for faster iteration, you raise `maxSimulations`, not lower it

The wall-time safety cap (`maxWallTimeSeconds`) catches pathological cases (e.g. a game state that produces unusually expensive simulations), but is intentionally generous — 5 s per decision in the default profile, way above the ~200 ms a 1000-sim search costs today.

**On the bin-packing concern raised in the earlier draft:** real, but minor. The variance in decisions-per-turn is bounded (~3–15 typical), and the concurrent-game scheduler can simply oversubscribe slightly to keep cores fed. Cleaner than binding our algorithm to today's chip.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Combines 3+ APIs? Yes (MCTSConfig, MCTSAgent, MCTSTree, MCTSSimulator)
- Explanation requires 50+ lines? Yes (PUCT formula, selection vs expansion vs backup, value-network integration, combat handling)
- Needs theory/background? Yes (MCTS basics, PUCT, why search beats 1-ply)

**Article Name:** `MCTSGuide.md` (avoid `MCTSAgent.md` to dodge DocC parser conflict with the symbol)

**Article should cover:**
1. Why tree search beats 1-ply value networks — short narrative with the project's own Elo ceiling as the example
2. MCTS in 4 phases (selection → expansion → evaluation → backup), with the PUCT formula
3. How leaf evaluation flows through `AccelerateGVN.evaluate`
4. Combat handling: `.expected` vs `.sampled(trials:)` trade-offs
5. Tournament configuration recipes (low-budget for fast tournaments, high-budget for benchmarks)
6. Self-play data generation: temperature schedule, when to switch from sampling to greedy
7. Measured benchmarks vs. Greedy/Strategic/accelerate-learned (filled in after v1 ships)

In-code DocC for every public API.

---

## 12. Performance Considerations

### Per-simulation cost

A single MCTS simulation at our network size:

| Step | Cost |
|---|---|
| Traversal (selection through ~20 deep tree) | ~5µs (pointer chases + PUCT compute) |
| Expansion (enumerate ~20 valid moves at leaf) | ~50µs (move filtering + neighbor lookups) |
| Evaluation (one `AccelerateGVN.evaluate`) | ~150µs (one forward pass on 42-node graph) |
| Backup (~20 nodes up the path, alternating signs) | ~5µs |
| **Total per simulation** | **~210µs** |

**On current hardware (Apple Silicon, single-threaded, no batched eval):** simulation cost ≈ 210µs.
- Default profile (1000 sims): **~210 ms per decision today**
- Benchmark profile (5000 sims): **~1.05 s per decision today**
- Smoke profile (50 sims): **~10 ms per decision today**

With batched eval (K=8) the per-sim cost drops to ~100µs:
- Default profile: **~100 ms per decision today**
- Benchmark profile: **~500 ms per decision today**

These are wall-time consequences of the chosen sim count, not targets. As hardware improves they fall automatically; sim count stays the algorithmically meaningful number.

Compare to MCTS-using-rollout-only (no network): ~50ms per simulation (200-move random rollout) → 20 sims/sec → ~20 sims per turn. Useless.

The leverage from a fast value head is enormous — we get ~250× more simulations than a rollout-based MCTS in the same wall time. This is exactly why AlphaZero replaced rollouts with networks.

### Memory

- Per-node: ~80 bytes (move, parent ptr, value sum, visit count, prior, children dict header)
- Children dict: ~32 bytes overhead + (key+value pointer) per child ≈ 16 bytes/child
- Avg branching factor: ~20 candidate moves per node in attack phase, ~5 in placement
- Tree size after 5,000 simulations: ~50,000 nodes × 80 + ~50,000 × 16 (avg) = **~5 MB per turn**
- Subtree reuse: drops 95% of the tree on each turn anyway

Negligible compared to the 4–5 GB the trainer used. No memory pressure concern.

### Cache locality

Tree traversal is the canonical pointer-chase pattern — bad for cache. Each node access is a near-random RAM read. This is the standard MCTS bottleneck and is **unavoidable** without changing data structures (e.g. arena allocator with index-based child references would help; deferred to v2 if profiling shows it's needed).

The value network call overwhelmingly dominates runtime, so the cache misses are noise on the budget. Expected.

### Parallelism

**Root parallelism strategy** (v1):
- Spawn N threads, each runs (budget / N) simulations on its own private tree
- After all threads finish, merge by summing visit counts at the root
- Pick most-visited move from the merged statistics
- Cost: 1 thread builds a tree of T nodes; N threads build N trees of T/N nodes (worse cache locality per tree, but fully parallel)
- Speedup: ~0.7–0.9× × N (suboptimal because we duplicate work near the root, but linear-ish)

**Why not tree parallelism (virtual loss):** Tree parallelism shares one tree across threads, with locks + virtual loss to prevent thread collisions on the same path. Faster in theory (no duplicated work) but:
- Adds locking complexity
- Adds non-determinism (thread interleaving affects results)
- Hard to reason about correctness
- Defer to v2 if root parallelism doesn't scale to 8 threads cleanly

### Tournament throughput — required infrastructure changes

Per-game cost is **~400 seconds wall time** at 1 s/turn × 200 turns × 2 agents. Run serially, that's 110 hours for a 1000-round pairing — **unworkable for our iteration cadence.** This proposal is *blocked* on three throughput improvements that ship with v1:

#### (a) Concurrent game execution in the tournament runner

The current `TournamentOrchestrator` runs games one at a time. With Apple Silicon's 8 cores and most game time spent waiting on per-turn search budgets, the tournament should run **N games concurrently** where N matches the core count.

- **Implementation:** wrap the per-game loop in `withTaskGroup` with N in-flight tasks; each task gets its own RNG-seeded copy of the agent pair
- **Estimated work:** ~150 LOC in `TournamentOrchestrator.swift` plus seed-management hygiene to keep games reproducible per-seed
- **Speedup:** ~7x on 8-core (slight loss to coordination + memory contention)
- **Scope:** infrastructure, not strictly MCTS. Ships in this proposal because MCTS is the feature that makes it required

#### (b) Batched leaf evaluation in MCTS simulator

A single MCTS simulation calls `valueNetwork.evaluate` once per leaf. If we accumulate **K leaves before evaluating**, we can batch them into one larger sgemm call and amortize the per-call overhead.

- **Implementation:** `MCTSSimulator` queues evaluations in an internal buffer; flushes when full or when no more selections can proceed without their results
- **Estimated work:** ~80 LOC in `MCTSSimulator.swift`; AccelerateGVN already supports batched forward through the encoder pipeline (we'd add a batch-forward overload)
- **Speedup:** ~2× per simulation at K=8 (dominant cost is the network call; batching reduces per-call overhead)
- **Side effect:** changes simulation order slightly; the number of simulations drops slightly because we wait for batches, but the time-to-result improves

#### (c) Reduced default sample size + lower default budget

For day-to-day iteration we don't need 1000 games per pairing — 200 games gives a 95% CI on win rate of ±3.5%, which is plenty to tell whether a change helped. Reserve 1000 games for tagged-release benchmarks.

The default per-turn budget drops from 1 s (proposal-original) to **100 ms** for tournament play. At 100 ms:
- Simulations per turn ≈ 480 (single-thread, no batching)
- Simulations per turn ≈ 960 (with batched eval)
- Simulations per turn ≈ ~7,000 effective (with root parallelism × batching at 8 cores per agent — but most cores go to concurrent games instead)

### Combined throughput today (sim-count primary, ~100µs/sim with batched eval)

Wall-time numbers are projections based on current hardware; sim counts are the real spec.

| Profile | Sims/decision | Wall today | 200 games × 8 concurrent | 1000 games × 8 concurrent | Use case |
|---|---|---|---|---|---|
| `smoke` | 50 | ~5 ms/decision | ~3 min/pairing | ~17 min/pairing | CI / smoke tests |
| `default` | 1000 | ~100 ms/decision | **~17 min/pairing** | **~1.4 hr/pairing** | day-to-day iteration |
| `benchmark` | 5000 | ~500 ms/decision | ~1.4 hr/pairing | ~7 hr/pairing | tagged-release benchmark |

For a 4-agent tournament (6 pairings):
- `default` × 200 games × 8 concurrent: **~1.7 hours**
- `default` × 1000 games × 8 concurrent: ~8.5 hours
- `benchmark` × 1000 games × 8 concurrent: ~42 hours (run when tagging a release; not for iteration)

**On future hardware:** if a 2030 Mac runs sims 4x faster, the *default* tournament drops from 1.7 hr to ~25 min — without changing the sim count. The algorithm produces the same moves; we just get answers faster. This is the property the user asked us to design for.

**If concurrent execution doesn't ship (worst case):** `default × 200 games` becomes 200 games × ~40 sec/game serial = ~2.2 hours per pairing. Worse than the 17 min concurrent target, but still iteration-tractable. Concurrent execution remains a v1 deliverable for tournament throughput, but sim-count-primary buys us a graceful-degradation story the time-based design didn't have.

### What we are NOT optimizing in v1

- Tree-parallel search with virtual loss (v2)
- Subtree reuse across turns (open question; possibly v1.1)
- Arena allocator for nodes (v2 if cache misses dominate)
- Multi-game value-network batching across concurrent games — when 8 games are running, we could batch all their leaf evaluations into one sgemm. Significant additional speedup but couples the games' search trajectories. Defer to v2 unless v1 throughput is still tight.
- Mixed precision (f16) for the value network during search — irrelevant; the network is already fast

### What we are NOT optimizing in v1

- Tree-parallel search with virtual loss (v2)
- Subtree reuse across turns (open question; possibly v1.1)
- Arena allocator for nodes (v2 if cache misses dominate)
- Value-network batching across multiple leaves per simulation step (v2; possible 2× speedup at the cost of complexity)
- Mixed precision (f16) for the value network during search — irrelevant; the network is already fast

---

## Approval

- [ ] Reviewed by author
- [ ] Architecture sign-off
- [ ] Open questions resolved or deferred
- [ ] Ready to move to UPCOMING/ and begin TDD

**Approver:** _pending_
**Date approved:** _pending_

---

**End of proposal.**
