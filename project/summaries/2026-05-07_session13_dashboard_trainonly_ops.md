# Session Summary: Training Dashboard + TRAIN_ONLY Mode + Ops Infrastructure

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-05-07/08 | Phase 2 (AI) | COMPLETED |

## 1. Core Objective

Make the AlphaConquer training pipeline observable and operationally flexible. Add live monitoring, decouple game generation from training, and establish the design direction for user-facing AI learning.

## 2. Design Decisions

- **Decision:** Add `TRAIN_ONLY=1` environment variable to skip game generation and train on existing game files.
- **Rationale:** The MCTS self-play loop generates games at ~1.1 games/min (11+ hours for 1000 games). Being able to train on partial results without waiting for full generation enables faster iteration and lets users generate games on one machine and train on another.

- **Decision:** Write structured `status.json` telemetry from the pipeline, read by a separate dashboard process.
- **Rationale:** Decouples monitoring from execution. The status file can be read by the TUI dashboard, a web dashboard, or any other tooling. Atomic writes prevent corruption from concurrent reads.

- **Decision:** Build the dashboard TUI as a separate executable target using SwiftCLIKit.
- **Rationale:** SwiftCLIKit (sibling repo) already has all the terminal primitives — cursor control, ANSI colors, box drawing, screen buffer, alternate screen. No need to pull in a third-party TUI framework.

- **Decision:** Use `onEpoch` callback (already in AccelerateGVNTrainer API) for real-time training progress.
- **Rationale:** The trainer already supports `EpochHook = (Int, Float, AccelerateGVN) -> Void`. No API changes needed — just pass the closure.

- **Decision:** Bump IconquerAI package minimum from macOS 14 to macOS 15.
- **Rationale:** SwiftCLIKit requires macOS 15. IconquerApp already targets macOS 26, so no downstream breakage.

- **Decision:** User-facing AI training should be opt-in ("Train from your gameplay"), not automatic.
- **Rationale:** Respectful UX — save games silently, but only train when the user asks. Training runs on efficiency cores during idle time.

## 3. Work Completed

### IconquerAI — TRAIN_ONLY Mode

**Modified files:**
- `Sources/iconquer-train/SelfPlayPipeline.swift` — Added `trainOnly` flag to `PipelineConfig`, `TRAIN_ONLY` env var parsing, conditional game generation skip

**Usage:**
```bash
TRAIN_ONLY=1 ITERATIONS=2 EPOCHS=50 OUTPUT=training_output_full swift run -c release iconquer-train
```

### IconquerAI — Pipeline Telemetry (status.json)

**New files:**
- `Sources/iconquer-train/PipelineStatus.swift` — `PipelineStatus` Codable model + `StatusWriter` thread-safe writer

**Integration points in SelfPlayPipeline.swift:**
- Iteration start: phase, counters reset
- Game completion: gamesCompleted, gamesPerMinute, gamesEtaMinutes
- Encoding phase: phase transition
- Training: `onEpoch` callback updates trainingEpoch, tdError, errorHistory
- Iteration end: IterationSummary recorded, disk usage computed
- Pipeline end: phase set to `.complete`

### IconquerAI — Training Dashboard TUI

**New files:**
- `Sources/iconquer-dashboard/Dashboard.swift` — Full `top`-style TUI executable

**Package changes:**
- `Package.swift` — Added SwiftCLIKit dependency, `iconquer-dashboard` executable target, macOS 15 minimum

**Dashboard features:**
- Alternate screen buffer (clean terminal restore on exit)
- Phase indicator (color-coded: green=generating, yellow=training, cyan=encoding)
- Games progress bar with rate and ETA
- Training progress bar with TD error
- TD error sparkline (Unicode block characters)
- Iteration history table (last 5)
- Recent events log (last 5 with timestamps)
- 1-second refresh, graceful Ctrl+C handling
- Resilient to missing/corrupt status files

**Usage:**
```bash
swift run -c release iconquer-dashboard -- training_output_full/status.json
```

## 4. Quality Gate

| Check | Status |
| :--- | :--- |
| **iconquer-train build** | ✅ (release, clean) |
| **iconquer-dashboard build** | ✅ (release, clean) |
| **TRAIN_ONLY smoke test** | ✅ (loaded 1000 iter0 games, trained successfully) |
| **status.json written** | ✅ (live updates during training) |
| **Dashboard renders** | ✅ (alternate screen, progress bars, sparkline) |

## 5. Commits

| Repo | SHA | Description |
|------|-----|-------------|
| IconquerAI | pending | TRAIN_ONLY mode, status.json telemetry, dashboard TUI |

## 6. Training Run Status

**Original run (PID 1266, started 2026-05-07 20:59):**
- Iteration 0: 1000 heuristic games, trained to TD=0.00253, weights saved
- Iteration 1: ~707/1000 MCTS self-play games generated (ongoing, ~1.1 games/min)
- ETA for 1000 games: ~4.5 hours from session end

**TRAIN_ONLY run (started 2026-05-08 ~07:30):**
- Training on existing iter0 (1000 games) and iter1 (~707 games) data
- Running concurrently with game generation

## 7. Next Session Handover

### Immediate Starting Point

1. Check training results: compare GVN weights from TRAIN_ONLY run vs original pipeline run
2. Run a validation tournament: trained GVN+MCTS vs heuristic agents (500 games)
3. If performance improved, bundle best weights into IconquerApp

### Pending Tasks

- [ ] Bundle trained weights into IconquerApp as a resource for the `learned` strategy
- [ ] Add weight-loading path to the `makeAgent` factory (currently creates random-init GVN)
- [ ] Run the app and playtest "Watch AI" spectator mode
- [ ] Playtest human-vs-learned-AI game
- [ ] Implement user-facing "Train from your gameplay" opt-in feature
- [ ] Long-term: K-Means clustering of user playstyles for AI personality archetypes
- [ ] Phase 3C: watchOS async turn-based play
- [ ] Phase 3D: Widgets, audio, haptics, accessibility

### Design Direction Captured

User-facing AI training vision: games saved silently, training opt-in, efficiency core scheduling. Long-term commercial vision: aggregate user games, cluster by playstyle (K-Means), generate distinct AI personality archetypes learned from real player behavior. No existing board game has shipped this.

---

**Session Duration:** ~3 hours
**AI Model Used:** Claude Opus 4.6
