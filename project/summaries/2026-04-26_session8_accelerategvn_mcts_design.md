# Session Summary: AccelerateGVN trainer + agent + MCTS design

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-26 | Phase 2 — AI infrastructure overhaul | COMPLETED (AccelerateGVN shipped, MCTS designed) |

## 1. Core Objective

Replace the MLX-based Graph Value Network trainer (which projected at ~28 hours per 100-epoch run) with an Accelerate/cblas/vDSP-backed implementation that hits the same algorithmic target in under an hour. Then design the next architectural step — Monte Carlo Tree Search — so the project has a credible path to beating the heuristic agents.

**Master Plan reference:** Phase 2 — AI + Tournament infrastructure. The 28-hour MLX bottleneck blocked the self-play loop and made iteration impractical. The accumulated diagnosis from session 7 said the solution was either better MLX usage or a different backend; this session committed to Accelerate.

## 2. Design Decisions

- **Decision: Replace MLX trainer with hand-rolled Accelerate (cblas + vDSP) — proposal `IconquerAI_AccelerateGVN.md`.** Drop softmax (TD targets are scalar values, not probabilities). Side-by-side with MLX initially, with `--architecture accelerate` flag. Hand-rolled forward + backward + Adam, parallelized via `DispatchQueue.concurrentPerform` across the gradient batch.
  - **Rationale:** at our network size (42-node graph, 64-hidden GCN, ≤64-game gradient batch), MLX dispatch overhead per matmul dwarfs the actual work. Per-element GPU→CPU sync barriers in the TD(λ) target step compounded the cost. CPU + Accelerate sidesteps both, and the entire working set fits in L2 cache.
  - **Alternatives rejected:** larger MLX batch sizes (still OOM-prone); PyTorch via Python bridge (adds runtime + IPC); custom Metal kernels (overkill at this scale).

- **Decision: Statistical early-stop via slope-significance test.** Replaced the heuristic "1% improvement over 10 epochs" threshold with a linear-regression slope test on the recent loss trajectory. Stop when we fail to reject H₀: slope ≥ 0 at α = 0.05.
  - **Rationale:** user feedback explicitly asked for the early-stop threshold to be *statistically valid*, not just heuristic. Cornish-Fisher t-critical approximation; tests verify against standard t-table values within 2.5%.
  - **Alternative rejected:** fixed relative threshold (heuristic, doesn't account for noise variance).

- **Decision: Periodic checkpointing with a callback hook.** Trainer takes an `onEpoch: (Int, Float, AccelerateGVN) -> Void` callback; CLI saves `.partial.agvn` every N epochs.
  - **Rationale:** kill-mid-training without losing work; necessary for long runs and for the "use the partial we have in place" policy when convergence flattens.

- **Decision: ADR-001 — Tree search is the path to competitive learned agents.** Committed to `architecture_decisions.md` (the project's first real ADR).
  - **Rationale:** three prior learned agents (T5 MLP, MLX graph, Accelerate graph) all topped out around Elo 1330–1410, all losing to Greedy (1651) and Strategic (1517). The 1-ply argmax ceiling is structural, not a bug. AlphaZero-style MCTS adds 200–400 Elo at the same network quality.
  - **Alternatives rejected:** larger network (1-ply ceiling is structural); better TD reward shaping (doesn't add lookahead); pure heuristic improvement (already evolved Strategic via 300k-game search; sublinear gains).

- **Decision: MCTS budget is simulation count, not wall time.** User pushback: "we should focus on optimal solutions, not bind algorithms to today's hardware." Default = 1000 sims/decision; wall time is a secondary safety cap.
  - **Rationale:** algorithmic depth is hardware-independent; "1000 sims at α=0.05 beat Greedy 62%" is a claim that ages well across chip generations.
  - **Alternative rejected:** time-budget primary (binds the design to 2026 hardware; needs re-tuning every chip generation).

## 3. Work Completed

### Design Proposals (Phase 0)
- [x] `IconquerAI_AccelerateGVN.md` — written, reviewed in 3 design passes, **shipped end-to-end this session**
- [x] `IconquerAI_MCTS.md` — written, full walkthrough with user, all 6 open questions resolved, moved to `project/plans/upcoming/2026-04-26_IconquerAI_MCTS.md`

### Architecture Decisions
- [x] **ADR-001 committed** to `architecture_decisions.md` in proper YAML format. First real ADR in the file.

### Tests Written (RED + GREEN, AccelerateGVN)
- [x] `AccelerateGVNTests.swift` — 4 tests:
  - `forwardOutputShapeMatchesPlayerCount` (golden path)
  - `forwardIsDeterministicForFixedSeed` (determinism)
  - `backwardMatchesFiniteDifference` — **the load-bearing correctness test**, validates every parameter's analytic gradient against finite-difference within 5e-2 relative error
  - `adamCanFitASingleStateToTarget` (convergence smoke test, 200 steps)
- [x] `AccelerateGVNTrainerStatTests.swift` — 6 tests for the slope-significance early-stop helpers:
  - `perfectlyDecreasingLossHasNegativeSlopeAndLargeT`
  - `flatLossHasZeroSlopeAndZeroT`
  - `noisyDecreasingLossHasModerateNegativeT`
  - `pureNoiseHasInsignificantSlope`
  - `tCriticalMatchesKnownTableValues` (within 2.5% of standard t-tables for dof 8/10/15/20/30)
  - `tCriticalAtAlpha01IsLargerThanAt05`

All 10 tests passing. Deterministic seeds: 1, 7, 13, 17, 21, 23, 42, 99, 100, 200.

### Implementation (GREEN, AccelerateGVN)
**Files created:**
- `IconquerAI/Sources/IconquerAI/Learned/Accelerate/AccelerateGVN.swift` — forward + backward + Adam, ~900 LOC. cblas_sgemm/sgemv/sger for matmul, vDSP_vthres/vadd/vsma/vsq/vsqrt/vdiv for elementwise. Drops softmax. SplitMix64 for deterministic Glorot init.
- `IconquerAI/Sources/IconquerAI/Learned/Accelerate/AccelerateGVNTrainer.swift` — Phase 1 parallel encode (concurrentPerform), Phase 2 per-game forward+backward parallelized across gradient batch with thread-local gradient accumulators, additive vDSP_vadd reduction. Statistical early-stop. Per-epoch callback hook for checkpointing.
- `IconquerAI/Sources/IconquerAI/Learned/Accelerate/AccelerateGVNWeights.swift` — own binary format ("AGVN" magic + version + hyperparams + tensor blocks). save/load roundtrip.
- `IconquerAI/Sources/IconquerAI/Learned/Accelerate/AccelerateGraphLearnedAgent.swift` — `PlayerAgent` conformance using AccelerateGVN; near-copy of MLX `GraphLearnedAgent` with the network swap; pure-Swift adjacency builder so inference doesn't pull MLX.
- `IconquerTournament/scripts/accelerate-self-play-loop.sh` — train ↔ tournament loop with env-tunable defaults.

**Files modified:**
- `IconquerAI/Sources/IconquerAI/Learned/GraphEncoder.swift` — added `encodeNodesAsFloats(state:)` to skip MLXArray round-trip during Phase 1.
- `IconquerAI/Sources/IconquerAI/Learned/GlobalEncoder.swift` — added `encodeAsFloats(state:)`. Added precomputed `neighborsByCountry` dict for O(1) `neighborsOf` lookup (was O(N) linear scan that dominated Phase 1 hot path in the MLX trainer too).
- `IconquerTournament/Sources/iconquer-tournament/TournamentCommand.swift` — `--architecture accelerate` branch; `--batch-size`, `--threads`, `--max-states-per-game`, `--checkpoint-every`, `--early-stop-alpha`, `--early-stop-window` flags. Final-write-always semantics: in-memory model is saved as canonical weights regardless of how training ended.
- `IconquerTournament/Sources/IconquerTournament/Orchestrator/TournamentAgentFactory.swift` — `accelerate-learned` registered, loads `~/.iconquer/models/accelerate_gvn_p2.agvn`, falls back to untrained network if missing.

### End-to-end results

| Run | Phase 1 | Phase 2 | Result |
|---|---|---|---|
| MLX path (session 7) | 24 min | OOM crashed in Phase 2 | no weights |
| Accelerate v1 (this session, all-states) | 5 min | swap-thrashed at 40 GB | killed (had to add `--max-states-per-game 20`) |
| Accelerate v2 (this session, --max-states-per-game 20) | **27 sec** | **75 min, 100 epochs** | weights at `~/.iconquer/models/accelerate_gvn_p2.agvn`, final TD error 0.0089 |

500-game validation tournament (greedy / strategic / accelerate-learned, 1v1 each pairing):
- greedy: 1651 Elo (505W/397L/98D)
- strategic: 1517 Elo (527W/391L/82D)
- **accelerate-learned: 1332 Elo (320W/564L/116D)** — last place, but in line with the prior best learned agent (graph-learned 1405). Math is right; data + 1-ply ceiling is the bottleneck.

### Documentation
- [x] DocC comments on every public AccelerateGVN API
- [x] Both proposals include their own narrative-article placeholders (`AccelerateGVNGuide.md`, `MCTSGuide.md`) — to be written when those features ship
- [x] ADR-001 has full context + rationale + alternatives_rejected

## 4. Mandatory Quality Gate

**Not run this session.** Quality-gate scaffolding exists but wasn't invoked at the end. Should be the first action next session.

| Check | Status |
| :--- | :--- |
| **build** | ✅ (manual `swift build` + `xcodebuild` both succeed) |
| **test** | ✅ (10 new tests pass; full suite not re-run) |
| **safety** | ⚠️ not invoked |
| **doc-lint** | ⚠️ not invoked |
| **doc-coverage** | ⚠️ not invoked |

**Action for next session:** run `quality-gate` as the first thing, fix anything that surfaces.

## 5. Project State Updates

- [x] `master_plan.md`: not updated this session (no architectural change to phase plan; the Accelerate work fits inside Phase 2 as an infrastructure improvement)
- [x] No active `CURRENT_*.md` checklist exists — work has been proceeding via proposals + sessions
- [x] AccelerateGVN proposal stays in `PROPOSALS/` (it shipped, but the design doc's still useful as the as-built record; consider moving to a "shipped" archive in a future cleanup)
- [x] MCTS proposal moved to `project/plans/upcoming/2026-04-26_IconquerAI_MCTS.md`

## 6. Next Session Handover (Context Recovery)

### Immediate Starting Point

**The self-play loop is still running.** PID 74063, started in this session, currently mid-iteration 1 of 5 (epoch 60 of 100, ~31 min remaining for v1 training). Each iteration is ~30 min train + ~5 min tournament = ~35 min/iter. Total expected wall time ~3 hours from when it started.

**Check first thing next session:**
```bash
ps -p 74063 -o etime,%cpu 2>/dev/null            # is it still alive?
tail -20 /tmp/agvn-self-play/pipeline.log         # how far did it get?
ls -la /tmp/agvn-self-play/v*/                    # which iterations completed?
cat /tmp/agvn-self-play/SUMMARY.md 2>/dev/null    # final summary if all 5 done
```

If the loop finished, look at the per-iteration Elo trajectory. We should expect each iteration to bump accelerate-learned somewhat as it trains on its own wins (winner-filter includes accelerate-learned).

### Pending Tasks

**Big ticket — implement MCTS** (proposal in `project/plans/upcoming/2026-04-26_IconquerAI_MCTS.md`):
- [ ] Quality gate (run as first thing)
- [ ] Move AccelerateGVN proposal to a "shipped" archive (housekeeping)
- [ ] Cut implementation tasks from the MCTS proposal (it has all 6 open questions resolved + ADR-001 committed). File layout in §2 of the proposal lists the LOC budget per file.
- [ ] First MCTS task to implement: `ValueNetworkBackend` protocol + `AccelerateValueNetwork` wrapper (~120 LOC, no risk)
- [ ] Then PUCT selector with golden tests (math first, follows TDD)
- [ ] Then concurrent-game execution in `TournamentOrchestrator` — this is a *blocking* prerequisite for benchmarking MCTS at any reasonable game count (see §12 of MCTS proposal for the throughput math)

**Smaller items:**
- [ ] Investigate cblas_sgemm_pack for ~1.5–2x speedup on the trainer's matmul step (mentioned in AccelerateGVN proposal §12 "Tier 1 optimizations" — not yet implemented, just designed)
- [ ] The proposal's "batched leaf evaluation" optimization for MCTS (~50 LOC, ~2x speedup; ships with v1 per §12)

### Blockers

- **None for code.** Proposal is approved (all open questions resolved), ADR is committed, design is locked.
- **Loop is consuming all 8 cores.** Don't kick off MCTS perf benchmarking on this machine while the loop runs — they'd contend.

### Context Loss Warning

1. **MCTS budget is simulation count, NOT wall time.** This was an explicit user decision against my initial design (which used time as primary). `MCTSConfig.maxSimulations` is the algorithmic primary; `maxWallTimeSeconds` is a safety cap. Don't "fix" this by reverting to time-based.
2. **AccelerateGVN drops softmax.** TD(λ) targets are scalar values, not probabilities. The output head is raw values per seat. Don't add softmax back unless you have a clear reason.
3. **Statistical early-stop uses slope-significance test, not heuristic threshold.** Replacing with "stop if loss < 0.001" is *worse*, not simpler. The slope test handles noise correctly.
4. **Two binary build paths exist:** `swift build -c release` produces a binary that crashes on MLX-init because metallib isn't compiled; `xcodebuild` produces one that works. The script and any benchmark MUST use the xcodebuild path: `/Users/jpurnell/Dropbox/Computer/Development/Swift/IconquerTournament/.xcodebuild/Build/Products/Release/iconquer-tournament`. Don't switch to swift-build without compiling metallib too.
5. **Accelerate-learned at Elo 1332 is NOT failure**, it's parity with the prior best learned agent (graph-learned 1405). The next ~200 Elo comes from MCTS, the next ~100 from self-play data. See §1 of the MCTS proposal for the staged path.
6. **The user expects design reviews to surface throughput infrastructure** (parallelism, dataset sizing) before declaring complete. Two memories saved this session capture this:
   - `feedback_design_review_quantitative_checks.md`
   - `feedback_design_review_throughput_parallelism.md`
   Read these before the next design proposal.

---

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| AccelerateGVN test count | 0 | 10 |
| End-to-end training time (100 epochs, 100k games) | 28 hr (MLX, projected) | **75 min (Accelerate, measured)** |
| Phase 1 encoding time | 24 min (MLX) | **27 sec (Accelerate, parallel)** |
| Per-state encoder hot-path complexity | O(N) linear scan | O(1) dict lookup |
| ADR count in `architecture_decisions.md` | 0 (template only) | 1 (ADR-001) |
| Source LOC added | 0 | ~1700 (4 new files) |
| Test LOC added | 0 | ~450 (2 new files) |
| Memories saved (feedback type) | — | 2 (design-review patterns) |

---

**Session Duration:** ~8 hours
**AI Model Used:** Claude Opus 4.7 (1M context)
