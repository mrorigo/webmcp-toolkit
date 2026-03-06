# Implementation Plan: Universal WebMCP Agent

This document outlines the phased implementation strategy for building the `universal-webmcp-agent` toolkit. We begin with a minimal Proof of Concept (PoC) to validate the locally embedded agent loop, and progressively expand into full WebMCP standard compliance.

## Phase 1: Local Sub-Agent Core (The PoC)
**Goal:** Prove that an in-page ReAct loop can autonomously drive a form using the zero-cost Chrome Prompt API (`window.LanguageModel`).
- **1.1 Mock Webpage:** Build a static `playground.html` featuring a mock e-commerce checkout form using declarative attributes (`<form toolname="...">`).
- **1.2 Semantic DOM Indexer:** Write a lightweight script to traverse the DOM, find actionable elements (forms, inputs, buttons), assign them ephemeral identifiers (`data-agent-id`), and serialize this state into a clean text prompt (the "Observation" phase).
- **1.3 Chrome Prompt API Integration:** Use `window.LanguageModel` (as sketched in `experiments/llm-tool-call.js`) to feed the DOM semantic text and a list of internal subagent tools (`input_text`, `click_element`, `wait`, `done`).
- **1.4 Execution Loop Engine:** Implement the async generator that prompts the LLM, parses the tool JSON output, native-dispatches events (like `.click()` or setting input `.value` and firing `InputEvent`), and loops until the LLM returns `done`.

## Phase 2: The Universal Delegate (WebMCP Bridge)
**Goal:** Expose the proven PoC engine to the browser's top-level WebMCP interface.
- **2.1 Toolkit Scaffolding:** Set up the standard TypeScript project structure under `packages/core`.
- **2.2 WebMCP Registration:** Write the initialization logic to register `delegate_page_task` via `navigator.modelContext.registerTool()`.
- **2.3 Human-in-the-Loop (HITL) Hooks:** Map the subagent's internal `ask_user` loop trigger directly to WebMCP's `client.requestUserInteraction()`.
- **2.4 Testing:** Validate through a mocked WebMCP client that the exact flow from Phase 1 can be triggered by calling the `delegate_page_task` tool.

## Phase 3: Declarative Polyfills & Explicit Tool Bridge
**Goal:** Fulfill the "Bronze" and "Silver" pillars of the Universal WebMCP Agent Toolkit specification.
- **3.1 Declarative Form Polyfill:** Write a mutation observer that scans for `<form toolname="...">`. If the browser lacks native declarative WebMCP support, automatically translate these forms into imperative `registerTool` calls, complete with auto-generated JSON schemas from `<input>` definitions.
- **3.2 `SubmitEvent` Extensions:** Polyfill `e.agentInvoked` and `e.respondWith()` so website owners can comfortably block native page navigations on agent invocations and return JSON dynamically.
- **3.3 Explicit API Wrappers:** Finalize the developer surface `mcp.tools.register({...})` powered by Zod to make manual tool registration heavily typed and incredibly simple.

## Phase 4: Production Harden & Publish
**Goal:** Ensure the toolkit gracefully handles complex, nasty, real-world Single Page Applications.
- **4.1 Shadow DOM Support:** Enhance the semantic indexer to pierce Shadow DOM limits recursively.
- **4.2 Edge LLM Fallbacks:** Implement a clean adapter pattern so if `window.LanguageModel` is not available, the developer can provide a lightweight cloud or edge model abstraction.
- **4.3 Documentation & Demo App:** Create a full Next.js/React demo showing traditional implementations vs Toolkit implementations. Publish to npm as `universal-webmcp-agent`.
