# How We Got Here: From a 19% Win Rate to Graph Neural Networks

## The Starting Point

On April 23-24, we built a five-tier AI agent stack for iConquer:

- **T1 (Greedy):** Attack anything weaker. Simple, surprisingly effective.
- **T2 (Strategic):** Evolved parameters via 300k-game search. Continent-focused.
- **T3 (MonteCarlo):** Simulate each battle 200 times before committing. The champion.
- **T5 (Learned):** A neural network trained on game data to evaluate board positions.

T5 was the ambitious one — train a small MLP (12→64→32→1) on tournament transcripts to learn what winning positions look like. The first version trained on 51,000 examples from 480 games and achieved 89.9% validation accuracy. In tournament play, it won 42% of games (Elo 1471, 3rd of 4).

## The Overnight Tournament

We ran 750,000 games overnight (April 24-25) to generate serious training data. Results:

| Agent | Elo | Win Rate |
|-------|-----|----------|
| montecarlo | 1575 | 52% |
| greedy | 1494 | 54% |
| learned (v1) | 1471 | 42% |
| strategic | 1460 | 46% |

Monte Carlo dominated by "thinking before attacking." Greedy's simplicity was surprisingly strong. Learned placed 3rd but showed promise.

## The Collapse: More Data Made It Worse

With 100,000 transcripts available, we retrained T5 v2 on **20.5 million examples** (400x more data). Validation accuracy held at 89.1%. But in tournament play:

**T5 v2 dropped to 19% win rate (Elo 1351).** Dead last. Worse than random.

The model had learned the base rate — "montecarlo usually wins from any position" — rather than learning to discriminate good moves from bad ones. More data amplified the noise rather than the signal.

## Attempted Fix: Winner Filtering

We added `--winner-filter` to the training pipeline and retrained v3 using only games won by strong agents. This recovered to 28% win rate (Elo 1405) — better than v2 but still last place. We built an automated self-play pipeline (`scripts/self-play-loop.sh`) to iterate, but the fundamental architecture was the bottleneck.

## Diagnosing the Real Problem

We identified three root causes:

1. **Noisy labels:** Every state in a winning game gets label 1.0 — even turn 1 when the board is random. With 20M examples, most are meaningless early-game states that teach the model nothing.

2. **Features too coarse:** 12 aggregate numbers (territory ratio, army ratio, etc.) lose all spatial information. The model can't tell "I should attack Brazil" from "I should attack Alaska" — both might show identical feature vectors.

3. **Train-use mismatch:** Trained to predict "will this player win?" but used to compare "is position A better than position B after this specific move?" The differences between pre/post-move scores are tiny in 12-dimensional aggregate space.

## The Research

We surveyed the academic literature on Risk AI and board game learning:

### Carr 2020 — "D.A.D: Using GCN and TD(λ) to play Risk"
The most directly relevant paper. Key findings:
- **Per-territory features on a graph:** Each of 42 territories gets a 14-dimensional feature vector (owner, armies, continent, border status). A Graph Convolutional Network processes the adjacency graph to learn spatial patterns automatically.
- **Dual pathway architecture:** GCN handles board topology; a separate fully-connected network handles global features (player totals, income, cards). Outputs are concatenated.
- **TD(λ) training:** Instead of binary win/loss labels, the network learns to predict its own future evaluations with exponentially decaying credit. Early-game states get weak signal; late-game states get strong signal. This eliminates our noisy-label problem entirely.
- **Same problem we hit:** The author explicitly noted that predicting win probability caused "the AI to struggle in positions where it was essentially won because the difference in evaluation was insignificant." Our exact symptom.
- **Result:** 35% win rate vs 5 strong AIs in a 6-player game (random chance = 17%).

### GG-Net (IEEE 2023) — Graph Neural Networks for Risk
- Uses GNN + genetic algorithm
- **Generalizes across different maps** without retraining — the graph structure IS the map
- 413 Elo above rule-based AI, 304 Elo above an AlphaZero approach
- Key insight: treat any map as a graph, and the same model works on duel, world, or custom maps

### AlphaZero (DeepMind) — The Gold Standard
- Dual-head network: value head (who wins?) + policy head (what move?)
- Self-play + MCTS training loop
- Game-agnostic architecture that mastered Chess, Go, and Shogi
- Board state as raw tensor input, minimal feature engineering

### TD-Gammon (Tesauro 1993) — The Pioneer
- Trained a neural network via TD(λ) self-play to play backgammon at world-class level
- 198 input features, 80 hidden units, 1 output
- Proved that TD learning + self-play can discover sophisticated strategies from scratch
- The direct ancestor of every modern game AI

## The Path Forward

The research points clearly to three changes:

1. **Per-territory graph encoding** instead of 12 aggregate features — preserves spatial structure, enables the network to learn positional patterns
2. **TD(λ) training** instead of supervised win/loss labels — clean signal that naturally weights late-game states over early-game noise
3. **Graph Neural Network** instead of flat MLP — learns from the adjacency structure, generalizes across maps

This approach is also inherently generalizable — swap the adjacency matrix and feature schema, and the same architecture works for any territory-based strategy game.
