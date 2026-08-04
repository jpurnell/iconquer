# Session Summary: T5 Self-Play Training Pipeline + Multiplatform App Design

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-25 (continued into 04-26) | AI Training + App Design | COMPLETED |

## 1. Core Objective

Apply the overnight 750k-game tournament results: retrain the T5 learned agent, build a self-play improvement pipeline, and design the multiplatform SwiftUI app architecture for iPhone/iPad/Mac/watchOS.

## 2. Design Decisions

- **Decision:** Train T5 only on games won by strong agents (montecarlo, greedy, strategic), not all games.
- **Rationale:** Training on all 20M examples (v2) caused learned agent to drop from 42% to 19% win rate — it learned the base rate rather than winning patterns. Filtering to winners teaches "what good looks like."
- **Alternatives Considered:** Relative position scoring (pre/post attack), larger model architecture. These remain options for future iterations.

- **Decision:** Self-play loop as a shell script, not integrated into the tournament binary.
- **Rationale:** Simple, restartable, monitorable via `tail -f`. No code changes needed to iterate. macOS notification on completion.

- **Decision:** Multiplatform SwiftUI app uses a shared `IconquerUI` library consumed by platform-specific app targets.
- **Rationale:** Maximizes code sharing. ViewModels, map rendering, and game logic are identical across iPhone/iPad/Mac. Only layout adapters and entry points differ. watchOS gets a thin turn-submission UI backed by the server.

- **Decision:** `--winner-filter` CLI flag added to `train` subcommand rather than baking the filter into `TrainingPipeline`.
- **Rationale:** Keeps the pipeline generic. Different training strategies (all games, winners only, specific agents) are CLI concerns, not library concerns.

## 3. Work Completed

### Overnight Tournament Analysis
- [x] 750k-game tournament completed (montecarlo #1 at Elo 1575, greedy #2, learned #3, strategic #4)
- [x] Strategy guide generated (JSON + Markdown + kid-friendly version)
- [x] Key insight: montecarlo's "simulate before attacking" strategy dominates; greedy's simplicity is surprisingly strong

### T5 Retraining Experiments
- [x] **T5 v2 (all data):** 20.5M training examples, 89.1% validation accuracy — but tournament performance **collapsed** (19% win rate, Elo 1351). Diagnosis: model learned base rate, not decision quality.
- [x] **T5 v3 (winner-filtered):** Trained on games won by montecarlo/greedy/strategic only. Tournament result: Elo 1405, 28% win rate. Improved over v2 but still 4th place.
- [x] Added `--winner-filter` flag to tournament `train` subcommand
- [x] Rebuilt xcodebuild binary with new flag

### Self-Play Pipeline
- [x] `scripts/self-play-loop.sh` — Automated train→tournament→guide→repeat loop
- [x] macOS notification on completion
- [x] Graceful stop via `touch /tmp/t5-self-play/STOP`
- [x] Per-version weight archival (`~/.iconquer/models/position_network_v{N}.safetensors`)
- [x] Pipeline running: v3 complete, v4 in progress

### Multiplatform SwiftUI Design Proposal
- [x] Comprehensive design proposal: `IconquerApp_MultiplatformSwiftUI.md`
- [x] Covers iPhone, iPad, Mac, watchOS with shared `IconquerUI` library
- [x] Two-tap interaction model, Liquid Glass styling, multiplayer lobby
- [x] watchOS: server-backed async turn submission with suggested moves + auto-play
- [x] Four implementation phases: Foundation → Multiplayer → watchOS → Widgets/Polish

### Files Created/Modified
- **Created:** `IconquerTournament/scripts/self-play-loop.sh`
- **Created:** `/tmp/t5-overnight/STRATEGY_GUIDE_FRIENDLY.md`
- **Created:** `development-guidelines/project/plans/proposals/IconquerApp_MultiplatformSwiftUI.md`
- **Modified:** `IconquerTournament/Sources/iconquer-tournament/TournamentCommand.swift` (added `--winner-filter`)
- **Rebuilt:** `IconquerTournament/.xcodebuild/Build/Products/Release/iconquer-tournament`

## 4. Quality Gate

| Check | Status |
| :--- | :--- |
| **build** | ✅ xcodebuild Release build succeeded |
| **test** | ✅ All existing tests pass (tournament binary functional) |
| **safety** | ✅ No force unwraps in new code |
| **self-play** | ✅ Pipeline running autonomously |

## 5. T5 Training Results Summary

| Version | Training Data | Examples | Val Accuracy | Tournament Elo | Win Rate |
|---------|--------------|----------|-------------|----------------|----------|
| v1 | 480 transcripts (51k) | 51,094 | 89.9% | 1,471 | 42% |
| v2 | 100k transcripts (all) | 20,494,009 | 89.1% | 1,351 | 19% |
| v3 | 100k transcripts (winners only) | ~12M est | ~89% | 1,405 | 28% |
| v4 | v3 tournament (winners) | TBD | TBD | TBD | TBD |

**Key finding:** More data doesn't help when the model architecture is too small (12→64→32→1 MLP). The 89% accuracy ceiling across all training sizes suggests the model is capacity-limited. Future improvements need either more features or a larger network.

## 6. Next Session Handover

### Immediate Starting Point

1. **Check v4 results:** `tail -20 /tmp/t5-self-play/pipeline.log` — v4 should be complete
2. **Read the summary:** `cat /tmp/t5-self-play/SUMMARY.md`
3. **Review multiplatform design proposal:** User is reading `IconquerApp_MultiplatformSwiftUI.md` overnight — expect feedback and approval to begin Phase A implementation

### Pending Tasks

- [ ] **visionOS design proposal** — Immersive space with miniature globe. Research complete (MapLayout3D scaffolded, coordinate reprojection pipeline designed). Write the proposal.
- [ ] **Document housekeeping** — Master plan needs updating (Phase 1-2 marked complete, Phase 3 in progress). 12 implemented proposals should move to COMPLETED/. Architecture decisions log is empty.
- [ ] **T5 architecture investigation** — Current MLP is capacity-limited. Consider: more features, wider layers, or switching to transformer-based position evaluation.
- [ ] **Update StrategicConfig.default** with evolved world map config from `/tmp/best-strategic-world.json`

### Blockers

- **None.** Self-play pipeline is autonomous. Design proposals are written. Next session can begin Phase A implementation if the multiplatform proposal is approved.

### Context Loss Warnings

- **Self-play pipeline PID 70776** may still be running (v4 iteration). Check before starting new tournament work.
- **v1 weights are installed as default** (`position_network.safetensors`). The pipeline installs each new version but if it crashed, the default may be stale. Check `ls -la ~/.iconquer/models/`.
- **xcodebuild binary was rebuilt** with `--winner-filter` flag. If `IconquerTournament` source changes, the binary must be rebuilt: `xcodebuild -scheme iconquer-tournament -configuration Release -derivedDataPath .xcodebuild -destination 'platform=macOS' build`
- **`IconquerApp_SwiftUIPort.md`** is superseded by `IconquerApp_MultiplatformSwiftUI.md`. The old proposal was iOS-only with no watchOS or multiplayer UI.

## 7. In-Flight Background Work

### Self-Play Pipeline
- **PID:** 70776
- **Storage:** `/tmp/t5-self-play/`
- **Status:** v3 complete (Elo 1405), v4 in progress
- **Monitor:** `tail -f /tmp/t5-self-play/pipeline.log`
- **Stop:** `touch /tmp/t5-self-play/STOP`

---

**Session Duration:** ~14 hours
**AI Model Used:** Claude Opus 4.6 (1M context)
**Games Simulated:** ~200k (100k v2 tournament + 100k v3 tournament)
**New Tests Written:** 0 (infrastructure/design session)
