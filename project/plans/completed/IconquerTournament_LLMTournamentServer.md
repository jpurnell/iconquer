# Design Proposal: LLM Tournament Server & Strategy Doc Generator

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** New `IconquerTournament` package — continuous LLM-vs-LLM tournament ladder with automated strategy document generation
**Phase:** Phase 3+

---

## 1. Objective

Build a tournament orchestrator that runs continuous LLM-vs-LLM iConquer games, tracks Elo ratings, and feeds aggregated results into an auto-generated strategy guide.

**Problems solved:**
1. **No empirical strategy data.** AI agents exist (random, greedy, strategic, mcp-claude, mcp-openai, mcp-ollama) but there's no systematic comparison of their play patterns or win rates across maps/variants.
2. **No strategy documentation.** Players have no guide for how to play well. Human-written strategy advice is speculative; tournament data makes it empirical.
3. **No continuous integration of AI quality.** New agents or prompt tweaks have no automated benchmark. A ladder provides regression detection for AI strategy quality.
4. **Existing `tournament` subcommand is limited.** Only 2 players, no persistence, no round-robin, no Elo, no analytics pipeline.

**Master Plan Reference:** Phase 3+ — "LLM tournament server feeding strategy docs" (memory: `project_iconquer_llm_tournament_vision.md`). The Phase 2 architecture was intentionally designed to enable this without engine changes.

---

## 2. Proposed Architecture

### New Package: `IconquerTournament`

Sibling repo alongside IconquerCore, IconquerAI, IconquerCLI, IconquerMCP.

```
~/Dropbox/.../Swift/
├── IconquerTournament/              # NEW — this proposal
│   ├── Package.swift
│   ├── Sources/IconquerTournament/
│   │   ├── Orchestrator/            # Tournament scheduling + lifecycle
│   │   │   ├── TournamentOrchestrator.swift
│   │   │   ├── TournamentConfig.swift
│   │   │   ├── MatchScheduler.swift
│   │   │   └── EloRating.swift
│   │   ├── Storage/                 # Persistence
│   │   │   ├── TournamentStore.swift
│   │   │   ├── MatchRecord.swift
│   │   │   └── AgentProfile.swift
│   │   ├── Analytics/               # Result aggregation
│   │   │   ├── WinMatrix.swift
│   │   │   ├── StrategyAnalyzer.swift
│   │   │   ├── TerritoryHeatmap.swift
│   │   │   └── MovePatternExtractor.swift
│   │   └── DocGenerator/            # Strategy doc output
│   │       ├── StrategyDocGenerator.swift
│   │       ├── DocTemplate.swift
│   │       └── MarkdownRenderer.swift
│   ├── Sources/iconquer-tournament/ # CLI executable
│   │   └── TournamentCLICommand.swift
│   └── Tests/IconquerTournamentTests/
│
├── IconquerCore/                    # existing — consumed as dependency
├── IconquerAI/                      # existing — agent implementations
├── IconquerMatch/                   # existing — MatchRunner
└── IconquerMCP/                     # existing — MCP server (for remote agents)
```

### New Files

| File | Purpose |
|------|---------|
| `TournamentOrchestrator.swift` | Top-level actor: schedules matches, manages agent pool, drives the ladder loop |
| `TournamentConfig.swift` | Configuration: agents, maps, variants, rounds per pairing, Elo settings |
| `MatchScheduler.swift` | Round-robin or Swiss-system pairing generator |
| `EloRating.swift` | Elo rating calculator with K-factor and initial rating constants |
| `TournamentStore.swift` | JSON-file persistence for match records, agent profiles, Elo history |
| `MatchRecord.swift` | Single match result: agents, map, variant, winner, move count, transcript hash |
| `AgentProfile.swift` | Agent identity + current Elo + win/loss/draw tallies + metadata |
| `WinMatrix.swift` | NxN win-rate matrix across all agent pairings |
| `StrategyAnalyzer.swift` | Extract strategic patterns from transcripts: continent priority, attack timing, fortify patterns |
| `TerritoryHeatmap.swift` | Per-country control frequency across games — which countries do winners hold? |
| `MovePatternExtractor.swift` | Categorize moves by phase/intent, compute distributions |
| `StrategyDocGenerator.swift` | Orchestrates analytics → prose pipeline; optionally uses LLM for prose generation |
| `DocTemplate.swift` | Markdown template sections: opening strategy, mid-game, continent priorities, card timing |
| `MarkdownRenderer.swift` | Renders analytics data into Markdown tables, charts (ASCII), and prose blocks |
| `TournamentCLICommand.swift` | `iconquer-tournament` executable with subcommands: `run`, `status`, `report`, `generate-doc` |

### Modified Files

| File | Change |
|------|--------|
| (none) | All existing packages consumed read-only as SPM dependencies |

### Module Placement

`IconquerTournament` is a new sibling package. It depends on `IconquerCore`, `IconquerMatch`, and `IconquerAI` for game engine, match running, and agent construction. It does NOT depend on `IconquerCLI` or `IconquerMCP` — it uses `MatchRunner` directly for local matches and can optionally shell out to `iconquer-mcp` for remote agent testing.

---

## 3. API Surface

### Core Types

```swift
/// Configuration for a tournament run.
public struct TournamentConfig: Sendable, Codable {
    /// Agent names to include (resolved via AgentFactory).
    public var agents: [String]
    /// Maps to play on (round-robin across maps).
    public var maps: [String]
    /// Game variants to test.
    public var variants: [GameVariant]
    /// Rounds per pairing per map per variant.
    public var roundsPerPairing: Int
    /// Starting seed; increments per round.
    public var seedBase: UInt32
    /// Max moves per game before declaring a draw.
    public var maxMovesPerGame: Int
    /// Elo K-factor for rating updates.
    public var eloKFactor: Double
    /// Initial Elo rating for new agents.
    public var eloInitialRating: Double
    /// Directory for persisted results.
    public var storageDirectory: URL
}
```

```swift
/// The top-level tournament orchestrator.
public actor TournamentOrchestrator {
    /// Create an orchestrator with the given config.
    public init(config: TournamentConfig) throws

    /// Run a full tournament cycle (all pairings, all maps, all variants).
    /// Persists results after each match.
    public func runFullCycle() async throws -> TournamentReport

    /// Run a single match between two agents on a given map/variant.
    public func runMatch(
        agent1: String, agent2: String,
        map: MapDefinition, variant: GameVariant,
        seed: UInt32
    ) async throws -> MatchRecord

    /// Current Elo standings.
    public func standings() -> [AgentProfile]

    /// Generate the strategy document from accumulated results.
    public func generateStrategyDoc() async throws -> String
}
```

```swift
/// A single completed match record.
public struct MatchRecord: Sendable, Codable {
    public let id: String
    public let date: Date
    public let agent1: String
    public let agent2: String
    public let mapName: String
    public let variant: GameVariant
    public let seed: UInt32
    public let winner: String?          // nil = draw
    public let moveCount: Int
    public let gameDuration: Duration
    public let transcriptHash: String   // SHA-256 of full transcript
    public let agent1EloAfter: Double
    public let agent2EloAfter: Double
}
```

```swift
/// Agent identity + accumulated statistics.
public struct AgentProfile: Sendable, Codable {
    public let name: String
    public var elo: Double
    public var wins: Int
    public var losses: Int
    public var draws: Int
    public var totalGames: Int
    public var averageMoveCount: Double
    public var eloHistory: [(date: Date, elo: Double)]
}
```

### Elo Rating

```swift
/// Standard Elo rating calculator.
public struct EloRating: Sendable {
    public let kFactor: Double

    public init(kFactor: Double = 32.0)

    /// Expected score for player A against player B.
    public func expectedScore(ratingA: Double, ratingB: Double) -> Double

    /// Updated ratings after a match.
    /// - Parameter outcome: 1.0 = A wins, 0.0 = B wins, 0.5 = draw.
    public func updatedRatings(
        ratingA: Double, ratingB: Double, outcome: Double
    ) -> (newA: Double, newB: Double)
}
```

### Analytics

```swift
/// NxN win-rate matrix across all agent pairings.
public struct WinMatrix: Sendable {
    /// Agents in the matrix (row/column order).
    public let agents: [String]
    /// Win rates: matrix[i][j] = agent i's win rate against agent j.
    public let matrix: [[Double]]
    /// Total games per pairing.
    public let gameCounts: [[Int]]

    public init(records: [MatchRecord])
}
```

```swift
/// Extracts strategic patterns from game transcripts.
public struct StrategyAnalyzer: Sendable {
    /// Analyze a batch of match transcripts.
    public func analyze(
        records: [MatchRecord],
        transcripts: [String: [GameMove]]  // keyed by match ID
    ) -> StrategyInsights

    public struct StrategyInsights: Sendable, Codable {
        /// Which continents do winners prioritize first?
        public let continentPriority: [(continent: String, winCorrelation: Double)]
        /// Average turn number of first successful continent completion.
        public let averageContinentCompletionTurn: [String: Double]
        /// Attack frequency by game phase (early/mid/late).
        public let attackFrequencyByPhase: [String: Double]
        /// Card turn-in timing: average cards held before turn-in.
        public let averageCardsBeforeTurnIn: Double
        /// Fortify patterns: % of fortifies that move to borders vs interior.
        public let borderFortifyRate: Double
    }
}
```

### Strategy Doc Generator

```swift
/// Generates a Markdown strategy guide from tournament analytics.
public struct StrategyDocGenerator: Sendable {
    /// Generate the strategy document.
    ///
    /// - Parameters:
    ///   - insights: Aggregated strategy insights from StrategyAnalyzer.
    ///   - matrix: Win-rate matrix for agent comparisons.
    ///   - standings: Current Elo standings.
    ///   - llmProvider: Optional LLM provider for prose generation.
    ///     If nil, uses template-based prose.
    public func generate(
        insights: StrategyAnalyzer.StrategyInsights,
        matrix: WinMatrix,
        standings: [AgentProfile],
        llmProvider: (any MCPProviderProtocol)?
    ) async throws -> String
}
```

### CLI Executable

```swift
/// iconquer-tournament CLI with subcommands.
@main struct TournamentCLICommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "iconquer-tournament",
        subcommands: [Run.self, Status.self, Report.self, GenerateDoc.self]
    )
}

/// Run a full tournament cycle.
struct Run: AsyncParsableCommand {
    @Option var agents: [String] = ["random", "greedy", "strategic"]
    @Option var maps: [String] = ["world"]
    @Option var rounds: Int = 10
    @Option var seedBase: UInt32 = 42
    @Option var storage: String = "~/.iconquer/tournament"
}

/// Show current Elo standings.
struct Status: AsyncParsableCommand { ... }

/// Generate analytics report (tables + charts).
struct Report: AsyncParsableCommand { ... }

/// Generate the strategy guide Markdown document.
struct GenerateDoc: AsyncParsableCommand {
    @Option var output: String = "STRATEGY_GUIDE.md"
    @Flag var useLLM: Bool = false  // Use Claude to polish prose
}
```

---

## 4. MCP Schema

The tournament system does not expose MCP tools directly. However, it consumes the existing `MCPMultiTurnAgent` infrastructure when running LLM-based agents. Remote agents connect via `IconquerMCP` HTTP transport.

**Future MCP extension (v2):** A `tournament_status` MCP resource could expose live standings to external dashboards.

```json
{
  "resource": "iconquer://tournament/standings",
  "content": {
    "agents": [
      {"name": "mcp-claude", "elo": 1523, "wins": 47, "losses": 23, "draws": 5},
      {"name": "strategic", "elo": 1487, "wins": 42, "losses": 28, "draws": 5}
    ],
    "lastUpdated": "2026-04-23T12:00:00Z"
  }
}
```

---

## 5. Constraints & Compliance

| Constraint | Approach |
|------------|----------|
| **Concurrency** | `TournamentOrchestrator` is an actor. All value types are Sendable. Matches run concurrently via TaskGroup (configurable parallelism). |
| **Determinism** | Each match uses `seedBase + offset` for reproducibility. Same config produces same tournament results for deterministic agents. |
| **Safety** | No force unwraps. Match failures are caught and recorded as draws, not crashes. Bounded iteration via `maxMovesPerGame`. |
| **Persistence** | JSON files in a configurable directory. No external database dependency. Atomic writes via temp-file-then-rename. |
| **Cross-platform** | Pure Swift, no Apple-only dependencies. Must run on Linux (roseclub.org, Swift 6.0.3) and macOS. |
| **LLM cost control** | LLM agents have per-move timeouts (30s) and per-conversation budgets (10 round-trips via MCPTurnBudget). Tournament config caps total LLM games per cycle. |

---

## 6. Backend Abstraction

Not compute-intensive — match execution is I/O bound (waiting for LLM responses) not CPU bound. No GPU/Accelerate backend needed.

**Parallelism:** Matches between deterministic agents (random, greedy, strategic) run in a `TaskGroup` with configurable concurrency (default: `ProcessInfo.processInfo.activeProcessorCount`). LLM agent matches run with limited concurrency (default: 2) to avoid API rate limits.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` — Game engine, MapDefinition, GameSnapshot, Settings
- `IconquerMatch` — MatchRunner, PlayerAgent, MoveRecord
- `IconquerAI` — AgentFactory, MCPMultiTurnAgent, provider protocols
- `swift-argument-parser` — CLI subcommands

**External Dependencies:**
- None beyond what IconquerAI already requires (Foundation URLSession for LLM API calls)

**Runtime Requirements:**
- API keys for LLM agents (ANTHROPIC_API_KEY, OPENAI_API_KEY) set as environment variables
- Ollama running locally for mcp-ollama agent
- Network access for cloud LLM providers

---

## 8. Test Strategy

**Test Categories:**

| Category | What | Where |
|----------|------|-------|
| **Elo calculation** | Expected scores, rating updates, K-factor sensitivity | `EloRatingTests.swift` |
| **Match scheduling** | Round-robin pairing generation for N agents, no self-play, all pairs covered | `MatchSchedulerTests.swift` |
| **Win matrix** | Correct aggregation from match records, symmetry (A vs B + B vs A = 100%) | `WinMatrixTests.swift` |
| **Strategy analysis** | Known transcript patterns produce expected insights | `StrategyAnalyzerTests.swift` |
| **Persistence** | Store round-trip: write → read → compare. Concurrent write safety. | `TournamentStoreTests.swift` |
| **Doc generation** | Template produces valid Markdown with expected sections | `StrategyDocGeneratorTests.swift` |
| **Integration** | Run 3 deterministic agents × 5 rounds on line4 map, verify Elo ordering matches expected (greedy > random) | `TournamentIntegrationTests.swift` |

**Reference Truth:**
- Elo formula: standard FIDE Elo (Wikipedia: `E_A = 1 / (1 + 10^((R_B - R_A) / 400))`)
- Validate: `expectedScore(ratingA: 1500, ratingB: 1500) == 0.5`
- Validate: `expectedScore(ratingA: 1600, ratingB: 1400)` ≈ `0.7597`
- Win matrix: 3 agents, 10 games each pairing → 30 games total, all cells sum correctly

**Validation Trace:**
- `EloRating(kFactor: 32).updatedRatings(ratingA: 1500, ratingB: 1500, outcome: 1.0)` → `(newA: 1516.0, newB: 1484.0)`
- `WinMatrix(records: [3 games A beats B, 2 games B beats A]).matrix[0][1]` → `0.6`

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes

**New ADR Draft:**
- **Title:** Tournament persistence uses JSON files, not a database
- **Category:** storage
- **Key decision:** Tournament results are persisted as JSON files (one per match + an `index.json` for agent profiles and Elo history) rather than SQLite or a remote database. This keeps the deployment zero-dependency and file-inspectable, at the cost of slower queries for very large tournament histories (>10k matches). If scale demands it, a future ADR can introduce SQLite.

---

## 10. Open Questions — RESOLVED

1. **Transcript retention:** ~~Store first 1000 games.~~ **RESOLVED:** Keep a **rolling window of the last 1000 full transcripts** plus a **representative sample from each era** (e.g., one per 100 games from the historical record). Goal: strategy docs build from state-of-the-art play, but historical trends remain visible. `TranscriptStore` implements FIFO eviction with periodic sampling into an archive.

2. **Strategy doc format:** ~~Template vs LLM prose.~~ **RESOLVED:** Default to template-based generation. Output is **structured JSON** that is also human-readable — not just Markdown prose. The JSON contains all analytics (win matrices, continent correlations, timing data) as machine-parseable fields with human-friendly labels. A Markdown renderer can produce prose from the JSON, and the `--use-llm` flag can optionally polish it.

3. **LLM game caps:** ~~Default to deterministic only.~~ **RESOLVED:** Configurable cap is fine for cost control (`--llm-games-per-cycle 20`). However, the long-term vision is **offering the tournament as a benchmark to AI companies** to prove their claimed improvements. Design the analytics and reporting for scale — the cap is a deployment knob, not an architectural constraint.

4. **Remote agent support:** ~~Defer to v2.~~ **RESOLVED: v1 requirement.** Remote agents connecting via HTTP/WebSocket are **critical day-1 infrastructure**, not a deferral. This is how AI companies would participate in the benchmark. The tournament orchestrator must accept both local agents (via `AgentFactory`) and remote agents (via WebSocket using the `IconquerServer` wire protocol or a dedicated tournament agent protocol).

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (orchestrator + analytics + doc generator)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (Elo rating system, strategy analysis methodology)

**Article Name:** TournamentServerGuide.md

**Contents:**
1. Quick start: `iconquer-tournament run --agents random,greedy,strategic --rounds 50`
2. Understanding Elo ratings and what they mean for agent quality
3. Reading the strategy guide output
4. Adding custom agents to the tournament
5. Deploying to a Linux server (systemd service file)
6. Cost management for LLM agents

---

## Appendix: Strategy Doc Template Sections

The generated `STRATEGY_GUIDE.md` would contain:

1. **Overview** — What this guide is, how it was generated, how many games were analyzed
2. **Agent Rankings** — Elo standings table with win/loss/draw records
3. **Win Matrix** — NxN table showing head-to-head win rates
4. **Opening Strategy** — Which countries/continents to prioritize during PickCountries (from continent priority correlation data)
5. **Army Placement** — Where winning agents place reinforcements (from territory heatmap data)
6. **Attack Timing** — When to attack and when to fortify (from attack frequency by game phase)
7. **Continent Control** — Which continents to complete first and average completion turns
8. **Card Management** — When to turn in cards (from card timing data)
9. **Fortification Patterns** — Border vs interior fortify rates among winners
10. **Map-Specific Tips** — Per-map insights if multiple maps were tested
11. **Methodology** — Tournament config, number of games, agent versions, date range
