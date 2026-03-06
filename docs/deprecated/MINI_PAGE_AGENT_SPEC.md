# Mini Page Agent: Technical Specification

## Overview
The **Mini Page Agent** is a streamlined, unopinionated, and highly idiomatic headless browser automation engine. It leverages modern LLMs (e.g., GPT-4o, Claude 3.5 Sonnet) in a persistent ReAct loop to interact with web pages. By interpreting indexed DOM elements and outputting discrete tool invocations, the agent accomplishes complex, multi-step browser tasks autonomously.

The core philosophy is minimalism, type safety, and a robust event-driven architecture, avoiding brittle text hacks in favor of standardized LLM tool-calling APIs.

## Core Architecture

The system is composed of three primary decoupling interfaces:
1. **Runner (Agent Loop)**: An async execution orchestration layer based on asynchronous generators.
2. **LLM Provider & Tools (Brain)**: Strongly typed Zod schema abstractions for generating formatted browser interactions.
3. **Page Controller (DOM Adapter)**: A generic interface (compatible with headless drivers like Playwright or Puppeteer) for serializing DOM state and executing explicit actions.

### 1. The Runner (Agent Loop)

Instead of complex recursive callbacks or highly coupled event emitters, the core runner is implemented as a clean async generator (`runTask`). This enables trivial pause/resume semantics and easy consumption by varying clients (CLI, React UI, etc).

**Execution Pipeline:**
1. **Observe**: Fetch the current `BrowserState` (DOM projection) from the `PageController`.
2. **Think**: Dispatch `History` + `BrowserState` + `Tools` to the LLM. 
3. **Act**: The LLM guarantees a valid tool call. The runner dispatches it to the `PageController`.
4. **Evaluate**: Update `History` with the tool result. If the action is `done`, yield final result and terminate. Otherwise, repeat until `maxSteps`.

### 2. State Management

#### Browser State
The page is serialized into a lightweight semantic representation, stripping out noise and styling, leaving only actionable and contextual text nodes.

```typescript
type ElementNode = {
  index: number;
  tagName: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  isScrollable?: boolean;
};

type BrowserState = {
  url: string;
  interactiveElements: ElementNode[]; 
};
```
*To the LLM, this looks like: `[5] <button aria-label="Submit">Login</button>`*

#### Memory & Reflection
A rolling context window ensures the LLM does not hallucinate history. 
- **Agent Reflection**: A required tool output containing the LLM's short-term memory, prior evaluation, and planned next goal.
- **Immutable History**: A chronological trace of executed tool calls, results, and page URL transitions.

### 3. Tool Specification (Capabilities)

All capabilities are strictly defined using `Zod` schemas compiled directly into the LLM provider's structured output settings. This bypasses the need for manual JSON healing/auto-fixing.

1. **`click_element`**: `{ index: number }` - Clicks a specified interactive node.
2. **`input_text`**: `{ index: number, text: string, submit?: boolean }` - Fills inputs.
3. **`select_option`**: `{ index: number, value: string }` - Interacts with dropdowns.
4. **`scroll`**: `{ direction: "up" | "down", magnitude: number }` - Scroll the viewport or specific scrollable containers.
5. **`wait`**: `{ seconds: number }` - Yields execution to allow network latency/animations to settle.
6. **`ask_user`**: `{ question: string }` - Pauses the entire loop, hoisting the prompt to the invoker.
7. **`done`**: `{ success: boolean, summary: string }` - Terminates the loop with closing notes.

### 4. DOM Adapter (Page Controller)

The `Page Controller` seamlessly injects an evaluation script into the target page. 

**Deterministic Element Indexing:**
Instead of relying on brittle XPath/CSS Selectors hallucinated by the LLM, the evaluation script traverses the visible DOM and assigns a contiguous `data-agent-index` to actionable elements. Only these indexed elements are shipped to the LLM.

**Robust Action Execution:**
When `click_element({ index: 5 })` is evaluated, the adapter locates `[data-agent-index="5"]` and triggers native trusted driver events (e.g., `page.click()`), cleanly surfacing interaction errors back to the LLM's context.

## Implementation Guidelines (Idiomatic TypeScript)

- **Dependency Injection**: Pass the `PageController` and `LLMProvider` implementations into the `AgentCore` via the constructor. This ensures total testability using mocks, without a real browser.
- **Native Structured Outputs**: Rely strictly on the LLM API's native `tool_choice` or Structured Output JSON capabilities. No regex text parsing.
- **Graceful Error Recovery**: Catch Playwright/driver-level errors natively and emit them as standard `Result` objects back into the prompt history so the LLM can self-correct (e.g. `Action Failed: Element [5] is hidden`).
- **Telemetry Yielding**: Standardize `yield` payloads in the async generator to allow consumers to pipe logs or render real-time UI without polluting business logic.

## Usage API Example

```typescript
import { PlaywrightAdapter, MiniAgent, OpenAIProvider } from "mini-page-agent";

// 1. Initialize Adapters
const adapter = new PlaywrightAdapter(page);
const brain = new OpenAIProvider({ model: "gpt-4o" });

// 2. Instantiate Agent
const agent = new MiniAgent({
  llm: brain,
  controller: adapter,
  maxSteps: 25
});

// 3. Drive Completion
const taskStream = agent.run("Find a top-rated mechanical keyboard under $100 and add it to my cart.");

for await (const event of taskStream) {
  if (event.type === 'thought') console.log(`Agent plans: ${event.nextGoal}`);
  if (event.type === 'action')  console.log(`Executing: ${event.tool} with args`, event.args);
  if (event.type === 'done')    console.log(`Finished: ${event.output.summary}`);
}
```

## Adopted Anti-Patterns
- **No Regex/JSON Fallbacks**: Strict LLM Structured Outputs guarantee schema compliance without fallback auto-fixers.
- **No Free-form JS Execution**: Eradicates `execute_javascript` from the toolset to prevent destructive actions or sandbox breaking.
- **No Monoliths**: Zero tight coupling between the LLM loop and the browser DOM engine.
