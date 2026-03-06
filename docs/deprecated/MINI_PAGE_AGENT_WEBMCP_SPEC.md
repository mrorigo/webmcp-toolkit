# Mini Page Agent: WebMCP Integration Specification

## Overview

As the **WebMCP** standard introduces `navigator.modelContext`, websites can actively expose intelligent tools to external browser-based AI agents (the WebMCP Clients). 

Instead of an external agent constantly polling DOM state, attempting to parse complex layouts, and micro-managing granular clicks and scrolls, we can bridge the **Mini Page Agent** as a **Subagent** through WebMCP.

By exposing the Mini Page Agent via WebMCP, a top-level agent (e.g., Claude, a browser companion, or a broad task solver) can delegate complex, multi-step page tasks (e.g., "Add the top-rated mechanical keyboard to my cart") using a single, high-level tool invocation.

## The Mental Model

1. **Top-Level Agent (WebMCP Client)**: An overarching AI solving user goals across tabs. It doesn't want to parse HTML or coordinate exact X/Y clicks. It views the page abstractly.
2. **WebMCP Bridge (Tool Registration)**: The page registers `delegate_page_task` using `navigator.modelContext.registerTool()`.
3. **Mini Page Agent (The Subagent)**: When the tool is called, the Mini Page Agent instantiates natively within the page. It runs its ReAct loop (Observe → Think → Act), interacting with the local DOM and its specialized LLM, until the task is complete. It then returns a summarized success/failure payload back to the WebMCP Client.

## Bridging WebMCP Tools with the Subagent

We register a single composite tool into the WebMCP context.

```typescript
const pageAgentTool: ModelContextTool = {
  name: "delegate_page_task",
  description: "Delegates a complex, multi-step objective to an intelligent subagent embedded in the page. The subagent can autonomously navigate, click, scroll, and extract data to achieve the given task.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The natural language instruction for the subagent (e.g., 'Find the checkout button and click it', 'Extract all visible product prices into a list')."
      },
      maxSteps: {
        type: "integer",
        description: "The maximum number of sub-actions the agent is allowed to take before aborting.",
        default: 15
      }
    },
    required: ["task"],
    additionalProperties: false
  },
  annotations: { 
    readOnlyHint: false // Subagent might mutate page state (e.g. clicking buttons, filling forms)
  },
  
  async execute(input, client) {
    const { task, maxSteps } = input as { task: string; maxSteps?: number };
    
    // 1. Initialize the Mini Page Agent within the browser context
    const adapter = new DOMController(); // The native controller
    const brain = new BrowserLLMProvider(); // e.g., using window.ai or a pre-configured lightweight model
    
    // 2. Configure the agent, bridging WebMCP hit-in-the-loop features
    const agent = new MiniAgent({
      llm: brain,
      controller: adapter,
      maxSteps: maxSteps ?? 15,
      // Map the internal 'ask_user' tool to the WebMCP interactive callback
      onAskUser: async (question) => {
        // Halt and ask the external top-level agent/user
        let answer = "";
        await client.requestUserInteraction(async () => {
             // In a real implementation, custom UI or message passing handles this
             answer = window.prompt(`Subagent needs help: ${question}`) || "";
        });
        return answer;
      }
    });

    // 3. Drive the underlying task stream
    try {
      const taskStream = agent.run(task);
      let finalResult = null;
      
      for await (const event of taskStream) {
        // Optional: Pipe these events to a local debug UI or a custom CustomEvent emitter
        if (event.type === 'done') {
          finalResult = event.output;
        }
      }
      
      // 4. Return structural results back to the WebMCP network
      return { 
        status: finalResult?.success ? "success" : "failed", 
        summary: finalResult?.summary || "Task failed to yield a final output", 
      };
      
    } catch (error) {
       return { status: "error", message: error instanceof Error ? error.message : "Unknown error" };
    }
  }
};

// Expose to the top-level Browser Agent
if (window.isSecureContext && navigator.modelContext) {
  navigator.modelContext.registerTool(pageAgentTool);
}
```

## Benefits of the Subagent Pattern

### 1. Context Window Preservation
Exposing raw granular toolings (like `click_element` or `DOMState`) over WebMCP would force the Top-Level Agent to repeatedly ingest the raw DOM text representation at every step. By encapsulating this into a subagent, the massive DOM state remains **strictly local** to the Mini Page Agent. The WebMCP interface is purely semantic (`input: task string` -> `output: task result string`).

### 2. Reduced Network Latency
If the top-level agent runs in the cloud, passing DOM state over WebMCP back-and-forth for 15 steps of a ReAct loop introduces severe latency. The embedded Mini Page Agent (acting as an on-device subagent) iterates instantly in the frontend, pinging its local LLM provider or optimizing DOM parsing without roundtrips to the top-level client.

### 3. Human-In-The-Loop Compatibility
By mapping the Mini Page Agent's `ask_user` tool to WebMCP's `client.requestUserInteraction`, we keep the system compliant with rigorous security and UX guidelines. If the subagent hits a paywall or a confirmation dialog, it seamlessly pauses execution and bubbles the request up to the top-level client to arbitrate.

## Summary
The future of browser automation is hierarchical. The Top-Level Agent orchestrates broad logic, and the **Mini Page Agent** acts as a brilliant, context-aware peripheral via **WebMCP**, managing the heavy lifting of localized DOM traversal.
