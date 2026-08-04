# Design Proposal: Strategic AI Agent + Wire Agents into TUI

**Date:** 2026-04-11
**Status:** Proposed
**Scope:** Replace inline handleAIPicks with PlayerAgent protocol, build StrategicAgent

---

## 1. Objective

Replace the inline AI logic in `handleAIPicks` (GameUpdate.swift) with proper `PlayerAgent` instances from IconquerAI, then build a `StrategicAgent` that plays intelligently.

**Problems solved:**
1. **Duplicated AI logic.** `handleAIPicks` reimplements a worse version of GreedyAgent inline.
2. **No agent selection.** The TUI ignores the `--player-config` AI type setting.
3. **Dumb AI.** Current AI places all armies on one country, never fortifies, uses simplistic attack logic.

---

## 2. Architecture

### Wire agents into GameModel

GameModel gains a `playerAgents: [PlayerId: any PlayerAgent]` dict. GameApp creates agents from player config at startup. `handleAIPicks` calls `agent.requestMove()` in a loop instead of inline logic.

### New StrategicAgent (in IconquerAI)

Strategy priorities:
1. **Continent pursuit** — identify the continent closest to completion, place armies to secure it
2. **Border concentration** — place armies on countries with enemy neighbors, not interior countries
3. **Calculated attacks** — attack when odds are favorable (3:1 or better for important targets, 2:1 for continent completion)
4. **Fortify toward the front** — move armies from interior countries to border countries
5. **Card management** — turn in cards when forced or when bonus is high

---

## 3. API Surface

### GameModel change
```swift
// GameModel gains:
public var playerAgents: [String: any PlayerAgent]  // keyed by PlayerId.rawValue
```

### handleAIPicks refactor
```swift
// Instead of inline logic:
while currentPlayer.isComputer {
    let agent = m.playerAgents[currentPlayerId.rawValue] ?? fallbackGreedy
    let move = try await agent.requestMove(state: snapshot, seat: currentPlayerId, deadline: ...)
    guard game.isLegal(move, for: currentPlayerId) else { break }
    game.apply(move)
}
```

### StrategicAgent (new file in IconquerAI)
```swift
public struct StrategicAgent: PlayerAgent {
    public let identity: AgentIdentity
    private let map: MapDefinition
    
    // Placement: identify target continent, place on weakest border country in that continent
    // Attack: prioritize continent-completing attacks, then best odds
    // Fortify: move from interior to strongest border
    // Cards: turn in when forced or bonus >= 10
}
```

---

## 4. Test Strategy

- StrategicAgent: places armies on border countries (not interior)
- StrategicAgent: attacks to complete continents when possible
- StrategicAgent: fortifies toward the front line
- Wire test: GameUpdate with playerAgents dict calls agent.requestMove
- Regression: existing game flow still works with GreedyAgent

---

## 5. Open Questions

1. **Async in handleAIPicks:** `requestMove` is async but `handleAIPicks` is synchronous (called from gameUpdate which is a pure function). Solution: make handleAIPicks synchronous by calling a blocking wrapper, or restructure to use Cmd for AI moves.

**Resolution:** Since handleAIPicks runs in the main event loop and AI agents are fast (scripted, not network), use a synchronous wrapper. GreedyAgent and StrategicAgent don't actually suspend — their requestMove returns immediately. The async signature is for LLM/MCP agents.
