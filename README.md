# Universal WebMCP Agent Toolkit 🌐🤖

The **Universal WebMCP Agent Toolkit** is an SDK for bridging traditional web applications into the era of AI Browser Agents. By integrating this toolkit, site owners can instantly make their web applications first-class [WebMCP (Web Model Context Protocol)](https://webmcp.link/) environments.

Instead of waiting for brittle external AI agents to scrape your DOM, you can expose semantic intent natively using a standards-compliant API. The toolkit scales from simple **Explicit Tool bridging**, to **Declarative DOM polyfills** (based on the [WebMCP declarative API draft](https://github.com/webmachinelearning/webmcp/blob/53388c87ba372de6be84d5eb30a436c07d41944b/declarative-api-explainer.md)), all the way up to a fully autonomous, embedded **In-Page Sub-Agent**.

---

## The Three Pillars of Universal WebMCP

### 1. The Explicit Tool Bridge (Bronze Level)
For developers who want tight control over what an external agent can do, the Toolkit wraps the emerging `navigator.modelContext.registerTool()` API. Drop in any object with a `parse` method as the schema — including any Zod schema, since they naturally satisfy the interface.

```typescript
import { WebMCPToolkit } from "./dist/browser.js";

const mcp = new UniversalWebMCPAgent.WebMCPToolkit();

mcp.tools.register({
  name: "search_products",
  description: "Search the catalog for products.",
  // Any object with a parse(data) method works as the schema.
  // You can use your own Zod schema here too.
  schema: {
    parse: (data) => ({ query: String(data.query) }),
    _shape: { query: { isOptional: () => false } }
  },
  execute: async ({ query }, client) => {
    return await myInternalApi.search(query);
  }
});
```

### 2. Declarative WebMCP Polyfill (Silver Level)
The WebMCP specification lets standard HTML `<form>` elements be exposed as AI tools if they carry `toolname` and `tooldescription` attributes. Since native browser support will take years, the Toolkit ships a **MutationObserver-powered Polyfill** that works today.

```html
<!-- Expose the checkout form directly to WebMCP -->
<form toolname="checkout_cart" tooldescription="Submits the current shopping cart">
  <input type="text" name="shipping_address" toolparamdescription="The full delivery address" required />
  <button type="submit">Place Order</button>
</form>
```

> Load `dist/declarative.js` (7 kb) instead of the full `dist/browser.js` (15 kb) for pages that only use the Declarative Polyfill path.

### 3. The Universal Delegate / In-Page Agent (Gold Level)
For complex multi-step workflows, enable the **Universal Delegate**, which registers a single powerful WebMCP tool: `delegate_page_task`. A top-level browser agent calls this tool, and the embedded **In-Page Agent** takes over, running a full ReAct loop (Observe → Think → Act) directly inside the tab.

Powered by the **Chrome Prompt API** (`globalThis.LanguageModel`) or a **Bring-Your-Own-Key OpenAI Provider**, the agent parses a semantically labeled DOM, plans its next actions, and dispatches real browser events — while prompting the user (Human-In-The-Loop) before critical actions.

```typescript
import { WebMCPToolkit, InPageAgent, ChromePromptProvider, OpenAIProvider } from "./dist/browser.js";

const mcp = new WebMCPToolkit();

let provider;
if (globalThis.LanguageModel) {
  provider = new ChromePromptProvider(await globalThis.LanguageModel.create({}));
} else {
  provider = new OpenAIProvider({ apiKey: "sk-...", model: "gpt-4o-mini" });
}

mcp.enableUniversalDelegate({
  agent: new InPageAgent({ llmProvider: provider, maxSteps: 15 }),
  requireConfirmationFor: ["form[toolname='checkout_cart']"]
});
```

---

## Why use the Universal WebMCP Agent Toolkit?

- **Future-Proof**: Write code using impending W3C/WebMCP specs today. The Polyfill covers you until browsers catch up.
- **Zero Dependencies**: The entire SDK is self-contained with no runtime dependencies. The full agent bundle is **15 kb minified**.
- **Split Bundles**: Use `dist/declarative.js` (**7 kb**) for form-only pages, or `dist/browser.js` (**15 kb**) for the full ReAct agent.
- **Zero-Cost Inference**: By plugging into `globalThis.LanguageModel`, the In-Page Agent uses local edge models — eliminating latency and token costs for micro-UI interactions.
- **BYOK**: A `fetch`-based `OpenAIProvider` is included so you can power the In-Page Agent with cloud models without any heavy SDK imports.
- **Privacy First**: DOM reasoning happens entirely on-device. Sensitive form structure never leaves the browser.
- **Human-In-The-Loop**: Authorization hooks pause the agent loop and call `client.requestUserInteraction()` before destructive actions.

## Repository Structure
- `packages/core/` — The fully typed TypeScript SDK. No runtime dependencies.
- `dist/browser.js` — Full bundle: ReAct agent, LLM providers, DOM polyfill. **15 kb minified.**
- `dist/declarative.js` — Slim bundle: Declarative Polyfill + WebMCPToolkit only. **7 kb minified.**
- `examples/delegate-agent.html` — End-to-end demo of `delegate_page_task` with Chrome Prompt API.
- `examples/declarative-forms.html` — End-to-end demo of the Declarative Polyfill.
- `examples/byok-openai.html` — End-to-end demo of OpenAI BYOK powering the In-Page Agent.

## Building locally

```bash
cd packages/core
npm install
npm run build          # Produces dist/browser.js (full) and dist/declarative.js (slim)
npm run build:full     # Full bundle only
npm run build:declarative  # Slim bundle only
npm run lint           # oxlint (perf) + eslint (idiomatic TS)
```

## License
MIT
