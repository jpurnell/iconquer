# No Hardcoded Domain Constants

**Purpose:** Domain-specific values must flow from configuration objects, not magic numbers scattered through code.

---

## The Rule

> **No domain-specific numeric literal should appear in source code outside of named configuration types or presets.**

Dimensions, counts, sizes, identifiers, thresholds, and structural parameters should flow from a configuration object — not from literals embedded in implementation code.

---

## Classification

### Permitted as Literals

Values that are universal or infrastructure-level:

| Category | Examples |
|----------|----------|
| **Platform/hardware constants** | Page sizes, alignment requirements, SIMD widths |
| **Math constants** | Epsilon, pi, common scaling factors |
| **Framework limits** | Max batch size, max concurrent operations |
| **Protocol constants** | HTTP status codes, well-known ports |

### Must Come from Configuration

Values that would change for a different use case, deployment, or domain variant:

| Instead of... | Use... |
|---------------|--------|
| `let dim = 4096` | `config.dimension` |
| `for i in 0..<60` | `for i in 0..<config.layerCount` |
| `if id == 248046` | `if id == config.terminatorID` |
| `let offset = 2097152` | `config.dataOffset` |
| `buffer = alloc(512 * size)` | `buffer = alloc(config.count * size)` |

---

## Why This Matters

### 1. Testability
Configuration presets (e.g., a "tiny" or "test" config) allow integration tests to run with minimal data. Without this, tests may require production-scale resources.

### 2. Portability
Supporting a new variant (model architecture, schema version, protocol revision) should require a new configuration preset — not scattered code changes.

### 3. Correctness
When the same value appears as a literal in multiple files, the copies inevitably diverge during maintenance. A single configuration source of truth eliminates this entire class of bug.

### 4. Discoverability
A configuration struct documents all tunable parameters in one place, making the system's degrees of freedom explicit to new contributors.

---

## Recommended Pattern

Define a configuration struct with named presets:

```swift
public struct EngineConfig: Sendable {
    public let inputDimension: Int
    public let layerCount: Int
    public let maxItems: Int
    // ... all domain-specific parameters

    /// Production configuration.
    public static let production = EngineConfig(
        inputDimension: 4096,
        layerCount: 60,
        maxItems: 512
    )

    /// Minimal configuration for testing.
    public static let test = EngineConfig(
        inputDimension: 8,
        layerCount: 2,
        maxItems: 4
    )
}
```

Types that depend on domain dimensions accept the config at initialization:

```swift
public init(device: MTLDevice, config: EngineConfig) throws {
    let buffer = device.makeBuffer(
        length: config.inputDimension * MemoryLayout<Float>.size
    )
    // ...
}
```

---

## Anti-Patterns

### Scattered Magic Numbers
```swift
// BAD: 4096 appears in 12 files, 512 in 8 files — which is right?
let buffer = allocate(4096 * MemoryLayout<Float>.size)
let experts = Array(repeating: 0, count: 512)
```

### Constants File Without Injection
```swift
// BAD: Global constants are still hardcoded — just in one place
struct Constants {
    static let dimension = 4096  // Can't test with a different value
}
```

### Correct: Config with Presets
```swift
// GOOD: Testable, portable, discoverable
let config = EngineConfig.test  // or .production, or .customVariant
let buffer = allocate(config.inputDimension * MemoryLayout<Float>.size)
```

---

## Enforcement Checklist

### Design Proposal Review
- [ ] Does the proposal introduce numeric literals that are domain-specific?
- [ ] Can the feature work with a minimal/test configuration preset?
- [ ] Are new configuration parameters added to the config struct?

### Code Review
- [ ] Grep for known domain-specific magic numbers
- [ ] All buffer/array sizes derive from configuration
- [ ] All loop bounds over domain collections derive from configuration
- [ ] No token/identifier literals outside of config presets

### Testing
- [ ] Integration tests prefer minimal config presets
- [ ] If a test requires a specific preset, the reason is documented

---

## Related Documents

- [Coding Rules](01_CODING_RULES.md) — General code style and safety
- [Design Proposal](05_DESIGN_PROPOSAL.md) — Architecture validation phase
- [Architecture Decisions](06_ARCHITECTURE_DECISIONS.md) — Decision log
