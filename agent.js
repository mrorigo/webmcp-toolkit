/**
 * Universal WebMCP Agent - Core Execution Loop (Phase 1.3 & 1.4)
 * 
 * Drives the observation-thought-act loop using the Chrome Prompt API.
 */

class PageAgent {
    constructor(indexer) {
        this.indexer = indexer;
        this.session = null;
        this.isRunning = false;
        this.task = "";

        this.agentLogEl = document.getElementById('agentLog');
    }

    log(msg, type = 'info') {
        if (!this.agentLogEl) return;
        const entry = document.createElement('div');
        entry.style.color = type === 'error' ? '#f87171' : type === 'success' ? '#4ade80' : type === 'action' ? '#60a5fa' : type === 'warning' ? '#facc15' : '#d4d4d4';
        entry.style.marginBottom = '4px';
        entry.textContent = `[${new Date().toISOString().split('T')[1].slice(0, -1)}] ${msg}`;
        this.agentLogEl.appendChild(entry);
        this.agentLogEl.scrollTop = this.agentLogEl.scrollHeight;
    }

    async init() {
        if (typeof window.LanguageModel === 'undefined') {
            this.log("Error: Chrome Prompt API (LanguageModel) not available.", "error");
            this.log("Please make sure you are in Chrome Dev/Canary with the prompt API flags enabled.", "error");
            return false;
        }

        try {
            let isAvailable = false;
            if (typeof window.LanguageModel.availability === 'function') {
                const availability = await window.LanguageModel.availability();
                if (availability === 'available') {
                    isAvailable = true;
                }
            } else if (typeof window.LanguageModel.capabilities === 'function') {
                // Fallback for older API versions
                const capabilities = await window.LanguageModel.capabilities();
                if (capabilities.available !== 'no') {
                    isAvailable = true;
                }
            } else {
                // Optimistically assume it's available if the global exists but we can't check
                isAvailable = true;
            }

            if (!isAvailable) {
                this.log("Error: Language model is not available.", "error");
                return false;
            }

            this.log("Initializing Language Model session...");
            // Initializing session with system prompt
            this.session = await window.LanguageModel.create({
                systemPrompt: `You are a web automation agent. Your goal is to help the user complete tasks on a web page.
You receive a serialized DOM state. You must pick ONE tool to execute per turn.
Return ONLY valid JSON.
Tools:
- input_text: Type text into an input field. Arguments: {"agent_id": string, "text": string}
- click_element: Click a button or link. Arguments: {"agent_id": string}
- done: The task is complete. Arguments: {"reason": string}

Always verify the DOM state. Do not invent element IDs.`
            });
            this.log("Language Model session ready.", "success");
            return true;
        } catch (e) {
            this.log(`Error initializing model: ${e.message}`, "error");
            return false;
        }
    }

    async executeAction(actionName, args) {
        this.log(`Executing: ${actionName} with args: ${JSON.stringify(args)}`, "action");

        if (actionName === 'done') {
            this.log(`Task finished: ${args.reason || args.message || ''}`, "success");
            return false; // stop loop
        }

        this.hasTakenAction = true;

        const agentId = args.agent_id || args.id || args.element_id;
        const textToInput = args.text !== undefined ? args.text : args.value;

        const el = this.indexer.actionableElements.get(agentId);
        if (!el) {
            this.log(`Error: Element with ID ${agentId} not found.`, "error");
            return true; // continue
        }

        if (actionName === 'input_text' || actionName === 'input') {
            el.focus();
            el.value = textToInput || '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            this.log(`Typed text into [ID: ${agentId}]`, "success");
        } else if (actionName === 'click_element' || actionName === 'click') {
            el.focus();
            el.click();
            this.log(`Clicked element [ID: ${agentId}]`, "success");
        } else {
            this.log(`Error: Unknown action ${actionName}`, "error");
        }

        // Wait a bit after action to allow DOM updates
        await new Promise(r => setTimeout(r, 800));
        return true; // continue loop
    }

    async step() {
        // Observe
        const domState = this.indexer.serializeDOM();

        const prompt = `Current Goal: ${this.task}\n\n${domState}\n\nBased on the current state, what is the next logical action? Output ONLY a JSON object with 'tool' and 'arguments' properties. No markdown formatting.`;
        this.log("Prompting LLM with current state...", "info");

        try {
            const allowedTools = this.hasTakenAction ? ["input_text", "click_element", "done"] : ["input_text", "click_element"];
            const tempSession = await this.session.clone();
            const responseText = await tempSession.prompt(prompt, {
                responseConstraint: {
                    type: "object",
                    properties: {
                        tool: {
                            type: "string",
                            enum: allowedTools,
                        },
                        arguments: {
                            type: "object",
                        },
                    },
                    required: ["tool", "arguments"],
                }
            });

            // Try to parse JSON output
            let cleanJson = responseText.trim();
            if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.substring(7);
            } else if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.substring(3);
            }

            if (cleanJson.endsWith('```')) {
                cleanJson = cleanJson.substring(0, cleanJson.length - 3);
            }
            cleanJson = cleanJson.trim();

            let action;
            try {
                action = JSON.parse(cleanJson);
            } catch (jsonErr) {
                this.log(`Failed to parse LLM output as JSON: ${responseText}`, "error");
                if (typeof tempSession.destroy === 'function') tempSession.destroy();
                return false;
            }

            if (!action.tool || !action.arguments) {
                this.log("LLM returned invalid action format.", "error");
                if (typeof tempSession.destroy === 'function') tempSession.destroy();
                return false;
            }

            // Commit the session state if we accepted the action
            if (typeof this.session.destroy === 'function') this.session.destroy();
            this.session = tempSession;

            // Act
            const shouldContinue = await this.executeAction(action.tool, action.arguments);
            return shouldContinue;

        } catch (e) {
            this.log(`LLM Error: ${e.message}`, "error");
            return false;
        }
    }

    async run(task) {
        this.task = task;
        if (!this.session) {
            const ok = await this.init();
            if (!ok) return;
        }

        this.isRunning = true;
        this.hasTakenAction = false;
        this.log(`Starting task: "${task}"`, "success");

        let steps = 0;
        const maxSteps = 10;

        while (this.isRunning && steps < maxSteps) {
            steps++;
            this.log(`--- Step ${steps} ---`, "info");

            const shouldContinue = await this.step();
            if (!shouldContinue) {
                break;
            }
        }

        if (steps >= maxSteps) {
            this.log("Max steps reached. Aborting loop.", "warning");
        }

        this.isRunning = false;
        this.log("Agent loop stopped.", "info");
    }
}

// Ensure the agent is globally accessible for the playground
window.PageAgent = PageAgent;
