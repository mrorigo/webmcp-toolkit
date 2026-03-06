# Universal WebMCP Agent Toolkit: User Guide

Welcome to the Universal WebMCP Agent Toolkit!

This library allows you to build "AI-Native Web Applications" by seamlessly bridging your frontend directly into overarching AI Browser Agents according to the [WebMCP Standard](https://webmcp.link/).

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Level 1: Explicit Tools (Bronze)](#level-1-explicit-tools-bronze)
3. [Level 2: Declarative Forms (Silver)](#level-2-declarative-forms-silver)
4. [Level 3: The Universal Delegate (Gold)](#level-3-the-universal-delegate-gold)

---

## Core Concepts

The **Web Model Context Protocol (WebMCP)** is a standard connecting web applications to AI agents. It does so by exposing arbitrary webpage capabilities as tools. For example, a search bar on an e-commerce site can become a `search_catalog` tool exposed globally to any compliant browser agent.

Our Toolkit implements these connections progressively, lowering the barrier to entry immediately, while setting you up for advanced autonomous UI automation.

---

## Level 1: Explicit Tools (Bronze)

The simplest way to use WebMCP is by registering imperative functions. You write the function, tell the agent what arguments you need using a Zod schema, and the agent invokes it.

### Usage
```typescript
import { WebMCPToolkit } from "universal-webmcp-agent";
import { z } from "zod";

const mcp = new WebMCPToolkit();

mcp.tools.register({
  name: "get_weather",
  description: "Resolves temperature for a city.",
  schema: z.object({ city: z.string() }),
  execute: async ({ city }, client) => {
    // 1st party logic here
    const data = await weatherApi.fetch(city);
    return { weather: data.status, degrees: data.temp };
  }
});
```

Here, the Toolkit safely transpiles your Zod schema into the exact JSON schema formats required by the browser's `navigator.modelContext`, handling validation failures and strict type bridging automatically. 

---

## Level 2: Declarative Forms (Silver)

The [WebMCP declarative API draft](https://github.com/webmachinelearning/webmcp/blob/53388c87ba372de6be84d5eb30a436c07d41944b/declarative-api-explainer.md) specifies that standard HTML `<form>` elements should be exposed as AI tools organically if they contain `toolname` or `toolparamdescription` attributes.

Since native support in browsers will take years to fully roll out, our Toolkit relies on a **Declarative Polyfill**. You can write standard-compliant HTML *today*.

### Usage

**1. Write your HTML:**
```html
<form toolname="search_flight" tooldescription="Searches the internal system for available flights">
    <input type="text" name="destination" required toolparamdescription="The city or airport code">
    <button type="submit">Search Flights</button>
</form>
```

**2. Initialize the Polyfill:**
```typescript
import { WebMCPToolkit, DeclarativePolyfill } from "universal-webmcp-agent";

const mcp = new WebMCPToolkit();
const polyfill = new DeclarativePolyfill(mcp);

polyfill.start(); // Scans DOM, creates WebMCP registrations
```

**3. Intercept Agent Executions without Page Reloads:**
```typescript
document.getElementById('my-form').addEventListener('submit', async (e) => {
    // Check if the submit was purely a synthetic agent execution
    if (e.agentInvoked) {
       e.preventDefault(); 
       
       // Handle it asynchronously and stream JSON strictly back to the overarching agent
       e.respondWith(new Promise(resolve => {
           resolve({ status: "success", data: "..." });
       }));
    }
});
```

---

## Level 3: The Universal Delegate (Gold)

If your workflow cannot easily be distilled into explicit backend API actions or single forms, you can deploy the **Universal Delegate / In-Page Agent**.

Instead of writing specific tools, you register a single incredibly powerful tool: `delegate_page_task({"task": "string"})`. A top-level browser agent calls this when it doesn't want to parse your web UI manually.

Our SDK spins up a locally-embedded AI (an **In-Page Agent**) inside your tab. It runs a ReAct loop: Observe, Think, Act. It natively dispatches `.click()` and `Event('input')` directly on complex DOM states.

### Choosing your LLM Provider
To guarantee zero latency (as the agent might need to perform dozens of clicks rapidly), it integrates out-of-the-box with Chrome's experimental local model APIs. It also provides a BYOK (Bring Your Own Key) wrapper for OpenAI when the local model is insufficient or missing.

### Usage

```typescript
import { WebMCPToolkit, InPageAgent, ChromePromptProvider, OpenAIProvider } from "universal-webmcp-agent";

const mcp = new WebMCPToolkit();

// Decide on provider based on browser capabilities
let provider;
if (window.LanguageModel) {
    provider = new ChromePromptProvider(await window.LanguageModel.create({...}));
} else {
    // Fast REST API abstraction with guaranteed structured JSON schema parsing
    provider = new OpenAIProvider({ apiKey: "YOUR_API_KEY", model: "gpt-4o-mini" });
}

// Enable the Agent
mcp.enableUniversalDelegate({
    agent: new InPageAgent({
        llmProvider: provider,
        maxSteps: 15
    }),
    
    // Safety boundaries! If the AI tries to submit the checkout element, 
    // the toolkit automatically pauses the loop and prompts the User via the WebMCP HITL specs.
    requireConfirmationFor: ["form[toolname='checkout_cart']"] 
});
```

When an external agent invokes `delegate_page_task`, your React/Next.js/HTML interface is completely driven natively and securely by your curated embedded LLM, drastically improving success rates compared to generic screen-scraping agents.
