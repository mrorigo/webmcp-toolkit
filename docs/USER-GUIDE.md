# webmcp-toolkit — Universal WebMCP Agent Toolkit User Guide

This library lets you build AI-Native Web Applications by bridging your frontend into overarching AI Browser Agents via the [WebMCP Standard](https://webmcp.link/).

## Table of Contents
1. [Installation](#installation)
2. [Level 1: Explicit Tools (Bronze)](#level-1-explicit-tools-bronze)
3. [Level 2: Declarative Forms (Silver)](#level-2-declarative-forms-silver)
4. [Level 3: The Universal Delegate (Gold)](#level-3-the-universal-delegate-gold)

---

## Installation

Build the SDK locally:

```bash
cd packages/core
npm install
npm run build
```

This produces two bundles — pick the one that fits your needs:

| Bundle                | Size      | When to use                                                         |
| --------------------- | --------- | ------------------------------------------------------------------- |
| `dist/browser.js`     | **15 kb** | Full ReAct agent + LLM providers + Declarative Polyfill             |
| `dist/declarative.js` | **7 kb**  | Declarative Polyfill + `WebMCPToolkit` only (no LLM, no agent loop) |

Load the bundle directly in your HTML:
```html
<script src="dist/browser.js"></script>
<!-- exposes window.UniversalWebMCPAgent -->

<!-- or, for declarative-only pages: -->
<script src="dist/declarative.js"></script>
<!-- exposes window.DeclarativeWebMCP -->
```

The SDK has **zero runtime dependencies**.

---

## Core Concepts

The **Web Model Context Protocol (WebMCP)** connects web applications to AI agents by exposing page capabilities as callable tools. For example, a search bar can become a `search_catalog` tool, callable by any compliant browser agent.

The Toolkit implements three progressive levels of integration.

---

## Level 1: Explicit Tools (Bronze)

Register imperative functions as named tools. You define a schema object with a `parse(data)` method — any Zod schema works here since they implement this interface natively.

```typescript
const mcp = new UniversalWebMCPAgent.WebMCPToolkit();

mcp.tools.register({
  name: "get_weather",
  description: "Resolves temperature for a city.",
  // Any object with parse(data) satisfies the schema interface.
  // Tip: a Zod schema (z.object({...})) works here directly.
  schema: {
    parse: (data) => ({ city: String(data.city) }),
    _shape: { city: { isOptional: () => false } }
  },
  execute: async ({ city }, client) => {
    const data = await weatherApi.fetch(city);
    return { weather: data.status, degrees: data.temp };
  }
});
```

The Toolkit converts the `_shape` definition into the JSON Schema format required by `navigator.modelContext.registerTool()`. If using a Zod schema, the JSON Schema conversion uses Zod's `_shape` property automatically.

---

## Level 2: Declarative Forms (Silver)

The [WebMCP declarative API draft](https://github.com/webmachinelearning/webmcp/blob/53388c87ba372de6be84d5eb30a436c07d41944b/declarative-api-explainer.md) specifies that HTML `<form>` elements with `toolname` attributes should be exposed as AI tools natively. Since native browser support will take years, use the included **Declarative Polyfill** today.

> Use `dist/declarative.js` (7 kb) instead of the full bundle for pages that only need this feature.

**1. Write your HTML:**
```html
<form toolname="search_flight" tooldescription="Searches for available flights">
    <input type="text" name="destination" required toolparamdescription="The city or airport code">
    <button type="submit">Search Flights</button>
</form>
```

**2. Initialize the Polyfill:**
```typescript
const { WebMCPToolkit, DeclarativePolyfill } = DeclarativeWebMCP;

const mcp = new WebMCPToolkit();
const polyfill = new DeclarativePolyfill(mcp);
polyfill.start(); // Scans the DOM and registers all toolname forms
```

**3. Intercept agent-triggered submits:**
```typescript
document.getElementById('my-form').addEventListener('submit', async (e) => {
    if (e.agentInvoked) {
       e.preventDefault();
       e.respondWith(new Promise(resolve => {
           resolve({ status: "success", data: "..." });
       }));
    }
});
```

---

## Level 3: The Universal Delegate (Gold) `[EXPERIMENTAL]`

> **⚠️ Experimental.** The In-Page Agent's ReAct loop is under active development. DOM coverage, token budgeting, and multi-step reliability are not yet production-hardened. Treat this as a powerful prototype, not a production API.

For complex multi-step workflows, enable the **Universal Delegate**. This registers a single powerful tool: `delegate_page_task({ task: string })`. When a top-level browser agent invokes it, the embedded **In-Page Agent** takes over and runs a full ReAct loop inside the tab.

### Choosing an LLM Provider

| Provider               | When to use                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `ChromePromptProvider` | Chrome with `globalThis.LanguageModel` available (local, zero-cost) |
| `OpenAIProvider`       | Fallback via REST API with your own API key (BYOK)                  |

> [!CAUTION]
> **Security warning: your API key will be visible in the browser.**
>
> `OpenAIProvider` makes requests directly from the user's browser using the key you pass as `apiKey`. Because all frontend JavaScript is readable by anyone using the page, **this key is effectively public** to any user who opens DevTools.
>
> Implications:
> - Any user can extract the key and use it to make arbitrary API calls at your expense.
> - **Never use a production or billing-critical key here.**
>
> Safer alternatives:
> - **Prefer `ChromePromptProvider`** — it uses the on-device model and requires no key at all.
> - **Proxy via your own backend** — expose a `/api/llm` endpoint that holds the key server-side, and point the agent at that instead.
> - **Use a restricted, rate-limited key** with a per-key spend cap set in your OpenAI dashboard, scoped only to the models you need.

### Usage

```typescript
const { WebMCPToolkit, InPageAgent, ChromePromptProvider, OpenAIProvider } = UniversalWebMCPAgent;

const mcp = new WebMCPToolkit();

let provider;
if (globalThis.LanguageModel) {
    provider = new ChromePromptProvider(await globalThis.LanguageModel.create({}));
} else {
    provider = new OpenAIProvider({ apiKey: "YOUR_OPENAI_KEY", model: "gpt-4o-mini" });
}

mcp.enableUniversalDelegate({
    agent: new InPageAgent({
        llmProvider: provider,
        maxSteps: 15
    }),
    // Pause the agent loop and prompt the user before submitting critical elements
    requireConfirmationFor: ["form[toolname='checkout_cart']"]
});
```

### Chat Integration

For a beautiful, production-ready chat interface, the `InPageAgent` integrates perfectly with [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat). See the [Deep Chat Guide](DEEP-CHAT-GUIDE.md) for detailed instructions.

When an external agent calls `delegate_page_task`, your page is driven natively and securely by the embedded LLM — with Human-In-The-Loop authorization for any action matching a `requireConfirmationFor` selector.
