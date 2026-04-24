# Session Summary: AI Tier Progression, Tournament Infrastructure, T5 Learned Agent

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-24 (continued from 04-23) | AI Agent Evolution + Tournament | COMPLETED |

## 1. Core Objective

Evolve the AI agent stack from hand-coded heuristics (T1) through evolutionary tuning (T2), Monte Carlo simulation (T3), to neural network learned policy (T5). Build the tournament infrastructure to generate training data and benchmark agents empirically.

## 2. Work Completed

### AI Agent Evolution

| Tier | Agent | Version | Key Capability | World Map Performance |
| :--- | :--- | :--- | :--- | :--- |
| T1 | GreedyAgent | 1.0 | Stack + attack at any advantage | Baseline (~50%) |
| T2 | StrategicAgent | 5.0 | Evolved params (300k-game search) | 73% vs greedy |
| T3 | MonteCarloAgent | 1.0 | Combat simulation per attack | 52.5% vs greedy |
| T5 | LearnedPolicyAgent | 1.0 | MLX MLP trained on tournament data | 30% vs greedy (v1) |

### StrategicAgent v1.0 → v5.0 Evolution
- v1.0 (12% vs greedy): drip-feed armies, 2:1 threshold, .once attacks
- v2.0 (20%): concentrated armies, .untilWinOrLose, lower threshold
- v5.0: StrategicConfig with 8 tunable params + evolutionary search
- 300,000-game world map tuning run (30 pop × 20 gen × 500 rounds, 4.7 hours)
- Best world config: attackThreshold=1.14, no fortify, place on weakest border, high friendly neighbor weight

### MonteCarloAgent (T3)
- CombatSimulator: lightweight Risk dice simulator validated against known probabilities (37.2%/33.6%/29.3%)
- Evaluates every possible attack with 200 Monte Carlo trials before committing
- Critical bug found + fixed: `guard defenderArmies > 0` skipped free captures (0-army countries)
- Result: #1 on world map after fix (Elo 1548 vs greedy 1516)

### LearnedPolicyAgent (T5) with MLX-Swift
- FeatureExtractor: 12 normalized features (territory/army ratios, continent progress, border pressure, Gini concentration, card state)
- PositionNetwork: MLP (12→64→32→1) using Apple MLX-Swift framework
- GPU-accelerated training on Apple Silicon via Metal
- Trained on 51,094 examples from 480 tournament games → **89.9% validation accuracy**
- 1-ply search: enumerate attacks, score resulting positions via network
- Tournament results: crushes montecarlo/strategic on duel (80-90%), competitive on world (needs more data)

### Evolutionary Parameter Tuner
- ParameterTuner actor with configurable population, generations, rounds
- Crossover + mutation breeding from elite parents
- `iconquer-tournament tune` CLI subcommand
- Validated: found 93% win rate config on duel, 73% on world

### Tournament Infrastructure Additions
- Multi-map tournaments with per-map analytics in strategy guide
- Remote agent support via WebSocket (TournamentWebSocketServer + RemoteTournamentAgent)
- `--max-transcripts` flag for training data collection runs
- `train` subcommand for T5 model training from tournament data
- MLX-Swift integration for GPU-accelerated neural network training

### Other Completed Items
- Save/load wired into CLI ('s' key, --load flag, saves subcommand)
- Map plugin CLI export (`maps export world --output /tmp`)
- Deployment guide updated
- Tournament deployed to roseclub.org with montecarlo agent

## 3. Quality Gate

| Package | Tests | Status |
| :--- | :--- | :--- |
| IconquerCore | 180 | ✅ |
| IconquerAI | 84 (non-MLX via swift test) | ✅ |
| IconquerMatch | 37 | ✅ |
| IconquerCLI | 316 | ✅ |
| IconquerServer | 26 | ✅ |
| IconquerClient | 12 | ✅ |
| IconquerTournament | 50 | ✅ |

Note: MLX-dependent tests (PositionNetwork, TrainingPipeline) require `xcodebuild test` for Metal shader compilation. They pass via xcodebuild but not `swift test`.

## 4. In-Flight Work

### Overnight Tournament (750k games)
- **PID:** 31839 (local machine)
- **Started:** 2026-04-24 14:56 EST
- **Estimated completion:** ~06:00-07:00 EST April 25
- **Storage:** `/tmp/t5-overnight/`
- **Agents:** greedy, strategic, montecarlo, learned (4 agents, 6 pairings)
- **Map:** world only
- **Rounds:** 125,000 per pairing = 750,000 total games
- **Transcripts:** 100,000 max (~3.7 GB)
- **Binary:** Metal-enabled xcodebuild at `IconquerTournament/.xcodebuild/Build/Products/Release/iconquer-tournament`

### How to check:
```bash
tail -5 /tmp/t5-overnight/run.log
ls /tmp/t5-overnight/transcripts/ | wc -l
```

## 5. Next Session Priorities

### Tier 1: Apply overnight results
1. Check tournament standings: `.xcodebuild/.../iconquer-tournament status --storage /tmp/t5-overnight`
2. Generate strategy guide with per-agent analysis
3. **Retrain T5** on 100k transcripts (~5M examples): `.xcodebuild/.../iconquer-tournament train --storage /tmp/t5-overnight --map world --epochs 200 --output ~/.iconquer/models/position_network_v2`
4. Run fresh tournament with retrained T5 v2 — measure improvement
5. Iterate: if T5 v2 beats greedy, include it in training data for T5 v3 (self-play improvement loop)

### Tier 2: Apply world map evolved config
6. Update StrategicConfig.default with world-map-optimized values from `/tmp/best-strategic-world.json`
7. Consider map-specific configs (detect map at runtime, load appropriate config)

### Tier 3: Test T4 (LLM agent)
8. Set ANTHROPIC_API_KEY and run MCPMultiTurnAgent in a tournament
9. Compare LLM reasoning quality vs evolved heuristics vs learned model

### Tier 4: Remaining infrastructure
10. Real Ollama integration testing
11. SwiftUI app (all engine infrastructure is now complete)
12. visionOS design proposal

## 6. Key Files

### New This Session
- `IconquerAI/Sources/IconquerAI/Learned/` — T5 agent (5 files)
- `IconquerAI/Sources/IconquerAI/CombatSimulator.swift` — T3 combat simulation
- `IconquerAI/Sources/IconquerAI/MonteCarloAgent.swift` + `MonteCarloConfig.swift` — T3 agent
- `IconquerAI/Sources/IconquerAI/StrategicConfig.swift` — T2 parameterized config
- `IconquerTournament/Sources/IconquerTournament/Tuner/ParameterTuner.swift` — evolutionary search
- `IconquerTournament/Sources/IconquerTournament/Remote/` — remote agent support (2 files)
- `~/.iconquer/models/position_network.safetensors` — trained T5 weights

### Critical Paths
- World map evolved config: `/tmp/best-strategic-world.json`
- Overnight tournament data: `/tmp/t5-overnight/`
- Metal-enabled binary: `IconquerTournament/.xcodebuild/Build/Products/Release/iconquer-tournament`

## 7. Context Warnings

- **MLX-Swift + SwiftPM:** Metal shaders don't compile via `swift build/test`. Must use `xcodebuild` for anything involving PositionNetwork or training. Non-MLX code works fine with SwiftPM.
- **roseclub.org is Intel Mac:** MLX-Swift requires Apple Silicon. Tournament server on roseclub.org cannot run the learned agent. Local machine (Apple Silicon) is required for T5 training and tournaments with the learned agent.
- **Overnight tournament PID 31839:** Don't kill this process — it's generating 750k games of training data. ~3.7 GB of transcripts when done.
- **Transcript eviction:** With 100k max transcripts and 750k games, the first ~650k transcripts will be evicted. The archive samples every 100 games, so ~7,500 archived samples will exist alongside the last 100k recent transcripts.

---

**Session Duration:** ~18 hours (continued from session 4)
**AI Model Used:** Claude Opus 4.6 (1M context)
**Games Simulated This Session:** ~1.1M (300k tuning + 240 tournaments + 750k overnight)
**New Tests Written:** ~50
