# AGENTS.md - Non-Obvious Patterns

This document captures the non-obvious architectural patterns used in this repository to enable efficient AI-driven web automation.

## 1. The Semantic Pruning Tier (`compressLevel`)
The `SemanticIndexer` does not return a raw DOM tree. It generates a syntactically dense "Actionable Landscape" string. 

**Non-Obvious:** We use a 3-tier compression strategy (0-2) to manage context window limits without losing critical semantic data.
- **Level 0 (Full)**: Includes descriptions (`tooldescription`) and parameter hints.
- **Level 1 (Pruned)**: Drops optional descriptions but keeps `required` markers.
- **Level 2 (Minimal)**: Only returns tags, IDs, and current values.

This allows the `InPageAgent` to "downshift" its context usage if the DOM is too large, rather than failing or truncating the string blindly.

## 2. ReAct vs. Declarative Dual-Mode
Most agentic systems assume a "Think-Act" loop (ReAct). This repo supports a "Zero-LLM" declarative path.

**Non-Obvious:** The `DeclarativePolyfill` scans for `<form toolname="...">`. 
- It bypasses the LLM entirely for simple, known tasks.
- It maps HTML5 attributes (like `pattern`, `min/max`, `required`) directly to JSON Schema in the browser's `modelContext`.
- **The Pattern:** Use ReAct for *discovery* and *complex reasoning*, but use Declarative mode for *standardized workflows* to save on latency and cost.

## 3. The "Universal Delegate" Macro-Tool
In `webmcp-toolkit.ts`, the `enableUniversalDelegate()` method is not just another tool.

**Non-Obvious:** It acts as a **Context Handoff**. 
- An external, high-level agent (like a system-wide assistant) can "delegate" a task to the **In-Page Agent** by calling this tool.
- The **In-Page Agent** then runs its own internal ReAct loop within the page context.
- This creates a tiered architecture where a "Master Agent" doesn't need to see the messy DOM; it just sees the "Universal Delegate" tool.

## 4. Guardrails as a Compiler Hint
The hyper-strict ESLint/TypeScript configuration (see [AI_TYPESCRIPT_SETUP_BASELINE.md](docs/AI_TYPESCRIPT_SETUP_BASELINE.md)) is not for human readability.

**Non-Obvious:** Strictness is used to **bias the LLM's completion engine**.
- By forbidding `null` (via `unicorn/no-null`), we remove a binary choice for the agent (`null` vs `undefined`), reducing the variance in its proposed code changes.
- By enforcing `globalThis`, we prevent the agent from hallucinating environment-specific globals that might fail in a Cross-Origin context.

## 5. Mutation-Driven Discovery
The agent registration isn't a one-time setup.

**Non-Obvious:** Both the `DeclarativePolyfill` and `WebMCPToolkit` rely on `MutationObserver`. 
- This ensures that if a Single Page App (SPA) dynamically renders a new "Tool" (e.g., a checkout form appearing in a modal), the agent "sees" the new capability instantly without a page refresh or manual re-index.
