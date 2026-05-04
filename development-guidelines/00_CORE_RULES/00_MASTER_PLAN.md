# iconquer Master Plan

**Purpose:** Source of truth for the iconquer Swift modernization project.

---

## Project Overview

### Mission
iconquer is a modern Swift port of "iConquer," a Risk-style turn-based strategy game originally written in Objective-C for Mac OS X around 2002 by Kavasoft. The original Obj-C source is no longer available locally; a working TypeScript reference port exists in this repository (`src/`) and will serve as the behavioral specification. The Swift rebuild will mirror the existing functionality and reuse the original assets, then progressively modernize both the gameplay and the visual design.

### Target Users
- Players who enjoyed the original iConquer and want a modern, native experience
- iOS and (eventually) macOS players who want a polished Risk-style strategy game
- The maintainer (Justin), as a portfolio-quality SwiftUI project demonstrating Design-First TDD

### Key Differentiators
- Faithful recreation of a beloved 2002 Mac game using its original art assets
- Native SwiftUI on Apple platforms with iOS 26+ Liquid Glass styling
- Plug-in architecture for maps and AI players, preserved from the original design
- A reference TypeScript implementation enables behavior-equivalence testing

---

## Architecture

### Technology Stack
- **Language:** Swift 6 (strict concurrency); SPM tools-version **6.2** (required for `.v26` platforms)
- **UI:** SwiftUI (iOS-first; macOS as a follow-on target)
- **Build System:** Swift Package Manager (Xcode app shell wrapping a SPM library)
- **Testing:** Swift Testing
- **Minimum OS:** iOS 18 (iOS 26+ for Liquid Glass adoption where available)

### Repo Structure

The project is split across **two sibling repos** so the engine can evolve independently of the app:

```
~/Dropbox/.../Swift/
├── iconquer/                          # this repo — app shell, assets, TS reference
│   ├── src/, public/                  # TypeScript reference oracle
│   ├── App/iconquer/                  # SwiftUI app (Phase 2)
│   │   ├── Views/
│   │   ├── ViewModels/
│   │   └── Resources/                 # Map assets, UI icons (from public/)
│   └── development-guidelines/        # process docs (cloned)
│
└── IconquerCore/                      # sibling repo — pure-Swift game engine
    ├── Package.swift
    ├── Sources/IconquerCore/
    │   ├── Model/                     # Country, Continent, Player, Card, GameState
    │   ├── Rules/                     # Phases, combat, reinforcement, fortify
    │   ├── Map/                       # MapDefinition + plugin loader
    │   ├── AI/                        # Player plugin protocol + built-in strategies
    │   └── IconquerCore.docc/
    └── Tests/IconquerCoreTests/
```

The `IconquerCore` package is platform-agnostic and headless so the rules engine can be exercised end-to-end in tests without any UI. The `iconquer` app consumes it as a Swift Package dependency.

**Deployment targets:** iOS 26 / iPadOS 26 / macOS 26 / tvOS 26 / visionOS 26 (hard requirement).

### Key Types

| Type | Purpose |
|------|---------|
| `Game` | Top-level state container; owns phase/turn machine and applies actions |
| `Country` / `Continent` | Map topology and ownership state |
| `Player` | Identity, color, cards, controlled countries, AI bindings |
| `MapPlugin` | Loads a `MapDefinition` (countries, neighbors, continent bonuses) from a bundle |
| `PlayerStrategy` | Plug-in protocol for AI decision-making (mirrors original 12 built-ins) |
| `CombatResolver` | Hidden-dice resolution per RULES.md §8–9 |

---

## Current Status

### What's Working
- [x] TypeScript reference implementation (`src/core/game.ts`, plugins, types)
- [x] Original asset bundle preserved: 42 country PNGs, Background.jpg, Countries.json, Continents.json, 7 localizations under `public/maps/iconquer-world/`
- [x] UI icons preserved under `public/ui/`
- [x] Game rules documented in `RULES.md`
- [x] Development-guidelines workflow scaffolded (`.claude/`, `CLAUDE.md`, project dirs)
- [x] **Phase 1 COMPLETE:** IconquerCore — Game engine with 180 passing tests
  - Model: Country, Continent, Player, Card, GameState, GameSnapshot
  - Rules: Phase machine, combat resolver, reinforcement, fortification, GameMove dispatcher
  - Map: Unified map format, map registry, validation, bundling, layout
  - Persistence: Save/load game state with versioning
  - Multiplayer: Wire types, room configuration, client/server messages
  - Parity: 20 deterministic fixtures validated against TS reference
- [x] **Phase 2 COMPLETE:** AI, Match, CLI, Server, Client, MCP
  - IconquerAI: 6 agents (Random, Greedy, Strategic/T2, MonteCarlo/T3, Learned/T5, MCPMultiTurn)
  - IconquerMatch: PlayerAgent protocol, match runner, turn timers, audit logging
  - IconquerCLI: Full TUI app with setup wizard, map rendering, attack animations, save/load
  - IconquerServer: WebSocket-based online multiplayer with lobby, rooms, auth
  - IconquerClient: Network play client library
  - IconquerMCP: Agentic gameplay protocol (Claude / OpenAI / Ollama)
- [x] **Tournament Infrastructure COMPLETE:** IconquerTournament
  - Elo ratings, multi-map tournaments, strategy doc generation
  - Evolutionary parameter tuning (StrategicAgent v5.0 via 300k-game search)
  - T5 neural network training pipeline (MLX-Swift, GPU-accelerated)
  - Self-play improvement loop (automated train → tournament → repeat)
  - 750k-game overnight tournament (2026-04-24/25)

### Known Issues
- Original Objective-C source is unavailable; TypeScript port is the only reference
- T5 LearnedPolicyAgent underperforming (Elo ~1405, 4th of 4). Model architecture (12→64→32→1 MLP) appears capacity-limited at 89% accuracy ceiling regardless of training data size.

### Current Priorities
1. Review and approve multiplatform SwiftUI app design proposal (`IconquerApp_MultiplatformSwiftUI.md`)
2. Begin Phase 3: SwiftUI app (iPhone/iPad/Mac/watchOS)
3. Design visionOS immersive space experience (miniature globe)

---

## Quality Standards

### Code Quality
- All code follows `01_CODING_RULES.md`
- Test coverage target: 80%+ for `IconquerCore`
- Documentation for all public APIs (DocC)
- Zero warnings in build output
- Swift 6 strict concurrency compliance

### Documentation Quality
- DocC comments for all public functions and types
- A DocC article explaining the rules engine and how it maps to RULES.md
- Usage examples for the plug-in protocols (maps, players)

---

## Error Registry

> Consult during the Design Proposal Phase to avoid duplicating error cases. Update whenever new error types are introduced.

### Error Types

| Error Enum | Case | When Thrown | Module |
|------------|------|------------|--------|
| `GameError` | `.invalidPhase(expected:actual:)` | An action is attempted in the wrong phase | IconquerCore |
| `GameError` | `.notOwner(country:player:)` | A player acts on a country they do not own | IconquerCore |
| `GameError` | `.notAdjacent(from:to:)` | Attack/fortify between non-adjacent countries | IconquerCore |
| `GameError` | `.insufficientArmies(country:required:)` | Action requires more armies than present | IconquerCore |
| `MapLoadError` | `.missingFile(name:)` | A required map asset is missing | IconquerCore |
| `MapLoadError` | `.malformed(reason:)` | A map definition file is unparseable | IconquerCore |

---

## Roadmap

### Phase 1: Core Engine Parity (headless) — COMPLETE
- [x] Define `IconquerCore` SPM package
- [x] Port data model (Country, Continent, Player, Card, Game)
- [x] Port phase machine (PickCountries → InitializeArmies → Play → Victory)
- [x] Port turn phases (AssignArmies → Attack → Fortify → Done)
- [x] Port combat resolver (hidden dice)
- [x] Port reinforcement and continent bonuses
- [x] Parity tests against the TS reference (deterministic seeded RNG)

### Phase 2: AI + Multiplayer + CLI — COMPLETE
- [x] 6 AI agent implementations (Random → Greedy → Strategic → MonteCarlo → Learned → MCP)
- [x] Match runner with PlayerAgent protocol, turn timers, fallback policies
- [x] Full TUI CLI app with setup wizard, map rendering, attack animations
- [x] WebSocket multiplayer server and client
- [x] MCP integration for LLM-driven agents
- [x] Tournament infrastructure with Elo, evolutionary tuning, neural network training
- [x] 750k-game overnight tournament + self-play improvement pipeline

### Phase 3: Multiplatform SwiftUI App — IN PROGRESS
- [ ] SwiftUI map view with Background.jpg + 42 country PNG overlays
- [ ] Two-tap interaction model for all turn phases
- [ ] iOS 26+ Liquid Glass styling throughout
- [ ] iPad NavigationSplitView + Mac menu bar / keyboard shortcuts
- [ ] Multiplayer lobby UI backed by existing server
- [ ] watchOS async turn-based play via server notifications
- [ ] Widgets (game status, turn reminder)
- [ ] Game Center / iCloud save

### Phase 4: visionOS Immersive Experience
- [ ] RealityKit miniature globe with 42 country territories
- [ ] 2D → spherical coordinate reprojection
- [ ] Gaze + pinch spatial interaction model
- [ ] Army indicators as 3D billboards on globe surface
- [ ] Spatial audio for territory claims and combat

### Future Considerations
- Additional map plug-ins (community-created maps)
- T5 agent architecture improvements (wider MLP or transformer)
- AI company benchmark tournament (public leaderboard)

---

**Last Updated:** 2026-04-26
