# Design Proposal: AccelerateGVN

**Status:** PROPOSAL
**Author:** Justin Purnell + Claude
**Date:** 2026-04-26
**Supersedes:** None (sibling to `IconquerAI_GraphValueNetwork.md`)
**Related:** `IconquerAI_GraphValueNetwork.md` (the MLX implementation we're replacing)

---

## 1. Objective

Replace the MLX-backed Graph Value Network with a hand-rolled Accelerate/vDSP/cblas implementation that trains in **under 1 hour** on the same data the MLX implementation needs **~28 hours** for.

**Master Plan reference:** Phase 2 — AI + Tournament infrastructure. The current bottleneck blocks the self-play loop and prevents the T5 tier from being competitive at the planned scale.

**Why this exists:** the MLX-based GVN trains 100 epochs on 100k games in ~28 hours, dominated by GPU dispatch overhead on a tiny network (42-node graph, 64 hidden dims). At this scale the per-kernel launch + per-element sync costs dwarf the actual matmul work. Apple Silicon's CPU + Accelerate is faster for problems this small, with the additional benefit that we can parallelize trivially across the gradient batch.

**Concrete target:**
- Phase 1 (encoding): under 5 min
- Phase 2 (training, 100 epochs × 100k games): under 30 min
- Total: **under 1 hour wall time**

---

## 2. Proposed Architecture

### New files

```
IconquerAI/Sources/IconquerAI/Learned/Accelerate/
├── AccelerateGVN.swift              # Forward + backward + Adam, ~600 LOC
├── AccelerateGVNTrainer.swift       # Phase 1 (parallel encode) + Phase 2 (parallel batch), ~400 LOC
├── AccelerateGraphLearnedAgent.swift # Inference-only agent for tournaments, ~200 LOC
└── AccelerateGVNWeights.swift       # Serialization (own binary format), ~100 LOC

IconquerAI/Tests/IconquerAITests/
├── AccelerateGVNTests.swift         # Forward + numerical equivalence vs MLX, ~300 LOC
├── AccelerateGVNGradientTests.swift # Finite-diff gradient check, ~150 LOC
└── AccelerateGVNTrainerTests.swift  # Tiny-dataset convergence, ~100 LOC
```

### Modified files

```
IconquerTournament/Sources/iconquer-tournament/TournamentCommand.swift
  — Add `--architecture accelerate` branch in train command
  — Add `accelerate-learned` agent in factory (separate from `graph-learned`)
```

### Module placement

New code lives under `IconquerAI/Sources/IconquerAI/Learned/Accelerate/`. The MLX implementation in `IconquerAI/Sources/IconquerAI/Learned/` (GraphValueNetwork.swift, GCNLayer.swift, GraphEncoder.swift, GlobalEncoder.swift, TDTrainer.swift, GraphLearnedAgent.swift) stays untouched. The encoders are reused as-is — they already produce `[Float]` data via their `encodeNodes`/`encode` methods (we'll add `[Float]`-returning variants to skip the unused MLXArray wrap).

Side-by-side coexistence is the explicit choice for v1. Once the Accelerate path is validated end-to-end and ships a competitive agent, retiring the MLX path can happen in a separate commit.

---

## 3. API Surface

### AccelerateGVN

```swift
public final class AccelerateGVN: @unchecked Sendable {
    // Justification: mutable weight arrays; trainer holds exclusive write
    // access during Phase 2. Inference is read-only after weights load.

    public struct Hyperparameters: Sendable, Codable {
        public var nodeFeatures: Int
        public var globalFeatures: Int
        public var gcnHidden: Int      // default 64
        public var gcnLayerCount: Int  // default 3
        public var globalHidden: Int   // default 64
        public var mixHidden: Int      // default 64
        public var playerCount: Int
        public var territoryCount: Int
    }

    public init(hyperparameters: Hyperparameters, seed: UInt64 = 42)

    /// Forward pass for a single state. Caches activations in the supplied
    /// buffer so the same state can be backpropped without re-running forward.
    /// Thread-safe: each thread passes its own buffer.
    public func forward(
        nodes: UnsafePointer<Float>,        // [N * F_node], row-major
        adjacency: UnsafePointer<Float>,    // [N * N], normalized, shared
        global: UnsafePointer<Float>,       // [F_global]
        cache: inout ForwardCache,
        output: UnsafeMutablePointer<Float> // [P]
    )

    /// Backward pass for a single state given an upstream gradient on output.
    /// Accumulates parameter gradients into the supplied gradient buffer
    /// (additive — caller must zero between minibatches).
    public func backward(
        cache: ForwardCache,
        outputGradient: UnsafePointer<Float>,  // [P]
        gradients: inout Gradients
    )

    /// Apply one Adam optimizer step using accumulated gradients.
    /// Resets gradients to zero after.
    public func step(
        gradients: inout Gradients,
        learningRate: Float,
        beta1: Float = 0.9,
        beta2: Float = 0.999,
        epsilon: Float = 1e-8,
        l2Lambda: Float = 0.0001
    )

    /// Snapshot weights for serialization or evaluation copies.
    public func weightsCopy() -> Weights

    /// Replace weights atomically (used for warm-starting from snapshot).
    public func setWeights(_ weights: Weights)

    public struct ForwardCache {
        // Per-state activation cache, sized at construction.
        // Holds H_0, H_1, H_2, H_3, boardEmbed, globalEmbed,
        // combined, mixed, output_pre.
        public init(hyperparameters: Hyperparameters)
    }

    public struct Gradients {
        // Same shape as Weights. Created once per thread, reused.
        public init(hyperparameters: Hyperparameters)
        public mutating func zero()
        public mutating func add(_ other: Gradients)
    }

    public struct Weights {
        // Flat [Float] arrays, one per parameter tensor.
        public var gcnWeights: [[Float]]      // [layer][F_in*F_out]
        public var gcnBiases:  [[Float]]      // [layer][F_out]
        public var globalFC:   (w: [Float], b: [Float])
        public var mixFC:      (w: [Float], b: [Float])
        public var outputFC:   (w: [Float], b: [Float])
    }
}
```

### AccelerateGVNTrainer

```swift
public struct AccelerateGVNTrainer: Sendable {

    public struct Config: Sendable, Codable {
        public var lambda: Float
        public var learningRate: Float
        public var epochs: Int
        public var gamma: Float
        public var l2Lambda: Float
        public var maxStatesPerGame: Int
        public var seed: UInt32
        public var threadCount: Int  // 0 = auto (ProcessInfo.processorCount)

        public static let `default`: Config
    }

    public struct TrainResult: Sendable {
        public var finalTDError: Float
        public var errorHistory: [Float]
        public var gamesUsed: Int
        public var totalTransitions: Int
        public var phase1Seconds: Double
        public var phase2Seconds: Double
    }

    public static func train(
        model: AccelerateGVN,
        transcripts: [String: [GameMove]],
        matches: [TrainingMatchInfo],
        map: MapDefinition,
        playerCount: Int,
        config: Config = .default
    ) -> TrainResult
}
```

### AccelerateGraphLearnedAgent

```swift
public final class AccelerateGraphLearnedAgent: PlayerAgent, @unchecked Sendable {
    // Justification: holds AccelerateGVN reference; agent is only used
    // serially within a single match by the match runner.

    public init(
        weightsURL: URL,
        graphEncoder: GraphEncoder,
        globalEncoder: GlobalEncoder
    ) throws

    // PlayerAgent conformance
    public func chooseAction(state: GameSnapshot, validActions: [GameMove]) async -> GameMove
}
```

### Weight serialization

```swift
public enum AccelerateGVNWeights {
    /// Magic bytes "AGVN" + version u32 + hyperparams + weight tensors
    /// in fixed order: gcn[0].w, gcn[0].b, gcn[1].w, ..., outputFC.w, outputFC.b.
    /// Each tensor: u32 length followed by length*4 bytes little-endian Float.
    public static func save(_ weights: AccelerateGVN.Weights, to url: URL) throws
    public static func load(from url: URL) throws -> (
        weights: AccelerateGVN.Weights,
        hyperparameters: AccelerateGVN.Hyperparameters
    )
}
```

---

## 4. MCP Schema

`AccelerateGVN` is not directly MCP-exposed — it is an internal training/inference subsystem invoked via the existing `iconquer-tournament` CLI. The CLI flag surface, however, IS the user-facing contract:

```json
{
  "command": "iconquer-tournament train",
  "arguments": {
    "storage": "/tmp/t5-overnight",
    "map": "world",
    "architecture": "accelerate",
    "epochs": 100,
    "td-lambda": 0.7,
    "learning-rate": 0.001,
    "players": 2,
    "threads": 0
  }
}
```

**Parameter Types:**
- `architecture` (string): `mlp` | `graph` | `accelerate`. New value `accelerate` selects this implementation.
- `epochs` (integer): training epochs, > 0
- `td-lambda` (float): TD(λ) parameter in [0, 1]
- `learning-rate` (float): Adam learning rate, > 0
- `players` (integer): 2..6
- `threads` (integer): 0 for auto (`ProcessInfo.processorCount`), else explicit count

The `accelerate-learned` agent name is added to the tournament agent registry alongside `graph-learned`, so it can be matched against other agents directly.

---

## 5. Constraints & Compliance

**Concurrency:**
- `AccelerateGVN` is `@unchecked Sendable` with a justification comment because its weight buffers are mutable. Trainer holds exclusive write access during `step()`. Forward/backward are read-only on weights and write only into per-thread `ForwardCache` and `Gradients` buffers.
- `AccelerateGVNTrainer.train(...)` uses `DispatchQueue.concurrentPerform` over the gradient batch. Each iteration index gets its own thread-local cache + gradient buffer (allocated once per thread, reused across batches).
- All public structs are `Sendable` (value types, no reference fields).

**Pointer safety (PointerEscapeAuditor compliance):**
- Forward and backward use `UnsafePointer<Float>` parameters that are constructed from `[Float]` via `withUnsafeBufferPointer` at the call site.
- No pointer escapes from inside a `withUnsafe*` block. All pointer use is strictly within a single scope.
- Caches and gradient buffers store `[Float]` arrays directly, not pointers.

**Recursion:** None. All loops are bounded by hyperparameter dimensions or the gradient batch size.

**Safety:**
- No force unwraps. Validation errors thrown via `AccelerateGVNError`.
- Division safety: Adam epsilon (1e-8) added before sqrt division to avoid NaN.
- Bounds checked on slot indices in serialization deserializer.

**Determinism:**
- Adam is deterministic given fixed seed and ordering.
- `concurrentPerform` is **not** guaranteed deterministic — gradient summation order varies. The reduction uses `vDSP_vadd` over thread-local buffers, and floating-point addition is not associative, so two runs with the same seed may produce 1e-6 weight drift. Acceptable for our use case (Elo-evaluated, not bit-reproducible).
- Seed fed into the weight initializer is deterministic.

**MCP Ready:** CLI flag schema specified above; weights file is a self-describing binary blob.

---

## 6. Backend Abstraction

**This proposal IS a backend swap** — `AccelerateGVN` is the CPU/Accelerate backend for the GVN architecture. The existing `GraphValueNetwork` is the MLX/GPU backend.

**Backend selection:**
- Selected at training time via `--architecture accelerate` (training writes a binary header identifying the implementation).
- Selected at inference time by inspecting the weights file header — `AGVN` magic loads `AccelerateGraphLearnedAgent`; safetensors loads the existing `GraphLearnedAgent`.
- No automatic fallback: an architecture mismatch fails loudly at load time with a clear error.

**Why not auto-switch?**
- The two networks have different numerical behavior (Accelerate drops softmax, outputs raw values; MLX outputs softmaxed probabilities). They are not interchangeable mid-game.
- Saved weights are explicitly tied to one backend by file format.

**Linux compatibility:**
- Accelerate is macOS-only. For Linux server deployment we'd swap `cblas_sgemm` from Accelerate for an OpenBLAS / Apple's open-source `swift-numerics-cpu-blas` (TBD if/when needed). The structure (forward/backward/Adam in flat `[Float]` arrays) is portable; only the BLAS calls change.
- Out of scope for v1 — the trainer runs on dev machines (Apple Silicon).

---

## 7. Dependencies

**Internal:**
- `IconquerCore` — `MapDefinition`, `GameSnapshot`, `Game`, `GameMove`, `Player`, `Settings`, `SeededRNG`
- `IconquerAI/Learned/GraphEncoder.swift` — reused for node feature extraction; will add `encodeNodesAsFloats(state:)` returning `[Float]` directly to skip the MLXArray round-trip
- `IconquerAI/Learned/GlobalEncoder.swift` — same: add `encodeAsFloats(state:)`
- `IconquerAI/Learned/TrainingExample.swift` — `TrainingMatchInfo` reused

**External:**
- `Accelerate.framework` (system, no SPM dependency) — provides `cblas_sgemm`, `vDSP_*`
- No new package dependencies

**No removals:** The MLX-based GVN keeps all its dependencies (mlx-swift, MLXNN). They coexist in the same target.

---

## 8. Test Strategy

### Test Categories

**Numerical equivalence (vs. MLX reference):**
1. Initialize MLX `GraphValueNetwork` with seed S; extract its weights
2. Construct `AccelerateGVN` and load the same weights (via a one-time bridging utility in tests only)
3. Drop softmax from MLX output for fair comparison: compare pre-softmax logits
4. Run forward pass on 10 deterministic random states
5. Assert max absolute difference < 1e-4

This test catches transposed matmul bugs, off-by-one in slicing, and mis-ordered layer application.

**Gradient correctness (finite-difference):**
1. Build tiny network: nodeFeatures=4, gcnHidden=8, playerCount=2, territoryCount=6
2. For each parameter `θ_i`:
   - Compute analytic gradient `g_i` via `backward()`
   - Compute numerical gradient: `(L(θ + h·e_i) - L(θ - h·e_i)) / (2h)` with h = 1e-3
   - Assert relative error `|g_i - g_num| / max(|g_i|, |g_num|, 1e-6) < 1e-2`
3. Test on 5 random seeds.

This is the critical correctness test — if backward is wrong, training silently produces garbage.

**Convergence (smoke test):**
1. Generate 1000 synthetic states with known target value `V*(s) = (some closed-form function of features)`
2. Train AccelerateGVN for 50 epochs
3. Assert final MSE < 0.01 and trajectory monotonically decreases

**Determinism:**
1. Train twice with same seed, single-threaded → assert weight-buffer-byte-identical
2. Train twice with same seed, multi-threaded → assert outputs differ by < 1e-4 on a held-out state set

**Performance (benchmark, not pass/fail):**
1. Measure forward + backward time for batch of 200 states on dev machine
2. Log to test output, fail only if > 5x worse than the documented baseline (TBD after first run)

**Serialization roundtrip:**
1. Train tiny model
2. Save weights to temp file, reload into fresh AccelerateGVN
3. Assert outputs identical on test states

### Reference truth

- **Forward pass:** the existing MLX `GraphValueNetwork.callAsFunction` with softmax stripped, run on identical weights. This is our oracle. Matches Carr (2020) and GG-Net (Heinrich et al., 2023) within numerical precision.
- **Backward pass:** finite-difference is self-validating, no external reference needed.
- **Adam:** Kingma & Ba (2014), Algorithm 1. Standard implementation, independently verifiable against PyTorch's `torch.optim.Adam` if ever needed.

### Validation Trace

Specific input → expected output for the golden-path forward test:

- nodeFeatures = 4, territoryCount = 6, playerCount = 2, gcnHidden = 8
- All weights initialized via Glorot with seed 42
- Input nodes = a 6×4 matrix of fixed values (encoded in test as a `[Float]` literal)
- Input adjacency = the symmetric normalized adjacency for a 6-node ring graph (computed once and inlined)
- Input global = an 8-element fixed vector
- Expected output: assert that `AccelerateGVN.forward(...)` matches `MLXGVN(without softmax)` to 1e-4 absolute tolerance

The exact 2-element output vector is computed in the test by running the MLX network once with the same weights, and the resulting values are inlined into the test source as the assertion target. If MLX numerics ever change, regenerate.

---

## 9. Architecture Decision Review

**ADR check:**
- [x] Reviewed `architecture_decisions.md` — no existing ADR specifies the GVN backend choice
- [x] Does this supersede an existing ADR? No
- [x] Does this amend an existing ADR? No
- [x] **New ADR required? Yes** — draft below

### New ADR Draft

**Title:** ADR-NNN — Accelerate is the default backend for value-network training

**Category:** performance

**Status:** Proposed

**Context:** The MLX-based Graph Value Network trains 100 epochs on 100k games in ~28 hours, with profiling showing the bottleneck is per-kernel GPU dispatch on a small (42-node, 64-hidden) network. MLX's strengths — large batched matmul, kernel fusion, autograd — are wasted at this scale. Per-element GPU→CPU sync barriers in TD(λ) target computation amplify the overhead.

**Decision:** Accelerate (cblas + vDSP) becomes the default backend for new value-network training in IconquerAI. The MLX implementation remains available for comparison and for any architecture that grows beyond the current scale.

**Consequences:**
- (+) Training time goal of < 1 hour becomes achievable; self-play loop becomes practical at planned scale
- (+) Removes GPU as a deployment requirement for inference (CPU-only inference works on any Apple platform)
- (+) Easier to debug and reason about — no async kernel queues, no opaque graph optimizer
- (−) Backward pass and Adam are hand-rolled, increasing surface area for bugs (mitigated by finite-diff gradient tests)
- (−) Backend split increases code volume in IconquerAI (~1500 LOC added net)
- (−) If we later add a much larger architecture (transformer, deeper GCN), we'll likely want MLX back — keeping it side-by-side preserves that option

**Alternatives considered:**
- **Larger MLX batch sizes:** MLX OOMs at the gradient tape sizes needed. We already mitigated with two-phase encoding; further reductions trade off training stability.
- **PyTorch via Python bridge:** adds Python runtime, IPC overhead, deployment complexity. Apple-platform native solution preferred.
- **Custom Metal kernels:** would address dispatch overhead but is a much larger project for marginal gain over Accelerate at this network size.

---

## 10. Open Questions

1. **Drop softmax confirmed?** Recommended (TD(λ) values are not probabilities). Confirmed in design discussion. Output head is now `[mixHidden] → [playerCount]` raw values.

2. **Side-by-side or replace MLX?** Side-by-side for v1. Confirmed in design discussion.

3. **Adam vs. simpler optimizer?** Sticking with Adam — it's what the MLX path uses, and the per-step cost is negligible compared to forward+backward.

4. **Single-precision (Float) vs. double?** Float (32-bit). Matches MLX, halves memory bandwidth, hits cblas_sgemm fast path. We'll only revisit if convergence is unstable.

5. **Should the agent's inference path also use Accelerate?** Yes — `AccelerateGraphLearnedAgent` uses the same forward pass. Inference latency target < 100µs/state (vs. ~5-10ms with MLX inference). This makes the agent usable in 5-second-per-turn tournament settings.

6. **Threading library — GCD vs. swift-async?** GCD's `concurrentPerform` is the right primitive: bounded parallelism, no scheduler overhead, native NEON/Accelerate compatibility. Swift Concurrency adds task overhead per iteration that's measurable at our batch sizes. (No open question — decided.)

7. **What batch size should Phase 2 use?** Initial guess: 32 games per gradient step (4x the MLX value of 10), justified by no longer being GPU-memory bound. Actual value to be tuned in implementation. Open question: do we expose this as a config parameter or auto-tune?

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Combines 3+ APIs? Yes (AccelerateGVN, AccelerateGVNTrainer, AccelerateGraphLearnedAgent)
- Explanation requires 50+ lines? Yes (architecture decisions, perf trade-offs, when to choose this vs. MLX)
- Needs theory/background? Yes (TD(λ), why-Accelerate-not-MLX, gradient derivation overview)

**Article Name:** `AccelerateGVNGuide.md` (note: not `AccelerateGVN.md` to avoid DocC parser conflict with the symbol)

**Article should cover:**
1. When to choose this backend over the MLX backend (network size heuristic)
2. The forward + backward equations with derivations
3. Adam pseudocode mapped to vDSP calls
4. The parallelization pattern (per-thread caches, additive gradient reduction, ordering caveats)
5. How to load weights into a tournament agent
6. Measured benchmarks vs. MLX baseline (filled in after implementation)

In-code DocC for every public API.

---

## 12. Performance Considerations

### Per-state forward cost (back-of-envelope)

Per state, the dominant ops are:

| Op | Shape | FLOPs |
|---|---|---|
| GCN agg (×3) | A[42,42] @ H[42,F] | 42·42·F per layer |
| GCN matmul (×3) | H[42,F] @ W[F,64] | 42·F·64 per layer |
| globalFC | g[F_g] @ W[F_g,64] | F_g·64 |
| mixFC | c[128] @ W[128,64] | 128·64 |
| outputFC | m[64] @ W[64,P] | 64·P |

For our config (F_node=10, gcnHidden=64, F_global=24, P=2):

- GCN layer 0: agg = 42·42·10 = 17.6k; matmul = 42·10·64 = 27k → **44.6k**
- GCN layer 1: agg = 42·42·64 = 113k; matmul = 42·64·64 = 172k → **285k**
- GCN layer 2: same as layer 1 → **285k**
- globalFC: 24·64 = 1.5k
- mixFC: 128·64 = 8.2k
- outputFC: 64·2 = 0.13k
- **Total per state forward: ~625k FLOPs**

Backward roughly doubles this → **~1.3M FLOPs per state per gradient step**.

### Throughput target

- 100 epochs × 100k games × ~20 states/game = 200M states processed
- At 1.3M FLOPs/state = 260 GFLOPs total work
- Apple M1 P-core peak: ~50 GFLOPs single-thread sustained (cblas_sgemm hits 80%+ of peak for small matrices when L1-resident)
- Single-thread time: 260 / 50 = **~5.2 seconds** (theoretical peak)
- With realistic overhead (bounds checks, allocations, gradient accumulation, Adam steps): **~30 min single-thread**
- 8-thread parallelization: **~5 min Phase 2**, plus Phase 1

This leaves comfortable margin under our 1-hour target.

### Memory layout

- All weights are flat `[Float]` arrays. Total: ~50 KB (3 GCN layers × 64×64 + heads ≈ 12k floats).
- Per-state forward cache: ~8.5 KB (activations from all 6 layers).
- Per-thread gradient buffer: same ~50 KB.
- 8 threads × (cache + gradient) = ~470 KB. Fits in L2 cache on Apple Silicon (4–12 MB depending on chip).
- Adjacency matrix: 42×42 = 7 KB, shared, hot in L1.

This is the magic: **the entire working set fits in cache**. cblas_sgemm on these dimensions runs at near-peak throughput.

### Parallelization details

```
for epoch in 0..<config.epochs {
    for batchStart in stride(from: 0, to: encodedGames.count, by: gradientBatchSize) {

        // Each thread uses its own cache + gradient buffer (allocated once per thread, kept alive across batches via thread-local dictionary)
        DispatchQueue.concurrentPerform(iterations: batchStates) { idx in
            let state = batchStates[idx]
            model.forward(state, into: &threadCache[Thread.current])
            model.backward(threadCache, outputGrad,
                           into: &threadGradients[Thread.current])
        }

        // Serial reduce
        for tg in threadGradients.values {
            summedGradients.add(tg)
        }
        model.step(summedGradients, lr: ...)
    }
}
```

Thread-local storage strategy: pre-allocate one `ForwardCache` and one `Gradients` per worker thread at trainer construction, indexed by thread index (0..<threadCount). `concurrentPerform` provides the iteration index, which we map to `iter % threadCount` for buffer selection.

### Phase 1 parallelization

Phase 1 (game replay + encoding) is embarrassingly parallel — each game is independent. Use `withTaskGroup` (Swift Concurrency, since we're not in a perf-critical inner loop here):

```
await withTaskGroup(of: LightweightGameData?.self) { group in
    for match in validMatches {
        group.addTask {
            replayAndEncode(match, ...)
        }
    }
    for await result in group {
        if let r = result { encodedGames.append(r) }
    }
}
```

The encoder methods are `Sendable` and stateless; we pass references safely. Expected speedup: 5-7x on 8-core Apple Silicon → 24 min becomes ~4 min.

### Tier 1 optimizations included in v1

These are baked into the implementation plan, not optional:

**Pre-packed weight matrices (`cblas_sgemm_pack`).** Apple Accelerate provides `cblas_sgemm_pack` to repack a weight matrix into the layout that the BLAS kernel actually wants. After each Adam step we re-pack each weight matrix once, then every forward and backward sgemm in the next batch uses `cblas_sgemm_compute` against the packed form. Per Adam step we re-pack 6 matrices (~0.05ms total); we save ~30% on each of 200·6 = 1200 sgemm calls per batch. Net win: ~1.5–2× on the matmul step, which is the dominant cost.

```swift
// Once per Adam step
cblas_sgemm_pack(.RowMajor, .Pack_B, .NoTrans,
                 m, n, k, 1.0, W, k, packedW)

// Per state forward / backward
cblas_sgemm_compute(.RowMajor, .NoTrans, .Packed,
                    m, n, k, H, k, packedW, n, 0, output, n)
```

**Pre-packed adjacency.** A is constant for the run. Pack at trainer construction, hot in L1 forever. Free.

**Tier 1 explicit choice — `concurrentPerform` over states, single-thread per matmul.** Two competing parallelism strategies exist (see "Tier 1 fork" below). v1 uses **per-state forward + `concurrentPerform`** with each per-state matmul running single-threaded inside Accelerate. This avoids fighting Accelerate's own internal threading on small matrices, which causes contention.

### Tier 1 fork — per-state vs. batched-sgemm

There are two ways to extract parallelism, and the right answer depends on Accelerate's internal threading thresholds for our specific matrix dimensions. The proposal commits to (A); we benchmark and reconsider if we miss the perf target.

| Strategy | Per-batch cost (estimate) | Risk |
|---|---|---|
| **A. Per-state forward + `concurrentPerform`** (v1 default) | ~750µs on 8 cores (200 states × 30µs each, well-parallelized) | Low — the parallelism granularity is predictable and matches Apple Silicon's P-core count |
| **B. Batched-sgemm + Accelerate-internal-threading** | ~400–800µs (heavily depends on whether Accelerate threads at our sizes) | Medium — Accelerate may not engage internal threading for `[8400, 64] × [64, 64]`; if it doesn't, we lose half our cores |

**Strategy B implementation note** (for reference if we need to switch):
- Stack all B states' nodes batch-first as `[B, N, F]`, reshape to `[N, B·F]` for the GCN aggregation step
- One sgemm: `A [N,N] · H_packed [N, B·F] = [N, B·F]`, reshape back
- For the per-layer `Linear`: stack as `[B·N, F_in]`, one sgemm of `[B·N, F_in] × [F_in, F_out] = [B·N, F_out]`
- Six large sgemms per batch instead of 1200 small ones
- Drop `concurrentPerform` entirely — Accelerate's internal threading owns the cores

If A misses the perf target, switching to B is a localized refactor (the trainer's batch loop and the GVN's forward signature; the backward and the optimizer don't change).

### Tier 2 optimizations (deferred, mentioned for future work)

- **BNNS for fused linear + ReLU** in the inference path. `BNNS.FullyConnectedLayer` fuses the matmul, bias, and activation into a single call. For batched training the win is small (we can already fuse via vDSP_vthres after sgemm); for the single-state inference path used by `AccelerateGraphLearnedAgent` it's cleaner. Add as a benchmark target after the v1 trainer ships.
- **Pipelined batch loop.** Three-stage pipeline: thread A does forward+backward on batch N, thread B does Adam on batch N-1, thread C prepares input tensors for N+1. ~2× throughput on the batch loop. Adds significant synchronization complexity; defer until v1 numbers are in hand.
- **Async SGD across CPU + GPU (Hogwild-style).** Two trainers writing into shared weights — one Accelerate, one MLX. ~1.5–2× on aggregate, but convergence stability is dicey at our network size and adds substantial complexity. Skip indefinitely unless v1 misses the target by a large margin.
- **Custom Metal kernels.** Out of scope; would only help if the network grew significantly larger.
- **Mixed precision (Float16).** Not worth the precision risk at this scale.
- **Gradient checkpointing.** Irrelevant; activations are already tiny.
- **Quantization for inference.** Defer until inference latency is actually a bottleneck.

### Why GPU/ANE underutilization is intentional

A reasonable observation: with the Accelerate path, GPU and ANE sit idle during training. This is **deliberate** for our network size:

- **GPU dispatch latency** is 10–50µs per kernel. Our weight matrices are ≤ 64×64 — the actual matmul is microseconds. Even with perfect MLX batching, GPU dispatch overhead is comparable to the work itself. (This is exactly why MLX took 28 hours: 200 separate `model()` calls per gradient batch × hundreds of thousands of batches × per-element sync barriers.)
- **The entire working set fits in L1/L2 cache** on Apple Silicon (~470 KB across 8 threads with all per-thread buffers + weights + adjacency). CPU memory bandwidth and cache locality become the dominant factor — GPU's strengths (HBM bandwidth, massive parallelism) provide no benefit at this scale.
- **ANE** is unhelpful for training: weights change every Adam step, and Core ML conversion is too expensive to do per-step. ANE could potentially serve the inference path during self-play (batched state evaluation across many parallel games), but that's a v2 conversation orthogonal to making the trainer fast.

**Threshold for revisiting this decision:** if we ever go to `gcnHidden ≥ 256` or `gradientBatchSize ≥ 1024`, GPU becomes competitive again. Current values (`gcnHidden = 64`, batch ≤ 64) are firmly in CPU-wins territory.

### Measurement plan

After v1 implementation:
1. Run the standard 100k-game training, record wall time for Phase 1, Phase 2, and total
2. Run a head-to-head tournament: `accelerate-learned` vs. `graph-learned` (both trained on same data)
3. Document results in the narrative article

If the run does not hit < 1 hour, profile with Instruments → Time Profiler. Most likely culprits in order: thread contention on gradient summation (fix: tree reduction), cache misses on weights (fix: reorder weight layout), too-small gradient batches (fix: increase batch size).

---

## Approval

- [ ] Reviewed by author
- [ ] Architecture sign-off
- [ ] Open questions resolved or deferred
- [ ] Ready to move to UPCOMING/ and begin TDD

**Approver:** _pending_
**Date approved:** _pending_

---

**End of proposal.**
