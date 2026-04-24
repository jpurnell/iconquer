# Design Proposal: T5 Learned Policy Agent

## 1. Objective

**Objective:** Train a position-evaluation model on tournament transcript data so an agent can predict optimal moves without handcrafted heuristics. The agent learns which board positions lead to wins and uses that knowledge to choose the highest-value action at each decision point.

**Master Plan Reference:** Phase 3 -- Learned / Data-Driven Agents (Algorithm Tier T5)

**Motivation:** The existing agents (T1-T3) rely on manually tuned weights and hardcoded heuristics. Tournament data is already accumulating (240 games per 6-hour cycle, thousands over days). A learned agent closes the loop: tournament outcomes feed back into agent improvement automatically. This is also the foundation for the long-term LLM tournament server vision, where strategy documents are generated from empirical performance data.

---

## 2. Proposed Architecture

The system has three components: feature extraction, a trainable neural network (via MLX-Swift), and the agent that uses the trained model for decision-making.

**ML Framework:** Apple's [MLX-Swift](https://github.com/ml-explore/mlx-swift) — a GPU-accelerated array framework for Apple Silicon. MLX provides tensor operations, automatic differentiation, and optimizers (Adam, SGD) natively in Swift. No Python bridge, no CoreML dependency. Runs on macOS (roseclub.org is Apple Silicon).

### New Files

```
Sources/IconquerAI/Learned/FeatureExtractor.swift        -- GameSnapshot -> MLXArray
Sources/IconquerAI/Learned/PositionNetwork.swift          -- MLX MLP (12 -> 64 -> 32 -> 1)
Sources/IconquerAI/Learned/LearnedPolicyConfig.swift      -- tunable parameters
Sources/IconquerAI/Learned/LearnedPolicyAgent.swift       -- PlayerAgent conformance
Sources/IconquerAI/Learned/TrainingExample.swift          -- (features, label) data type
Sources/IconquerAI/Learned/TrainingPipeline.swift         -- transcript -> examples -> fit
```

### Modified Files

```
Sources/IconquerAI/IconquerAI.swift                       -- bump version
```

### Tournament Integration (separate PR)

```
Sources/IconquerTournament/Training/TrainCommand.swift    -- `iconquer-tournament train` subcommand
Sources/IconquerTournament/Orchestrator/TournamentAgentFactory.swift -- add "learned" agent
```

### Module Placement

All learning code lives in `IconquerAI/Learned/`. The training pipeline reads `IconquerCore` types directly. New dependency: `mlx-swift` for tensor operations, autodiff, and optimizers.

---

## 3. API Surface

### Feature Extraction

```swift
/// Extracts a fixed-size numeric feature vector from a game snapshot
/// for use by the learned position evaluator.
///
/// The feature vector captures territory control, army strength,
/// continent progress, border pressure, and card state -- the
/// information a skilled human player would assess at a glance.
public struct FeatureExtractor: Sendable {

    /// The number of features produced by this extractor.
    /// All vectors have exactly this length.
    public static let featureCount: Int = 12

    /// Feature names for debugging and weight interpretation.
    public static let featureNames: [String]

    /// Extract features for `seat` from the given snapshot.
    ///
    /// - Parameters:
    ///   - state: The current game snapshot.
    ///   - seat: The player to extract features for.
    ///   - map: The map definition (for continent/neighbor topology).
    /// - Returns: A fixed-length array of Double values, one per feature.
    public func extract(
        state: GameSnapshot,
        seat: PlayerId,
        map: MapDefinition
    ) -> [Double]
}
```

**Feature Vector (12 features):**

| Index | Name | Computation |
|-------|------|-------------|
| 0 | `territoryRatio` | ownedCountries / totalCountries |
| 1 | `armyRatio` | ownedArmies / totalArmies |
| 2 | `unallocatedArmies` | player.unallocatedArmies (normalized by total armies) |
| 3 | `continentCompletionMax` | max continent completion ratio across all continents |
| 4 | `continentCompletionMean` | mean continent completion ratio |
| 5 | `continentBonusCaptured` | sum(bonus for fully owned continents) / sum(all bonuses) |
| 6 | `borderPressure` | sum(enemy armies adjacent to owned) / sum(own border armies) |
| 7 | `armyConcentration` | Gini coefficient of own army distribution |
| 8 | `cardCount` | player.cards.count / 5.0 (normalized, capped at 1.0) |
| 9 | `turnNumber` | turnNumber / 100.0 (normalized, capped at 1.0) |
| 10 | `interiorArmyRatio` | armies on interior (no enemy neighbor) / total own armies |
| 11 | `opponentTerritoryMax` | max opponent territory ratio (strongest rival) |

All features are normalized to roughly [0, 1] so weights are comparable and gradient descent converges uniformly.

### Position Network (MLX MLP)

```swift
import MLX
import MLXNN
import MLXOptimizers

/// A small multi-layer perceptron for board position evaluation.
///
/// Architecture: 12 → 64 (ReLU) → 32 (ReLU) → 1 (sigmoid)
///
/// Trained via Adam optimizer on game outcomes using MLX-Swift's
/// automatic differentiation. GPU-accelerated on Apple Silicon.
public class PositionNetwork: Module {

    let layer1: Linear  // 12 → 64
    let layer2: Linear  // 64 → 32
    let output: Linear  // 32 → 1

    public init() {
        layer1 = Linear(FeatureExtractor.featureCount, 64)
        layer2 = Linear(64, 32)
        output = Linear(32, 1)
    }

    /// Forward pass: features → win probability.
    ///
    /// - Parameter x: Batch of feature vectors [batchSize, 12].
    /// - Returns: Win probabilities [batchSize, 1] in (0, 1).
    public func callAsFunction(_ x: MLXArray) -> MLXArray {
        var h = relu(layer1(x))
        h = relu(layer2(h))
        return sigmoid(output(h))
    }

    /// Evaluate a single feature vector (convenience for inference).
    ///
    /// - Parameter features: Feature vector from ``FeatureExtractor``.
    /// - Returns: Win probability in (0, 1).
    public func evaluate(_ features: [Float]) -> Float {
        let input = MLXArray(features).reshaped([1, features.count])
        let output = self(input)
        return output.item(Float.self)
    }

    /// Save model weights to a JSON-compatible format.
    public func saveWeights(to url: URL) throws

    /// Load model weights from a saved file.
    public func loadWeights(from url: URL) throws
}
```

The MLP captures non-linear feature interactions that a linear model misses — for example, "high continent progress AND concentrated armies" being more valuable than either alone. With 3 layers (12→64→32→1), the model has ~2,800 parameters — small enough to train on thousands of games without overfitting, large enough to learn meaningful patterns.
```

### Training Types

```swift
/// A single training example: features extracted from a game state
/// paired with a win/loss label.
public struct TrainingExample: Sendable, Codable {
    /// Feature vector from ``FeatureExtractor``.
    public var features: [Double]

    /// Label: 1.0 for a state from a winning game, 0.0 for a losing game.
    /// Intermediate values (e.g. 0.5 for draws) are supported.
    public var label: Double
}
```

```swift
/// Orchestrates the full training pipeline: load transcripts,
/// replay games to reconstruct snapshots, extract features,
/// and fit the linear model via SGD.
public struct TrainingPipeline: Sendable {

    /// Configuration for the training run.
    public struct Config: Sendable, Codable {
        /// Learning rate for SGD.
        public var learningRate: Double

        /// Number of passes over the training data.
        public var epochs: Int

        /// L2 regularization strength (prevents overfitting on small datasets).
        public var l2Lambda: Double

        /// Fraction of data held out for validation (0.0-1.0).
        public var validationSplit: Double

        /// RNG seed for reproducible train/validation splits.
        public var seed: UInt64

        /// Minimum examples required to proceed with training.
        public var minExamples: Int

        public static let `default` = Config(
            learningRate: 0.01,
            epochs: 50,
            l2Lambda: 0.001,
            validationSplit: 0.2,
            seed: 42,
            minExamples: 100
        )
    }

    /// Result of a training run.
    public struct TrainResult: Sendable, Codable {
        /// The fitted model.
        public var model: PositionNetwork

        /// Training loss (binary cross-entropy) at the final epoch.
        public var trainLoss: Double

        /// Validation loss at the final epoch.
        public var validationLoss: Double

        /// Validation accuracy (fraction of correct win/loss predictions).
        public var validationAccuracy: Double

        /// Number of training examples used.
        public var trainExamples: Int

        /// Number of validation examples used.
        public var validationExamples: Int

        /// Loss history per epoch for convergence diagnostics.
        public var lossHistory: [Double]
    }

    /// Build training examples from match records and transcripts.
    ///
    /// For each match, replays the transcript to reconstruct game
    /// snapshots at each move, then extracts features for the active
    /// player. States from winning games are labeled 1.0; states from
    /// losing games are labeled 0.0.
    ///
    /// - Parameters:
    ///   - matches: Match records with winner information.
    ///   - transcripts: Move sequences keyed by match ID.
    ///   - map: Map definition for feature extraction.
    ///   - sampleRate: Fraction of states to keep per game (default 1.0).
    ///     Lower values reduce training set size for faster iteration.
    ///   - rng: Random number generator for sampling.
    /// - Returns: Array of training examples.
    public func buildExamples(
        matches: [MatchRecord],
        transcripts: [String: [GameMove]],
        map: MapDefinition,
        sampleRate: Double,
        using rng: inout some RandomNumberGenerator
    ) -> [TrainingExample]

    /// Train a PositionNetwork on training examples using MLX Adam optimizer.
    ///
    /// Uses binary cross-entropy loss with L2 weight decay.
    /// Shuffles data each epoch. GPU-accelerated on Apple Silicon.
    ///
    /// - Parameters:
    ///   - examples: Training data.
    ///   - config: Training hyperparameters.
    /// - Returns: The fitted model and training diagnostics.
    public func train(
        examples: [TrainingExample],
        config: Config
    ) -> TrainResult

    /// Incrementally update an existing model with new data.
    ///
    /// Uses the existing weights as initialization and trains for
    /// fewer epochs at a reduced learning rate.
    ///
    /// - Parameters:
    ///   - model: The existing trained model.
    ///   - newExamples: New training data to incorporate.
    ///   - config: Training hyperparameters (learning rate will be halved).
    /// - Returns: The updated model and training diagnostics.
    public func incrementalTrain(
        model: PositionNetwork,
        newExamples: [TrainingExample],
        config: Config
    ) -> TrainResult
}
```

### Agent Configuration

```swift
/// Configuration for the ``LearnedPolicyAgent``.
///
/// Controls how the agent uses the trained model to make decisions,
/// including lookahead depth and fallback behavior when the model
/// has low confidence.
public struct LearnedPolicyConfig: Sendable, Codable, Hashable {

    /// The trained model weights. Required -- the agent cannot
    /// function without a trained model.
    public var model: LinearModel

    /// Number of candidate moves to evaluate for attacks.
    /// Higher values explore more options but cost more time.
    public var attackCandidateLimit: Int

    /// Minimum model score difference to prefer one attack over another.
    /// Below this threshold, fall back to the greedy heuristic.
    public var minScoreDelta: Double

    /// Whether to use Monte Carlo combat simulation for attack
    /// probability estimation (hybrid mode).
    public var useMonteCarloForAttacks: Bool

    /// Number of combat simulation trials when hybrid mode is on.
    public var monteCarloTrials: Int

    /// Whether fortification is enabled.
    public var fortifyEnabled: Bool

    public static func `default`(model: PositionNetwork) -> LearnedPolicyConfig {
        LearnedPolicyConfig(
            model: model,
            attackCandidateLimit: 20,
            minScoreDelta: 0.01,
            useMonteCarloForAttacks: true,
            monteCarloTrials: 100,
            fortifyEnabled: false
        )
    }
}
```

### The Agent

```swift
/// A Tier 5 agent that uses a trained linear model to evaluate
/// board positions and choose moves that maximize expected win probability.
///
/// ## How It Works
///
/// For each decision point (placement, attack, fortify), the agent:
/// 1. Enumerates candidate moves
/// 2. Simulates each candidate's effect on the board
/// 3. Extracts features from the resulting position
/// 4. Evaluates each position with the trained model
/// 5. Picks the move that produces the highest-scoring position
///
/// This is a 1-ply search: the agent looks one move ahead. The model
/// serves as the evaluation function, replacing the handcrafted
/// heuristics used by ``StrategicAgent`` and ``MonteCarloAgent``.
///
/// ## Training
///
/// The model is trained offline by ``TrainingPipeline`` on tournament
/// transcript data. The agent loads pre-trained weights at initialization.
public struct LearnedPolicyAgent: PlayerAgent {

    public let identity: AgentIdentity

    /// Create a learned policy agent with a trained model.
    ///
    /// - Parameters:
    ///   - map: The map the agent will play on.
    ///   - name: Display name for logs and reports.
    ///   - config: Configuration including the trained model weights.
    public init(
        map: MapDefinition,
        name: String = "learned",
        config: LearnedPolicyConfig
    )

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

---

## 4. MCP Schema

The training pipeline is exposed as a tournament CLI subcommand, not an MCP tool. However, the model weights file is designed for machine readability.

**Model Weights Format (JSON):**

```json
{
  "featureCount": 12,
  "featureNames": [
    "territoryRatio", "armyRatio", "unallocatedArmies",
    "continentCompletionMax", "continentCompletionMean",
    "continentBonusCaptured", "borderPressure", "armyConcentration",
    "cardCount", "turnNumber", "interiorArmyRatio", "opponentTerritoryMax"
  ],
  "weights": [2.31, 1.87, 0.42, 1.95, 0.68, 3.12, -1.44, 0.33, 0.21, -0.15, -0.89, -2.05],
  "bias": -0.5,
  "trainedOn": {
    "matchCount": 960,
    "exampleCount": 48000,
    "validationAccuracy": 0.72,
    "trainDate": "2026-04-23T12:00:00Z"
  }
}
```

**Parameter Types:**

- `featureCount` (integer): Number of features. Must equal `FeatureExtractor.featureCount`.
- `featureNames` (array of string): Human-readable feature labels for diagnostics.
- `weights` (array of number): Weight vector. Length must equal `featureCount`.
- `bias` (number): Scalar bias term.
- `trainedOn` (object): Training metadata for provenance tracking.
  - `matchCount` (integer): Number of matches used for training.
  - `exampleCount` (integer): Number of state-label pairs.
  - `validationAccuracy` (number): Fraction of correct predictions on held-out data.
  - `trainDate` (string): ISO 8601 timestamp of training run.

---

## 5. Constraints & Compliance

**ML Framework:** Apple MLX-Swift for tensor operations, automatic differentiation, and optimizers. GPU-accelerated on Apple Silicon. No Python bridge, no CoreML. roseclub.org is macOS on Apple Silicon — MLX runs natively.

**Concurrency:** `PositionNetwork` is a class (required by MLX `Module` protocol) but used in a single-threaded training loop and read-only at inference time. `FeatureExtractor`, `TrainingExample`, and `LearnedPolicyConfig` are `Sendable` value types. The agent wraps the network in an actor if needed for concurrent access.

**Determinism:** Training accepts a `seed` parameter for reproducible train/validation splits. `FeatureExtractor` is deterministic given the same snapshot. The agent's move selection is deterministic given the same model weights and game state.

**Safety:**
- No force unwraps (`!`), no `try!`, no force casts (`as!`)
- Division safety: all denominators guarded with `max(1, ...)` or explicit zero checks
- Array bounds: feature vector length validated at model initialization
- Gradient clipping in SGD to prevent NaN from exploding gradients

**No Hardcoded Constants:** All numeric parameters (learning rate, epochs, regularization, candidate limits) are fields in config structs, never inline literals.

**Platform Compatibility:** macOS on Apple Silicon (roseclub.org). MLX-Swift requires Apple Silicon for GPU acceleration. Training and inference both run on the Metal GPU. The `FeatureExtractor` and `TrainingExample` types use plain Swift arrays for I/O compatibility; conversion to `MLXArray` happens at the training/inference boundary.

---

## 6. Backend Abstraction

MLX-Swift handles GPU acceleration automatically on Apple Silicon. Training runs on the Metal GPU; inference uses the same GPU path but is fast enough that CPU fallback would also work. The 3-layer MLP (2,800 parameters) is tiny by ML standards — training on 50,000 examples completes in seconds on Apple Silicon GPU.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` -- `GameSnapshot`, `GameMove`, `Game`, `MapDefinition`, `Player`, `Country`, `PlayerId`, `CountryId`, `SeededRNG`
- `IconquerMatch` -- `PlayerAgent`, `AgentIdentity`
- `IconquerAI/CombatSimulator` -- for hybrid attack evaluation (optional)

**External Dependencies:**
- `mlx-swift` (Apple MLX) — tensor operations, autodiff, optimizers, model serialization
- `mlx-swift-nn` — neural network layers (`Linear`, `Module` protocol)

**Tournament CLI (separate package, separate PR):**
- `IconquerTournament` -- `TranscriptStore`, `TournamentStore`, `MatchRecord`
- `swift-argument-parser` -- for the `train` subcommand

---

## 8. Test Strategy

### Test Categories

**Feature Extraction (FeatureExtractorTests):**
- Golden path: known 2-player snapshot with specific territory/army distribution produces expected feature vector
- Edge case: player owns zero territories (eliminated) -- all features should be 0 or safely bounded
- Edge case: player owns all territories (winner) -- territory/army ratios are 1.0
- Symmetry: two players with mirrored positions produce mirrored features
- Determinism: same snapshot always produces same features

**Position Network (PositionNetworkTests):**
- Golden path: initialized network produces output in (0, 1) for any input
- Output shape: batch of N inputs produces N outputs
- Gradient flow: loss.backward() produces non-zero gradients on all layers
- Save/load: weights round-trip through serialization preserving outputs
- Determinism: same input always produces same output

**Training Pipeline (TrainingPipelineTests):**
- Convergence: synthetic linearly separable data converges to high accuracy
- Regularization: L2 penalty shrinks weights compared to unregularized training
- Validation split: correct number of examples in train vs validation sets
- Incremental: updating a trained model with new data does not catastrophically regress
- Determinism: same seed produces identical training results

**Agent Behavior (LearnedPolicyAgentTests):**
- Picks the country that maximizes model score during pickCountries
- Places armies on the position that maximizes model score
- Attacks when the best attack's resulting position scores higher than not attacking
- Passes (finishAttackPhase) when no attack improves the position
- Handles forced card turn-in correctly

**Integration / Validation (LearnedPolicyValidationTests):**
- Train on 80% of tournament data, validate on 20%
- Validation accuracy exceeds 60% (better than coin flip -- games are not 50/50 due to first-mover advantage and agent skill gaps)
- Elo comparison: run 100 games against each existing agent, measure win rate

### Reference Truth

**Feature extraction:** Hand-computed from a minimal 2-player, 4-country snapshot. Values verified by manual calculation in a spreadsheet.

**Model evaluation:** `sigmoid(dot([1.0, 2.0, 3.0], [0.5, 0.5, 0.5]) + 0.0) = sigmoid(3.0) = 0.9526...`
- Verified against Python: `1 / (1 + math.exp(-3.0)) = 0.9525741268224334`
- This exact value becomes the golden path assertion (within 1e-10 tolerance).

**SGD convergence:** Train on XOR-like 2D dataset:
- Features `[0, 0]` -> label 0.0
- Features `[1, 1]` -> label 0.0
- Features `[1, 0]` -> label 1.0
- Features `[0, 1]` -> label 1.0

A linear model cannot solve XOR perfectly, but it should converge to ~50% accuracy, confirming the optimizer runs without error. For a linearly separable dataset (e.g., `x > 0.5` -> 1.0), accuracy should exceed 95%.

### Validation Trace

```
Input:  features = [0.6, 0.55, 0.1, 0.75, 0.4, 0.0, 0.8, 0.3, 0.2, 0.15, 0.1, 0.45]
        weights  = [2.0, 1.5, 0.5, 2.0, 0.5, 3.0, -1.5, 0.3, 0.2, -0.1, -0.8, -2.0]
        bias     = -0.5

Raw:    2.0*0.6 + 1.5*0.55 + 0.5*0.1 + 2.0*0.75 + 0.5*0.4 + 3.0*0.0
        + (-1.5)*0.8 + 0.3*0.3 + 0.2*0.2 + (-0.1)*0.15 + (-0.8)*0.1 + (-2.0)*0.45
        + (-0.5)
      = 1.2 + 0.825 + 0.05 + 1.5 + 0.2 + 0.0
        - 1.2 + 0.09 + 0.04 - 0.015 - 0.08 - 0.9
        - 0.5
      = 1.21

Score:  sigmoid(1.21) = 1 / (1 + exp(-1.21)) = 0.7704...
```

This specific input/output pair is the golden path test assertion.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `06_ARCHITECTURE_DECISIONS.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft entry below

**New ADR Draft:**
- **Title:** ADR-T5: MLX-Swift MLP for Learned Agent
- **Category:** architecture
- **Key decision:** Use Apple's MLX-Swift framework with a small MLP (12→64→32→1) rather than CoreML, PyTorch, or a hand-rolled linear model. Rationale: (1) MLX-Swift is native Swift with GPU acceleration on Apple Silicon — no Python bridge, (2) roseclub.org is macOS on Apple Silicon where MLX runs natively, (3) an MLP captures non-linear feature interactions that a linear model misses (e.g. "concentrated armies + high continent progress"), (4) MLX's autodiff eliminates hand-rolled gradient code, (5) the model is small enough (2,800 params) to train in seconds on thousands of games without overfitting.

---

## 10. Open Questions

1. **State reconstruction from transcripts:** The current `TranscriptStore` saves only `[GameMove]`, not snapshots. To extract features, we need to replay each game from scratch using `Game.apply(_:)`. This requires knowing the initial game setup (map, players, seed). Should we extend `TranscriptStore` to also save the game seed and player list, or derive them from the corresponding `MatchRecord`?

2. **Per-map or universal model?** The feature vector is map-agnostic (ratios, not absolute counts), so a single model should generalize across maps. But continent structures differ significantly between duel (3 continents, 9 countries) and world (6 continents, 42 countries). Should we train separate models per map, or one universal model? Recommendation: start with per-map models, merge later if accuracy is comparable.

3. **Which agents' games to learn from?** Options:
   - (a) Learn only from winning games of the best agents (strategic, montecarlo) -- teaches good play but smaller dataset
   - (b) Learn from all games, labeling by outcome -- larger dataset, learns to distinguish winning from losing positions regardless of agent
   - Recommendation: option (b). The model learns "what winning positions look like," not "what good agents do." A position that leads to a win is valuable information regardless of which agent reached it.

4. **Move-level vs game-level labels?** Current plan labels every state in a winning game as 1.0. But early-game states of a winning game may not be inherently better than early-game states of a losing game. Should we discount labels by distance from game end (e.g., label = 0.5 + 0.5 * (turnNumber / maxTurn) for winners)? Recommendation: start simple (binary labels), add temporal discounting as a follow-up if validation accuracy plateaus.

5. **Interaction with evolutionary tuning:** StrategicConfig has 8 evolved weights. The learned model has 12+1 weights. Could the evolutionary tuner from StrategicConfig be applied to the learned model's weights as well? This would be a hybrid approach: initialize from SGD, then fine-tune via tournament fitness. Deferred to a follow-up proposal.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (FeatureExtractor, LinearModel, TrainingPipeline, LearnedPolicyAgent)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (position evaluation, SGD, feature engineering)

**Article Name:** LearnedPolicyGuide.md (in .docc catalog)

The article should cover:
- Conceptual overview of position evaluation
- How features are engineered and why each one matters
- Training workflow: data collection, feature extraction, model fitting
- How to run the training CLI and interpret diagnostics
- How the agent uses the model at runtime
- Tips for improving accuracy (more data, better features, hyperparameter tuning)

---

## Appendix A: Training Data Flow

```
TranscriptStore              TournamentStore
     |                            |
     v                            v
[GameMove]                  MatchRecord
     |                       (winner, seed, map)
     |                            |
     +----------+  +--------------+
                |  |
                v  v
         TrainingPipeline.buildExamples()
                |
                |  replay game from seed
                |  extract features at each state
                |  label by game outcome
                v
         [TrainingExample]
                |
                v
         TrainingPipeline.train()
                |
                |  SGD with L2 regularization
                |  train/validation split
                v
         TrainResult
           .model: PositionNetwork
           .validationAccuracy: Double
                |
                v
         model.safetensors  -->  LearnedPolicyAgent
```

## Appendix B: MLX Training Loop

```swift
import MLX
import MLXNN
import MLXOptimizers

let model = PositionNetwork()
let optimizer = Adam(learningRate: 0.001)

func lossFn(model: PositionNetwork, x: MLXArray, y: MLXArray) -> MLXArray {
    let predictions = model(x)
    // Binary cross-entropy with numerical stability
    let clipped = clip(predictions, min: 1e-7, max: 1 - 1e-7)
    return -mean(y * log(clipped) + (1 - y) * log(1 - clipped))
}

for epoch in 0..<config.epochs {
    // Shuffle training data each epoch
    let indices = MLXArray(Array(0..<trainCount)).shuffled()
    let xBatch = trainFeatures[indices]
    let yBatch = trainLabels[indices]

    // Forward + backward + update (MLX handles autodiff)
    let (loss, grads) = valueAndGrad(model: model) { model in
        lossFn(model: model, x: xBatch, y: yBatch)
    }
    optimizer.update(model: model, gradients: grads)
    eval(model, optimizer)  // force evaluation

    logger.info("Epoch \(epoch): loss=\(loss.item(Float.self))")
}
```

MLX's `valueAndGrad` handles all gradient computation automatically — no hand-rolled derivatives. The `Adam` optimizer with weight decay provides L2 regularization and adaptive learning rates.

## Appendix C: Gini Coefficient Computation

The Gini coefficient measures army concentration. For a player's army distribution across their territories:

```swift
func giniCoefficient(_ values: [Double]) -> Double {
    guard values.count > 1 else { return 0.0 }
    let sorted = values.sorted()
    let n = Double(values.count)
    let mean = sorted.reduce(0, +) / n
    guard mean > 0 else { return 0.0 }
    var sumOfDifferences = 0.0
    for i in 0..<sorted.count {
        for j in 0..<sorted.count {
            sumOfDifferences += abs(sorted[i] - sorted[j])
        }
    }
    return sumOfDifferences / (2.0 * n * n * mean)
}
```

- Gini = 0.0: all territories have equal armies (spread thin)
- Gini = 1.0: all armies on one territory (maximally concentrated)

The existing `StrategicAgent` implicitly uses max-concentration (place all on strongest border). The Gini coefficient lets the model learn the optimal level of concentration from data.

## Appendix D: Incremental Training Strategy

When new tournament data arrives (every 6 hours):

1. Load the existing `weights.json`
2. Load only new match records (since last training date)
3. Build examples from new matches only
4. Call `incrementalTrain(model:newExamples:config:)` with halved learning rate
5. If validation accuracy improves, save new weights. Otherwise, keep old weights.

This avoids reprocessing the entire history each cycle. Full retraining can be triggered manually when the feature set changes or after major data accumulation milestones.
