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

Reconciled 2026-08-12 — the first two had been overtaken by shipped work.

1. ~~Review and approve multiplatform SwiftUI app design proposal
   (`IconquerApp_MultiplatformSwiftUI.md`)~~ — the app shipped; the proposal is
   history, not a pending decision.
2. ~~Begin Phase 3: SwiftUI app (iPhone/iPad/Mac/watchOS)~~ — begun and largely
   delivered on iOS / macOS / **tvOS** / visionOS. See Phase 3 for the item-by-item
   state and the three genuinely-unstarted pieces.
3. Design visionOS immersive space experience (miniature globe) — still open, and
   now better positioned: the app's vector map already reprojects, which is what the
   globe needs.
4. Finish Phase 3's remaining three, all confirmed in scope 2026-08-12 and none
   started: **watchOS** async turn-based play, **Widgets**, and **Game Center /
   iCloud save**. Nothing is blocked on a decision; they are open work.

---

## Quality Standards

### Code Quality
- All code follows `coding_rules.md`
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

### Phase 3: Multiplatform SwiftUI App — IN PROGRESS (6 of 9)

Reconciled 2026-08-12 against the `IconquerApp` source, which had been shipping for
months while this list still read as unstarted. Verified item by item, not ticked
from memory.

- [x] ~~SwiftUI map view with Background.jpg + 42 country PNG overlays~~ — **shipped,
      but built differently.** `IconquerApp` renders **vector GeoJSON polygons**
      (`Resources/geo`, `GeoStore`, `CountryGeometry`, `MapProjection`), not raster
      PNG overlays. Vectors scale to any rect and reproject, which the PNG approach
      could not do — and Phase 4's globe needs exactly that reprojection. The original
      plan was wrong on the means, not the end; recording it rather than quietly
      rewriting the goal.
- [x] Two-tap interaction model for all turn phases — `selectedSource` /
      `selectedTarget` with a two-step confirm (`GameViewModel:141,193`)
- [x] iOS 26+ Liquid Glass styling throughout — `GlassCard`, `glassBackground(in:)`;
      all four targets are `.v26`
- [x] iPad NavigationSplitView + Mac menu bar / keyboard shortcuts — `SidebarView`,
      `GameBoardView`, `GameCommands`, `KeyboardShortcutModifier`
- [x] Multiplayer lobby UI backed by existing server — `LobbyView`, `RoomView`,
      `MultiplayerViewModel`
- [x] **tvOS** — shipped, and confirmed in scope 2026-08-12. `IconquerApp` targets
      `.tvOS(.v26)` and `WorldMapView` carries a tvOS rendering path. It had shipped
      without appearing in any plan; it is now a first-class platform here.
- [ ] watchOS async turn-based play via server notifications — **in scope, not
      started.** Not a target in `Package.swift` or `project.yml` yet. Adding it means
      a new platform target plus a push path from `IconquerServer`.
- [ ] Widgets (game status, turn reminder) — **in scope, not started.** No WidgetKit
      usage anywhere yet.
- [ ] Game Center / iCloud save — **in scope, not started.** Saves are currently local
      via `SaveLoadManager`, which re-throws rather than wrapping, so a cloud backing
      store slots in behind it without changing its error surface.

**Platform set for this phase:** iOS, macOS, **tvOS**, visionOS shipping today;
watchOS still to come. The original list read "iPhone/iPad/Mac/watchOS", which was
wrong in both directions — it omitted a platform that shipped and claimed one that
never started.

**Also shipped, unplanned:** an App Store privacy manifest, and accessibility
adaptation across Reduce Transparency / Reduce Motion / Differentiate Without Color
with VoiceOver coverage of the board. See
`IconquerApp/project/summaries/2026-08-12_PrivacyManifest_Accessibility.md`.

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

**Last Updated:** 2026-08-12 — reconciled Phase 3 and Current Priorities against the
shipped `IconquerApp` source. Five of eight Phase 3 items were already delivered while
the list still read as unstarted; one shipped by a different means than planned (vector
GeoJSON, not PNG overlays) and that divergence is recorded rather than papered over.
Both questions it surfaced were answered the same day: **tvOS is officially in scope**
(it had shipped without appearing in any plan), and **watchOS, Widgets, and Game
Center / iCloud save all remain in scope** — open work, not dropped scope. Phase 3 is
now six of nine delivered, with tvOS added as an item in its own right.
