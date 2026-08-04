# Design Proposal: Graph Value Network (T5 v2 Architecture)

**Date:** 2026-04-26
**Status:** Proposed
**Supersedes:** `IconquerAI_LearnedPolicyAgent.md` (flat MLP with aggregate features)

---

## 1. Objective

Replace the T5 LearnedPolicyAgent's flat MLP (12→64→32→1) with a **Graph Neural Network** trained via **Temporal Difference learning (TD(λ))**, following the approaches proven in academic Risk AI research (Carr 2020, GG-Net 2023) and general game AI (AlphaZero, TD-Gammon).

**Problems solved:**

1. **Noisy training signal.** Current approach labels every game state with the final win/loss outcome. Turn 1 (random board) gets the same label as Turn 50 (decisive advantage). TD(λ) fixes this by weighting training signal toward nearby states with exponential decay — early states contribute little, late states contribute a lot.

2. **Lost spatial information.** Current 12 aggregate features (territory ratio, army ratio, etc.) discard all positional information. The network can't distinguish "I own all of South America" from "I own scattered territories everywhere." Per-territory features on a graph preserve spatial structure.

3. **Architecture-data mismatch.** A flat MLP can't learn from adjacency relationships. A GCN operates directly on the map's graph structure, learning patterns like "border pressure from multiple neighbors" or "interior territory safety" automatically.

4. **Map-specific model.** Current features are hardcoded. A graph-based model treats the adjacency matrix as input, enabling the same architecture to work on any map (duel, world, custom) without retraining the feature extractor.

**Research basis:**
- Carr 2020: GCN + TD(λ) for Risk, 35% win rate in 6-player games (2x random chance)
- GG-Net (IEEE 2023): GNN + genetic algorithm, 413 Elo above rule-based AI, generalizes across maps
- AlphaZero: Dual-head (value + policy) network, self-play + MCTS
- TD-Gammon: TD(λ) self-play achieved world-class backgammon from scratch

**Master Plan Reference:** Phase 2 AI evolution. Replaces the current T5 architecture with a research-informed approach that generalizes to any territory-based strategy game.

---

## 2. Proposed Architecture

### Dual-Pathway Graph Value Network

```
Board Features                    Global Features
(N nodes × F_node features)       (F_global-dimensional vector)
        │                                  │
   ┌────▼────┐                       ┌─────▼─────┐
   │  GCN 1  │ (F_node → 64)        │   FC 1    │ (F_global → 64)
   │  ReLU   │                       │   ReLU    │
   └────┬────┘                       └─────┬─────┘
   ┌────▼────┐                             │
   │  GCN 2  │ (64 → 64)                  │
   │  ReLU   │                             │
   └────┬────┘                             │
   ┌────▼────┐                             │
   │  GCN 3  │ (64 → 64)                  │
   │  ReLU   │ (3-hop: continent-scale)    │
   └────┬────┘                             │
   ┌────▼────┐                             │
   │ Readout │ (mean pool → 64)            │
   └────┬────┘                             │
        │                                  │
        └──────────┬───────────────────────┘
              ┌────▼────┐
              │ Concat  │ (64 + 64 = 128)
              └────┬────┘
              ┌────▼────┐
              │  FC 2   │ (128 → 64)
              │  ReLU   │
              └────┬────┘
              ┌────▼────┐
              │  FC 3   │ (64 → P)     P = playerCount (2-6)
              │ Softmax │
              └─────────┘
                  │
           Win probability
           per player [P]

Dimensions scale with player count P and continent count C:
  F_node   = P + 1 + C + 1              (e.g., P=2, C=6 → 10; P=6, C=6 → 14)
  F_global = P + P × (5 + C)            (e.g., P=2, C=6 → 24; P=6, C=6 → 72)
  Output   = P                           (e.g., 2 or 6)

Separate models are trained per player count. Hidden dimensions (64)
are fixed regardless of P, so the learned spatial representations
transfer conceptually even though weights don't share across P values.
```

### Why This Architecture

**GCN pathway** learns spatial patterns from the board graph:
- Layer 1: Each territory aggregates information from its neighbors (1-hop — immediate borders)
- Layer 2: Each territory sees 2 hops away (regional patterns — "am I surrounded?")
- Layer 3: Each territory sees 3 hops away (continent-scale patterns — "do I almost own this continent?")
- Readout: Mean pool all 42 node embeddings into a single 64-dim board summary

**FC pathway** learns global patterns that aren't spatial:
- Total army counts, income ratios, card counts, continent ownership fractions
- These features are inherently global and don't belong on individual nodes

**Concatenation + mixing** lets the network combine "the board looks like X" with "the global situation is Y" before producing evaluations.

**P-player output** predicts win probability for every player simultaneously. This is more informative than binary win/loss — the network learns about relative advantage between all players, not just "will I win."

### New Files

| File | Purpose |
|------|---------|
| `IconquerAI/Sources/IconquerAI/Learned/GraphValueNetwork.swift` | The dual-pathway GCN + FC network |
| `IconquerAI/Sources/IconquerAI/Learned/GCNLayer.swift` | Graph Convolutional Network layer (message-passing in MLX) |
| `IconquerAI/Sources/IconquerAI/Learned/GraphEncoder.swift` | Converts `GameSnapshot` + `MapDefinition` → node features + adjacency matrix |
| `IconquerAI/Sources/IconquerAI/Learned/GlobalEncoder.swift` | Extracts global features from `GameSnapshot` |
| `IconquerAI/Sources/IconquerAI/Learned/TDTrainer.swift` | TD(λ) training loop (replaces supervised `TrainingPipeline.train`) |
| `IconquerAI/Sources/IconquerAI/Learned/GraphLearnedAgent.swift` | Updated agent using `GraphValueNetwork` for position evaluation |

### Modified Files

| File | Change |
|------|--------|
| `TrainingPipeline.swift` | Add `buildTDExamples()` that produces state sequences instead of independent labeled examples |
| `PositionNetwork.swift` | Preserved as-is for backward compatibility; new code uses `GraphValueNetwork` |
| `LearnedPolicyAgent.swift` | Preserved as-is; `GraphLearnedAgent` is the new version |
| `TournamentAgentFactory.swift` | Register `"graph-learned"` agent name |

---

## 3. API Surface

### GCNLayer (Graph Convolutional Layer)

```swift
/// A single Graph Convolutional Network layer.
///
/// Implements the message-passing operation:
///   H' = σ(D̃⁻¹/² Ã D̃⁻¹/² H W)
///
/// Where Ã = A + I (adjacency with self-loops), D̃ is the degree matrix,
/// H is the node feature matrix, and W is the learnable weight matrix.
///
/// ## References
///
/// Kipf & Welling (2017), "Semi-Supervised Classification with
/// Graph Convolutional Networks"
public class GCNLayer: Module, @unchecked Sendable {
    // Justification: Module is reference type required by MLX.
    // Used single-threaded during training, read-only at inference.

    @ModuleInfo var weights: Linear

    /// Create a GCN layer.
    ///
    /// - Parameters:
    ///   - inputFeatures: Dimension of input node features.
    ///   - outputFeatures: Dimension of output node features.
    public init(inputFeatures: Int, outputFeatures: Int)

    /// Forward pass: apply graph convolution.
    ///
    /// - Parameters:
    ///   - nodeFeatures: Node feature matrix `[N, inputFeatures]`.
    ///   - normalizedAdjacency: Normalized adjacency matrix `[N, N]`.
    /// - Returns: Updated node features `[N, outputFeatures]`.
    public func callAsFunction(
        _ nodeFeatures: MLXArray,
        adjacency normalizedAdjacency: MLXArray
    ) -> MLXArray
}
```

### GraphEncoder (Board State → Graph Tensors)

```swift
/// Encodes a game snapshot as graph tensors for the GCN.
///
/// Produces per-territory node features and a normalized adjacency matrix
/// from the game state and map definition. The encoding is designed to be
/// low-level and map-agnostic — the same encoder works for any map topology.
///
/// ## Node Features (P + C + 2 per territory)
///
/// | Index | Name | Description |
/// |-------|------|-------------|
/// | 0..<P   | ownerOneHot | One-hot encoding of territory owner (P players). All zeros if unowned. |
/// | P       | armyFraction | Territory armies / total armies on board |
/// | P+1..<P+1+C | continentOneHot | One-hot encoding of continent membership (C continents) |
/// | P+1+C   | isContinentBorder | 1.0 if any neighbor belongs to a different continent |
///
/// Feature count = P + 1 + C + 1 = **P + C + 2**, varies with game configuration:
///
/// | Players | Continents | Features/Node | Example |
/// |---------|------------|---------------|---------|
/// | 2       | 6          | 10            | 2-player world tournament |
/// | 3       | 6          | 11            | 3-player world |
/// | 6       | 6          | 14            | Classic 6-player Risk |
/// | 2       | 1          | 5             | Duel map (1 continent) |
///
/// ## Adjacency Matrix
///
/// Symmetric normalized adjacency with self-loops:
///   Ã = D̃⁻¹/² (A + I) D̃⁻¹/²
///
/// Pre-computed once per map and reused across all evaluations.
public struct GraphEncoder: Sendable {

    /// Number of features per territory node.
    public let nodeFeatureCount: Int

    /// Number of territories (nodes in the graph).
    public let territoryCount: Int

    /// Pre-computed normalized adjacency matrix `[N, N]`.
    public let normalizedAdjacency: MLXArray

    /// Create a graph encoder for a specific map and player configuration.
    ///
    /// - Parameters:
    ///   - map: Map definition providing topology and continent info.
    ///   - playerCount: Number of players in the game.
    public init(map: MapDefinition, playerCount: Int)

    /// Encode a game snapshot as node features.
    ///
    /// - Parameters:
    ///   - state: The current game snapshot.
    /// - Returns: Node feature matrix `[N, nodeFeatureCount]`.
    public func encodeNodes(state: GameSnapshot) -> MLXArray

    /// Encode a batch of snapshots.
    ///
    /// - Parameter states: Array of game snapshots.
    /// - Returns: Batched node features `[B, N, nodeFeatureCount]`.
    public func encodeBatch(states: [GameSnapshot]) -> MLXArray
}
```

### GlobalEncoder (Game State → Global Feature Vector)

```swift
/// Extracts global (non-spatial) features from a game snapshot.
///
/// These features describe the overall game state that isn't tied to
/// any specific territory: per-player totals, income, card counts,
/// and continent control.
///
/// ## Features (66-dimensional for 6 players, 6 continents)
///
/// | Range | Name | Description |
/// |-------|------|-------------|
/// | 0-P   | currentPlayerOneHot | Whose turn it is |
/// | Per player (×P): | | |
/// |   +0  | armyFraction | Player's armies / total armies |
/// |   +1  | incomeFraction | Player's income / total income |
/// |   +2  | territoryFraction | Player's territories / total territories |
/// |   +3  | cardCount | Cards held (normalized by 5) |
/// |   +4  | defenceScore | Border defence heuristic (per Carr 2020) |
/// |   Per continent (×C): | | |
/// |     +0 | continentArmyFraction | Player's armies in continent / total continent armies |
///
/// Dimension = P + P × (5 + C) = 6 + 6 × (5 + 6) = 72 for standard Risk.
public struct GlobalEncoder: Sendable {

    /// Number of global features produced.
    public let featureCount: Int

    /// Create a global encoder for a specific configuration.
    ///
    /// - Parameters:
    ///   - map: Map definition for continent info.
    ///   - playerCount: Number of players.
    public init(map: MapDefinition, playerCount: Int)

    /// Encode global features from a game snapshot.
    ///
    /// - Parameter state: The current game snapshot.
    /// - Returns: Global feature vector `[featureCount]`.
    public func encode(state: GameSnapshot) -> MLXArray
}
```

### GraphValueNetwork (The Full Model)

```swift
/// Dual-pathway Graph Value Network for board position evaluation.
///
/// Combines a Graph Convolutional Network (spatial board features) with
/// a fully-connected network (global game features) to predict win
/// probability for each player.
///
/// ## Architecture
///
/// ```
/// Board (N × F_node) → GCN1(64) → GCN2(64) → GCN3(64) → MeanPool(64) ─┐
///                                                                         ├→ FC2(64) → FC3(P) → Softmax
/// Global (F_global)  → FC1(64) ──────────────────────────────────────────┘
/// ```
///
/// F_node and F_global scale with player count P and continent count C.
/// Separate weight files are trained per player count.
///
/// ## Training
///
/// Trained via TD(λ) self-play using ``TDTrainer``. The network learns
/// to predict its own future evaluations with exponential credit decay,
/// converging on accurate position evaluation without human labels.
///
/// ## Generalizability
///
/// The architecture is map-agnostic: the GCN operates on whatever graph
/// structure the map provides. The same trained model can evaluate positions
/// on any map with the same player count.
public class GraphValueNetwork: Module, @unchecked Sendable {
    // Justification: Module is reference type required by MLX.
    // Read-only at inference time.

    // GCN pathway (3 layers for continent-scale visibility)
    @ModuleInfo var gcnLayers: [GCNLayer]

    // Global pathway
    @ModuleInfo var globalFC: Linear

    // Mixing layers
    @ModuleInfo var mixFC: Linear
    @ModuleInfo var outputFC: Linear

    /// Create a graph value network.
    ///
    /// - Parameters:
    ///   - nodeFeatures: Per-territory feature count. Computed as P + C + 2 by the encoder.
    ///   - globalFeatures: Global feature count. Computed as P + P × (5 + C) by the encoder.
    ///   - gcnHidden: GCN hidden dimension (default 64).
    ///   - gcnLayers: Number of GCN layers (default 3).
    ///   - globalHidden: Global FC hidden dimension (default 64).
    ///   - mixHidden: Mixing layer hidden dimension (default 64).
    ///   - playerCount: Number of players (2-6). Determines output dimension.
    ///
    /// Typically constructed via `GraphValueNetwork.forGame(playerCount:continentCount:)`.
    public init(
        nodeFeatures: Int,
        globalFeatures: Int,
        gcnHidden: Int = 64,
        gcnLayers: Int = 3,
        globalHidden: Int = 64,
        mixHidden: Int = 64,
        playerCount: Int
    )

    /// Convenience factory that computes feature dimensions from game parameters.
    ///
    /// - Parameters:
    ///   - playerCount: Number of players (2-6).
    ///   - continentCount: Number of continents on the map.
    /// - Returns: A configured network with correct input/output dimensions.
    public static func forGame(
        playerCount: Int,
        continentCount: Int
    ) -> GraphValueNetwork

    /// Forward pass: board features + global features → win probabilities.
    ///
    /// - Parameters:
    ///   - nodeFeatures: Node feature matrix `[N, nodeFeatures]`.
    ///   - adjacency: Normalized adjacency matrix `[N, N]`.
    ///   - globalFeatures: Global feature vector `[globalFeatures]`.
    /// - Returns: Win probabilities `[playerCount]` summing to 1.0.
    public func callAsFunction(
        nodes: MLXArray,
        adjacency: MLXArray,
        global: MLXArray
    ) -> MLXArray

    /// Convenience: evaluate a single game state.
    ///
    /// - Parameters:
    ///   - state: Game snapshot to evaluate.
    ///   - graphEncoder: Encoder for board features.
    ///   - globalEncoder: Encoder for global features.
    ///   - seat: Player perspective to return value for.
    /// - Returns: Win probability for `seat` in (0, 1).
    public func evaluate(
        state: GameSnapshot,
        graphEncoder: GraphEncoder,
        globalEncoder: GlobalEncoder,
        seat: PlayerId
    ) -> Float
}
```

### TDTrainer (Temporal Difference Training)

```swift
/// Trains a ``GraphValueNetwork`` using TD(λ) on game transcripts.
///
/// ## Algorithm
///
/// For each game transcript (sequence of states s₁, s₂, ..., sₙ):
///
/// 1. Compute value predictions V(sₜ) for all states
/// 2. Compute TD errors: δₜ = V(sₜ₊₁) - V(sₜ)
///    (at terminal state: δₙ = r - V(sₙ), where r is actual outcome)
/// 3. Compute λ-weighted returns:
///    Gₜ = V(sₜ) + Σⱼ₌ₜ^(N-1) λ^(j-t) × δⱼ
/// 4. Update weights to minimize: L = Σₜ (V(sₜ) - Gₜ)²
///
/// TD(λ) interpolates between:
/// - λ=0 (TD(0)): Learn to predict one step ahead (myopic)
/// - λ=1 (TD(1)): Learn to predict final outcome (noisy, our old approach)
/// - λ=0.7: Sweet spot — strong late-game signal, attenuated early-game noise
///
/// ## Self-Play Mode
///
/// When `selfPlay` is enabled, the trainer generates new games using the
/// current network for move selection, then trains on those games. This
/// creates an improvement loop without requiring external tournament data.
///
/// ## References
///
/// - Sutton (1988), "Learning to Predict by the Methods of Temporal Differences"
/// - Tesauro (1995), "Temporal Difference Learning and TD-Gammon"
/// - Carr (2020), "Using GCN and TD(λ) to play Risk"
public struct TDTrainer: Sendable {

    /// Configuration for TD(λ) training.
    public struct Config: Sendable, Codable {
        /// TD lambda parameter (0.0 = TD(0), 1.0 = TD(1)).
        /// Recommended: 0.7 for Risk.
        public var lambda: Float

        /// Learning rate for Adam optimizer.
        public var learningRate: Float

        /// Number of training epochs over the transcript corpus.
        public var epochs: Int

        /// Number of games to generate per self-play iteration.
        public var selfPlayGames: Int

        /// Discount factor for future rewards (typically 1.0 for finite games).
        public var gamma: Float

        /// L2 regularization strength.
        public var l2Lambda: Float

        /// Maximum states to sample per game (0 = all states).
        public var maxStatesPerGame: Int

        /// RNG seed for reproducibility.
        public var seed: UInt32

        /// Default configuration tuned for iConquer world map.
        public static let `default` = Config(
            lambda: 0.7,
            learningRate: 0.001,
            epochs: 100,
            selfPlayGames: 1000,
            gamma: 1.0,
            l2Lambda: 0.0001,
            maxStatesPerGame: 0,
            seed: 42
        )
    }

    /// Result of a training run.
    public struct TrainResult: Sendable {
        /// Mean TD error at final epoch.
        public var finalTDError: Float

        /// TD error history per epoch.
        public var errorHistory: [Float]

        /// Number of game sequences used.
        public var gamesUsed: Int

        /// Total state transitions trained on.
        public var totalTransitions: Int
    }

    /// Train a network on existing game transcripts using TD(λ).
    ///
    /// - Parameters:
    ///   - model: The network to train (modified in place).
    ///   - transcripts: Game move sequences keyed by match ID.
    ///   - matches: Match records with winner info (for terminal rewards).
    ///   - map: Map definition for graph encoding.
    ///   - playerCount: Number of players per game.
    ///   - config: Training hyperparameters.
    /// - Returns: Training diagnostics.
    public static func train(
        model: GraphValueNetwork,
        transcripts: [String: [GameMove]],
        matches: [TrainingMatchInfo],
        map: MapDefinition,
        playerCount: Int,
        config: Config
    ) -> TrainResult

    /// Train via self-play: generate games, train, repeat.
    ///
    /// - Parameters:
    ///   - model: The network to train.
    ///   - map: Map to play on.
    ///   - playerCount: Number of players.
    ///   - opponents: AI agents to play against during self-play.
    ///   - config: Training hyperparameters.
    /// - Returns: Training diagnostics.
    public static func trainSelfPlay(
        model: GraphValueNetwork,
        map: MapDefinition,
        playerCount: Int,
        opponents: [any PlayerAgent],
        config: Config
    ) async -> TrainResult
}
```

### GraphLearnedAgent (Updated Agent)

```swift
/// A learned agent powered by a Graph Value Network.
///
/// Uses the same 1-ply search as ``LearnedPolicyAgent`` but with
/// a much richer evaluation function that understands spatial
/// relationships on the board via graph convolution.
///
/// ## Differences from LearnedPolicyAgent
///
/// | Aspect | LearnedPolicyAgent | GraphLearnedAgent |
/// |--------|-------------------|-------------------|
/// | Features | 12 aggregates | 42×14 per-territory + 72 global |
/// | Architecture | Flat MLP | GCN + FC dual pathway |
/// | Training | Supervised win/loss | TD(λ) |
/// | Map support | Hardcoded features | Any map via graph structure |
/// | Output | Binary win/loss | Per-player win probabilities |
public struct GraphLearnedAgent: PlayerAgent {

    public let identity: AgentIdentity

    /// Create a graph-learned agent with a trained network.
    ///
    /// - Parameters:
    ///   - map: The map the agent will play on.
    ///   - network: A trained ``GraphValueNetwork``.
    ///   - playerCount: Number of players in the game.
    ///   - name: Display name.
    public init(
        map: MapDefinition,
        network: GraphValueNetwork,
        playerCount: Int,
        name: String = "graph-learned"
    )

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

---

## 4. GCN Implementation in MLX-Swift

MLX-Swift doesn't have a graph neural network library. The GCN operation is simple enough to implement directly — it's fundamentally matrix multiplication:

```swift
/// GCN forward pass:
///   H' = ReLU(Ã · H · W + b)
///
/// Where:
///   Ã = D̃⁻¹/² (A + I) D̃⁻¹/²  (normalized adjacency, precomputed)
///   H = [N, F_in]  (node features)
///   W = [F_in, F_out]  (learnable weights)
///
/// In MLX:
///   let transformed = matmul(nodeFeatures, weights)  // [N, F_out]
///   let propagated = matmul(adjacency, transformed)   // [N, F_out]
///   return relu(propagated + bias)
```

The adjacency normalization is computed **once per map** at initialization:

```swift
/// Compute normalized adjacency matrix: D̃⁻¹/² (A + I) D̃⁻¹/²
///
/// - Parameter adjacencyList: Country neighbor relationships from MapDefinition.
/// - Returns: Normalized adjacency as MLXArray [N, N].
static func normalizeAdjacency(map: MapDefinition) -> MLXArray {
    let n = map.countries.count
    // Build A + I (adjacency with self-loops)
    var matrix = [[Float]](repeating: [Float](repeating: 0, count: n), count: n)
    for (i, country) in map.countries.enumerated() {
        matrix[i][i] = 1.0  // self-loop
        for neighbor in country.neighbors {
            if let j = map.countries.firstIndex(where: { $0.id == neighbor }) {
                matrix[i][j] = 1.0
                matrix[j][i] = 1.0  // symmetric
            }
        }
    }
    // Compute degree matrix D̃ and normalize: D̃⁻¹/² Ã D̃⁻¹/²
    let degrees = matrix.map { row in row.reduce(0, +) }
    let invSqrtD = degrees.map { d in d > 0 ? 1.0 / sqrt(d) : 0.0 }
    for i in 0..<n {
        for j in 0..<n {
            matrix[i][j] *= invSqrtD[i] * invSqrtD[j]
        }
    }
    return MLXArray(matrix.flatMap { $0 }).reshaped([n, n])
}
```

---

## 5. TD(λ) Training Algorithm

### Core Update Rule

For a game with states s₁, s₂, ..., sₙ and terminal reward r:

```
δₜ = γ·V(sₜ₊₁) - V(sₜ)          // TD error (at terminal: δₙ = r - V(sₙ))
Gₜ = V(sₜ) + Σⱼ₌ₜᴺ⁻¹ λʲ⁻ᵗ·δⱼ   // λ-return (weighted sum of TD errors)
L  = (1/N) Σₜ (V(sₜ) - Gₜ)²      // Loss: make predictions match λ-returns
```

### Why λ = 0.7

| λ | Behavior | Risk-specific effect |
|---|----------|---------------------|
| 0.0 | Only predicts one state ahead | Too myopic — can't learn long-term strategy |
| 0.3 | Mostly short-range | Learns tactical moves but misses continent strategy |
| **0.7** | **Balanced** | **Late-game states drive learning; early-game noise is attenuated by 0.7^t** |
| 0.9 | Mostly long-range | Starts to suffer from noisy early-game labels |
| 1.0 | Predicts final outcome | Our current broken approach — pure noise on early states |

### Training Data Flow

```
Game transcript (moves)
        │
        ▼
   Replay engine ──── reconstruct state sequence [s₁, s₂, ..., sₙ]
        │
        ▼
   GraphEncoder ──── per-state: nodeFeatures [42×14], adjacency [42×42]
   GlobalEncoder ─── per-state: globalFeatures [72]
        │
        ▼
   Forward pass ──── V(sₜ) for all t ∈ [1, N]
        │
        ▼
   TD(λ) targets ─── Gₜ for all t (using δ and λ decay)
        │
        ▼
   Loss: MSE(V(sₜ), Gₜ) ──── backprop through GCN + FC
```

---

## 6. Constraints & Compliance

```
Concurrency:      GraphEncoder and GlobalEncoder are Sendable structs.
                  GraphValueNetwork is @unchecked Sendable (MLX Module
                  requirement, read-only at inference). TDTrainer is
                  a Sendable struct with static methods.

Determinism:      TD training accepts a seed. Game replay from transcripts
                  uses the original match seed for bit-exact reconstruction.

Safety:           No force unwraps. Adjacency matrix validated at init.
                  Division guarded (degree normalization checks for zero).

Bounded:          Training loops bounded by config.epochs. Self-play
                  bounded by config.selfPlayGames. Collections bounded.

MLX Dependency:   Same as current T5 — requires xcodebuild for Metal
                  shaders. CPU fallback via Device.setDefault(.cpu).
```

---

## 7. Dependencies

**Internal:**
- `IconquerCore` — `Game`, `GameSnapshot`, `GameMove`, `MapDefinition`, `Settings`
- `IconquerMatch` — `PlayerAgent`, `MatchRunner` (for self-play)
- `IconquerAI` — `CombatSimulator` (reused for attack evaluation)

**External:**
- `MLX` + `MLXNN` + `MLXOptimizers` (already a dependency)
- No new external packages

---

## 8. Test Strategy

### Test Categories

| Category | Tests |
|----------|-------|
| **GCNLayer** | Forward pass dimensions, gradient flow, self-loop behavior, isolated node handling |
| **GraphEncoder** | Correct node feature dimensions for different maps/player counts, adjacency symmetry, normalization sums to ~1 per row |
| **GlobalEncoder** | Feature count matches expected dimensions, values normalized to [0,1], correct player ordering |
| **GraphValueNetwork** | End-to-end forward pass, output sums to 1.0 (softmax), gradient flow through both pathways |
| **TDTrainer** | λ=0 matches 1-step prediction, λ=1 matches final outcome, error decreases over epochs |
| **GraphLearnedAgent** | Produces legal moves, handles all turn phases, respects deadline |
| **Map generalization** | Same architecture works on duel (2 nodes), line4 (4 nodes), world (42 nodes) |
| **Determinism** | Same seed + same data → identical weights after training |

### Reference Truth

- **GCN correctness:** Validated against manual computation on a 3-node graph with known adjacency and features
- **TD(λ) correctness:** Validated against Sutton & Barto (2018) examples with known TD targets
- **Game replay:** Validated against existing parity fixtures — replayed states must match original snapshots

### Golden Path Test

```swift
@Test("GCN produces correct output dimensions for world map")
func gcnDimensions() {
    let map = MapRegistry().resolve("world").mapDefinition
    let encoder = GraphEncoder(map: map, playerCount: 2)
    let gcn = GCNLayer(inputFeatures: encoder.nodeFeatureCount, outputFeatures: 32)

    let nodeFeatures = MLXArray.zeros([42, encoder.nodeFeatureCount])
    let output = gcn(nodeFeatures, adjacency: encoder.normalizedAdjacency)

    #expect(output.shape == [42, 32])
}

@Test("TD lambda=0 matches 1-step prediction")
func tdLambdaZero() {
    // With λ=0, the target for state t should be V(s_{t+1})
    // (discounted by gamma, plus any immediate reward)
    let values: [Float] = [0.3, 0.5, 0.7, 1.0]  // V(s1)..V(s4), terminal=1.0
    let targets = TDTrainer.computeLambdaReturns(
        values: values, terminalReward: 1.0, lambda: 0.0, gamma: 1.0
    )
    #expect(abs(targets[0] - 0.5) < 1e-6)  // Target for s1 = V(s2)
    #expect(abs(targets[1] - 0.7) < 1e-6)  // Target for s2 = V(s3)
    #expect(abs(targets[2] - 1.0) < 1e-6)  // Target for s3 = terminal
}

@Test("Graph value network generalizes across maps with same player count")
func mapGeneralization() {
    // 2-player network works on any map topology
    let network = GraphValueNetwork(
        nodeFeatures: 10, globalFeatures: 24,
        gcnHidden: 16, globalHidden: 16, mixHidden: 16, playerCount: 2
    )
    // Works on 2-node graph (duel map)
    let small = network(
        nodes: MLXArray.zeros([2, 10]),
        adjacency: MLXArray.ones([2, 2]) * 0.5,
        global: MLXArray.zeros([24])
    )
    #expect(small.shape == [2])

    // Works on 42-node graph (world map) with same weights
    let large = network(
        nodes: MLXArray.zeros([42, 10]),
        adjacency: MLXArray.zeros([42, 42]),
        global: MLXArray.zeros([24])
    )
    #expect(large.shape == [2])
}

@Test("Different player counts produce different output dimensions",
      arguments: [2, 3, 4, 6])
func playerCountVariation(playerCount: Int) {
    let continentCount = 6
    let network = GraphValueNetwork.forGame(
        playerCount: playerCount, continentCount: continentCount
    )
    let nodeFeatures = playerCount + continentCount + 2
    let globalFeatures = playerCount + playerCount * (5 + continentCount)

    let output = network(
        nodes: MLXArray.zeros([42, nodeFeatures]),
        adjacency: MLXArray.zeros([42, 42]),
        global: MLXArray.zeros([globalFeatures])
    )
    #expect(output.shape == [playerCount])
}
```

---

## 9. Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| **Adjacency matrix size** | 42×42 = 1,764 floats. Trivial. Even 1000-territory maps would be 4MB. |
| **GCN forward pass** | Two matrix multiplications per layer: O(N²·F). For N=42, F=64, 3 layers: ~340k ops total. Sub-millisecond on Apple Silicon. |
| **Training memory** | Per-game: ~200 states × (42×14 + 72) features = ~130KB. 1000 games = ~130MB. Fits comfortably in memory. |
| **Self-play speed** | Agent evaluation is 3 GCN + 3 FC layers per candidate move. With ~50 candidate attacks, ~250 forward passes per turn. Budget: ~15ms per turn on M-series. |
| **Batch training** | MLX supports efficient batched matmul. Batch 64 game states: single GPU kernel launch. |

---

## 10. Architecture Decision Review

```
ADR Check:
- [x] Reviewed architecture_decisions.md
- [x] Supersedes the flat MLP approach in IconquerAI_LearnedPolicyAgent.md
- [ ] Does not amend any existing ADR
- [x] New ADR required

New ADR Draft:
- Title: Graph Value Network with TD(λ) for Position Evaluation
- Category: architecture
- Key decision: Replace flat MLP + supervised win/loss with GCN dual-pathway
  network + TD(λ) training. Motivated by empirical failure of supervised
  approach at scale (19% win rate with 20M examples) and alignment with
  proven academic approaches (Carr 2020, GG-Net 2023, TD-Gammon 1993).
```

---

## 11. Open Questions

1. **Player count flexibility:** ~~Should the network accept variable player counts (2-6)?~~ **DECIDED:** The network accepts variable player counts (2-6) as a runtime parameter. Player count P shapes three things:
   - **Node features:** Owner one-hot encoding is P-wide (not padded to 6). A 2-player game has 2-wide owner encoding; a 6-player game has 6-wide.
   - **Global features:** Per-player stats scale with P. Dimension = P + P × (5 + C).
   - **Output:** Softmax over P players (not padded).

   This means different player counts produce different tensor dimensions, so **separate models are trained per player count** (or a small set: 2-player, 3-player, 6-player). This is the correct approach — a 2-player game is strategically different from a 6-player game, and the network should specialize. The `GraphEncoder`, `GlobalEncoder`, and `GraphValueNetwork` all take `playerCount` at init time, and the `TournamentAgentFactory` loads the appropriate weights file for the game's player count.

   Weight files follow the naming convention: `graph_value_network_p{N}.safetensors` (e.g., `graph_value_network_p2.safetensors`, `graph_value_network_p6.safetensors`).

2. **Self-play vs tournament data:** ~~Train exclusively via self-play, or bootstrap?~~ **DECIDED:** Bootstrap from existing 100k overnight transcripts first. Once the network produces reasonable evaluations, switch to self-play for refinement. This mirrors TD-Gammon's proven approach.

3. **Policy head:** ~~Add AlphaZero-style policy head?~~ **DECIDED:** Defer to v2, but a design proposal and active roadmap for MCTS + policy head integration should be prepared alongside this work. The value head + 1-ply search is the proven Risk-domain approach for v1. Adding MCTS + policy head is the logical next step and should be designed now even though implementation is deferred.

4. **GCN depth:** ~~2 or 3 layers?~~ **DECIDED:** 3 GCN layers from the start. The world map diameter is ~8 hops, so 3 layers give each node visibility of its 3-hop neighborhood — enough to capture continent-scale patterns (most continents span 4-7 territories). The computational cost of a third layer is negligible (~54k additional float ops per forward pass, sub-millisecond on Apple Silicon). Continent bonus data is too strategically valuable to risk missing.

---

## 12. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Articles Required:**

1. **`TrainingBoardGameAI.md`** — A general guide to training AI for territory-based board games. Covers:
   - Why aggregate features fail and per-territory graph encoding works
   - How Graph Convolutional Networks learn spatial patterns from adjacency
   - The spectrum of training signals: supervised win/loss → TD(0) → TD(λ) → TD(1)
   - Why TD(λ) with λ≈0.7 is the sweet spot for stochastic games
   - Self-play improvement loops and when to use them
   - How to adapt the approach to a new game: define the graph, define node features, train
   - Worked example: iConquer world map (42 territories, 6 continents, 6 players)
   - References to academic foundations (TD-Gammon, AlphaZero, Carr 2020, GG-Net)

2. **`GraphValueNetworkGuide.md`** — iConquer-specific implementation guide:
   - Architecture walkthrough with layer dimensions
   - How to train a new model from tournament data
   - How to train on a different map
   - CLI commands for training and evaluation
   - Performance tuning (batch size, learning rate, lambda)

3. The existing `LearnedPolicyAgent` docs remain for backward compatibility

---

## 13. Implementation Phases

### Phase 1: Graph Infrastructure (RED → GREEN)
- [ ] `GCNLayer` with tests (forward pass, gradient flow, dimensions)
- [ ] `GraphEncoder` with tests (node features, adjacency normalization)
- [ ] `GlobalEncoder` with tests (feature extraction, normalization)
- [ ] `GraphValueNetwork` with tests (end-to-end forward pass, map generalization)

### Phase 2: TD(λ) Training (RED → GREEN)
- [ ] `TDTrainer.computeLambdaReturns` with unit tests against known values
- [ ] `TDTrainer.train` with tests (error decreases, determinism)
- [ ] CLI `train` subcommand updated with `--architecture graph` flag
- [ ] Train on existing 100k overnight transcripts, validate error convergence

### Phase 3: Agent Integration (RED → GREEN)
- [ ] `GraphLearnedAgent` with tests (legal moves, all phases, deadline respect)
- [ ] Register `"graph-learned"` in `TournamentAgentFactory`
- [ ] Tournament benchmark: graph-learned vs greedy/strategic/montecarlo/learned(old)

### Phase 4: Self-Play Refinement
- [ ] `TDTrainer.trainSelfPlay` implementation
- [ ] Self-play loop integration with tournament pipeline
- [ ] Iterate until graph-learned beats montecarlo consistently

---

---

## Appendix A: MCTS + Policy Head Roadmap (v2)

This section documents the planned evolution from value-only 1-ply search to full AlphaZero-style MCTS + dual-head network. Implementation is deferred to v2 but the design is captured here to inform v1 architecture decisions.

### Why a Policy Head

The v1 agent uses 1-ply search: enumerate all legal moves, evaluate the resulting position with the value network, pick the best one. This works but has limitations:

- **Branching factor:** With 42 territories and multiple attack options, there can be hundreds of candidate moves per turn. Evaluating all of them is wasteful.
- **Search depth:** 1-ply can't see "if I take Brazil now, I can take all of South America next turn." Multi-ply search requires pruning, which requires a policy to guide the search.
- **Move ordering:** A policy head predicts which moves are worth considering, letting MCTS focus compute on promising lines.

### Dual-Head Architecture (v2)

```
Board (42×14) → GCN1(64) → GCN2(64) → GCN3(64) ─┐
                                                     ├→ FC(128)
Global (72)   → FC1(64) ────────────────────────────┘
                                                      │
                                              ┌───────┴───────┐
                                              │               │
                                         Value Head      Policy Head
                                         FC → [6]       FC → [A]
                                         (Softmax)      (Softmax)
                                              │               │
                                    Win probability    Move probability
                                    per player [6]    distribution [A]
```

Where A = size of the action space. For Risk, this is large and variable:
- Place armies: up to 42 targets × variable counts
- Attack: up to ~200 source-target pairs × 3 attack modes
- Fortify: up to ~100 source-dest pairs

### Handling Risk's Variable Action Space

Unlike Chess (fixed 4,672 possible moves) or Go (fixed 362 positions), Risk has a variable and very large action space. Approaches:

**Option 1: Action decomposition** — Break each turn into sub-decisions:
- "Where to reinforce?" → 42-way softmax over territories
- "Attack from where?" → 42-way softmax over owned territories
- "Attack to where?" → conditional softmax over neighbors of selected source
- This reduces the policy head to a sequence of small softmax outputs

**Option 2: Attention-based policy** — Use the GCN node embeddings directly:
- For each candidate move, compute an attention score between source and target node embeddings
- Policy = softmax over attention scores of all legal moves
- Naturally handles variable action counts

**Option 3: Per-node action prediction** — Each node outputs a "take action here" probability:
- Reinforcement: argmax over owned nodes for army placement
- Attack: source node × target node attention matrix
- Similar to pointer networks

**Recommendation for v2:** Option 2 (attention-based policy) is the most natural fit for the GCN architecture. The node embeddings already encode local board context; comparing source and target embeddings via dot-product attention gives a move score without a fixed action vocabulary.

### MCTS Integration

```swift
/// Monte Carlo Tree Search using the dual-head network.
///
/// At each node:
/// 1. Use policy head to select promising moves (prior probability)
/// 2. Use value head to evaluate leaf positions (rollout replacement)
/// 3. UCB1 selection: argmax(Q(s,a) + c·P(s,a)·√N(s)/(1+N(s,a)))
///
/// Unlike standard MCTS which uses random rollouts, AlphaZero-style
/// MCTS uses the value network as the rollout function, making search
/// much more efficient.
public struct MCTSSearch {
    /// Number of simulations per move decision.
    public var simulations: Int  // default: 100-800

    /// Exploration constant (higher = more exploration).
    public var explorationConstant: Float  // default: 1.41

    /// Temperature for move selection (higher = more random).
    public var temperature: Float  // default: 1.0 early, 0.1 late

    /// Select a move using MCTS with the dual-head network.
    public func selectMove(
        state: GameSnapshot,
        seat: PlayerId,
        network: DualHeadGraphNetwork,
        graphEncoder: GraphEncoder,
        globalEncoder: GlobalEncoder
    ) -> GameMove
}
```

### Training Changes for v2

The loss function becomes:
```
L = (v - z)² - π · log(p) + c · ||θ||²
```
Where:
- `v` = value head prediction, `z` = actual game outcome
- `π` = MCTS visit count distribution (improved policy), `p` = policy head prediction
- `c · ||θ||²` = L2 regularization

Self-play generates training triples `(state, MCTS_policy, game_outcome)` that train both heads simultaneously.

### v1 → v2 Migration Path

The v1 `GraphValueNetwork` is designed so that v2 can reuse its trained weights:
- The GCN layers and global FC pathway are identical in both architectures
- The value head (FC2 → FC3) transfers directly
- Only the policy head is new in v2
- **v1 weights bootstrap v2 training** — the value network is already trained, only the policy head needs to learn from scratch

This is why getting v1 right matters: it becomes the foundation for v2.

---

**This proposal takes the T5 agent from a toy MLP that collapsed under data to a research-backed architecture that learns spatial strategy from the board graph itself. The same approach generalizes to any territory-based strategy game — swap the adjacency matrix and you have a new game.**

Sources:
- [Carr (2020): Using GCN and TD(λ) to play Risk](https://arxiv.org/pdf/2009.06355)
- [GG-Net (IEEE 2023): GNN for Risk-like board games](https://ieeexplore.ieee.org/document/10108022/)
- [KTH thesis: AlphaZero for Risk](https://kth.diva-portal.org/smash/get/diva2:1514096/FULLTEXT01.pdf)
- [Simple AlphaZero tutorial](https://suragnair.github.io/posts/alphazero.html)
- [TD-Gammon](https://www.bkgm.com/articles/tesauro/tdl.html)
- [OpenSpiel framework](https://github.com/google-deepmind/open_spiel)
- [mlx-graphs (Python GNN for MLX)](https://github.com/mlx-graphs/mlx-graphs)
