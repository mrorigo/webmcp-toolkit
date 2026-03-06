import { z } from "zod";
import { InPageAgent } from "./InPageAgent.js";

export interface ToolRegistration<T extends z.ZodType> {
    name: string;
    description: string;
    schema: T;
    readOnly?: boolean;
    execute: (args: z.infer<T>, client: any) => Promise<any>;
}

export interface WebMCPToolkitOptions {
    logHandler?: (msg: string, level: string) => void;
}

export class WebMCPToolkit {
    private toolsRegistry = new Map<string, ToolRegistration<any>>();
    private logHandler: (msg: string, level: string) => void;

    public tools = {
        register: <T extends z.ZodType>(tool: ToolRegistration<T>) => {
            this.toolsRegistry.set(tool.name, tool);

            // Wait for WebMCP navigator.modelContext to be available
            this.registerWithWebMCP(tool);
        }
    };

    constructor(options?: WebMCPToolkitOptions) {
        this.logHandler = options?.logHandler || ((msg, lvl) => console.log(`[WebMCP ${lvl}] ${msg}`));
    }

    private log(msg: string, level: string = "info") {
        this.logHandler(msg, level);
    }

    private async registerWithWebMCP(tool: ToolRegistration<any>) {
        if (typeof window !== "undefined" && window.navigator && (window.navigator as any).modelContext) {
            // Very naive Zod to JSON Schema bridge for the PoC
            const jsonSchema = {
                type: "object",
                properties: {} as any,
                required: [] as string[]
            };

            // E.g. basic conversion for z.object()
            if (tool.schema instanceof z.ZodObject) {
                const shape = tool.schema.shape;
                for (const key in shape) {
                    jsonSchema.properties[key] = { type: "string" }; // simplistic mapping for PoC
                    if (!shape[key].isOptional()) {
                        jsonSchema.required.push(key);
                    }
                }
            }

            (window.navigator as any).modelContext.registerTool({
                name: tool.name,
                description: tool.description,
                inputSchema: jsonSchema,
                readOnly: tool.readOnly ?? false,
                execute: async (args: any, context: any) => {
                    this.log(`Invoking tool ${tool.name}`, "info");
                    // Validate
                    const parsedArgs = tool.schema.parse(args);
                    return await tool.execute(parsedArgs, context?.client || null);
                }
            });
            this.log(`Successfully registered tool ${tool.name} with modelContext`, "success");
        } else {
            this.log(`WebMCP navigator.modelContext not found. Skipping native registration for ${tool.name}`, "warn");
        }
    }

    async askUserToConfirm(client: any, message: string): Promise<boolean> {
        if (!client || typeof client.requestUserInteraction !== 'function') {
            this.log("No valid WebMCP client provided for UI interaction. Falling back to native confirm.", "warning");
            return window.confirm(message);
        }

        try {
            const result = await client.requestUserInteraction({
                message,
                type: "confirmation"
            });
            return result === true;
        } catch (e) {
            return false;
        }
    }

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

                // Let the agent use the client for ask_user later (Phase 2.3)
                // We'll hardcode prompt confirmations for certain elements

                config.agent.onAction = async (actionName: string, arg: any) => {
                    const targetId = arg.agent_id || arg.id || arg.element_id;
                    const el = config.agent.indexer.actionableElements.get(targetId);

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
                            if (closestForm && closestForm.matches(selector)) {
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

                            const label = config.agent.indexer.getElementLabel(el) || el.getAttribute("name") || el.getAttribute("placeholder") || el.id || "Unnamed element";
                            const actionDesc = actionName.includes("input") ? `type "${arg.text || arg.value}" into` : `click on`;

                            const allowed = await this.askUserToConfirm(client, `The embedded agent wants to ${actionDesc} a critical element:\n<${el.tagName.toLowerCase()}> "${label}"\n\nAllow this action?`);
                            if (!allowed) {
                                throw new Error("Action denied by user.");
                            }
                        }
                    }
                };

                const res = await config.agent.run(args.task);
                return {
                    status: res.status,
                    summary: res.summary
                };
            }
        });
    }
}
