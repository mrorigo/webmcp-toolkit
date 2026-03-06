WebMCP lets your website act as a lightweight MCP “server” in the browser, exposing tools via `navigator.modelContext` that AI agents can reliably call instead of scraping your UI. [en.wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

## Mental model: MCP vs WebMCP

- MCP is a general, transport-agnostic standard for exposing tools, data sources, and workflows to AI applications, typically via separate “servers” connected over STDIO or HTTP/SSE. [descope](https://www.descope.com/learn/post/mcp)
- WebMCP applies that **same** conceptual model inside the browser: your page exposes tools (with JSON Schema, descriptions, and handlers) through `navigator.modelContext`, so agents can discover and call them as structured capabilities. [webmcp](https://webmcp.link)
- You can think of a WebMCP-enabled page as “an MCP server running in the front-end,” but managed by the browser instead of your own transport layer.

### Concept mapping

| MCP concept     | WebMCP analogue                         | Notes                                                                           |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| MCP server      | Web page using `navigator.modelContext` | Tools implemented in JS instead of a backend service.                           |
| Tool            | `ModelContextTool` dictionary           | Name, description, JSON Schema, execute callback.                               |
| Client (AI app) | Browser agent / external AI platform    | Calls tools via `modelContext` APIs and a bridge. [webmcp](https://webmcp.link) |

## Core WebMCP API surface

### Accessing the model context

- The browser extends `Navigator` with a **same-object** `modelContext` attribute in secure contexts:  
  ```ts
  // Typescript-style
  partial interface Navigator {
    [SecureContext, SameObject] readonly attribute ModelContext modelContext;
  }

  const ctx = navigator.modelContext;
  ```
- The `ModelContext` instance is created alongside the `Navigator` and holds an internal **model context struct**, whose primary field is a **tool map** keyed by tool name.

### Registering and unregistering tools

`ModelContext` provides two main methods to manage tools:

```webidl
[Exposed=Window, SecureContext]
interface ModelContext {
  undefined registerTool(ModelContextTool tool);
  undefined unregisterTool(DOMString name);
};
```

Key behaviors for **`registerTool(tool)`**:

- Fails if:
  - A tool with the same `name` already exists (throws `InvalidStateError DOMException`).  
  - `name` or `description` is the empty string (also `InvalidStateError`).  
- Serializes `inputSchema` with `JSON.stringify`; serialization errors or undefined/invalid `toJSON()` cause exceptions.  
- Internally creates a **tool definition struct** with:
  - **name**: the tool’s name  
  - **description**: natural-language description  
  - **input schema**: stringified JSON Schema  
  - **execute steps**: wrapper that calls your `execute` callback  
  - **read-only hint**: boolean derived from `annotations.readOnlyHint`  
- Inserts that tool definition into the internal context’s tool map under `tool.name`.

`unregisterTool(name)` behavior:

- Throws `InvalidStateError` if no tool with that name exists.  
- Otherwise, removes the entry from the tool map.

### Tool shape: `ModelContextTool`

The spec defines the tool description as a WebIDL dictionary:

```webidl
dictionary ModelContextTool {
  required DOMString name;
  required DOMString description;
  object inputSchema;
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;
};

callback ToolExecuteCallback = Promise<any> (
  object input,
  ModelContextClient client
);
```

Practical implications:

- **name**: Unique within the page’s `modelContext`. This is what the agent will use in tool calls.  
- **description**: Natural language, used by agents to decide when/how to call the tool. Treat this like a function-calling description for LLMs.  
- **inputSchema**:
  - A JSON Schema object describing the tool’s arguments, which the UA will stringify.  
  - Designed to align with standard LLM tool-calling formats (same idea as GPT/Claude/Gemini JSON Schema parameters). [bug0](https://bug0.com/blog/webmcp-chrome-146-guide)
- **execute**:
  - Async callback, receives:
    - `input`: an object structured according to your JSON Schema.  
    - `client`: a `ModelContextClient` instance representing the calling agent.  
  - Returns any JSON-serializable value (fulfilling the promise).  
- **annotations.readOnlyHint**:
  - Optional hint that the tool only **reads** data and does not mutate state.  
  - Agents can use this to optimize or auto-call “safe” tools more aggressively.

### ModelContextClient and user interaction

The `ModelContextClient` interface models the **agent** executing your tool.

```webidl
[Exposed=Window, SecureContext]
interface ModelContextClient {
  Promise<any> requestUserInteraction(UserInteractionCallback callback);
};

callback UserInteractionCallback = Promise<any> ();
```

- `client.requestUserInteraction(callback)`:
  - Asynchronously requests user input during a tool execution.  
  - The callback is where you implement UI interactions (confirm dialogs, multi-step forms, etc.).  
  - The spec’s algorithm is currently a TODO, but the intent is a browser-mediated, agent-visible way to have human-in-the-loop steps. [webmcp](https://webmcp.link)

## Implementation patterns for website authors

### Minimal “hello world” WebMCP tool

A basic read-only tool that echoes a greeting:

```ts
const tool: ModelContextTool = {
  name: "say_hello",
  description: "Return a friendly greeting for the given name.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" }
    },
    required: ["name"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true },
  async execute(input, client) {
    const { name } = input as { name: string };
    return { message: `Hello, ${name}!` };
  }
};

navigator.modelContext.registerTool(tool);
```

What happens:

- Browser validates `name` and `description` (non-empty) and serializes `inputSchema`.  
- If registration succeeds, the page’s internal tool map now contains a tool definition under `"say_hello"`.  
- Agents that can introspect the model context (usually via browser- or extension-provided plumbing) will see a tool named `"say_hello"` with a standard JSON Schema and can call it.

### Tool lifecycle and dynamic registration

You can manage tools dynamically during page lifetime:

- Register on load, when a feature becomes available, or lazily when the user enables a capability.  
- Unregister when:
  - User logs out and a capability no longer applies.  
  - Feature flags disable functionality.  
  - You want to replace a tool with a new version (must unregister the old name first because duplicate names are invalid).  

Example pattern for versioning:

```ts
function registerBookingTools(version: "v1" | "v2") {
  const name = "create_booking";
  try {
    navigator.modelContext.unregisterTool(name);
  } catch (_) {
    // Ignore if not present
  }

  const tool = version === "v1"
    ? makeCreateBookingV1Tool()
    : makeCreateBookingV2Tool();

  navigator.modelContext.registerTool(tool);
}
```

### Designing JSON Schemas that LLMs can use

Because WebMCP aligns with JSON Schema-based tool-calling, you should treat schema design as part of your agent UX: [bug0](https://bug0.com/blog/webmcp-chrome-146-guide)

- Prefer **small, flat** objects over deeply nested structures unless the domain demands it.  
- Use `description` fields on each property to help the model map natural language requests to parameters.  
- Use `enum`/`const` and `format` where useful (e.g., `"format": "date-time"` for ISO timestamps) to reduce ambiguity.  
- Mark truly required fields in `required`; avoid making everything required if some values can be inferred or defaulted.  

Example for a purchase action:

```ts
inputSchema: {
  type: "object",
  properties: {
    productId: {
      type: "string",
      description: "Internal product identifier, e.g. 'SKU-12345'."
    },
    quantity: {
      type: "integer",
      minimum: 1,
      default: 1,
      description: "Number of units to purchase."
    },
    paymentMethodId: {
      type: "string",
      description: "Opaque identifier for a stored payment method."
    }
  },
  required: ["productId", "paymentMethodId"],
  additionalProperties: false
}
```

### Using `ModelContextClient.requestUserInteraction`

For state-changing or sensitive tools, require explicit user approval: [webmcp](https://webmcp.link)

```ts
const deleteAccountTool: ModelContextTool = {
  name: "delete_account",
  description: "Permanently delete the current user's account.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute(input, client) {
    const confirmed = await client.requestUserInteraction(async () => {
      // Implement your own UI; resolve with true/false or more data.
      return await showConfirmationDialog(
        "Are you sure you want to delete your account?"
      );
    });

    if (!confirmed) {
      return { status: "cancelled" };
    }

    await actuallyDeleteAccount();
    return { status: "deleted" };
  }
};
```

This aligns with the spec’s **human-in-the-loop** design goal for sensitive operations. [webmcp](https://webmcp.link)

## Agent integration strategies

### In-browser “browser agent”

A browser or extension can act as the “MCP client” that calls your tools:

- It enumerates tools known to `navigator.modelContext` (exposed through UA-specific APIs or internal plumbing).  
- It forwards tool definitions to an LLM (ChatGPT, Claude, Gemini, etc.) in their native tool-calling format.  
- When the model emits a tool call, the agent calls `tool.execute(input, client)` and returns the result back to the model. [webmcp](https://webmcp.link)

As a site author, you don’t implement that wiring; you **only** define tools via WebMCP. The agent environment handles mapping to/from the LLM’s protocol. [webmcp](https://webmcp.link)

### External AI platforms

For external platforms that are not built into the browser:

- A browser extension, native companion app, or special browser mode can export the tool list and invocation interface to an external AI platform. [webmcp](https://webmcp.link)
- From your perspective as the website, nothing changes compared to the WebMCP API; you remain decoupled from the specific AI provider. [en.wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

This is analogous to “MCP servers” being re-used across multiple MCP clients without you coding to each vendor. [en.wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

## Security, privacy, and UX guidance

### Browser-level constraints

WebMCP is constrained by standard browser security policies: [webmcp](https://webmcp.link)

- **Secure context required**: Only available over HTTPS (or equivalent secure contexts).  
- **Same-Origin Policy**: Tools inherit the origin boundary of their page; they cannot directly act on other origins. [webmcp](https://webmcp.link)
- **Content Security Policy**: WebMCP respects CSP headers, so your CSP can continue to enforce script and network policies. [webmcp](https://webmcp.link)

### Site-level best practices

For safe and predictable agent interactions:

- Use `annotations.readOnlyHint = true` on tools that only read state to allow more automated use without confirmations.  
- For write operations (purchases, deletions, data sharing):
  - Combine clear `description` warnings.  
  - Require `requestUserInteraction` confirmation. [webmcp](https://webmcp.link)
- Log WebMCP tool invocations in your app’s analytics/audit trail, especially for actions with legal or security implications.  
- Keep tool names and schemas stable; when you must break compatibility, use new tool names for versioned behaviors.

### UX considerations

- Treat agents as “power users”: they may call tools in rapid succession, so design idempotent, retry-safe handlers where possible.  
- Return concise, structured results; the agent will convert those into natural language for the user.  
- Use explicit error payloads (e.g., `{ errorCode, message }`) rather than throwing whenever possible, so the agent can recover.

## Compact implementation checklist

When implementing WebMCP support on a site:

1. **Identify capabilities** you want agents to have (search, booking, checkout, export, etc.).  
2. **Define tools** for those capabilities using `ModelContextTool`:
   - Stable `name`  
   - Clear `description`  
   - JSON Schema `inputSchema`  
   - Async `execute(input, client)`  
   - `annotations.readOnlyHint` where appropriate  
3. **Register tools** via `navigator.modelContext.registerTool(tool)` in secure contexts, handling `InvalidStateError` and serialization errors.  
4. **Guard sensitive actions** with `client.requestUserInteraction` for confirmations or additional user input. [webmcp](https://webmcp.link)
5. **Respect security boundaries** (origin, CSP) and avoid cross-origin assumptions. [webmcp](https://webmcp.link)
6. **Document your tools** for human developers and agent authors (name, schema, semantics, side effects).

Following this pattern, your website becomes a first-class WebMCP endpoint, ready for browser agents and external AI assistants to interact with in a structured, reliable way.