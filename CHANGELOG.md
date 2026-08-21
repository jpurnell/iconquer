# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `turnInCards` accepted any three cards. Risk requires three of a kind or
  one of each, with wilds standing in for either, and the deck has carried
  suits and wilds all along — only the check was missing. Whole valid sets
  are now required, so a four-card hand no longer loses its fourth card to
  the integer division while paying for a single set.
- `getSnapshot()` now reports `cardSetsTurnedIn`. The escalating trade-in
  value is a real part of the position, and a consumer reading a snapshot
  could not previously tell a 4-army set from a 20-army one. All 12 parity
  fixtures gained the key and nothing else changed.
- `pickCountry` advanced the seat with `selectNextAlivePlayer()`, which skips
  players holding zero countries. During `PickCountries` every player holds
  zero, so the rotation parked on the first seat and that seat could claim the
  entire board. Setup now uses a plain +1 rotation, and a claim naming any
  player other than the current one is rejected — territories are claimed one
  at a time, in seat order, as in a physical Risk setup.
- `beginFortifyFrom` set the origin's garrison to `max(tiredArmies, 0)`, so a
  fortify could empty a territory to zero armies. Official Risk requires one
  army left behind, and IconquerCore already enforced it; the floor is now 1
  here too.
- Card trade-ins paid 5 armies for the first set and +1 per set thereafter.
  They now follow the official progressive schedule (4, 6, 8, 10, 15, 20 …,
  then +5 per set), matching IconquerCore's `CardValueMode.officialProgressive`.
  Escalating trade-in values are what push a Risk game to end, so this changes
  game length, not just a number.

These three were invisible for as long as they did because the parity fixtures
masked them: every fixture named the claiming player explicitly, which hid the
broken rotation, and in `10_card_turn_in_set_value_bump` the smaller income the
broken rotation produced exactly cancelled the larger card bonus. Re-dump the
fixtures (`npm run dump-fixtures`) after any engine rule change — 08 and 10 had
been stale against this engine before this round of fixes.

### Added

- Initial project scaffold with MLXTest executable target
- Swift-DocC plugin for documentation generation
- os.Logger-based logging
