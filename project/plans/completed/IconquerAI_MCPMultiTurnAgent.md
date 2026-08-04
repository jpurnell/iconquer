# Design Proposal: MCP Multi-Turn AI Agent

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** New `MCPMultiTurnAgent` that uses Model Context Protocol client sessions for multi-step LLM reasoning before committing a move

---

## 1. Objective

Build an `MCPMultiTurnAgent` that implements `PlayerAgent` by running a full MCP client session per turn -- the LLM can query game state, analyze attack odds, inspect continent status, and evaluate multiple options across several tool-call round-trips before committing a single move.

**Problems solved:**
1. **Shallow reasoning.** The existing `LLMAgent` sends the entire game state in one prompt and asks for one move back. The model cannot ask clarifying questions, explore alternatives, or verify its assumptions. Multi-turn tool use lets the model decompose the decision into steps.
2. **Context window waste.** Single-shot prompts must dump the full game state (all countries, all players, all legal moves) into one message. An MCP agent can start with a summary and drill into specific regions on demand, using context more efficiently.
3. **Strategy depth.** Multi-turn reasoning enables compound strategies: "check if I can complete South America, then check the odds of taking Venezuela, then see what my fortify options would be after that attack" -- a chain impossible in a single prompt/response.
4. **Provider flexibility.** MCP is provider-agnostic. The same tool definitions work with Claude, GPT, Gemini, or local models -- any provider that supports function calling can drive the session.
5. **Tournament surface.** A multi-turn agent adds a qualitatively different competitor to the Phase 3 LLM tournament, since its reasoning style and depth differ fundamentally from single-shot agents.

**Master Plan Reference:** Phase 2 -- AI agents; Phase 3 -- LLM tournament server

---

## 2. Proposed Architecture

### Overview

The agent acts as an **MCP client** (not server). On each `requestMove` call it:

1. Opens a conversation with the configured LLM provider
2. Provides the LLM with a set of MCP tools (game queries + a commit tool)
3. Lets the LLM call tools in a loop until it calls `commit_move` or the turn budget is exhausted
4. Returns the committed `GameMove` to the match runner

This inverts the Phase 2 `IconquerMCP` pattern: instead of an external LLM calling into our server, the agent orchestrates the LLM and intercepts its tool calls locally.

### New Files

- `Sources/IconquerAI/MCPMultiTurnAgent.swift` -- `PlayerAgent` implementation; owns the conversation loop
- `Sources/IconquerAI/MCPToolRouter.swift` -- Dispatches tool calls from the LLM to game-state query functions
- `Sources/IconquerAI/MCPToolDefinitions.swift` -- Tool JSON schemas exposed to the LLM
- `Sources/IconquerAI/MCPProviderProtocol.swift` -- Abstraction over LLM providers (Claude, OpenAI, Ollama, Apple)
- `Sources/IconquerAI/Providers/ClaudeMCPProvider.swift` -- Anthropic Messages API with tool use
- `Sources/IconquerAI/Providers/OpenAIMCPProvider.swift` -- OpenAI Chat Completions with function calling
- `Sources/IconquerAI/Providers/OllamaMCPProvider.swift` -- Ollama /api/chat with tools
- `Sources/IconquerAI/MCPTurnBudget.swift` -- Turn-budget enforcement and deadline tracking
- `Tests/IconquerAITests/MCPMultiTurnAgentTests.swift` -- End-to-end tests with a mock provider
- `Tests/IconquerAITests/MCPToolRouterTests.swift` -- Unit tests for each tool handler
- `Tests/IconquerAITests/MCPTurnBudgetTests.swift` -- Budget exhaustion and deadline tests

### Modified Files

- `Sources/IconquerAI/AgentFactory.swift` -- Register `"mcp"`, `"mcp:claude"`, `"mcp:openai"`, `"mcp:ollama"` agent names
- `Sources/IconquerCLILib/GamePromptBuilder.swift` -- Extract any reusable state-summarization helpers for the MCP system prompt

### Module Placement

All new files live in the `IconquerAI` module. The provider implementations use only `Foundation` (`URLSession`) and existing `IconquerCore`/`IconquerMatch` types. No new SPM packages are required.

### Conversation Flow (per turn)

```
MatchRunner                MCPMultiTurnAgent              LLM Provider
    |                            |                            |
    |-- requestMove(state,seat) ->|                            |
    |                            |-- system prompt + tools --->|
    |                            |<-- tool_call: get_game_state|
    |                            |-- game state JSON --------->|
    |                            |<-- tool_call: analyze_odds  |
    |                            |-- odds result ------------->|
    |                            |<-- tool_call: get_continent |
    |                            |-- continent status -------->|
    |                            |<-- tool_call: commit_move   |
    |<-- GameMove --------------|                              |
```

---

## 3. API Surface

### MCPProviderProtocol

```swift
/// Abstraction over LLM providers that support tool/function calling.
///
/// Each provider translates between our internal tool-call representation
/// and the provider's native API format (Anthropic tool_use, OpenAI functions, etc.).
public protocol MCPProviderProtocol: Sendable {
    /// Send a conversation (messages + tool definitions) and get the next assistant response.
    ///
    /// The response contains either text content, one or more tool calls, or both.
    func sendConversation(
        _ messages: [MCPMessage],
        tools: [MCPToolDefinition],
        systemPrompt: String
    ) async throws -> MCPResponse
}

/// A single message in the conversation.
public struct MCPMessage: Sendable {
    public enum Role: String, Sendable { case user, assistant, tool }
    public let role: Role
    public let content: String
    public let toolCallId: String?   // non-nil for tool-result messages
    public let toolCalls: [MCPToolCall]?  // non-nil for assistant messages with tool use
}

/// A tool call requested by the LLM.
public struct MCPToolCall: Sendable {
    public let id: String
    public let name: String
    public let arguments: [String: String]  // JSON-decoded key-value pairs
}

/// The LLM's response, which may contain content and/or tool calls.
public struct MCPResponse: Sendable {
    public let content: String?
    public let toolCalls: [MCPToolCall]
    public let stopReason: StopReason

    public enum StopReason: Sendable {
        case endTurn       // model finished speaking
        case toolUse       // model wants to call tools
        case maxTokens     // output truncated
    }
}
```

### MCPMultiTurnAgent

```swift
/// AI agent that uses multi-turn MCP tool calling for deep strategic reasoning.
///
/// Unlike single-shot `LLMAgent`, this agent lets the LLM query game state
/// incrementally, analyze specific scenarios, and reason over multiple
/// exchanges before committing a move.
public struct MCPMultiTurnAgent: PlayerAgent, Sendable {
    public let identity: AgentIdentity

    /// Maximum number of LLM round-trips before forcing a fallback move.
    public let turnBudget: Int

    /// Create an MCP multi-turn agent.
    ///
    /// - Parameters:
    ///   - provider: The LLM provider to use for conversation.
    ///   - map: The game map definition (for state queries).
    ///   - name: Display name for this player.
    ///   - turnBudget: Max round-trips per move. Default: 10.
    public init(
        provider: any MCPProviderProtocol,
        map: MapDefinition,
        name: String,
        turnBudget: Int = 10
    )

    public func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

### MCPToolRouter

```swift
/// Routes LLM tool calls to game-state query functions and returns JSON results.
public struct MCPToolRouter: Sendable {
    private let map: MapDefinition

    public init(map: MapDefinition)

    /// Handle a tool call and return the result as a JSON string.
    ///
    /// - Returns: A tool result string, or nil if the tool call is `commit_move`
    ///   (which terminates the conversation loop).
    public func handle(
        call: MCPToolCall,
        state: GameSnapshot,
        seat: PlayerId
    ) -> MCPToolResult

    public enum MCPToolResult: Sendable {
        case response(String)          // JSON result to feed back to the LLM
        case commitMove(GameMove)      // Terminal: the LLM has chosen its move
        case error(String)             // Tool call failed; feed error back to LLM
    }
}
```

### MCPTurnBudget

```swift
/// Tracks round-trip count and wall-clock deadline for a single agent turn.
public struct MCPTurnBudget: Sendable {
    public let maxRoundTrips: Int
    public let deadline: ContinuousClock.Instant

    public init(maxRoundTrips: Int, deadline: ContinuousClock.Instant)

    /// Record one round-trip and check limits.
    ///
    /// - Returns: `.continue` if budget remains, `.exhausted` with a reason otherwise.
    public mutating func tick() -> BudgetStatus

    public enum BudgetStatus: Sendable {
        case `continue`
        case exhausted(reason: String)  // "round-trip limit (10)" or "deadline exceeded"
    }
}
```

### AgentFactory Registration

```swift
// New cases in AgentFactory.make(name:seed:map:)
case "mcp", "mcp:claude":
    let provider = ClaudeMCPProvider(apiKey: env("ANTHROPIC_API_KEY"))
    return MCPMultiTurnAgent(provider: provider, map: map, name: name)

case "mcp:openai":
    let provider = OpenAIMCPProvider(apiKey: env("OPENAI_API_KEY"))
    return MCPMultiTurnAgent(provider: provider, map: map, name: name)

case "mcp:ollama":
    let provider = OllamaMCPProvider(model: "llama3.2:3b")
    return MCPMultiTurnAgent(provider: provider, map: map, name: name)

case let name where name.hasPrefix("mcp:ollama:"):
    let model = extractOllamaModel(from: name)
    let provider = OllamaMCPProvider(model: model)
    return MCPMultiTurnAgent(provider: provider, map: map, name: name)
```

### CLI Usage

```
--player-config "DeepBlue:mcp"                  # Claude (default MCP provider)
--player-config "DeepBlue:mcp:claude"            # Claude (explicit)
--player-config "Strategist:mcp:openai"          # OpenAI GPT
--player-config "Local:mcp:ollama"               # Ollama default model
--player-config "Local:mcp:ollama:mistral:7b"    # Ollama specific model
```

---

## 4. MCP Tool Definitions

The following tools are exposed to the LLM during the multi-turn session. Each tool is defined as a JSON schema and handled by `MCPToolRouter`.

### get_game_state

**Description:** Get a summary of the current game state including all players, their country counts, army totals, and the current turn phase.

```json
{
  "name": "get_game_state",
  "parameters": {
    "detail_level": {
      "type": "string",
      "enum": ["summary", "full"],
      "description": "summary = player stats + phase; full = all countries with owners and armies"
    }
  }
}
```

**Returns:** JSON object with players array, current phase, turn number, and optionally all country details.

### get_legal_moves

**Description:** Get all legal moves for the current player in the current turn phase.

```json
{
  "name": "get_legal_moves",
  "parameters": {
    "filter": {
      "type": "string",
      "enum": ["all", "attack", "fortify", "place", "cards"],
      "description": "Filter to a specific move category. Default: all."
    }
  }
}
```

**Returns:** JSON array of legal move descriptions with structured fields (type, from, to, armies).

### analyze_attack_odds

**Description:** Calculate the probability of winning an attack from one country to another, given current army counts.

```json
{
  "name": "analyze_attack_odds",
  "parameters": {
    "from_country": { "type": "string", "description": "Attacking country name" },
    "to_country": { "type": "string", "description": "Defending country name" },
    "mode": {
      "type": "string",
      "enum": ["once", "til_dead"],
      "description": "Single roll or fight until one side is eliminated. Default: til_dead."
    }
  }
}
```

**Returns:** JSON with win probability, expected attacker losses, expected defender losses, and army ratio.

### get_continent_status

**Description:** Get ownership status of one or all continents, including which countries are missing for completion.

```json
{
  "name": "get_continent_status",
  "parameters": {
    "continent": {
      "type": "string",
      "description": "Continent name, or 'all' for all continents. Default: all."
    }
  }
}
```

**Returns:** JSON array of continent objects with name, bonus, total countries, owned count, missing countries list, and controlling player (if any).

### get_borders

**Description:** Get the neighbors of a specific country, showing which are friendly and which are enemy.

```json
{
  "name": "get_borders",
  "parameters": {
    "country": { "type": "string", "description": "Country name" }
  }
}
```

**Returns:** JSON with the country's armies, owner, and arrays of friendly/enemy neighbors with their armies and owners.

### evaluate_fortify_paths

**Description:** Find the best fortify routes from interior countries to the front line.

```json
{
  "name": "evaluate_fortify_paths",
  "parameters": {
    "from_country": {
      "type": "string",
      "description": "Source country, or 'auto' to find the best interior country. Default: auto."
    }
  }
}
```

**Returns:** JSON array of fortify options ranked by strategic value (border exposure of destination, armies available to move).

### commit_move

**Description:** Commit the final move decision. This ends the reasoning session. The move must be a legal move in the current game state.

```json
{
  "name": "commit_move",
  "parameters": {
    "move_type": {
      "type": "string",
      "enum": ["pick", "place", "attack", "fortify", "end_attack", "end_fortify", "turn_in_cards"],
      "description": "The type of move"
    },
    "from_country": { "type": "string", "description": "Source country (for attack/fortify)" },
    "to_country": { "type": "string", "description": "Target country (for pick/place/attack/fortify)" },
    "armies": { "type": "integer", "description": "Number of armies (for place/fortify)" },
    "attack_mode": {
      "type": "string",
      "enum": ["once", "til_dead"],
      "description": "Attack mode (for attack moves). Default: til_dead."
    },
    "reasoning": { "type": "string", "description": "Brief explanation of strategic reasoning" }
  }
}
```

**Returns:** Confirmation JSON or error if the move is illegal (allowing the LLM to correct and retry within the turn budget).

---

## 5. Constraints & Compliance

**Concurrency:**
- `MCPMultiTurnAgent` is `Sendable` (all stored properties are immutable value types or `Sendable` protocol existentials).
- `MCPToolRouter` is `Sendable` (immutable struct).
- `MCPTurnBudget` is a value type; mutated only within the `requestMove` scope.
- Provider implementations are `@unchecked Sendable` with justification: URLSession is thread-safe, all stored properties are immutable after init.

**Safety:**
- No force unwraps in runtime code.
- Guard clauses validate all tool-call arguments before processing.
- Division safety: `analyze_attack_odds` guards against zero-army defenders.
- Deadline enforcement: `MCPTurnBudget.tick()` checks `ContinuousClock.now` against deadline on every round-trip. If the budget or deadline is exceeded, the agent:
  1. Sends a final "You must commit a move now" message to the LLM
  2. If the LLM still does not call `commit_move`, falls back to `GamePromptBuilder.fallbackMove`
- Illegal move recovery: if `commit_move` specifies an illegal move, the router returns an error and the LLM can retry (consuming one budget tick).

**No Infinite Loops:**
- The `turnBudget` (default 10) is a hard cap on round-trips. After exhaustion, the agent does not re-enter the conversation loop.
- The deadline from `MatchRunner` provides a wall-clock backstop independent of the round-trip budget.
- Both limits are enforced in `MCPTurnBudget.tick()`, which is called before every provider request.

**No New External Dependencies:**
- All provider implementations use `Foundation` (`URLSession`).
- Tool definitions are plain JSON constructed with `JSONSerialization` or `Codable`.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not directly applicable -- inference is delegated to external LLM providers. However, the `MCPProviderProtocol` abstraction serves an analogous role:

- **Provider swapping.** Switch between Claude, GPT, Ollama, or Apple Foundation Models by changing one factory parameter. The conversation loop and tool definitions are provider-agnostic.
- **Cost control.** The turn budget caps total tokens per move. Providers can also enforce `max_tokens` per response. The agent logs token usage per turn for tournament cost analysis.
- **Latency management.** Multi-turn sessions are inherently slower than single-shot. The deadline parameter ensures the agent cannot hold up the game. Expected latency: 3-15 seconds per move (2-5 round-trips at 1-3 seconds each for cloud providers).

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore/MapDefinition` -- map data for tool handlers
- `IconquerMatch/PlayerAgent` -- protocol conformance
- `IconquerMatch/GameSnapshot`, `GameMove`, `PlayerId` -- game state types
- `IconquerAI/GamePromptBuilder` -- system prompt construction and fallback move generation
- `IconquerAI/AgentFactory` -- registration of new agent names

**External Dependencies:** None

**System Framework Dependencies:**
- `Foundation` (URLSession, JSONSerialization) -- already linked

**Runtime Dependencies:**
- **Claude provider:** `ANTHROPIC_API_KEY` environment variable, network access to `api.anthropic.com`
- **OpenAI provider:** `OPENAI_API_KEY` environment variable, network access to `api.openai.com`
- **Ollama provider:** `ollama serve` running on `localhost:11434`, a tool-capable model pulled locally
- Internet access for cloud providers; Ollama provider works offline

---

## 8. Test Strategy

**Test Categories:**

### MCPToolRouter (pure, no network)
- **get_game_state summary:** Given 3-player game in attack phase, returns correct player counts and phase
- **get_game_state full:** Returns all countries with owners and armies
- **get_legal_moves:** Given player owns Brazil (5 armies) adjacent to enemy Argentina (2 armies), returns attack option
- **get_legal_moves filter:** `filter: "attack"` excludes fortify and place moves
- **analyze_attack_odds:** 5v2 attack returns win probability > 0.8 for til_dead mode
- **analyze_attack_odds zero defense:** 5v0 guard clause returns error, not division by zero
- **get_continent_status:** Player owns 5/6 South America countries; returns missing country name and bonus value
- **get_borders:** Country with 3 friendly and 2 enemy neighbors returns correct classification
- **evaluate_fortify_paths:** Interior country with 10 armies suggests fortify to highest-exposure border
- **commit_move legal:** `pick Alaska` when Alaska is unclaimed returns the corresponding `GameMove`
- **commit_move illegal:** Attack from a country the player does not own returns error string

### MCPMultiTurnAgent (mock provider)
- **Happy path:** Mock provider calls get_game_state, then commit_move. Agent returns the committed move.
- **Multi-step reasoning:** Mock provider calls get_game_state -> analyze_attack_odds -> commit_move (3 round-trips). Agent returns correct move.
- **Budget exhaustion:** Mock provider never calls commit_move. After 10 round-trips, agent returns fallback move.
- **Deadline exceeded:** Mock provider introduces 2-second delays. With a tight deadline, agent returns fallback move before timeout.
- **Illegal move retry:** Mock provider calls commit_move with illegal move, receives error, then calls commit_move with legal move. Agent returns the corrected move.
- **Empty tool calls:** Provider returns text with no tool calls (stop reason = endTurn). Agent sends "please commit a move" nudge and continues.

### MCPTurnBudget
- **Fresh budget:** 10 ticks of `.continue`, 11th returns `.exhausted`
- **Deadline check:** Budget with deadline in the past returns `.exhausted` on first tick
- **Combined:** Budget exhausts before deadline -- reports round-trip limit, not deadline

### Provider Integration (live, optional, not CI)
- **Claude round-trip:** Send a real conversation with tools to Claude API, verify tool_use response parses
- **Ollama round-trip:** Send a real conversation with tools to local Ollama, verify tool call extraction
- **Token counting:** Verify provider logs input/output token counts for cost tracking

### AgentFactory Integration
- `AgentFactory.make(name: "mcp", ...)` returns `MCPMultiTurnAgent` with Claude provider
- `AgentFactory.make(name: "mcp:openai", ...)` returns `MCPMultiTurnAgent` with OpenAI provider
- `AgentFactory.make(name: "mcp:ollama", ...)` returns `MCPMultiTurnAgent` with Ollama provider
- Missing API key throws descriptive error (not a crash)

**Reference Truth:**
- Tool call/response format validated against Anthropic Messages API documentation (tool_use content blocks)
- OpenAI format validated against Chat Completions API documentation (function calling)
- Ollama format validated against Ollama REST API documentation (tools parameter)
- Attack odds validated against known Risk probability tables

**Validation Trace:**
- Given a 3-player game, attack phase, player owns Brazil (5 armies) adjacent to enemy Argentina (2 armies):
  1. LLM calls `get_game_state(detail_level: "summary")` -- receives player stats and "attack" phase
  2. LLM calls `get_legal_moves(filter: "attack")` -- receives list including "attack Brazil Argentina"
  3. LLM calls `analyze_attack_odds(from: "Brazil", to: "Argentina", mode: "til_dead")` -- receives ~85% win probability
  4. LLM calls `commit_move(move_type: "attack", from_country: "Brazil", to_country: "Argentina", attack_mode: "til_dead", reasoning: "85% win odds to advance toward South America completion")`
  5. Agent returns `.attack(from: "Brazil", to: "Argentina", mode: .tilDead)`

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No -- complements the existing on-device AI ADR
- [x] New ADR required? Yes -- draft entries below

**New ADR Draft (primary):**
- **Title:** MCP multi-turn agent uses a client-side conversation loop, not an MCP server
- **Category:** architecture
- **Key decision:** The Phase 2 `IconquerMCP` exposed game state as an MCP server for external LLMs to query. The multi-turn agent inverts this: it acts as an MCP-style *client*, managing the conversation loop internally and intercepting tool calls locally. This avoids requiring an external MCP orchestrator, keeps the agent self-contained behind the `PlayerAgent` protocol, and allows deadline enforcement from within the process.

**New ADR Draft (secondary):**
- **Title:** LLM provider abstraction uses a protocol, not MCP transport
- **Category:** architecture
- **Key decision:** Rather than requiring all providers to implement the full MCP transport protocol (stdio/SSE), the agent uses a simpler `MCPProviderProtocol` that maps tool-call semantics onto each provider's native API (Anthropic tool_use, OpenAI functions, Ollama tools). This avoids an MCP SDK dependency and works with providers that do not natively support MCP transport. The "MCP" in the agent name refers to the multi-turn tool-calling pattern, not the transport layer.

**New ADR Draft (tertiary):**
- **Title:** Turn budget is a hard cap, not a soft hint
- **Category:** reliability
- **Key decision:** The agent enforces a maximum round-trip count (default 10) and a wall-clock deadline. Both are hard limits: exceeding either immediately terminates the conversation and falls back to `GamePromptBuilder.fallbackMove`. This prevents runaway token consumption and ensures the agent cannot stall a multiplayer game. The budget is not communicated to the LLM as a constraint (which it might ignore) -- it is enforced mechanically in the conversation loop.

---

## 10. Open Questions

1. **Conversation history across turns.** Should the agent retain conversation history from previous turns within the same game? Retaining history would let the model reference earlier reasoning ("I decided to pursue South America three turns ago"), but increases token consumption linearly. Recommendation: start stateless (fresh conversation per turn), add optional history as a Phase 3 enhancement with a configurable window (e.g., last 3 turns).

2. **Parallel tool calls.** Claude and GPT can return multiple tool calls in a single response. Should the router handle them in parallel or sequentially? Parallel is faster but complicates error handling (one tool fails, others succeed). Recommendation: handle sequentially in v1 -- the latency savings are minimal for 2-3 tool calls, and sequential handling is simpler to reason about.

3. **Structured output for commit_move.** Should `commit_move` use the provider's structured output feature (Anthropic tool_use already structures it) or accept free-text that gets parsed? Recommendation: use the tool-call parameters directly -- they are already structured by the function-calling protocol. No text parsing needed for the commit step.

4. **Token budget vs. round-trip budget.** Should the agent also enforce a per-turn token budget (e.g., 4000 input + 2000 output tokens)? This would cap cost more precisely than round-trip count alone. Recommendation: add token tracking in v1 (logged, not enforced), enforce token budgets in v2 after gathering real usage data from tournaments.

5. **Provider capability detection.** Not all models handle tool calling well. Small local models (e.g., `gemma2:2b`) may hallucinate tool calls or fail to use them at all. Should the agent validate provider capability at init time, or degrade gracefully at runtime? Recommendation: degrade gracefully -- if the model returns text without tool calls, the agent sends a reminder prompt. After 3 consecutive text-only responses, fall back to `GamePromptBuilder.fallbackMove`.

6. **System prompt tuning per provider.** Different models respond better to different prompt styles. Should the system prompt be parameterized per provider? Recommendation: start with a single prompt, then split in v2 based on tournament data showing provider-specific weaknesses.

7. **Observability.** Multi-turn sessions produce rich reasoning traces. Should the agent emit structured logs (tool calls, responses, reasoning) for post-game analysis? Recommendation: yes, emit a `[MCPAgent]` log line per tool call with tool name, latency, and truncated result. Full traces optionally written to a `.jsonl` file when `--verbose` is set.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (MCPProviderProtocol, MCPToolRouter, PlayerAgent, multiple LLM provider APIs)
- Does explanation require 50+ lines? Yes (multi-turn architecture, tool definitions, provider setup, budget mechanics)
- Does it need theory/background context? Yes (MCP concepts, multi-turn tool-calling patterns, single-shot vs. multi-turn tradeoffs)

**Article Name:** MCPMultiTurnAgentGuide.md (in .docc catalog)

**Article Outline:**
1. Overview: why multi-turn reasoning produces stronger AI play than single-shot prompts
2. Architecture diagram: conversation loop, tool router, provider abstraction, budget enforcement
3. Tool reference: what each MCP tool does, when the LLM typically calls it, example inputs/outputs
4. Provider setup: API keys for Claude/OpenAI, Ollama daemon for local, model recommendations
5. CLI usage: `--player-config` examples for each provider
6. Turn budget tuning: how to balance reasoning depth vs. latency vs. cost
7. Observability: reading agent logs, understanding reasoning traces
8. Comparison with other agents: single-shot LLMAgent, scripted StrategicAgent, GreedyAgent
9. Troubleshooting: provider timeouts, budget exhaustion, illegal move loops, model compatibility
