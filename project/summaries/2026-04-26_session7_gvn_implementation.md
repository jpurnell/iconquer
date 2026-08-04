# Session Summary: Graph Value Network Implementation

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-26 | T5 Architecture Overhaul (GVN) | PARTIAL — code complete, training not yet validated |

## 1. Core Objective

Replace the T5 flat MLP (which collapsed to 19% win rate with more data) with a research-backed Graph Value Network trained via TD(λ). Based on academic Risk AI literature (Carr 2020, GG-Net 2023, TD-Gammon).

## 2. What Worked

### Research & Design
- Diagnosed exactly why the flat MLP failed (noisy labels, lost spatial info, train-use mismatch)
- Surveyed academic Risk AI literature and found proven approaches
- Wrote comprehensive design proposal with user decisions incorporated
- Variable player count (2-6), 3 GCN layers, MCTS+policy head roadmap for v2

### Implementation (Phase 1-3 complete, all compile clean)
- **6 new source files** (60KB total):
  - `GCNLayer.swift` — Graph convolution with adjacency normalization
  - `GraphEncoder.swift` — Per-territory node features on the map graph
  - `GlobalEncoder.swift` — Global game state features
  - `GraphValueNetwork.swift` — Dual-pathway GCN + FC network
  - `TDTrainer.swift` — TD(λ) training loop
  - `GraphLearnedAgent.swift` — Game-playing agent with 1-ply GVN search

- **6 new test files** (~72 tests):
  - GCNLayerTests (6), GraphEncoderTests (19), GlobalEncoderTests (19)
  - GraphValueNetworkTests (8), TDTrainerTests (12), GraphLearnedAgentTests (8)

- **Tournament integration:**
  - `graph-learned` registered in TournamentAgentFactory
  - `--architecture graph` flag added to `train` CLI command
  - `--td-lambda` and `--players` flags added

### Document housekeeping
- Master plan updated (Phase 1-2 marked complete, Phase 3-4 roadmap)
- 12 completed proposals archived to PROPOSALS/COMPLETED/
- Journey narrative written (how we got from 19% to GNN research)

## 3. What Didn't Work

### Training pipeline hit GPU memory limits
Three attempts to train on the overnight 100k transcripts all crashed with `[metal::malloc] Resource limit exceeded`:

1. **Attempt 1:** Loaded all 100k games as MLXArrays at once (~35GB). Instant OOM.
2. **Attempt 2:** Batched at 4,000 games. Still OOM — the gradient tape (computational graph for backprop) through thousands of forward passes exhausted Metal resources.
3. **Attempt 3:** Batched at 10 games, 20 states/game. OOM again — the replay was still happening inside the epoch loop, re-encoding every epoch.

### Root cause
The `valueAndGrad` closure in MLX builds a computational graph that tracks every operation for backpropagation. With even 10 games × 20 states × 6 network layers, that graph has ~1,200 forward pass nodes. MLX's Metal allocator runs out of resources tracking all the intermediate tensors needed for gradient computation.

### Fix in progress (not yet validated)
Rewrote TDTrainer as a two-phase approach:
- **Phase 1 (once):** Replay all games, store encoded states as plain `[Float]` arrays in CPU memory (no MLXArrays held)
- **Phase 2 (per epoch):** Convert small batches (10 games) to MLXArrays, forward/backward, release

This is running now (PID 30530) but hasn't been validated yet.

## 4. Self-Play Pipeline (from earlier in session)
- v3 completed: Elo 1405 (up from 1351 in v2, still 4th)
- v4 was training when we shifted focus to GVN
- Pipeline at `/tmp/t5-self-play/` may have stale state

## 5. Next Session Handover

### Immediate Starting Point

1. **Check if GVN training succeeded:** `cat /tmp/graph-train-v3.log`
   - If Phase 1 completed: look for "Phase 1 complete: X games"
   - If Phase 2 completed: look for "Epoch 100/100: TD error = X"
   - If crashed: the `valueAndGrad` computational graph is still too large

2. **If training crashed again**, the fix is to stop computing TD targets inside the gradient closure. Instead:
   - Forward pass all states (with `eval()` to materialize)
   - Compute TD(λ) targets as plain Float math (no gradient)
   - Then do a SECOND forward pass inside `valueAndGrad` and compute MSE loss against the pre-computed targets
   - This separates "target computation" from "gradient computation" so the grad tape only covers one forward pass per state, not the full game sequence

3. **If training succeeded:** Run the tournament and compare graph-learned vs the other agents

### Key Files
- GVN source: `IconquerAI/Sources/IconquerAI/Learned/G*.swift`, `TDTrainer.swift`
- GVN tests: `IconquerAI/Tests/IconquerAITests/G*Tests.swift`, `TDTrainerTests.swift`
- Design proposal: `project/plans/proposals/IconquerAI_GraphValueNetwork.md`
- Journey narrative: `project/summaries/2026-04-26_t5_research_journey.md`
- Tournament binary: `IconquerTournament/.xcodebuild/Build/Products/Release/iconquer-tournament`
- Training log: `/tmp/graph-train-v3.log`

### Blockers
- **MLX Metal memory management** is the blocker. The gradient tape for TD(λ) training across game sequences is too large. The two-phase fix may work but needs validation. If it doesn't, the target-precomputation approach described above is the next step.

### Context Warnings
- The `replayAndEncode` private method from the original TDTrainer is now unused dead code — the replay logic was inlined into the `train` method. Clean up if the two-phase approach is validated.
- PID 30530 may still be running. Check before starting new training.
- The old self-play pipeline script at `scripts/self-play-loop.sh` trains the OLD MLP architecture, not the GVN. It needs updating once GVN training works.

---

**Session Duration:** ~12 hours
**AI Model Used:** Claude Opus 4.6 (1M context)
**New Source Files:** 6 (60KB)
**New Test Files:** 6 (~72 tests)
**Training Runs Attempted:** 3 (all crashed on Metal memory)
**Training Runs Succeeded:** 0
