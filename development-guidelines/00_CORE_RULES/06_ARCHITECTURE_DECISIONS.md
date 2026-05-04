# Architecture Decisions Log

**Purpose:** Machine-readable log of architectural decisions. Each entry is a YAML block.

> **When to add entries:**
> - Choosing between competing approaches (actor vs struct, sync vs async)
> - Establishing conventions (error handling, naming, file structure)
> - Making tradeoffs (performance vs safety, simplicity vs flexibility)
> - Rejecting a previously considered approach

---

## How to Use

1. **Add new entries** at the bottom of this file using the YAML template below
2. **Increment the ID** sequentially (ADR-001, ADR-002, etc.)
3. **Query entries** by category, status, or keyword
4. **Supersede** old entries by updating `superseded_by` and creating a new entry

### Querying Examples

```
"Check the architecture decisions log for any decisions about concurrency
(category: concurrency). Summarize what was decided and why."
```

```
"Find ADR-001 and tell me what alternatives were rejected."
```

---

## Entry Template

Copy this template for each new decision:

```yaml
id: ADR-NNN
date: YYYY-MM-DD
status: proposed  # proposed | accepted | superseded | amended | deprecated
category: [category]  # concurrency | storage | api | testing | performance | architecture
title: [Brief title]
context: |
  [Describe the specific problem, constraints, and why a decision is needed.]
decision: |
  [Detail the chosen architectural approach or convention.]
rationale: |
  - [Reason 1]
  - [Reason 2]
consequences: |
  [Document the positive and negative impacts on the codebase,
   performance, or workflow.]
alternatives_rejected:
  - "[Alternative]: [Why rejected]"
affected_files:
  - [file path]
supersedes: null  # ADR-NNN if this completely replaces an earlier decision
amends: null  # ADR-NNN if this refines/extends an existing decision
superseded_by: null  # ADR-NNN if this was later replaced
```

### Lifecycle Management

- **`supersedes`**: Use when a new decision completely replaces an older one. Update the original entry's `status` to `superseded` and set its `superseded_by` field.
- **`amends`**: Use when a new decision refines or adds constraints to an existing one without replacing it. Update the original entry's `status` to `amended`.
- **When updating**: Always go back to the original entry and update its `status` field to reflect that it is no longer the sole authority.

---

## Decisions

*Add entries below as architectural decisions are made.*

```yaml
id: ADR-001
date: 2026-04-26
status: proposed
category: architecture
title: Tree search is the path to competitive learned agents
context: |
  Three learned-agent attempts in IconquerAI have all topped out around
  Elo 1330–1410, all losing to the heuristic agents Greedy (Elo 1651) and
  Strategic (Elo 1517):
    - T5 MLP (LearnedPolicyAgent): peaked ~1390
    - MLX GraphValueNetwork (graph-learned): peaked ~1405
    - Accelerate GraphValueNetwork (accelerate-learned): 1332 v1
  The diagnostic pattern is consistent across all three: a value head
  combined with greedy 1-ply argmax cannot recover lookahead, and the
  value network is being trained on transcripts where heuristic agents
  won — so the network's notion of "good position" mirrors what those
  heuristics already optimize for. We are at a structural ceiling, not a
  bug. This is well-documented in the broader game-AI literature
  (TD-Gammon needed rollouts; AlphaZero needed MCTS; GG-Net for Risk
  specifically uses MCTS + neural priors).
decision: |
  From now on, the path to *competitive* learned agents in IconquerAI is
  search-augmented. Pure value-network-only agents remain available for
  benchmarking and as backbones for search agents, but the "competitive"
  tier — agents intended to beat the heuristic baselines — must use
  Monte Carlo Tree Search or equivalent multi-ply lookahead.
  See proposal: 02_IMPLEMENTATION_PLANS/PROPOSALS/IconquerAI_MCTS.md
rationale: |
  - The Elo gap to Greedy (~300 points) is too wide to close with network
    quality alone at our current model size. A 64-hidden GCN at 1-ply
    cannot encode multi-turn strategic reasoning that a 5–10 ply search
    can express directly.
  - MCTS reuses our existing AccelerateGVN with no model changes for v1
    — the network we already trained becomes the leaf evaluator.
  - The self-play loop infrastructure already in place becomes more
    valuable: MCTS-vs-MCTS games produce better training data than
    heuristic-vs-heuristic games, addressing the data-bias root cause.
  - Per-turn inference cost rises from microseconds to 100 ms (tournament)
    or 1 second (benchmark), but parallel game execution in the tournament
    runner keeps wall-clock iteration time bounded.
consequences: |
  + Unblocks the project's stated goal of beating Greedy in head-to-head
  + Reuses all existing value-network work — no model retraining for v1
  + Provides the substrate for AlphaZero-style policy+value training (v2)
  + Forces the tournament runner to support concurrent game execution,
    which is a general infrastructure improvement
  - Per-turn inference cost rises from µs to 100 ms (tournament) / 1 s
    (benchmark)
  - ~1100 LOC of new search code; tree-search bugs are subtle and have no
    finite-diff equivalent test (we lean on golden numbers + game-result
    benchmarks)
  - Tournament defaults must change: 1000 games × 1 s × 8 concurrent =
    14 hr per pairing; default for iteration drops to 200 games × 100 ms
    × 8 concurrent ≈ 17 min per pairing
alternatives_rejected:
  - "Larger value network: would help marginally but the 1-ply ceiling is structural"
  - "Better TD reward shaping: shifts value calibration but doesn't add lookahead"
  - "Pure heuristic improvement: already evolved Strategic via 300k-game search; further gains sublinear"
  - "Tree-parallel MCTS with virtual loss: more efficient at high thread counts but adds non-determinism and locking complexity; root parallelism is sufficient for v1"
affected_files:
  - IconquerAI/Sources/IconquerAI/Search/*
  - IconquerAI/Sources/IconquerAI/Learned/Accelerate/AccelerateValueNetwork.swift
  - IconquerTournament/Sources/IconquerTournament/Orchestrator/TournamentOrchestrator.swift
  - IconquerTournament/Sources/IconquerTournament/Orchestrator/TournamentAgentFactory.swift
  - IconquerTournament/Sources/iconquer-tournament/TournamentCommand.swift
  - IconquerTournament/scripts/accelerate-self-play-loop.sh
supersedes: null
amends: null
superseded_by: null
```

<!-- Example entry (remove or replace with your first real decision):

```yaml
id: ADR-001
date: 2024-01-15
status: accepted
category: api
title: Return NaN for mathematically undefined, throw for invalid input
context: |
  Need a consistent error-handling strategy across all numeric functions.
  Some operations are mathematically undefined (log(-1)) while others
  receive programmatically invalid input (empty array).
decision: |
  Functions return .nan when result is mathematically undefined.
  Functions throw errors when input is programmatically invalid.
rationale: |
  - NaN propagates through calculations (IEEE 754 standard)
  - Errors force callers to handle bad input at boundaries
  - Matches behavior of standard numeric libraries
consequences: |
  + Callers get IEEE 754-compliant behavior for math functions
  + Invalid input is caught early at API boundaries
  - Callers must check for NaN in downstream results
alternatives_rejected:
  - "Return nil: Forces optional chaining everywhere, clutters call sites"
  - "Always throw: Breaks IEEE 754 conventions for math functions"
affected_files:
  - Sources/[PROJECT_NAME]/*.swift
supersedes: null
amends: null
superseded_by: null
```

-->

---

**Last Updated:** 2026-04-26
