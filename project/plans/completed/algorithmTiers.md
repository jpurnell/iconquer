The progression from v1.0 to v2.0 was about fixing obvious bugs (drip-feeding, single-roll attacks, 2:1
   threshold). Those were clear heuristic errors. But now we're at a point where tweaking thresholds
  gives diminishing returns — going from 1.1x to 1.0x attack threshold won't fundamentally change the
  agent's behavior.

  Here's how I see the algorithm landscape:

  ┌───────────────────────┬─────────────────────────┬───────────────────────────┬───────────────────┐
  │         Tier          │        Approach         │          Example          │   Expected Elo    │
  │                       │                         │                           │       Range       │
  ├───────────────────────┼─────────────────────────┼───────────────────────────┼───────────────────┤
  │ T1: Fixed heuristic   │ Hand-coded if/then      │ GreedyAgent,              │ 1200-1700         │
  │                       │ rules                   │ StrategicAgent v2.0       │                   │
  ├───────────────────────┼─────────────────────────┼───────────────────────────┼───────────────────┤
  │ T2: Parameterized     │ Same rules, but         │ StrategicAgent with       │                   │
  │ heuristic             │ thresholds tuned by     │ optimized constants       │ 1400-1750         │
  │                       │ search                  │                           │                   │
  ├───────────────────────┼─────────────────────────┼───────────────────────────┼───────────────────┤
  │ T3: Expectiminimax /  │ Look-ahead tree search  │ Classic game AI           │ 1600-1900         │
  │ Monte Carlo           │ with dice probability   │                           │                   │
  ├───────────────────────┼─────────────────────────┼───────────────────────────┼───────────────────┤
  │ T4: LLM-guided        │ Multi-turn reasoning    │ MCPMultiTurnAgent         │ Unknown (creative │
  │                       │ with analysis tools     │                           │  but slow)        │
  ├───────────────────────┼─────────────────────────┼───────────────────────────┼───────────────────┤
  │ T5: Learned policy    │ Train a model on        │ Neural net or RL          │ Potentially       │
  │                       │ tournament transcripts  │                           │ highest           │
  └───────────────────────┴─────────────────────────┴───────────────────────────┴───────────────────┘

  The threshold for moving beyond T1/T2: When tuning the existing parameters (attack ratio, placement
  priority, card timing) can't improve win rate by more than ~5% per iteration, the algorithm itself is
  the bottleneck.

  We're there now. StrategicAgent's structure — score countries, pick best, attack or not — has a
  ceiling. The next real jump would be:

  1. T2 quick win: Use the tournament data to automatically tune the thresholds (evolutionary search over
   the parameter space — run 100 tournaments with random threshold combinations, pick the winner)
  2. T3 bigger jump: Implement a simple 1-ply lookahead that evaluates "if I attack X with Y armies,
  what's my expected position after?" using the combat probability math
  3. T4 already built: The MCPMultiTurnAgent can reason about strategy — we just haven't tested it
  against real LLM APIs yet

  Which direction interests you — automated parameter tuning (T2), lookahead search (T3), or testing the
  LLM agent (T4)?
