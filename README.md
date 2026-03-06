# Universal WebMCP Agent Toolkit 🌐🤖

The **Universal WebMCP Agent Toolkit** is the definitive SDK for bridging traditional web applications into the era of AI Browser Agents. By integrating this toolkit, site owners can instantly upgrade their web applications to be first-class [WebMCP (Web Model Context Protocol)](https://webmcp.link/) environments.

Instead of waiting for brittle external AI agents to awkwardly screen-scrape your DOM, developers can use a unified, standards-compliant API to expose semantic intent natively. This toolkit scales gracefully from simple **Explicit Tool bridging**, to **Declarative DOM polyfills** (based on the [WebMCP declarative API draft](https://github.com/webmachinelearning/webmcp/blob/53388c87ba372de6be84d5eb30a436c07d41944b/declarative-api-explainer.md)), all the way up to a fully autonomous, embedded **In-Page Sub-Agent**.

---

## The Three Pillars of Universal WebMCP

### 1. The Explicit Tool Bridge (Bronze Level)
For developers who want tight control over exactly what an external agent can do, the Toolkit provides an elegant wrapper over the emerging `navigator.modelContext.registerTool()` API. It removes the boilerplate of handling JSON Schema stringification, standardizes error boundaries, and makes registering a WebMCP tool feel like defining a modern API route.

```typescript
import { WebMCPToolkit } from "universal-webmcp-agent";
import { z } from "zod";

const mcp = new WebMCPToolkit();

mcp.tools.register({
  name: "search_products",
  description: "Search the catalog for products.",
  // Automatically transpiled to JSON Schema for the overarching WebMCP client
  schema: z.object({ query: z.string() }), 
  execute: async ({ query }, client) => {
    return await myInternalApi.search(query);
  }
});
```

### 2. Declarative WebMCP Polyfill (Silver Level)
The standard WebMCP specification introduces a **Declarative API** extending standard HTML `<form>` elements with properties like `toolname` and `tooldescription`. 

Since browsers will take years to fully adopt this natively, the Toolkit includes a **MutationObserver-powered Polyfill**. Just write semantic HTML today, and the Toolkit seamlessly ensures declarative WebMCP forms work perfectly—automatically translating your `<input>` fields into JSON Schemas, bridging WebMCP `SubmitEvents` (`e.agentInvoked`, `e.respondWith()`), and preventing unwanted page reloads when an agent interacts.

```html
<!-- Expose the checkout form directly to WebMCP -->
<form toolname="checkout_cart" tooldescription="Submits the current shopping cart">
  <input type="text" name="shipping_address" toolparamdescription="The full delivery address" required />
  <button type="submit">Place Order</button>
</form>
```

### 3. The Universal Delegate / In-Page Agent (Gold Level)
For complex multi-step workflows, writing explicit tools is exhausting and couples the backend API too tightly to the UI flow.

Instead, enable the **Universal Delegate**, which registers a single, highly powerful WebMCP tool: `delegate_page_task`. When a top-level browser agent calls this tool, it spins up our **In-Page Agent** natively within the browser tab.

Powered by the zero-cost **Chrome Prompt API** (`window.LanguageModel`) or a **Bring-Your-Own-Key OpenAI Provider**, the In-Page Agent runs its own ReAct loop (Observe → Think → Act) entirely locally. It parses a semantically labeled DOM, plans its next clicks and inputs, and natively dispatches browser events to autonomously achieve the delegated goal—all while securely prompting the user (Human-In-The-Loop) before clicking critical endpoints!

```typescript
import { WebMCPToolkit, InPageAgent, ChromePromptProvider, OpenAIProvider } from "universal-webmcp-agent";

const mcp = new WebMCPToolkit();

// Initialize the local Prompt API session (or fallback to OpenAI REST API)
let provider;
if (window.LanguageModel) {
  provider = new ChromePromptProvider(await window.LanguageModel.create({...}));
} else {
  provider = new OpenAIProvider({ apiKey: "sk-...", model: "gpt-4o-mini" });
}

mcp.enableUniversalDelegate({
  agent: new InPageAgent({
    llmProvider: provider,
    maxSteps: 15
  }),
  // Automatically trigger Human-in-the-Loop for specific semantic elements to ensure safety
  requireConfirmationFor: ["form[toolname='checkout_cart']"] 
});
```

---

## Why use the Universal WebMCP Agent Toolkit?

- **Future-Proof**: Write code using impending W3C/WebMCP specs ([like Declarative HTML tools](https://github.com/webmachinelearning/webmcp/blob/53388c87ba372de6be84d5eb30a436c07d41944b/declarative-api-explainer.md)) today. The Polyfill covers you until browsers catch up.
- **Zero-Cost Abstractions**: By plugging into `window.LanguageModel`, the In-Page Agent utilizes local edge models. It eliminates latency and token costs for micro-UI interactions (clicks, scrolling, typing).
- **BYOK (Bring Your Own Key)**: A fully functional `fetch`-based `OpenAIProvider` is included out of the box so site developers can power the In-Page Agent dynamically using robust cloud models without heavy Node.js SDK imports.
- **Privacy First**: Sensitive DOM structures and form elements are semantically digested and reasoning is done entirely on-device by the In-Page Agent, keeping user data local.
- **Human-In-The-Loop**: Fully integrated authorization hooks pause the internal loops and securely leverage WebMCP's `client.requestUserInteraction()` to guarantee safety before destructive actions.

## Repository Structure
- `packages/core/`: The fully typed TypeScript SDK containing the ReAct loops, WebMCP bridges, and DOM polyfills.
- `playground.html`: Phase 1 testing harness for the raw In-Page ReAct loop.
- `playground2.html`: Phase 2 testing harness proving the `delegate_page_task` WebMCP integration and HITL logic.
- `playground3.html`: Phase 3 test—native Declarative DOM polyfills bypassing agents completely.
- `playground4.html`: Phase 4 test—BYOK OpenAIPovider powering the In-Page SDK loop.

## Documentation
See the [User Guide](docs/USER-GUIDE.md) for full installation instructions, API documentation, and explicit integration patterns.

To hack on the Toolkit locally:

```bash
cd packages/core
npm install
npm run build # Uses esbuild to bundle dist/browser.js and dist/index.js
```

## License
MIT
