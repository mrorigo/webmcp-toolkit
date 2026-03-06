import { SemanticIndexer } from './semantic-indexer.js';
import type { ILLMProvider } from './llm/illm-provider.js';

/**
 * Configuration options for the InPageAgent instance.
 */
export interface InPageAgentOptions {
    llmProvider: ILLMProvider; // The initialized language model session
    maxSteps?: number;
    allowedActions?: string[];
    requireConfirmationFor?: string[];
}

/**
 * A native, embedded AI sub-agent which drives the current browser tab.
 * Implements a ReAct loop over the `SemanticIndexer` to satisfy overarching `delegate_page_task` requests.
 */
export class InPageAgent {
    indexer: SemanticIndexer;
    session: ILLMProvider;
    isRunning: boolean;
    task: string;
    maxSteps: number;
    hasTakenAction: boolean;
    actionHistory: string[];

    // For hitl/UI events
    onAction?: (actionName: string, args: Record<string, any>) => Promise<void> | void;
    onLog?: (msg: string, type: string) => void;

    constructor(options: InPageAgentOptions) {
        this.indexer = new SemanticIndexer();
        this.session = options.llmProvider;
        this.maxSteps = options.maxSteps ?? 10;
        this.isRunning = false;
        this.task = "";
        this.hasTakenAction = false;
        this.actionHistory = [];
    }

    log(msg: string, type = 'info') {
        if (this.onLog) {
            this.onLog(msg, type);
        } else {
            console.log(`[Agent: ${type}] ${msg}`);
        }
    }

    async executeAction(actionName: string, args: Record<string, any>): Promise<boolean> {
        this.log(`Executing: ${actionName} with args: ${JSON.stringify(args)}`, "action");

        if (this.onAction) {
            await this.onAction(actionName, args);
        }

        if (actionName === 'done') {
            this.log(`Task finished: ${args['reason'] ?? args['message'] ?? ''}`, "success");
            return false; // Stop loop
        }

        this.hasTakenAction = true;

        const agentId = args['agent_id'] ?? args['id'] ?? args['element_id'];
        const textToInput = args['text'] !== undefined ? args['text'] : args['value'];

        const el = this.indexer.actionableElements.get(agentId);
        if (!el) {
            this.log(`Error: Element with ID ${agentId} not found.`, "error");
            return true; // Continue
        }

        if (actionName === 'input_text' || actionName === 'input') {
            el.focus();
            (el as HTMLInputElement).value = textToInput ?? '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            this.log(`Typed text into [ID: ${agentId}]`, "success");
            this.actionHistory.push(`typed "${textToInput}" into [ID: ${agentId}]`);
        } else if (actionName === 'click_element' || actionName === 'click') {
            el.focus();
            el.click();
            this.log(`Clicked element [ID: ${agentId}]`, "success");
            this.actionHistory.push(`clicked element [ID: ${agentId}]`);
        } else {
            this.log(`Error: Unknown action ${actionName}`, "error");
            this.actionHistory.push(`attempted unknown action ${actionName}`);
        }

        // Wait a bit after action to allow DOM updates
        await new Promise(resolve => setTimeout(resolve, 800));
        return true; // Continue loop
    }

    private async countAndBuildPrompt(compressLevel: number, historyLimit: number): Promise<{ prompt: string; tokens: number }> {
        const domState = this.indexer.serializeDOM(globalThis.document.body, compressLevel);

        let historyStr = "None";
        const trimmedHistory = this.actionHistory.slice(-historyLimit);
        if (trimmedHistory.length > 0) {
            historyStr = trimmedHistory.map((action, index) => `${index + 1}. ${action}`).join('\n');
        }

        const prompt = `Current Goal: ${this.task}\n\nPast Actions Taken In Order:\n${historyStr}\n\n${domState}\n\nBased on your past actions and the current state, what is the exact next logical action? Output ONLY a JSON object with 'tool' and 'arguments' properties. No markdown formatting.`;
        const tokens = await this.session.countPromptTokens(prompt);
        return { prompt, tokens };
    }

    /**
     * Executes a single turn of the Observe-Think-Act loop.
     * @returns True if the loop should continue, false if terminal bounds or 'done' command triggered.
     */
    async step(): Promise<boolean> {
        let compressLevel = 0;
        let historyLimit = this.actionHistory.length || 1; // If 0, we still want 1 for serialization logic (using || here because length 0 is falsy and we want 1)
        let { prompt, tokens } = await this.countAndBuildPrompt(compressLevel, historyLimit);

        // Utilize the provider's native contextWindow if available, reserving a 10% safety margin for the assistant response and internal system prompts.
        // Fallback to 4000 if not available.
        const MAX_CONTEXT = this.session.contextWindow ? Math.floor(this.session.contextWindow * 0.9) : 4000;

        if (tokens > MAX_CONTEXT) {
            compressLevel = 1;
            ({ prompt, tokens } = await this.countAndBuildPrompt(compressLevel, historyLimit));
        }

        if (tokens > MAX_CONTEXT) {
            compressLevel = 2;
            historyLimit = Math.min(historyLimit, 3);
            ({ prompt, tokens } = await this.countAndBuildPrompt(compressLevel, historyLimit));
        }

        if (tokens > MAX_CONTEXT) {
            this.log(`Warning: DOM is incredibly large (${tokens} tokens). Forcibly truncating literal string.`, "warning");
            prompt = prompt.slice(0, 15000); // Hard slice string 
        }

        this.log(`Prompting LLM with current state (Tokens: ~${tokens}, Compress Level: ${compressLevel})...`, "info");

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
                cleanJson = cleanJson.slice(7);
            } else if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.slice(3);
            }

            if (cleanJson.endsWith('```')) {
                cleanJson = cleanJson.slice(0, -3);
            }
            cleanJson = cleanJson.trim();

            let action;
            try {
                action = JSON.parse(cleanJson);
            } catch {
                this.log(`Failed to parse LLM output as JSON: ${responseText}`, "error");
                tempSession.destroy?.();
                return false;
            }

            if (!action.tool || !action.arguments) {
                this.log("LLM returned invalid action format.", "error");
                tempSession.destroy?.();
                return false;
            }

            // Commit the session state if we accepted the action
            this.session.destroy?.();
            this.session = tempSession;

            // Act
            const shouldContinue = await this.executeAction(action.tool, action.arguments);
            // this.currentSessionTokensConsumed += tokens; // This line was in the user's edit but `currentSessionTokensConsumed` is not defined. I will omit it to avoid introducing a new error.
            return shouldContinue;

        } catch (error) {
            this.log(`LLM Error: ${(error as Error).message || String(error)}`, "error");
            this.actionHistory.push(`Error: ${(error as Error).message || String(error)}`);
            return false;
        }
    }

    /**
     * Bootstraps and locks the agent into solving a provided text task.
     * 
     * @param task Natural language instruction for the embedded agent to attempt to achieve.
     */
    async run(task: string): Promise<{ status: string, summary?: string }> {
        this.task = task;
        if (!this.session) {
            this.log("No valid session or provider given.", "error");
            return { status: "error", summary: "No LLM session" };
        }

        this.isRunning = true;
        this.hasTakenAction = false;
        this.actionHistory = [];
        this.log(`Starting task: "${task}"`, "success");

        let steps = 0;

        while (this.isRunning && steps < this.maxSteps) {
            steps++;
            this.log(`--- Step ${steps} ---`, "info");

            // eslint-disable-next-line no-await-in-loop
            const shouldContinue = await this.step();
            if (!shouldContinue) {
                break;
            }
        }

        if (steps >= this.maxSteps) {
            this.log("Max steps reached. Aborting loop.", "warning");
        }

        this.isRunning = false;
        this.log("Agent loop stopped.", "info");

        return {
            status: steps >= this.maxSteps ? "timeout" : "success",
            summary: `Automated UI completed in ${steps} steps.`
        };
    }
}
