# Session Summary: Self-Play Training Pipeline + AI Spectator Mode

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-05-06/07 | Phase 2 (AI) + Phase 3B (App) | COMPLETED |

## 1. Core Objective

Close the loop between AI training and the live app. Build the self-play training pipeline that generates games, trains the GVN value network, and iterates — then wire trained agents into the SwiftUI app so users can play against them or watch 6 AIs battle each other.

## 2. Design Decisions

- **Decision:** Use `MapRegistry.resolve("world")` for the training executable instead of duplicating the map data.
- **Rationale:** IconquerCore already has a built-in "world" map bundle with all 42 territories and adjacencies. Avoids data duplication and drift.

- **Decision:** Remove MLX dependency from `AccelerateGVNTrainer` entirely.
- **Rationale:** The trainer only used MLX to convert `GraphEncoder.normalizedAdjacency` (an `MLXArray`) to `[Float]`. But `GraphEncoder` already stores `adjacencyAsFloats: [Float]` — the MLX round-trip was unnecessary and caused Metal initialization crashes in headless environments.

- **Decision:** Fix N-player reward assignment in the trainer (was hardcoded for 2-player games).
- **Rationale:** The pipeline generates 6-player games. The trainer's `winnerSeat` lookup only checked `agent1`/`agent2`, causing all 6-player games to be silently skipped (0 transitions trained). Added fallback parsing for `P1`-`P6` naming convention.

- **Decision:** Wire `PlayerAgent` protocol directly into GameViewModel's game loop rather than using `MatchRunner`.
- **Rationale:** The app's game loop is already well-structured with human/AI branching. Adding full `MatchRunner` would require rearchitecting the human input flow. Simpler to call `agent.requestMove()` directly for AI turns.

## 3. Work Completed

### IconquerAI — Self-Play Training Pipeline

**New files:**
- `Sources/iconquer-train/SelfPlayPipeline.swift` — `@main` executable with full AlphaConquer training loop

**Modified files:**
- `Package.swift` — Added `iconquer-train` executable target
- `AccelerateGVNTrainer.swift` — Removed MLX import, use `adjacencyAsFloats` directly, fix N-player reward mapping

**Pipeline architecture:**
```
Iteration 0 (bootstrap):
  Greedy/Strategic/Random agents → 1000 games → TD(λ) training → weights checkpoint

Iteration 1+ (self-play):
  MCTS + trained GVN → 1000 games → TD(λ) training → weights checkpoint
```

**Configuration via environment variables:** `GAMES`, `ITERATIONS`, `EPOCHS`, `SIMS`, `PLAYERS`, `OUTPUT`

**Smoke test results (4 games, 5 epochs):**
- 4 games → 2000 state transitions
- TD error: 0.0068 → 0.0052 in 5 epochs
- Weights saved successfully (88KB)

**Full training run (1000 games, iteration 0):**
- 1000 games generated in ~2 seconds (heuristic agents)
- 200,000 state transitions encoded
- Early-stopped at epoch 15/50 (TD error converged at 0.0026)
- ~8 seconds/epoch in release mode
- Iteration 1 (MCTS self-play, 100 sims) launched and running overnight

### IconquerApp — AI Agents + Spectator Mode

**Modified files:**
- `Package.swift` — Added IconquerAI, IconquerMatch, IconquerClient dependencies
- `PlayerConfig.swift` — Added `.learned` case to `AIStrategy` enum
- `GameViewModel.swift` — Replaced random-move AI with proper `PlayerAgent` agents; added agent factory
- `SetupView.swift` — Added "Watch AI" button, `onWatchAI` callback, spectator player configuration
- `ContentView.swift` — Wired `onWatchAI` callback, added multiplayer navigation
- `MultiplayerViewModel.swift` — Rewired to use `RemoteGameSession` actor
- `ConnectionLinesView.swift` — Closest border-point connections instead of centroids
- `LobbyView.swift` — Default server URL

**Agent factory maps `AIStrategy` to `PlayerAgent`:**
| Strategy | Agent | Notes |
|----------|-------|-------|
| `.random` | `RandomAgent` | Uniform random legal moves |
| `.greedy` | `GreedyAgent` | Attack weakest neighbors |
| `.strategic` | `StrategicAgent` | Evolved heuristic, continent-focused |
| `.learned` | `MCTSAgent<AccelerateValueNetwork>` | 100 sims, MCTS + GVN value network |

**Spectator mode:** "Watch AI" button launches 6 AI players (2x Strategic, 2x Greedy, 2x Learned) with 50ms delay between moves for visual rendering.

### IconquerClient — Server Messages Stream

- `RemoteGameSession.swift` — Added `serverMessages: AsyncStream<ServerMessage>` for UI-layer dispatch

## 4. Quality Gate

| Check | Status |
| :--- | :--- |
| **IconquerAI build** | ✅ (release mode, 116s) |
| **IconquerApp build** | ✅ (clean build, 56s) |
| **IconquerAI tests** | ⚠️ MLX Metal crash in CI (pre-existing, not introduced) |
| **Pipeline smoke test** | ✅ (end-to-end: generate → encode → train → save) |

## 5. Commits

| Repo | SHA | Description |
|------|-----|-------------|
| IconquerAI | `01d9edf` | Self-play training pipeline + trainer fixes (36 files) |
| IconquerApp | `41c4eb2` | AI agents, spectator mode, multiplayer wiring (10 files) |
| IconquerClient | `071e1d3` | serverMessages AsyncStream |

## 6. Next Session Handover

### Immediate Starting Point

Check training results:
1. Look at `training_output_full/` for saved weights from all 3 iterations
2. Run a validation tournament: trained GVN+MCTS vs heuristic agents (500 games)
3. If performance improved, bundle the best weights into the app for the `learned` strategy

### Pending Tasks

- [ ] Bundle trained weights into IconquerApp as a resource for the `learned` strategy
- [ ] Add weight-loading path to the `makeAgent` factory (currently creates random-init GVN)
- [ ] Run the app and playtest "Watch AI" spectator mode
- [ ] Playtest human-vs-learned-AI game
- [ ] Phase 3C: watchOS async turn-based play
- [ ] Phase 3D: Widgets, audio, haptics, accessibility

### Context Loss Warning

- The `learned` strategy currently creates a **randomly-initialized** GVN with MCTS. It will play with some structure (MCTS explores the tree) but won't be strong until trained weights are bundled.
- A full training run is in progress (PID 82536). Iteration 0 complete, iteration 1 MCTS self-play generating games. Check `training_output_full/` for results.
- MLX-based tests in IconquerAI crash due to Metal not being available in CLI environments. This is pre-existing and does not affect the Accelerate-based training pipeline.

---

**Session Duration:** ~4 hours
**AI Model Used:** Claude Opus 4.6
