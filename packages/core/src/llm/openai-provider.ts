import type { ILLMProvider } from "./illm-provider.js";

export interface OpenAIOptions {
    apiKey: string;
    model?: string;
    systemPrompt?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful UI automation agent.";
const CHARS_PER_TOKEN = 4;
const CONTEXT_WINDOW_LIMIT = 64_000;
const FIRST_CHOICE_INDEX = 0;

export class OpenAIProvider implements ILLMProvider {
    private apiKey: string;
    private model: string;
    private systemPrompt: string;
    private messages: { role: string; content: string }[] = [];

    constructor(options: OpenAIOptions) {
        this.apiKey = options.apiKey;
        this.model = options.model ?? DEFAULT_MODEL;
        this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
        this.messages = [
            { content: this.systemPrompt, role: "system" }
        ];
    }

    async prompt(userPrompt: string, options?: { responseConstraint?: any }): Promise<string> {
        // We append the new prompt
        const currentMessages = [...this.messages, { content: userPrompt, role: "user" }];

        const body: any = {
            messages: currentMessages,
            model: this.model,
        };

        if (options?.responseConstraint) {
            // OpenAI requires response_format type json_schema with strict flags.
            body.response_format = {
                json_schema: {
                    description: "The action to take.",
                    name: "agent_action",
                    schema: {
                        additionalProperties: false,
                        properties: options.responseConstraint.properties,
                        // Required array needs to include all properties to be strict
                        required: Object.keys(options.responseConstraint.properties),
                        type: "object",
                    },
                    strict: true,
                },
                type: "json_schema",
            };
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            body: JSON.stringify(body),
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            method: "POST",
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const output = data.choices?.[FIRST_CHOICE_INDEX]?.message?.content ?? "";

        this.messages.push(
            { content: userPrompt, role: "user" },
            { content: output, role: "assistant" }
        );

        return output;
    }

    async countPromptTokens(text: string): Promise<number> {
        // Very rough estimation: 4 chars per token
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }

    get contextWindow(): number {
        return CONTEXT_WINDOW_LIMIT; // gpt-4o-mini has 128k context limit, but we want to leave room for the response
    }

    async clone(): Promise<ILLMProvider> {
        const cloned = new OpenAIProvider({
            apiKey: this.apiKey,
            model: this.model,
            systemPrompt: this.systemPrompt
        });
        cloned.messages = [...this.messages];
        return cloned;
    }
}
