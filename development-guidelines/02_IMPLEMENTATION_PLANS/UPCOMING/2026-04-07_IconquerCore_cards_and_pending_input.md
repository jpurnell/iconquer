# Design Proposal: IconquerCore — Cards & PendingInput (Phase 1 Step 4.6)

**Status:** APPROVED (2026-04-07) — all four §10 questions resolved in favor of the proposal's recommended defaults: test-only setup helper YES, `deckSignature` field on `GameSnapshot` YES (with one-time re-dump of fixtures 01–08), collapse `mustTurnInCards`/`needsCardTurnIn` into `pendingInput != nil`, `PendingInput` lives in its own file.
**Date:** 2026-04-07
**Author:** Justin (with Claude)
**Scope:** Phase 1 Step 4.6 of `CURRENT_iconquer_core_phase1.md`

---

## 1. Goal

Bring `IconquerCore` to parity with the TypeScript oracle on the **card lifecycle**: drawing on conquest, accumulating a hand, the forced-turn-in trigger when the hand grows too large, the AI-style "best set to turn in" heuristic, the army bonus (set value, +2 per owned-country card), and the discard/reshuffle path when the draw pile empties.

This is also the natural place to finally introduce `PendingInput`, the long-deferred replacement for the `mustTurnInCards` / `needsCardTurnIn` boolean pair on `Game`. Step 4.6 is the first sub-step where the engine actually needs to *pause* and wait on a human decision (which cards to turn in), so the type design has a concrete forcing function.

## 2. Non-Goals

- No `apply(_: GameAction)` enum in this step. Public direct mutating methods stay. The action layer arrives in Step 5 (REFACTOR) once the surface is stable.
- No AI strategy port. `bestCardsToTurnIn` is implemented as a *helper* on `Game` (callable from tests and from Phase 2's `IconquerAI` module), but no `PlayerStrategy` glue.
- No card-dealing UI affordances beyond what the parity fixtures need.
- `drawPile` and `discardPile` will *not* be added to ``GameSnapshot``. They remain `public private(set)` on `Game` (already in place since Step 4.2). The TS oracle's snapshot doesn't include them either, so parity tests don't need them.

## 3. The TypeScript Oracle in Brief

| TS member | What it does |
| :--- | :--- |
| `initializeDeck()` | Builds 1 card per country (cycling suits 0/1/2) + N wild cards (suit -1). Already mirrored in Step 4.2. |
| `shuffleDeck()` | Drains `discardPile` into `drawPile` via an RNG shuffle. Already mirrored. |
| `takeCard()` | Pops from front of `drawPile`; if empty, calls `shuffleDeck()` first. Returns `Card | null`. |
| `finishTurn()` (line 425) | If `currentPlayer.hasWonThisTurn`, calls `takeCard()` and pushes to player's hand. |
| `bestCardsToTurnIn(playerId)` | Pure heuristic: prefers same-suit triples vs one-of-each, prioritizing cards whose `countryId` is currently owned (so the +2 army bonus lands on owned territory). |
| `turnInCards(playerId, cards)` | For every group of 3, grants `currentCardSetValue` armies to `unallocatedArmies`, then bumps `currentCardSetValue` by `settings.cardValues`. For each card whose country the player still owns, adds `+2` armies to that country. Removes the cards from the player's hand and pushes them onto the discard pile. |
| `mustTurnInCards` flag | Set during attack flow when an opponent is eliminated AND `attackerPlayer.cards.length > 4` AND `allowTurningInCards`. |
| `needsCardTurnIn` flag | UI flag that pauses the engine waiting on a human decision. Set when the active player is human AND `mustTurnInCards` is true and they're now in a state that needs to resolve before continuing. |

The TS engine's two-flag scheme conflates *"the engine demands a turn-in"* with *"specifically, we are blocked waiting for the human"*. Phase 1 has a chance to clean this up.

## 4. PendingInput

```swift
/// A point where the engine has paused waiting on an external decision
/// (typically a human player). Replaces the TS reference's two-flag
/// `mustTurnInCards` / `needsCardTurnIn` scheme with a single optional
/// stored on ``Game``.
///
/// Public API on ``Game`` is allowed to advance the state machine only
/// when ``Game/pendingInput`` is `nil`. Each case names the player whose
/// decision is awaited and carries any context the resolver needs.
public enum PendingInput: Sendable, Hashable {
    /// The named player must turn in cards before the engine continues.
    /// Triggered after eliminating an opponent or at the start of a turn
    /// where the player's hand exceeds ``Settings/cardHandLimit``.
    case awaitingCardTurnIn(player: PlayerId)
}
```

**Initially this enum has exactly one case.** Adding more later (e.g. `awaitingAdvanceCount(from:to:)` for the post-capture army-advance choice once we model that fully) is purely additive.

### 4.1 Where it lives on `Game`

```swift
public struct Game: Sendable {
    // ... existing state ...
    public private(set) var pendingInput: PendingInput?
}
```

### 4.2 How it interacts with `GameSnapshot`

`GameSnapshot` keeps its `mustTurnInCards: Bool` and `needsCardTurnIn: Bool` fields *exclusively for parity-fixture compatibility*. They're computed in `Game.snapshot()` like this:

```swift
mustTurnInCards: pendingInput != nil && /* triggered-from-elimination context */,
needsCardTurnIn: pendingInput != nil
```

The trick: the TS reference distinguishes "*should* turn in" (set during attack) from "*blocked waiting* to turn in" (set when the engine actually pauses). Phase 1 treats them as identical from the engine's view — both flags become `true` when `pendingInput == .awaitingCardTurnIn(...)`. **If a parity fixture cares about the difference, it's a real semantic divergence and we revisit then, not now.** None of the planned fixtures (09, 10) should — the human-driven turn-in resolves immediately in dump scenarios via direct `turnInCards` calls.

### 4.3 The blocker contract

Public mutating methods on `Game` that advance the state machine grow a uniform guard:

```swift
guard pendingInput == nil else { return }  // engine is paused waiting on input
```

This applies to: `pickCountry`, `placeArmies`, `attack`, `finishAttackPhase`, `beginFortifyFrom`, `finishTurn`. The only methods that bypass it are the ones that *resolve* the pending input — `resolveCardTurnIn(playerId:cards:)` — and the read-only API.

**Pure Phase 1 callers (the parity fixtures) never observe `pendingInput != nil`** because the dump scripts always resolve immediately. The guard exists so that future SwiftUI code can't accidentally drive the engine forward while a human prompt is on screen.

## 5. Settings Additions

Three new fields, all defaults from §14b of the TS oracle notes (no magic numbers in engine code):

```swift
public var cardHandLimit: Int                  // default 4 — game.ts:278 `cards.length > 4`
public var firstCardSetValue: Int              // default 5 — game.ts:47 `currentCardSetValue = 5`
public var cardValueIncrement: Int             // default 1 — defaults.ts `cardValues`
public var ownedCardCountryBonus: Int          // default 2 — game.ts:582 `armies += 2`
public var allowTurningInCards: Bool           // default true — defaults.ts
```

`cardSuitsPerCountry` and `numberOfWildCards` already landed in Step 4.2.

## 6. New `Game` State

```swift
public private(set) var currentCardSetValue: Int  // initialized from settings.firstCardSetValue
public private(set) var pendingInput: PendingInput?
```

`currentCardSetValue` mirrors the TS reference's monotonically-rising set value: starts at 5, climbs by `cardValueIncrement` (default 1) every time a player turns in a triple. Tests can read it after a turn-in to verify the bump.

## 7. New / Modified `Game` API

```swift
// New
public mutating func finishTurn()                                  // ends a player's Play turn
public mutating func resolveCardTurnIn(_ playerId: PlayerId,
                                       cards: [Card])              // human resolution of pendingInput
public func bestCardsToTurnIn(for playerId: PlayerId) -> [Card]    // pure helper, computer + tests

// Modified
private mutating func takeCard() -> Card?                          // pops from drawPile, reshuffles if empty
private mutating func turnInCards(_ playerId: PlayerId,
                                  cards: [Card])                   // shared by resolve + future AI

// Modified attack flow:
// after a successful capture that eliminates the defender player AND the attacker
// holds more than `settings.cardHandLimit` cards AND `settings.allowTurningInCards`,
// set `pendingInput = .awaitingCardTurnIn(player: attacker)`.
```

## 8. The `bestCardsToTurnIn` Heuristic

Direct port of the TS algorithm (lines 512–569) — it's pure, deterministic, and used by both the AI plugin layer and parity tests. **No simplification.** The structure (soldiers/cannons/horses/wilds with `unshift` for owned-country cards) is preserved so the output is bit-identical.

This is a pragmatic choice: even though `IconquerAI` is the long-term home for AI helpers, this particular function lives in the rules engine because (a) `turnInCards` validation might want to reference it later and (b) computer-player turn-ins call it directly from the attack flow when `mustTurnInCards` triggers and the player is a computer. Phase 2 can move it to `IconquerAI` if it turns out to be unused by `IconquerCore`'s callers.

## 9. Parity Fixtures

Three new scenarios in `dump-parity-fixtures.ts`. Each writes one new JSON file under `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/`.

| # | Name | Drives | Verifies |
| :--- | :--- | :--- | :--- |
| 09 | `09_card_draw_on_conquest` | Line map `North-Middle-South`, P1 captures Middle from P2 (P2 still alive via South), `finishTurn()` | P1's hand grows by 1; deck size shrinks; `hasWonThisTurn` cleared on the next turn open |
| 10 | `10_card_turn_in_set_value_bump` | Manually deal P1 a triple via repeated capture-and-finish-turn cycles, then call `turnInCards()` directly | `currentCardSetValue` bumps from 5 to 6; P1.unallocatedArmies += 5; cards moved from hand to discard pile (verified via deck-state hash since drawPile/discardPile aren't snapshotted) |
| 11 | `11_forced_turn_in_after_elimination` | Pre-load P1 with 5 cards (via setup helper), capture P2's last country | `pendingInput = awaitingCardTurnIn(P1)` → `mustTurnInCards = true && needsCardTurnIn = true` in snapshot |

**Fixture 11 is the first that exercises `PendingInput`.** It also forces us to introduce a small **test-only setup helper** (the `Game.testingApply(...)` style we discussed during Step 4.4 planning but didn't end up needing) so the dump script can pre-stuff a player's hand without playing 5 conquest turns. The Swift side gets a matching helper.

If the test-only helper feels like scope creep for one fixture, we can instead drive 5 real conquest turns end-to-end. That's slower to write but adds zero engine surface area. **Default: implement the test helper** — its blast radius is small (one method, gated behind a `testing_` prefix in the public API, with a DocC warning) and it'll be reused for fortify/cards combinations later.

### 9.1 Deck-state hashing

Fixture 10 needs to assert that cards moved from hand to discard pile, but `GameSnapshot` doesn't surface piles. Two options:

**(a)** Add a `deckSignature: String` field to `GameSnapshot` (a stable hash of `drawPile + discardPile`). Cheap, deterministic, doesn't leak the cards themselves.

**(b)** Add an opt-in field on `GameSnapshot` (`var deckState: DeckSnapshot?`) that's only populated when a setting flag is on.

**Recommendation: (a).** It's one Codable field, the hash is one line, parity fixtures get it for free. Justin's call.

## 10. Open Questions for Justin

1. **Fixture 11 test helper:** OK to add a `Game.testing_dealCard(_:to:)` method (or similar) gated behind a `testing_` prefix and DocC warning? Or would you rather drive 5 real conquest cycles?
2. **Deck signature in GameSnapshot:** OK with option (a) — adding `deckSignature: String`? Alternative is to skip fixture 10's discard-pile assertion entirely and only verify the visible state (`unallocatedArmies` bump, hand size, set value bump).
3. **`mustTurnInCards` vs `needsCardTurnIn` distinction:** Phase 1 collapses these to "pendingInput is set." If TS exposes a divergence (e.g. there's a state where `mustTurnInCards == true && needsCardTurnIn == false`), do you want the Swift port to mirror that quirk, or treat it as TS legacy and let Swift be cleaner? **My recommendation:** be cleaner; revisit only if a fixture catches a real difference.
4. **`PendingInput` location:** new file `Sources/IconquerCore/Rules/PendingInput.swift`, or co-located with `Game.swift`? **My recommendation:** new file — it's a public API surface that's likely to grow, and `Game.swift` is already 350+ lines.

## 11. RED → GREEN Order

Once approved, sub-steps for Step 4.6:

1. **4.6.0 — Settings + state:** add the 5 new Settings fields, `currentCardSetValue`, `pendingInput`, `PendingInput.swift`. Update `Game.start()` to initialize `currentCardSetValue = settings.firstCardSetValue`. Build green, no behavior change. Run existing 13 tests.
2. **4.6.1 — `takeCard` + `finishTurn`:** dump fixture 09, write the parity test, RED → GREEN.
3. **4.6.2 — `turnInCards` + `bestCardsToTurnIn`:** dump fixture 10, write the parity test (with deck signature), RED → GREEN. This is the bigger chunk — `bestCardsToTurnIn` is ~50 LOC of careful porting.
4. **4.6.3 — `pendingInput` blocker + forced turn-in:** dump fixture 11, write the parity test, RED → GREEN. Plumb the `pendingInput == nil` guards into the public mutating methods.
5. **4.6.4 — REFACTOR pass:** consolidate the new code, audit the public API surface, confirm zero magic numbers, doc-comment everything new.

Each sub-step is one commit on each repo, same atomic-checkpoint pattern as Steps 4.1–4.5.

## 12. Risks

- **`bestCardsToTurnIn` is delicate.** The TS algorithm interleaves shifts/unshifts/splices in ways that are easy to get subtly wrong in Swift. Mitigation: write a focused unit test BEFORE the parity test, asserting the heuristic's output on three hand-crafted hands (all-same-suit, one-of-each, mixed with wilds). If those pass, the parity test will pass.
- **Deck signature is a new contract.** Once `deckSignature` lands in `GameSnapshot`, we can't easily remove it without re-dumping every existing fixture. Mitigation: make it `Optional`, default to `nil` in fixtures 01–08 (re-dump won't include it because the TS dump doesn't write it), and only set it on fixtures that need it. Actually — that's awkward because the Swift snapshot would always emit nil, and fixture JSON wouldn't have the field at all → encoding/decoding asymmetry. Alternative: just always emit it and re-dump fixtures 01–08 once. **TBD with Justin.**
- **`pendingInput` guard could break a test setup that doesn't expect it.** Mitigation: the guard is added in step 4.6.3 LAST, after fixtures 09 and 10 are GREEN, so any regression is localized.

## 13. Acceptance for Step 4.6

- Three new parity fixtures (09, 10, 11) GREEN against the TS oracle.
- 16+ tests passing total. Zero warnings.
- `Game.pendingInput` exists and is honored by all public mutating methods.
- `currentCardSetValue` bumps correctly and is reflected in player `unallocatedArmies` after turn-in.
- `Settings` has 5 new fields, all with defaults matching TS, no magic numbers in engine code.
- `bestCardsToTurnIn` matches TS output bit-for-bit on at least 3 unit-test hands plus the parity-fixture hand.
- One commit per sub-step in each repo (5 commits total: one per 4.6.x).
- Checklist `Cards` row ticked.
- New session summary in `05_SUMMARIES/`.

---

**Awaiting Justin's review.** Move to `UPCOMING/` and mark APPROVED once questions in §10 are resolved.
