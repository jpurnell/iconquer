# Design Proposal: On-Device AI Integration for IconquerCLI

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Add two on-device AI agent providers (Apple Foundation Models, Ollama) to IconquerCLI

---

## 1. Objective

Add on-device AI model support to IconquerCLI via two new `PlayerAgent` implementations: `AppleAIAgent` (Apple Foundation Models, macOS 26+) and `OllamaAgent` (Ollama HTTP daemon, any macOS).

**Problems solved:**
1. **API key barrier.** Current LLM agents require Anthropic/OpenAI API keys and network access. On-device models eliminate both requirements.
2. **Latency and cost.** Cloud API calls add 2-10 seconds of latency and per-token cost. On-device inference on Apple Silicon runs in 0.5-3 seconds with zero marginal cost.
3. **Offline play.** Neither provider requires internet, enabling fully offline AI opponents.
4. **Tournament diversity.** More agent types expand the strategy tournament surface for the Phase 3 LLM tournament vision.

**Master Plan Reference:** Phase 2 -- AI agents; Phase 3 -- LLM tournament server

---

## 2. Proposed Architecture

### New Files

- `Sources/IconquerCLILib/AppleAIAgent.swift` -- `PlayerAgent` backed by FoundationModels (`#if canImport(FoundationModels)`)
- `Sources/IconquerCLILib/OllamaAgent.swift` -- `PlayerAgent` backed by Ollama localhost HTTP API
- `Sources/IconquerCLILib/GamePromptBuilder.swift` -- Shared prompt construction extracted from `LLMAgent`
- `Tests/IconquerCLILibTests/OllamaAgentTests.swift` -- Mock HTTP tests for Ollama request/response format
- `Tests/IconquerCLILibTests/AppleAIAgentTests.swift` -- Conditional compilation tests for prompt building
- `Tests/IconquerCLILibTests/GamePromptBuilderTests.swift` -- Unit tests for shared prompt builder

### Modified Files

- `Sources/IconquerCLILib/AgentFactory.swift` -- Register `"apple"`, `"ollama"`, and `"ollama:<model>"` agent names
- `Sources/IconquerCLILib/LLMAgent.swift` -- Extract prompt building and move parsing into `GamePromptBuilder`

### Module Placement

All new files live in the existing `IconquerCLILib` module. No new SPM targets are required -- both agents use only Foundation (`URLSession` for Ollama, `FoundationModels` for Apple) and existing `IconquerCore`/`IconquerMatch` types.

---

## 3. API Surface

### GamePromptBuilder (extracted from LLMAgent)

```swift
/// Shared prompt construction and move parsing for all LLM-based agents.
public struct GamePromptBuilder: Sendable {
    private let map: MapDefinition

    public init(map: MapDefinition)

    /// Build a system prompt describing iConquer rules and strategy.
    public func buildSystemPrompt() -> String

    /// Build a user prompt describing current game state and legal moves.
    public func buildUserPrompt(state: GameSnapshot, seat: PlayerId) -> String

    /// Parse a text response (plain text or JSON) into a GameMove.
    public func parseMove(
        from response: String,
        state: GameSnapshot,
        seat: PlayerId
    ) -> GameMove?

    /// Produce a reasonable fallback move when parsing fails.
    public func fallbackMove(state: GameSnapshot, seat: PlayerId) -> GameMove
}
```

### AppleAIAgent

```swift
#if canImport(FoundationModels)
import FoundationModels

/// On-device AI agent using Apple Foundation Models (macOS 26+).
///
/// Uses `LanguageModelSession` with `@Generable` structured output
/// to produce moves. No API key or network required.
public struct AppleAIAgent: PlayerAgent, Sendable {
    public let identity: AgentIdentity
    private let promptBuilder: GamePromptBuilder

    public init(map: MapDefinition, name: String)

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}

/// Structured output type for Apple Foundation Models.
@Generable
struct LLMGameMove: Sendable {
    @Guide(description: "The move command, e.g. 'pick Alaska' or 'attack Brazil Argentina'")
    var move: String
    @Guide(description: "Brief strategic reasoning for this move")
    var logic: String
}
#endif
```

### OllamaAgent

```swift
/// On-device AI agent using Ollama HTTP API (localhost:11434).
///
/// Sends game state to a locally running Ollama model and parses
/// the response. Supports JSON schema structured output for
/// compatible models.
public struct OllamaAgent: PlayerAgent, @unchecked Sendable {
    // Justification: URLSession is thread-safe; all stored properties are immutable after init
    public let identity: AgentIdentity
    private let model: String
    private let baseURL: URL
    private let promptBuilder: GamePromptBuilder

    public init(
        model: String = "llama3.2:3b",
        baseURL: URL = URL(string: "http://localhost:11434")!,  // init-time only
        map: MapDefinition,
        name: String
    )

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

### AgentFactory Registration

```swift
// New cases in AgentFactory.make(name:seed:map:)
case "apple":
    #if canImport(FoundationModels)
    return AppleAIAgent(map: map, name: "apple")
    #else
    throw .unknownAgent("apple -- requires macOS 26+ with Apple Silicon")
    #endif

case let name where name.hasPrefix("ollama"):
    let model = extractOllamaModel(from: name) ?? "llama3.2:3b"
    return OllamaAgent(model: model, map: map, name: name)
```

### CLI Usage

```
--player-config "Siri:apple"                     # Apple Foundation Models
--player-config "Local:ollama"                    # Ollama default model (llama3.2:3b)
--player-config "Local:ollama:mistral:7b"         # Ollama specific model
--player-config "Local:ollama:phi-3.5:3.8b"       # Ollama another model
```

---

## 4. MCP Schema

### AppleAIAgent Tool

**Tool Description:** Create an on-device AI player using Apple Foundation Models.

**REQUIRED STRUCTURE (JSON):**
```json
{
  "agent_type": "apple",
  "player_name": "Siri"
}
```

**Parameter Types:**
- agent_type (string): Must be `"apple"`. Requires macOS 26+ with Apple Silicon.
- player_name (string): Display name for the player.

### OllamaAgent Tool

**Tool Description:** Create an on-device AI player using a locally running Ollama model.

**REQUIRED STRUCTURE (JSON):**
{
  "agent_type": "ollama",
  "player_name": "Local",
  "model": "llama3.2:3b",
  "base_url": "http://localhost:11434"
}
```

**Parameter Types:**
- agent_type (string): Must be `"ollama"`.
- player_name (string): Display name for the player.
- model (string): Ollama model tag. Default: `"llama3.2:3b"`. Common values: `"llama3.2:3b"`, `"phi-3.5:3.8b"`, `"mistral:7b"`, `"gemma2:2b"`.
- base_url (string): Ollama HTTP endpoint. Default: `"http://localhost:11434"`. Must be a localhost URL.

---

## 5. Constraints & Compliance

**Concurrency:**
- `AppleAIAgent` is `Sendable` (all stored properties are immutable value types).
- `OllamaAgent` is `@unchecked Sendable` with justification (same pattern as existing `LLMAgent` -- URLSession is thread-safe, all stored properties immutable after init).
- `GamePromptBuilder` is `Sendable` (immutable struct).

**Safety:**
- No force unwraps in runtime code. The `URL(string:)!` in `OllamaAgent.init` default parameter is compile-time constant; alternatively, use a static `let` with a guard.
- Guard clauses validate Ollama HTTP responses before parsing.
- Deadline enforcement: both agents check `ContinuousClock.now` against deadline and throw `AgentError.timeout` if exceeded.
- Fallback: both agents fall back to `GamePromptBuilder.fallbackMove` on parse failure (same as LLMAgent).

**Conditional Compilation:**
- `AppleAIAgent` wrapped entirely in `#if canImport(FoundationModels)`.
- On platforms where FoundationModels is unavailable, `"apple"` in AgentFactory throws a descriptive error.
- `OllamaAgent` uses only Foundation -- available on all platforms.

**No New External Dependencies:**
- Apple Foundation Models is a system framework (macOS 26+).
- Ollama communication uses `URLSession` (Foundation).
- No third-party packages added.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Both agents delegate inference to external engines (Apple's on-device model runtime and Ollama daemon respectively). IconquerCLI performs no compute-intensive work itself -- it constructs prompts and parses responses.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore/MapDefinition` -- map data for prompt building
- `IconquerMatch/PlayerAgent` -- protocol conformance
- `IconquerMatch/GameSnapshot`, `GameMove`, `PlayerId` -- game state types
- `IconquerCLILib/LLMAgent` -- source of extracted prompt/parse logic (becomes consumer of `GamePromptBuilder`)

**External Dependencies:** None

**System Framework Dependencies:**
- `Foundation` (URLSession) -- already linked
- `FoundationModels` (macOS 26+) -- new, conditionally imported

**Runtime Dependencies:**
- Apple Foundation Models: macOS 26+ on Apple Silicon. No daemon needed.
- Ollama: `ollama serve` must be running on `localhost:11434`. User is responsible for installing Ollama and pulling models.

---

## 8. Test Strategy

**Test Categories:**

### GamePromptBuilder (extracted, testable in isolation)
- **Golden path:** Known game state produces expected prompt sections (player summary, country list, legal moves, continent info)
- **Move parsing:** JSON response `{"move": "pick Alaska", "logic": "..."}` parses to `.pickCountry("Alaska")`
- **Plain text parsing:** `"attack Brazil Argentina"` parses to `.attack(from: "Brazil", to: "Argentina", mode: .once)`
- **Fallback:** Unparseable response returns a legal fallback move
- **Edge cases:** Empty state, single player, no legal moves

### OllamaAgent
- **Request format:** Verify HTTP POST body matches Ollama `/api/chat` schema (model, messages, format fields)
- **JSON schema:** Verify the `format` field contains correct JSON schema for structured output
- **Response parsing:** Mock HTTP server returns valid JSON, agent extracts move
- **Error handling:** Mock returns 404/500/timeout, agent falls back gracefully
- **Model parsing:** `"ollama:mistral:7b"` extracts model `"mistral:7b"`; `"ollama"` defaults to `"llama3.2:3b"`
- **Daemon detection:** Agent throws descriptive error when Ollama is not running (connection refused)

### AppleAIAgent (conditional)
- **Conditional compilation:** `#if canImport(FoundationModels)` tests only run on macOS 26+
- **Prompt building:** Verify agent delegates to `GamePromptBuilder` (testable via prompt output)
- **Structured output:** Verify `@Generable LLMGameMove` round-trips correctly
- **Fallback:** When `LanguageModelSession` throws, agent returns fallback move

### AgentFactory Integration
- `AgentFactory.make(name: "apple", ...)` returns `AppleAIAgent` on macOS 26+, throws on older
- `AgentFactory.make(name: "ollama", ...)` returns `OllamaAgent` with default model
- `AgentFactory.make(name: "ollama:mistral:7b", ...)` returns `OllamaAgent` with `"mistral:7b"`
- `AgentFactory.availableAgents` includes `"apple"` and `"ollama"`

**Reference Truth:**
- Prompt format validated against existing `LLMAgent.buildPrompt` output (regression -- extracted logic must produce identical prompts)
- Ollama API format validated against Ollama REST API documentation (https://github.com/ollama/ollama/blob/main/docs/api.md)
- Apple FoundationModels API validated against WWDC25 session "Meet the Foundation Models framework"

**Validation Trace:**
- Given a game state with 3 players, phase `.play`, turnPhase `.attack`, player owns Brazil (5 armies) adjacent to enemy Argentina (2 armies):
  - `buildUserPrompt()` output contains `"attack brazil argentina"` in legal moves list
  - Ollama response `{"move": "attack brazil argentina", "logic": "2.5:1 odds"}` parses to `.attack(from: "Brazil", to: "Argentina", mode: .once)`
  - Same response from AppleAIAgent `LLMGameMove(move: "attack brazil argentina", logic: "2.5:1 odds")` parses identically

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft entry below

**New ADR Draft:**
- **Title:** On-device AI agents use shared GamePromptBuilder
- **Category:** architecture
- **Key decision:** All LLM-based agents (cloud and on-device) share prompt construction and move parsing via `GamePromptBuilder`, ensuring consistent game understanding across providers. Individual agents are responsible only for transport (HTTP, FoundationModels API) and response extraction.

**New ADR Draft (secondary):**
- **Title:** Apple Foundation Models support is conditionally compiled
- **Category:** architecture
- **Key decision:** `AppleAIAgent` and `@Generable LLMGameMove` are wrapped in `#if canImport(FoundationModels)` to allow the project to compile on macOS < 26 and non-Apple platforms. The `"apple"` agent name in `AgentFactory` throws a descriptive error when the framework is unavailable rather than silently falling back to another agent.

---

## 10. Open Questions

1. **Apple FoundationModels entitlement.** Does a CLI binary need code signing or a specific entitlement to use `LanguageModelSession`? Early macOS 26 beta documentation is sparse. Mitigation: test with a signed Developer ID build if unsigned fails.

2. **Ollama daemon auto-detection.** Should `AgentFactory` probe `localhost:11434/api/tags` at agent creation time and throw immediately if Ollama is not running? Or should the agent fail lazily on first `requestMove`? Recommendation: fail eagerly at factory time with a descriptive message ("Ollama not running -- start with `ollama serve`").

3. **Shared prompt extraction scope.** `LLMAgent` currently contains `buildSystemPrompt`, `buildPrompt`, `parseMove`, `parseMoveString`, `findCountry`, `fallbackMove`, and `isLegalMove`. All of these should move to `GamePromptBuilder` except the HTTP transport methods. This is a refactor of ~200 lines. Should this be done as a prerequisite PR or bundled with the on-device agents?

4. **Ollama model validation.** Should the agent verify the requested model is actually pulled locally (`GET /api/tags`) before the first move? This would give an immediate error ("model llama3.2:3b not found -- run `ollama pull llama3.2:3b`") instead of a cryptic 404 mid-game.

5. **Apple model selection.** FoundationModels currently offers a single on-device model with no user-selectable variants. If Apple adds model tiers (e.g., compact vs. full), should we expose a `--apple-model` flag or keep it automatic?

6. **Structured output vs. text parsing.** Apple FoundationModels `@Generable` gives typed structured output directly. Ollama supports JSON schema via the `format` parameter. Should both agents use structured output exclusively, or maintain the text-parsing fallback path from `GamePromptBuilder`? Recommendation: use structured output as primary, text parsing as fallback for models that ignore the schema.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (FoundationModels, Ollama HTTP, PlayerAgent protocol)
- Does explanation require 50+ lines? Yes (two providers with different setup requirements)
- Does it need theory/background context? Yes (on-device AI concepts, model selection guidance)

**Article Name:** OnDeviceAIGuide.md (in .docc catalog)

**Article Outline:**
1. Overview of on-device AI in IconquerCLI
2. Apple Foundation Models setup (macOS 26+ requirements, no configuration needed)
3. Ollama setup (install, pull models, `ollama serve`)
4. CLI usage examples for both providers
5. Model selection guidance (latency vs. quality tradeoffs)
6. Troubleshooting (daemon not running, model not pulled, unsupported platform)
