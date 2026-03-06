# Integrating with Deep Chat

[Deep Chat](https://github.com/OvidijusParsiunas/deep-chat) is a fully customizable AI chat component. This guide explores how to bridge Deep Chat with the `webmcp-toolkit` to create a beautiful, conversational interface for your autonomous in-page agent.

---

## 🚀 Quick Start

### 1. Install Dependencies

You'll need both the `webmcp-toolkit` (local build) and `deep-chat`:

```bash
# Install Deep Chat
npm install deep-chat

# Building webmcp-toolkit
cd packages/core
npm run build
```

### 2. Basic Integration (The "Handler" Path)

The most robust way to connect them is using Deep Chat's `handler` property. This lets you intercept user messages and send them directly to the `InPageAgent` loop.

```javascript
import { InPageAgent, ChromePromptProvider } from './dist/browser.js';

// 1. Initialize your agent
const agent = new InPageAgent({
  llmProvider: new ChromePromptProvider(await globalThis.LanguageModel.create())
});

// 2. Configure Deep Chat
const chatElement = document.querySelector('deep-chat');

chatElement.handler = async (body, signals) => {
  try {
    // Get the latest user message
    const userTask = body.messages[body.messages.length - 1].text;
    
    // Start the agent loop
    const result = await agent.run(userTask);
    
    // Return the agent's summary to the chat interface
    signals.onResponse({ text: result.summary });
  } catch (error) {
    signals.onError(error.message);
  }
};
```

---

## 🏗️ Advanced Integration: Streaming Agent Logs

You can make the experience even better by streaming the agent's internal logs into the chat as it works.

```javascript
agent.onLog = (msg, type) => {
  // Only show "action" and "success" types to the user for a cleaner look
  if (type === 'action' || type === 'success') {
    chatElement.addMessage({ text: `⚙️ ${msg}`, role: 'ai' });
  }
};
```

---

## 🪄 The Declarative Path (Fetch Hooking)

If you prefer a pure HTML-based configuration, you can use our `WebMCPToolkit` to intercept requests to a specific mock URL.

**1. HTML:**
```html
<deep-chat 
  request='{"url": "https://webmcp.local/agent-loop"}'
  introMessage='{"text": "Hello! I am your in-page agent. What can I do for you today?"}'
></deep-chat>
```

**2. JavaScript Integration:**
```javascript
// This patch is often handled automatically by our upcoming deep-chat-bridge
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  if (typeof input === 'string' && input === 'https://webmcp.local/agent-loop') {
    const body = JSON.parse(init.body);
    const task = body.messages[body.messages.length - 1].text;
    
    const result = await agent.run(task);
    
    return new Response(JSON.stringify({ text: result.summary }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch(input, init);
};
```

---

## ✨ Styling for a Premium Look

To make Deep Chat match the `webmcp-toolkit` aesthetic (dark mode, blurred surfaces), apply these styles:

```html
<deep-chat
  style="
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background-color: #0c1020;
    font-family: 'Inter', sans-serif;
  "
  messageStyles='{
    "default": {
      "ai": {"bubble": {"backgroundColor": "#1e2a45", "color": "white"}},
      "user": {"bubble": {"backgroundColor": "#6366f1", "color": "white"}}
    }
  }'
></deep-chat>
```

---

## 📖 Related Resources
- [User Guide](USER-GUIDE.md)
- [In-Page Agent Technical Reference](UNIVERSAL_WEBMCP_AGENT.md)
- [Deep Chat Documentation](https://deepchat.dev/)
