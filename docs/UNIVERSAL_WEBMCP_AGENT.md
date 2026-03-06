# Universal WebMCP Agent Toolkit: Specification

## Vision
The Universal WebMCP Agent Toolkit is the standard SDK for bridging regular web applications into the era of AI Browser Agents. By integrating this toolkit, site owners instantly upgrade their web applications to be first-class WebMCP environments. 

Instead of waiting for external agents to awkwardly screen-scrape DOMs or trying to manually implement dozens of complex WebMCP JSON schemas for every distinct action, developers can use a unified API. This toolkit scales gracefully from simple explicit tool bridging, to semantic DOM labeling, all the way to a fully autonomous, embedded **In-Page Agent**.

## Core Architecture

The toolkit consists of three progressive pillars, allowing developers to start simple and scale up to autonomous agents as their comfort and needs grow:

1. **The Tool Bridge (Explicit WebMCP Tools)**
2. **Semantic DOM Helpers (Agent-Friendly Markup)**
3. **The Universal Delegate (Embedded Page Agent)**

---

### 1. The Tool Bridge (Explicit Tools)

For developers who want tight control over exactly what an external agent can do, the Toolkit provides an elegant wrapper over raw `navigator.modelContext.registerTool()`. It removes the boilerplate of handling JSON Schema stringification, security checks, and standardizes error boundaries, making it feel like defining a modern API route.

It also seamlessly bridges complex WebMCP concepts like `client.requestUserInteraction` into simple, readable async flows.

**API Example:**
```typescript
import { WebMCPToolkit } from "universal-webmcp-agent";
import { z } from "zod";

const mcp = new WebMCPToolkit();

// Register a simple, explicit tool for the top-level agent
mcp.tools.register({
  name: "search_products",
  description: "Search the catalog for products and return their IDs and prices.",
  // Automatically transpiled to JSON Schema for WebMCP
  schema: z.object({ query: z.string() }), 
  readOnly: true,
  execute: async ({ query }, client) => {
    // 1st party app logic
    return await myInternalApi.search(query);
  }
});

// A sensitive operation wrapped with Human-In-The-Loop
mcp.tools.register({
  name: "delete_account",
  description: "Deletes the user account permanently.",
  schema: z.object({}),
  readOnly: false,
  execute: async (_, client) => {
    // Uses the toolkit's helper to seamlessly trigger WebMCP user interaction
    const confirmed = await mcp.askUserToConfirm(client, "Are you sure you want the agent to delete your account?");
    if (!confirmed) return { status: "cancelled" };
    
    return await myInternalApi.deleteAccount();
  }
});
```

---

### 2. Declarative WebMCP Polyfill & Enhancements (Agent-Friendly Markup)

The emerging WebMCP specification introduces a **Declarative API** extending standard HTML `<form>` elements with properties like `toolname` and `tooldescription`. This allows sites to directly expose semantic forms to agents without writing imperative JavaScript tools.

The Toolkit acts as a **Polyfill and Enhancer** for this standard. It seamlessly ensures declarative WebMCP tools work in all browsers, while giving the embedded In-Page Agent deep semantic context about the application's forms and capabilities. 

**HTML Markup Example (Embracing the WebMCP Standard):**
```html
<!-- Expose the checkout form directly to WebMCP with auto-submit disabled for safety -->
<form 
  toolname="checkout_cart" 
  tooldescription="Submits the current shopping cart for purchase"
>
  <!-- Native semantic inputs automatically compile to JSON Schemas for the agent -->
  <input 
    type="text"
    name="shipping_address" 
    toolparamdescription="The full delivery address" 
    required 
  />
  
  <button type="submit">Place Order</button>
</form>
```

**JavaScript Integration:**
Because the Toolkit bridges declarative WebMCP with JavaScript, it provides simple hooks into the new `SubmitEvent` API, letting you intercept agent-invoked actions and return structured JSON to the agent without reloading the page.

```typescript
// Intercepting a declarative WebMCP agent submission
document.querySelector('form[toolname="checkout_cart"]').addEventListener('submit', async (e) => {
  if (e.agentInvoked) {
    e.preventDefault(); // Stop native navigation
    
    // Resolve the task dynamically and stream JSON back to the WebMCP client
    e.respondWith(
      myInternalApi.processCheckout(new FormData(e.target))
    );
  }
});
```

---

### 3. The Universal Delegate (Embedded Page Agent)

For complex multi-step workflows, writing explicit tools (like `navigate_to_checkout`, `fill_shipping`, `submit_payment`) is exhausting and couples the backend API too tightly to the UI flow.

Instead, the Toolkit provides the **Universal Delegate**. This registers a single, highly powerful WebMCP tool (e.g., `delegate_page_task`). When the top-level browser agent calls this tool, it spins up the **In-Page Agent** natively within the browser tab.

The In-Page Agent runs its own ReAct loop (Observe → Think → Act) entirely within the browser context. It **observes** the page by serializing the semantic DOM (leveraging the declarative markup) into a lightweight text representation, stripping visual clutter. It then iteratively **thinks** by feeding this state to the local LLM to decide on its next logical action, and **acts** by dispatching native browser events (e.g., typing, clicking) until the delegated task is complete.

**Privacy-First & Zero-Cost via the Prompt API**
A major breakthrough here is leveraging the new Chrome Prompt API (via `ai.languageModel.create()`). Instead of hitting an expensive external cloud API, the Subagent runs a zero-cost, privacy-first local LLM natively integrated into the browser. This dramatically reduces latency for rapid micro-actions (clicks and scrolling) and ensures no sensitive DOM data leaves the user's device.

**Setup Example:**
```typescript
import { WebMCPToolkit, InPageAgent } from "universal-webmcp-agent";

// Tip: @types/dom-chromium-ai provides typings for `window.ai`

const mcp = new WebMCPToolkit();

// Initialize the local Prompt API session (if available)
const session = window.ai?.languageModel ? await window.ai.languageModel.create({
  // Built-in browser LLM session configuration
  systemPrompt: "You are an embedded UI agent."
}) : null;

// Enable the Universal Delegate
mcp.enableUniversalDelegate({
  agent: new InPageAgent({
    // Natively hook into the prompt API or fallback to an edge model
    llmProvider: session || defaultEdgeModel,
    maxSteps: 20,
  }),
  // Security constraints & bounds
  allowedActions: ["click", "input", "scroll"],
  // Automatically trigger Human-in-the-Loop for specific semantic elements
  requireConfirmationFor: ["form[toolname='checkout_cart']"] 
});
```

**Execution Flow:**
1. **WebMCP Request**: Top-level agent says, `delegate_page_task({ task: "Book the cheapest flight to NYC next Tuesday" })`.
2. **Sub-Agent Awakens**: The `InPageAgent` isolates the viewport, reads the semantic DOM, and starts its internal loop.
3. **Local Iterate**: It queries its local `llmProvider` (like the natively fast Chrome Prompt API) to decide the next click. It natively dispatches events (typing, clicking) directly in the DOM without network roundtrips.
4. **Resolution**: Once the local LLM determines the goal is met, it streams a summarized payload back to the WebMCP client: `{"status": "success", "summary": "Flight booked for $250. Confirmation sent."}`.

## Progressive Adoption Strategy

The elegance of this SDK lies in its adoption curve:

- **Level 1 (Bronze):** The developer installs the Toolkit just to register specific, backend-driven tools (`check_inventory`, `get_pricing`). They get Zod schemas and clean API syntax.
- **Level 2 (Silver):** The developer sprinkles `data-agent-action` attributes onto their complex UI components, preparing the site for reliable frontend automation.
- **Level 3 (Gold):** The developer enables the **Universal Delegate**. Their website instantly behaves like a dedicated AI Concierge. A top-level browser agent can say "Buy this," and the Toolkit autonomously drives the frontend UI to make it happen, bridging cleanly to the user when confirmation is required.

## Conclusion

The Universal WebMCP Agent Toolkit flips the current automation paradigm. Instead of external AI agents reverse-engineering websites via brittle scraping, the website itself provides a robust, semantic, and embedded sub-agent. It is the ultimate SDK for building "AI-Native Web Applications."
