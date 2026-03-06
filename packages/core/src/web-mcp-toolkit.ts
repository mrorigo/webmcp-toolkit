import type { InPageAgent } from "./in-page-agent.js";

/**
 * A minimal schema interface that mirrors the Zod contract we need at runtime.
 * Callers may pass a Zod schema, or any object that implements `parse` and `_shape`.
 */
export interface Schema<T> {
    parse(data: unknown): T;
    _shape?: Record<string, { isOptional(): boolean }>;
}

/**
 * Opaque WebMCP client reference natively passed into executing tools by the browser.
 */
export interface WebMCPClient {
    requestUserInteraction: (params: { message: string, type: string }) => Promise<boolean>;
    [key: string]: unknown;
}

export interface ToolRegistration<T> {
    name: string;
    description: string;
    schema: Schema<T>;
    readOnly?: boolean;
    execute: (args: T, client: WebMCPClient | undefined | null) => Promise<unknown>;
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
    private toolsRegistry = new Map<string, ToolRegistration<unknown>>();
    private logHandler: (msg: string, level: string) => void;

    public tools = {
        /**
         * Registers an explicit functional tool into the browser's modelContext.
         * Automatically strictly-types parameters and maps a schema object to proper JSON schema.
         * 
         * @param tool The definition of your tool including its schema and executor.
         */
        register: <T>(tool: ToolRegistration<T>) => {
            this.toolsRegistry.set(tool.name, tool as ToolRegistration<unknown>);

            // Wait for WebMCP navigator.modelContext to be available
            this.registerWithWebMCP(tool as ToolRegistration<unknown>);
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

    private async registerWithWebMCP(tool: ToolRegistration<unknown>) {
        if (globalThis.window?.navigator && (globalThis.window.navigator as unknown as { modelContext?: any }).modelContext) {
            // Build JSON Schema from the tool schema's _shape if available (Zod-compatible duck typing)
            const jsonSchema = {
                type: "object",
                properties: {} as Record<string, unknown>,
                required: [] as string[]
            };

            if (tool.schema._shape) {
                for (const [key, value] of Object.entries(tool.schema._shape)) {
                    jsonSchema.properties[key] = { type: "string" };
                    if (!value.isOptional()) {
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
                    const parsedArgs = tool.schema.parse(args);
                    return await tool.execute(parsedArgs, context?.client);
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
    async askUserToConfirm(client: WebMCPClient | undefined | null, message: string): Promise<boolean> {
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
        // Inline schema: a plain object with a single required `task` string field.
        // This avoids Zod as a runtime dependency while remaining compatible with Schema<T>.
        const schema: Schema<{ task: string }> = {
            parse: (data: unknown) => {
                const record = data as Record<string, unknown>;
                if (typeof record['task'] !== 'string') {
                    throw new Error("Invalid args: 'task' must be a string.");
                }
                return { task: record['task'] };
            },
            _shape: {
                task: { isOptional: () => false }
            }
        };

        this.tools.register({
            name: "delegate_page_task",
            description: "Spins up an embedded in-page ReAct sub-agent to autonomously drive the frontend UI to achieve a delegated task.",
            schema,
            readOnly: false,
            execute: async (args, client) => {
                this.log(`Delegating task to InPageAgent: ${args.task}`, "info");

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

                            const allowed = await this.askUserToConfirm(client, `The embedded agent wants to ${actionDesc} a critical element:\n<${el.tagName.toLowerCase()}> "${label}"\n\nAllow this action?`);
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
