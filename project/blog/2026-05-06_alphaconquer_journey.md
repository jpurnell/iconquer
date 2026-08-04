# Teaching a Neural Network to Play Risk: The AlphaConquer Journey

*How a 24-year-old Mac game became a testbed for modern AI — and why the obvious approach fails spectacularly.*

---

## The Starting Point

iConquer started life in 2002 as a Mac OS X game — a polished Risk clone built in Objective-C by my high school friend, Andrew Zamler-Carhart. It was a great game. We played it constantly. But when the Mac moved to the App Store and then to Swift, iConquer didn't make the transition. It just quietly stopped running on modern systems.

I'd always wanted to rebuild it. I had the idea for years — port it to Swift, make it multiplatform, bring it to iPhone and iPad and maybe even Vision Pro. But I never had the time or, honestly, the expertise to pull off something that ambitious solo. Life got in the way.

Then Claude happened. With AI-assisted development, I could finally do it — and not just rebuild it, but *extend* it in ways neither of us imagined back in 2002. Andrew gave his blessing, and I got to work.

But I didn't just want a faithful port. I wanted the AI opponents to actually be *good*.

Not "picks random legal moves" good. Not even "follows sensible heuristics" good. I wanted an AI that *learns* to play — that discovers strategies humans haven't thought of — the way AlphaGo discovered Move 37.

This is the story of that attempt, and all the ways it went wrong before it went right.

## Phase 1: The Heuristic Baseline

Before trying anything learned, I built three hand-coded agents to establish a baseline:

- **RandomAgent**: Picks uniformly from legal moves. Exists solely as a punching bag.
- **GreedyAgent**: Always attacks the weakest neighbor. Simple, but shockingly effective — 1651 Elo in tournament play, winning over 60% of games.
- **StrategicAgent**: Evolved via 300,000-game parameter search. Focuses on continent control, fortifies borders, knows when to stop attacking. 1517 Elo.

The StrategicAgent's parameters were tuned by running massive round-robin tournaments and selecting configurations that won the most. It plays a recognizable "good Risk strategy" — secure Australia early, build up, expand methodically.

But it's still just following rules I wrote. It can't discover anything I didn't encode.

## Phase 2: The Naive Supervised Approach (And Why It Collapsed)

The obvious first attempt: play thousands of games, label each game state with whether that player eventually won, train a neural network to predict "will this player win from this position?"

I built a small MLP (12→64→32→1) and trained it on 50,000 tournament transcripts. Every state in a game that Player 3 won got labeled 1.0 for Player 3. Version 1 hit 89.9% validation accuracy and earned 1471 Elo — worse than the heuristics, but a respectable first showing.

Then I scaled up. 20.5 million training examples. 400x more data. Surely that would help?

**It collapsed to 1351 Elo — a 19% win rate.** The agent got *worse* with more data.

### The Three Fatal Flaws

Debugging this failure revealed three fundamental problems:

**1. Noisy labels.** In a game with 1000 moves, the random opening position where Player 3 placed one army in Peru gets the same label (1.0) as the decisive moment 800 moves later when Player 3 had 30 armies on South America's border. The network learns that *every* position in a winning game is good, which means it learns nothing about *why* positions are good.

**2. Features too coarse.** The 12-dimensional feature vector (territory ratio, army percentage, card count, etc.) captures aggregate statistics but loses all spatial information. It can't distinguish "I have 20 armies in one stack on a fortified border" from "I have 20 armies scattered across the map in single-unit garrisons." These are radically different positions, but they look identical in 12 numbers.

**3. Train-use mismatch.** The network was trained to predict "will this player win?" but used at decision time to compare "is position A or position B better?" When two candidate positions differ by one army placement, the predicted win probabilities differ by 0.001 in the 4th decimal place. There's no meaningful gradient for the agent to follow.

More data amplified the noise without fixing the signal. A classic case of scaling the wrong approach.

## Phase 3: The Research Pivot

Three papers pointed the way forward:

- **Carr 2020 ("D.A.D")**: Used a *per-territory* Graph Convolutional Network instead of aggregate features, and trained with *TD(λ) temporal-difference learning* instead of win/loss labels. The key insight: don't label a position as "winning" or "losing" — instead, train the network to predict "how much better did things get from this position to the next one?" This removes the noisy-label problem entirely. Achieved a 35% win rate against 5 AI opponents.

- **GG-Net (IEEE 2023)**: Formalized the graph structure — territories as nodes, adjacencies as edges — showing it generalizes across different maps.

- **AlphaZero**: The gold standard. Train a value network through self-play, guide decisions with Monte Carlo Tree Search. The network learns *from its own games* rather than from heuristic agents whose strategies may be suboptimal.

## Phase 4: Building the Infrastructure

### The Graph Value Network (AccelerateGVN)

The new architecture treats the Risk map as a graph:

- **42 nodes** (one per territory), each with 14 features: owner one-hot (6 players), army fraction, continent membership one-hot (6 continents), and a border flag
- **3-layer Graph Convolutional Network** that propagates information along adjacency edges — so each territory "knows" about its neighbors' armies and ownership
- **Global features** (72-dimensional): per-player aggregate stats including continent control, army income, card count, and a defense score
- **Mix layer** fuses the graph embedding with global features, outputs a value per player

The critical infrastructure decision: I wrote the entire forward pass, backward pass, and Adam optimizer by hand using Apple's Accelerate framework (cblas + vDSP). No PyTorch, no MLX, no autograd. Why?

Because the MLX-based version projected at 28 hours per training run and crashed with out-of-memory errors on Metal. The hand-rolled Accelerate version completed the same run in **75 minutes** — a 22x speedup — because it avoids building a gradient tape across entire game sequences. TD(λ) targets are precomputed scalars; there's no computational graph to retain.

### Monte Carlo Tree Search

MCTS is the other half of the AlphaZero recipe. Instead of evaluating one position and picking the best immediate move, MCTS:

1. **Selects** a promising path through the game tree using the PUCT formula (balancing exploitation of known-good moves vs. exploration of untried ones)
2. **Expands** a new node at the frontier
3. **Evaluates** it with the value network (no rollout to game end — that's the "Zero" innovation)
4. **Backs up** the value through the tree, updating visit counts

After 100-1000 simulations, the most-visited root child is the best move. The search effectively gives the network multiple "looks" at each decision, compensating for value estimation errors.

I built the full engine: `MCTSTree`, `MCTSNode`, `PUCTSelector`, `MCTSSimulator`, `MCTSAgent` — all generic over a `ValueNetworkBackend` protocol so the same search code works with any value network architecture.

## Phase 5: The Self-Play Pipeline

Tonight, I shipped the final piece: `iconquer-train`, an executable that ties everything together:

```
Iteration 0 (bootstrap):
  Greedy + Strategic + Random agents play 1000 games
  → Encode 200,000 state transitions as graph features
  → Train GVN with TD(λ) for 50 epochs
  → Save weights checkpoint

Iteration 1+ (self-play):
  MCTS + trained GVN plays 1000 games against itself
  → Encode new transitions
  → Train on self-play data
  → Save improved weights
  → Repeat
```

The bootstrap iteration completed in under 3 minutes on an M-series Mac — 1000 heuristic games generated in 2 seconds, 200K transitions encoded, training early-stopped at epoch 15 when the TD error converged.

The self-play iterations are slower — each MCTS decision requires 100 forward passes through the GVN, and a 6-player game has roughly 1000 decisions. But this is an overnight job, not a blocked developer.

## Phase 6: Closing the Loop

The most satisfying part: wiring the trained agent into the actual game. The SwiftUI app now has four AI strategies:

| Strategy | What it does |
|----------|-------------|
| Random | Uniform random legal moves |
| Greedy | Attack weakest neighbor |
| Strategic | Evolved heuristic with continent focus |
| **Learned** | **MCTS + trained GVN value network** |

And a "Watch AI" spectator mode that launches 6 AI players — a mix of all four strategies — and lets you sit back and watch them play. It's mesmerizing in a way that watching random bots never was. The strategic agents secure continents. The MCTS agents sometimes make surprising moves that only make sense three turns later.

## What I Learned

**1. More data can hurt.** The v1→v2 supervised learning collapse was the most instructive failure. The instinct to "just add more data" is dangerous when the labeling scheme is fundamentally noisy. Fix the signal before scaling the noise.

**2. The right abstraction matters more than the right algorithm.** Switching from 12 aggregate features to a 42-node graph didn't just improve accuracy — it made entirely new strategies learnable. A network that can see "these three territories form a chokepoint" will discover strategies that a network seeing only "I own 7/42 territories" never can.

**3. Hand-rolling math is sometimes the right call.** Autograd frameworks are brilliant for research iteration, but when your training loop has a specific structure (precomputed TD targets, no cross-game gradient flow), a hand-rolled implementation can be an order of magnitude faster. The 28-hour-to-75-minute speedup made the difference between "theoretically possible" and "actually ships."

**4. Ship the infrastructure, not the results.** The trained agent isn't superhuman yet. It might not even be better than the hand-coded heuristics after one night of training. But the *pipeline* is built: generate games, encode features, train network, evaluate, iterate. Every future improvement is incremental. The hard part was building the loop.

## What's Next

The training run is churning through MCTS self-play games as I write this. Tomorrow I'll check the weights, run a validation tournament, and — if the numbers look good — bundle the trained model into the app.

The long-term vision is bigger: a tournament server where different AI architectures compete continuously, with strategy documents generated from game transcripts by LLMs. An AI company benchmark where anyone can submit an agent and see how it ranks.

But that's future work. Tonight, a neural network is teaching itself to play Risk by playing against itself, on a game my friend Andrew built in Objective-C in 2002. I never could have done this alone — not the Swift port, not the graph neural network, not the MCTS engine. But with Claude as a collaborator, a project I'd been dreaming about for years finally became real, and then became something neither Andrew nor I ever imagined it could be.

Some loops take 24 years to close. This one was worth the wait.

---

*Built with Swift 6, Accelerate framework, and Claude Code. No GPUs were used in the making of this AI — it's all CPU-side cblas and vDSP, which turns out to be fast enough when you don't need autograd.*
