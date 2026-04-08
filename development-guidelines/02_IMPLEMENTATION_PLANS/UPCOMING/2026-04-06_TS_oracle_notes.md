# TypeScript Oracle — Notes for the Swift Port

**Status:** REFERENCE
**Date:** 2026-04-06
**Scope:** Capture the essential behavior of the TypeScript engine at `iconquer/src/core/` so the Swift port can mirror it under deterministic seeded RNG, plus call out gotchas and rule ambiguities.

**Files read:**
- `src/core/rng.ts` (35 lines)
- `src/core/defaults.ts` (21 lines)
- `src/core/game.ts` (929 lines)
- `src/types/game.ts` (108 lines)
- `src/plugins/maps/world.ts` (63 lines)

---

## 1. RNG — Mulberry32, bit-reproducible

`rng.ts` is textbook **mulberry32** (a 32-bit seedable PRNG). It is trivially reproducible in Swift bit-for-bit using `UInt32` wrapping arithmetic.

```typescript
next(): number {
  this.state += 0x6d2b79f5;
  let t = this.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
```

**Swift mirror:**
```swift
public struct SeededRNG: Sendable {
    public private(set) var state: UInt32
    public init(seed: UInt32) { self.state = seed }

    public mutating func next() -> Double {
        state &+= 0x6d2b79f5
        var t: UInt32 = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double((t ^ (t >> 14))) / Double(UInt32.max + 1)
    }

    public mutating func int(_ maxExclusive: Int) -> Int {
        Int((next() * Double(maxExclusive)).rounded(.down))
    }

    public mutating func die() -> Int { int(6) + 1 }
}
```

Notes:
- JS `>>> 0` forces UInt32. In Swift, the type IS UInt32, so the operation is implicit.
- `Math.imul(a, b)` is signed 32-bit multiplication; in UInt32 arithmetic the bit pattern of `&*` (UInt32) matches `Math.imul` exactly because both are mod 2³². Verified mentally — write a parity test of the first 1000 values to be safe.
- `4294967296` is `UInt32.max + 1` (i.e. 2³²). Use `Double(UInt32.max) + 1` or `0x1p32` to avoid overflow.
- `pick(arr)` and `shuffle(arr)` (Fisher–Yates from end) follow trivially. **Decision: mirror, do not replace.** No need for SplitMix64.

---

## 2. Phase Machine

```
GamePhase:    PickCountries → InitializeArmies → Play → Victory
TurnPhase:    Done → AssignArmies → Attack → Fortify → Done (next player) → ...
```

**Transitions:**
- `startGame()`: phase = PickCountries; if `assignCountries` setting is true, immediately calls `randomlyPickCountries()` → `donePickingCountries()`.
- `pickCountry(player, country)`: assigns country, advances to next alive player, when all countries owned → `donePickingCountries()`.
- `donePickingCountries()`: turnNumber += 1; phase = InitializeArmies; currentPlayerIndex = 0; `beginTurnIfReady()`.
- `beginTurnIfReady()` (InitializeArmies): grants 5 armies (or all remaining initial) to the current player and sets destinations to all owned countries.
- `placeArmies()` during InitializeArmies: when `unallocatedArmies` hits 0 → `advanceInitializationTurn()`.
- `advanceInitializationTurn()`: if no player has any `unallocatedInitialArmies` left → phase = Play, currentPlayerIndex = 0, `beginTurnIfReady()`. Else advance to next alive player.
- `beginTurnIfReady()` (Play, turnPhase=Done): turnPhase = AssignArmies, grant income via `incomeForCountries`, force card turn-in if `cards.length > 4`.
- `placeArmies()` during AssignArmies: when 0 → `startAttackPhase()`.
- `attack()` → may stay in Attack phase, may trigger pending card turn-in, may end game if `playersOrder.length === 1`.
- `finishAttackPhase()`: turnPhase = Fortify.
- `beginFortifyFrom(country)`: sets up fortify source, marks armies as movable.
- `placeArmies()` during Fortify: when 0 → clears fortify source (does NOT auto-advance turn).
- `finishTurn()`: clears tiredArmies, draws a card if `hasWonThisTurn`, advances currentPlayerIndex (incrementing turnNumber on wrap), `beginTurnIfReady()`.

---

## 3. Reinforcement Formula

```typescript
incomeForCountries(countryIds): number {
  if (count === 0) return 0;
  let income = count < 9 ? 3 : Math.floor(count / 3);
  for (continent of map.continents) {
    if (continent.countries.every(id => countryIds.includes(id))) {
      income += continent.armies;
    }
  }
  return income;
}
```

**⚠️ Subtle deviation from RULES.md:** The rule book says "minimum 3, otherwise floor(territories/3)". The TS reads `count < 9 ? 3 : floor(count/3)`. These agree for `count ≤ 8` (both give 3) and for `count ≥ 9` (both give `floor(count/3) ≥ 3`). They are equivalent. Mirror as-is.

Continent bonuses: a player owning *every* country in a continent gets the bonus. From `Continents.json`: North America 5, South America 2, Europe 5, Africa 3, Asia 7, Australia 2 — matches RULES.md.

Initial armies: hardcoded `unallocatedInitialArmies: 20` per player (line 82). Drip-fed in `Math.min(5, remaining)` chunks during InitializeArmies (line 258).

---

## 4. Combat — Hidden Dice

```typescript
attackOnce(attacker, defender):
  attackDiceCount  = min(attacker.armies, settings.diceToRoll)   // settings.diceToRoll defaults to 3
  defendDiceCount  = (settings.diceToRoll > 1 && defender.armies > 1) ? 2 : 1
  attackDice = rollDice(attackDiceCount).sortedDescending()
  defendDice = rollDice(defendDiceCount).sortedDescending()
  // Compare first dice always:
  if attackDice[0] > defendDice[0]: defender.armies -= 1   // ties favor defender
  else: attacker.armies -= 1
  // Compare second dice only if BOTH had > 1:
  if attackDiceCount > 1 && defendDiceCount > 1:
    if attackDice[1] > defendDice[1]: defender.armies -= 1
    else: attacker.armies -= 1
```

**Gotchas:**
1. **Ties favor the defender** — `attackDice[0] > defendDice[0]` is strict. RULES.md §8 implies but does not state this; standard Risk rule, mirror as-is.
2. **`defender.armies` can go to -1.** The attack loop condition is `defender.armies > -1`, so the country falls when armies hits -1. On capture (`defender.armies < 0`), `transferCountry` happens and the new owner places `armiesToMove - 1` armies (where `armiesToMove = settings.advanceArmies ? attacker.armies : min(attacker.armies, diceToRoll)`). So a defended country with 0 armies still requires one successful attack roll to fall. **This is a meaningful difference from standard Risk** (where 0-army countries are technically not legal). Justin's RULES.md §4 ("Computer game: minimum of zero armies per country") confirms iConquer allows 0-army countries; the -1 sentinel is the engine's way of representing "now empty and conquered."
3. `attacker.armies` becomes 0 at the moment the attacker can no longer continue — the loop `attacker.armies > 0` exits. The minimum-1-must-stay rule is enforced implicitly.

---

## 5. Cards & Turn-In

- Deck: 1 card per country, suits cycling 0,1,2 in country-iteration order (`(i % 3)`), plus 2 wilds (`suit: -1`).
- On capture (`hasWonThisTurn`), draw 1 card at end of turn via `takeCard`.
- Reshuffle: when `drawPile` is empty, all of `discardPile` is shuffled to `drawPile`.
- `mustTurnInCards`: set true when a player's hand exceeds 4 after eliminating an opponent (and `allowTurningInCards`).
- `needsCardTurnIn`: a UI flag that pauses the engine waiting for the human to choose cards.
- `bestCardsToTurnIn`: AI heuristic that prefers same-suit triples vs. one-of-each, prioritizing cards whose `countryId` is currently owned (so the +2 army bonus lands on owned territory).
- Set value: starts at `5`, increments by `settings.cardValues` (default `1`) each set turned in.

---

## 6. Fortification

`beginFortifyFrom(country)`:
- Movable armies = `country.armies - max(country.tiredArmies, 0)`. If ≤ 0, no-op.
- Sets `runtime.fortifyFrom = country`, `destinations = {country, ...ownedNeighbors(country)}`.
- Moves all movable armies into `player.unallocatedArmies` and zeroes the source country's armies (well, sets to `tired`).

`placeArmies` during Fortify into a destination ≠ source: increments `country.tiredArmies` by the placed amount (so those armies cannot move again this turn).

**Critical:** RULES.md §11 says "the territories are connected through owned territories (and the move happens only once per turn)". TS implementation only allows fortifying to **directly adjacent** owned countries (not arbitrary connected chains). This is a deviation from classic Risk but matches what the TS reference enforces. **Mirror the TS behavior** — RULES.md is documentation drift, not an active spec.

`tiredArmies` starts at `-1` (sentinel for "fresh"). The first `placeArmies` during fortify needs to handle the -1→0 transition; in the TS code this is implicit because `country.tiredArmies += actual` will go from -1 to (actual - 1). **TODO:** verify in parity tests that the Swift port handles this sentinel identically.

---

## 7. Country Picking

`randomlyPickCountries()`:
1. Shuffle all country IDs.
2. Pop from the end and assign round-robin to `playersOrder[i % length]`.

This means the *last* country in the shuffled list goes to player 0, the second-to-last to player 1, etc. Mirror exactly to preserve fixture parity.

---

## 8. Player Elimination

`removePlayer(playerId)`:
- Removes from `playersOrder`.
- If the eliminated index is ≤ currentPlayerIndex AND currentPlayerIndex > 0, decrements currentPlayerIndex (so the next-player rotation lands on the same logical "next").

**Subtle:** the player's countries have already been transferred to the attacker via `transferCountry` calls during the conquering attack. The player struct itself is left in `players` map but is no longer in `playersOrder`.

---

## 9. State Layout to Mirror

| TS field | Swift mirror notes |
|---|---|
| `phase`, `turnPhase`, `turnNumber`, `currentPlayerIndex` | top-level on `Game` |
| `currentCountryId` | top-level; affects `selected` flags |
| `mustTurnInCards`, `needsCardTurnIn` | top-level booleans |
| `winnerId` | optional |
| `currentCardSetValue` (starts 5) | top-level |
| `conquestEvents` | top-level counter |
| `playersOrder: PlayerId[]` | array on `Game`; players removed on elimination |
| `players: Map<PlayerId, PlayerState>` | dictionary; players persist after elimination |
| `countries: Map<CountryId, CountryState>` | dictionary |
| `runtime: Map<PlayerId, RuntimeState>` | per-player UI state (selected attacker, fortify source, valid destinations, pendingAdvance) |
| `drawPile`, `discardPile: Card[]` | arrays |

**`PlayerState` fields:** `id, name, color, isComputer, countries[], cards[], unallocatedInitialArmies, unallocatedArmies, hasWonThisTurn, victories, defeats`.

**`CountryState` fields:** `id, ownerId?, armies, tiredArmies (-1 sentinel), reserveArmies, selected`.

---

## 10. AI Plugin Surface (Phase 2 only — read but don't port yet)

The `GameEngine` exposes a *lot* of helper methods for AI strategies:
- `attackRandomCountries(playerId)`, `attackVulnerableCountries(playerId)`, `attackUntilWinOrLose(from, to)`
- `mostVulnerableNeighbor`, `findWeakestEnemyNeighbor`, `threat(country)`
- `allocateArmiesRandomly`, `allocateArmiesToMostThreatened`, `pickRandomUnownedCountry`, `randomOwnedCountry`
- `updateReserveArmies`, `fortifyVulnerableCountries`

These are AI utilities tangled into the engine. **Phase 1 stays focused on the rules engine.** When Phase 2 ports the AI plugins, these helpers should be *separated* into a `IconquerAI` namespace (free functions or extension on `Game`) — but Phase 1 may still need to expose the underlying primitives so that AI code in Phase 2 can be written without re-touching `Game` internals.

---

## 11. Settings (defaults from `defaults.ts`)

| Setting | Default | Notes |
|---|---|---|
| `assignCountries` | true | If true, `startGame` immediately auto-distributes |
| `attacksPerClick` | `AttackUntilWinOrLose` | Modes: Once / UntilLossesExceed / UntilWinOrLose |
| `diceToRoll` | 3 | Caps attacker dice; defender uses 2 dice if this > 1 AND defender > 1 |
| `lossesExceedValue` | 5 | Threshold for `UntilLossesExceed` mode |
| `cardValues` | 1 | Increment per set turned in |
| `allowTurningInCards` | true | Whether forced turn-in fires |
| `advanceArmies` | true | If true, all attacker armies advance on capture; else `min(attacker, diceToRoll)` |

Default 6 player colors (hex): red `#e53935`, orange `#fb8c00`, yellow `#fdd835`, green `#43a047`, blue `#1e88e5`, purple `#8e24aa`.

---

## 12. Map Definition

`MapDefinition` structure (from `types/game.ts` and `world.ts`):
- `id, name, background, baseWidth: 1820, baseHeight: 950`
- `countries: Record<CountryId, {x, y, width?, height?, dotOffsetX?, dotOffsetY?, neighbors: CountryId[]}>`
- `continents: Record<ContinentId, {armies: number, countries: CountryId[]}>`

Loaded from `public/maps/iconquer-world/Countries.json` and `Continents.json`. The Swift port will read these files via `Bundle` (test bundle for parity tests, app bundle for the iconquer app shell).

---

## 13. Decisions Locked In

1. **Mirror the TS RNG bit-for-bit** (mulberry32). No replacement.
2. **Mirror the TS combat semantics including the `defender.armies = -1` sentinel** for capture. Document in DocC.
3. **Mirror the TS fortify constraint** (adjacent owned only, not arbitrary connected paths). RULES.md is documentation drift.
4. **Mirror the `tiredArmies = -1` fresh-army sentinel.** Capture in a typed wrapper if it helps clarity.
5. **`incomeForCountries` formula** preserved exactly: `count < 9 ? 3 : floor(count / 3)`, plus continent bonuses.
6. **Hardcoded `unallocatedInitialArmies = 20`** preserved (no setting for it). 5-army drip-feed during InitializeArmies preserved.
7. **Card deck composition** preserved: 1 per country (cyclic suit) + 2 wilds.
8. **Phase 1 ports the rules engine only.** AI helper methods remain unported until Phase 2; the protocol surface (`PlayerStrategy`) lands as protocol-only stubs.

---

## 14. Decisions Resolved (2026-04-06)

1. **AI lives in a separate `IconquerAI` module as free functions** that take a `Game` (or `inout Game`) as an argument. This keeps the rules engine pure and lets Phase 2 modernize AI radically — including LLM-backed `PlayerStrategy` implementations as Justin has hinted at in `SPEC.md`'s "cognition fabric" experiment. The Phase 1 engine still exposes the lower-level primitives that AI strategies need (neighbor queries, threat scoring, etc.) as part of the public `Game` API, but the *strategies themselves* never live in `IconquerCore`.

2. **No hardcoded constants — anywhere.** `unallocatedInitialArmies` is no longer a magic `20`; it becomes `Settings.initialArmiesPerPlayer`. Default value `20` lives in the `Settings` initializer, not in the engine. **Generalize this:** every magic number from the TS source (`5`-army drip-feed in InitializeArmies, `5` starting card-set value, `4` card-hand threshold, `9` country threshold for income, etc.) becomes a named field on `Settings` (or a related config struct). This aligns with `01_CODING_RULES.md` and `11_NO_HARDCODED_CONSTANTS.md`.

3. **Pending-input type instead of `needsCardTurnIn` flag on `Game`.** Model human-input pauses as a `PendingInput` enum (e.g. `case awaitingCardTurnIn(player:)`, `case awaitingAdvanceCount(from:to:)`) returned alongside the `Game` value or carried as a non-state field. The `Game` itself stays pure rules. The phase machine reads "is there a pending input that blocks progress?" via a single computed property, replacing both `mustTurnInCards` and `needsCardTurnIn` boolean state.

## 14b. Settings Catalog (extracted magic numbers)

Every constant below moves out of code and into a `Settings` (or sub-config) struct. Defaults match the TS reference exactly so parity tests pass.

| Setting | Default | TS source location |
|---|---|---|
| `assignCountries` | true | defaults.ts |
| `attacksPerClick` | `.untilWinOrLose` | defaults.ts |
| `diceToRoll` | 3 | defaults.ts |
| `lossesExceedValue` | 5 | defaults.ts |
| `cardValueIncrement` | 1 | defaults.ts (`cardValues`) |
| `allowTurningInCards` | true | defaults.ts |
| `advanceArmies` | true | defaults.ts |
| `initialArmiesPerPlayer` | 20 | game.ts:82 (was hardcoded) |
| `initialArmyDripPerTurn` | 5 | game.ts:258 `Math.min(5, ...)` |
| `cardHandLimit` | 4 | game.ts:278 `cards.length > 4` |
| `firstCardSetValue` | 5 | game.ts:47 `currentCardSetValue = 5` |
| `incomeMinimumThreshold` | 9 | game.ts:502 `count < 9 ? 3 : ...` |
| `incomeMinimumValue` | 3 | game.ts:502 |
| `numberOfWildCards` | 2 | game.ts:872-873 |
| `cardSuitsPerCountry` | 3 | game.ts:870 `(i % 3)` |

If grouping these all on a single flat `Settings` struct gets unwieldy, split into `RuleSettings`, `CombatSettings`, `CardSettings`, `EconomySettings`. Decide during Step 4 RED/GREEN cycles when the surface area is concrete.

---

## 15. Next Step on the Phase 1 Checklist

Step 3 — **Parity fixture infrastructure**. Build `iconquer/scripts/dump-parity-fixtures.mjs` that drives `src/core/game.ts` through scripted scenarios with seed `42` and writes `GameSnapshot` JSON files into `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/`.

Initial scenarios:
1. `01_start_pick_countries.json` — startGame with assignCountries=false → assert PickCountries phase, no owners
2. `02_random_country_distribution.json` — startGame with assignCountries=true, seed=42 → assert distribution
3. `03_initialize_armies_drip.json` — drive InitializeArmies through one player's full 20-army allocation
4. `04_reinforcement_continent_bonus.json` — set up a player owning Australia, assert income = floor(N/3)+2 (or 3+2)
5. `05_attack_capture.json` — single attack that captures, seed for deterministic dice
6. `06_attack_lose.json` — single attack that fails
7. `07_player_elimination.json` — capture a player's last country, assert removal
8. `08_card_turn_in.json` — accumulate 5 cards, force turn-in, assert army bonus
9. `09_fortify.json` — full fortify cycle including tiredArmies sentinel
10. `10_short_game.json` — full game to victory (3 players, 5 countries, ~10 turns)
