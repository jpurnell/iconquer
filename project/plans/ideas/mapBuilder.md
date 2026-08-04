# Idea: iConquer Game Builder App

**Status:** Conceptual — not yet scoped for implementation

## Concept

A standalone app for creating complete iConquer game experiences — maps AND game rules. This is broader than just a "map builder" — it's a **game builder** that produces unified `.json` files containing:

### Map Building
- Drawing countries as regions on a grid
- Defining neighbor connections by drawing lines
- Grouping countries into continents with bonus values
- Positioning countries for console/web/native layouts (2D + 3D for visionOS)
- Previewing the map as it would appear in the TUI
- Validating the map (bidirectional neighbors, all countries reachable, etc.)

### Game Rules Configuration
- **Custom missions** — create mission objectives for Mission Risk variant:
  - "Conquer Africa and Asia"
  - "Destroy all [Player Color] armies"
  - "Control 24 territories with 2+ armies each"
  - "Control any 3 continents"
  - Custom conditions with configurable parameters
- **Mission pools** — define a set of missions that are randomly assigned at game start
- **Card value schedules** — define custom card trade-in value progressions
- **Fortify rules** — set per-map (some maps might play better with connected fortify)
- **Victory conditions** — standard conquest, capital capture, mission completion, or custom
- **Starting configuration** — pre-placed armies, fixed country assignments, scenario setups

### Scenario Building
- Pre-built game states for tutorials ("Learn to attack from this position")
- Historical scenarios (pre-assigned territories matching historical conflicts)
- Puzzle modes ("Win in 3 turns from this position")

## Why

1. Hand-editing JSON for 42 countries + layouts + missions is tedious and error-prone
2. A visual editor makes map/game creation accessible to non-developers
3. Enables a community sharing ecosystem — download maps + rulesets as single files
4. Custom missions and scenarios dramatically expand replayability
5. The unified file format supports all of this but needs tooling to author

## Potential Approaches

1. **SwiftUI macOS app** — drag-and-drop country placement, mission builder forms, live TUI preview
2. **Web-based editor** — HTML5 canvas for maps, forms for rules, wider community reach
3. **TUI-based editor** — built with SwiftCLIKit, edit everything in-terminal
4. **Hybrid** — web editor for visual layout, native app for rules/missions/validation

## Unified File Format Integration

The game builder outputs a complete `UnifiedMapFile` that includes:
```json
{
  "name": "Custom WWII Europe",
  "countries": [...],
  "continents": [...],
  "layouts": [...],
  "missions": [
    {
      "description": "Conquer all of Europe and Africa",
      "condition": { "conquerContinents": ["Europe", "Africa"] }
    },
    {
      "description": "Control 18 territories with 2+ armies",
      "condition": { "controlTerritories": { "count": 18, "minArmies": 2 } }
    }
  ],
  "defaultVariant": "mission",
  "defaultCardValues": "officialProgressive",
  "defaultFortifyMode": "connected",
  "scenarios": [
    {
      "name": "Tutorial: First Attack",
      "description": "Learn attack mechanics",
      "presetState": { ... }
    }
  ]
}
```

This means the unified map format needs to be extended to support missions and scenarios — the Game Variants proposal should account for this.

## Relationship to Other Work

- **Depends on:** Unified Map Format (finalized), Game Variants (rules system)
- **Enables:** community map/game sharing, custom experiences, tutorials
- **Related:** Console Map Renderer (the builder previews what the renderer shows)
- **Related:** Game Variants (the builder configures variant rules per map)
- **Related:** Setup Screen (loads custom maps + their embedded rules)

## Open Questions

- Should the builder be a separate repo or part of the IconquerCLI workspace?
- What's the minimum viable feature set for v1?
- Is a web editor more practical for community adoption?
- Should mission definitions live in the map file or be a separate concept?
- How to handle scenario pre-built states (full GameSnapshot serialization)?
