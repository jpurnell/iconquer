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
- [ ] Swift package skeleton — not started
- [ ] Swift port of core engine — not started

### Known Issues
- Original Objective-C source is unavailable; TypeScript port is the only reference
- No automated parity tests yet between TS reference and the (future) Swift port

### Current Priorities
1. Approve the Phase 1 design proposal for `IconquerCore` (rules engine, no UI)
2. Stand up the SPM package with a failing test that defines the smallest playable slice
3. Mirror the TS `game.ts` rules in Swift, driven by parity tests

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

### Phase 1: Core Engine Parity (headless)
- [ ] Define `IconquerCore` SPM package
- [ ] Port data model (Country, Continent, Player, Card, Game)
- [ ] Port phase machine (PickCountries → InitializeArmies → Play → Victory)
- [ ] Port turn phases (AssignArmies → Attack → Fortify → Done)
- [ ] Port combat resolver (hidden dice)
- [ ] Port reinforcement and continent bonuses
- [ ] Parity tests against the TS reference (deterministic seeded RNG)

### Phase 2: iOS App Shell
- [ ] SwiftUI map view with the original Background.jpg + country PNG overlays
- [ ] Tap-to-select / tap-to-attack interaction
- [ ] Reinforcement and fortification UI
- [ ] AI opponents (port at least Aggressive, Defensive, Unpredictable)

### Phase 3: Modernization
- [ ] iOS 26+ Liquid Glass styling
- [ ] New high-resolution map assets
- [ ] Game Center / iCloud save
- [ ] macOS target

### Future Considerations
- Online multiplayer
- Additional map plug-ins
- New AI personalities (perhaps LLM-backed, per the existing SPEC.md "cognition fabric" experiment)

---

**Last Updated:** 2026-04-06
