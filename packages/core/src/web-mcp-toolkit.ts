import { z } from "zod";
import type { InPageAgent } from "./in-page-agent.js";

/**
 * Defines a tool to be exposed to overarching WebMCP-compliant agents.
 */
/**
 * Opaque WebMCP client reference natively passed into executing tools by the browser.
 */
export interface WebMCPClient {
    requestUserInteraction: (params: { message: string, type: string }) => Promise<boolean>;
    [key: string]: unknown;
}

export interface ToolRegistration<T extends z.ZodType> {
    name: string;
    description: string;
    schema: T;
    readOnly?: boolean;
    execute: (args: z.infer<T>, client: WebMCPClient | undefined) => Promise<unknown>;
}

/**
 * Configuration options for the Universal Toolkit.
 */
export interface WebMCPToolkitOptions {
    logHandler?: (msg: string, level: string) => void;
}

/**
 * The primary bridging layer integrating local TypeScript code 
 * into the impending native browser `navigator.modelContext` API.
 */
export class WebMCPToolkit {
    private toolsRegistry = new Map<string, ToolRegistration<z.ZodType>>();
    private logHandler: (msg: string, level: string) => void;

    public tools = {
        /**
         * Registers an explicit functional tool into the browser's modelContext.
         * Automatically strictly-types parameters and maps Zod object to proper JSON schema.
         * 
         * @param tool The definition of your tool including its schema and executor.
         */
        register: <T extends z.ZodType>(tool: ToolRegistration<T>) => {
            this.toolsRegistry.set(tool.name, tool);

            // Wait for WebMCP navigator.modelContext to be available
            this.registerWithWebMCP(tool);
        }
    };

    /**
     * Initializes the bridging toolkit.
     * 
     * @param options Provides optional custom logging hooks.
     */
    constructor(options?: WebMCPToolkitOptions) {
        this.logHandler = options?.logHandler ?? ((msg, lvl) => console.log(`[WebMCP ${lvl}] ${msg}`));
    }

    /**
     * Emits internal logs to the configured logHandler.
     */
    public log(msg: string, level = "info") {
        this.logHandler(msg, level);
    }

    private async registerWithWebMCP(tool: ToolRegistration<z.ZodType>) {
        if (globalThis.window?.navigator && (globalThis.window.navigator as unknown as { modelContext?: any }).modelContext) {
            // Lightweight Zod to JSON Schema bridge
            const jsonSchema = {
                type: "object",
                properties: {} as Record<string, unknown>,
                required: [] as string[]
            };

            // E.g. basic conversion for z.object()
            if (tool.schema instanceof z.ZodObject) {
                for (const [key, value] of Object.entries(tool.schema.shape)) {
                    jsonSchema.properties[key] = { type: "string" }; // simplistic mapping for strings
                    if (!(value as any).isOptional()) {
                        jsonSchema.required.push(key);
                    }
                }
            }

            (globalThis.window.navigator as unknown as { modelContext: any }).modelContext.registerTool({
                name: tool.name,
                description: tool.description,
                inputSchema: jsonSchema,
                readOnly: tool.readOnly ?? false,
                execute: async (args: Record<string, unknown>, context: { client?: WebMCPClient }) => {
                    this.log(`Invoking tool ${tool.name}`, "info");
                    // Validate
                    const parsedArgs = tool.schema.parse(args);
                    return await tool.execute(parsedArgs, context?.client ?? undefined);
                }
            });
            this.log(`Successfully registered tool ${tool.name} with modelContext`, "success");
        } else {
            this.log(`WebMCP navigator.modelContext not found. Skipping native registration for ${tool.name}`, "warn");
        }
    }

    /**
     * Pauses execution to manually prompt the local human user using the overarching client's 
     * Human-In-The-Loop capabilities. 
     * 
     * @param client The opaque WebMCP client context that triggered the tool.
     * @param message Text to display to the user explaining the requested action.
     * @returns True if the user permitted the action.
     */
    async askUserToConfirm(client: WebMCPClient | undefined, message: string): Promise<boolean> {
        if (!client?.requestUserInteraction) {
            this.log("No valid WebMCP client provided for UI interaction. Falling back to native confirm.", "warning");
            return globalThis.window.confirm(message);
        }

        try {
            const result = await client.requestUserInteraction({
                message,
                type: "confirmation"
            });
            return result === true;
        } catch {
            return false;
        }
    }

    /**
     * Dispatches the `delegate_page_task` tool to the browser. 
     * This exposes an incredibly powerful macro-tool where an external agent can 
     * simply hand a text string (e.g., "Checkout my cart") to your completely embedded, 
     * native autonomous `InPageAgent`.
     * 
     * @param config Configures the delegate agent limits and Human-In-The-Loop boundaries.
     */
    enableUniversalDelegate(config: {
        agent: InPageAgent,
        allowedActions?: string[],
        requireConfirmationFor?: string[]
    }) {
        const schema = z.object({
            task: z.string().describe("The human-readable task description to execute on the page.")
        });

        this.tools.register({
            name: "delegate_page_task",
            description: "Spins up an embedded in-page ReAct sub-agent to autonomously drive the frontend UI to achieve a delegated task.",
            schema: schema,
            readOnly: false,
            execute: async (args, client) => {
                this.log(`Delegating task to InPageAgent: ${args.task}`, "info");

                // Let the agent use the client for ask_user later
                // We'll hardcode prompt confirmations for certain elements

                config.agent.onAction = async (actionName: string, arg: Record<string, any>) => {
                    const targetId = arg['agent_id'] ?? arg['id'] ?? arg['element_id'];
                    if (targetId === undefined) return;
                    const el = config.agent.indexer.actionableElements.get(String(targetId));

                    if (el && config.requireConfirmationFor) {
                        let requiresConfirm = false;
                        let matchedSelector = "";

                        for (const selector of config.requireConfirmationFor) {
                            if (el.matches(selector)) {
                                requiresConfirm = true;
                                matchedSelector = selector;
                                break;
                            }
                            // If the selector targets a form, we only want to confirm when the agent tries to submit the form
                            const closestForm = el.closest('form');
                            if (closestForm?.matches(selector)) {
                                if (actionName === "click" || actionName === "click_element") {
                                    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'submit')) {
                                        requiresConfirm = true;
                                        matchedSelector = selector;
                                        break;
                                    }
                                }
                            }
                        }

                        if (requiresConfirm) {
                            this.log(`Agent action triggered Human-In-The-Loop hook for selector: ${matchedSelector}`, "action");

                            const label = config.agent.indexer.getElementLabel(el) ?? el.getAttribute("name") ?? el.getAttribute("placeholder") ?? el.id ?? "Unnamed element";
                            const actionDesc = actionName.includes("input") ? `type "${arg['text'] ?? arg['value']}" into` : `click on`;

                            const allowed = await this.askUserToConfirm(client ?? undefined, `The embedded agent wants to ${actionDesc} a critical element:\n<${el.tagName.toLowerCase()}> "${label}"\n\nAllow this action?`);
                            if (!allowed) {
                                throw new Error("Action denied by user.");
                            }
                        }
                    }
                };

                const result = await config.agent.run(args.task);
                return {
                    status: result.status,
                    summary: result.summary
                };
            }
        });
    }
}
