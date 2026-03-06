import { ILLMProvider } from './ILLMProvider.js';

export interface OpenAIOptions {
    apiKey: string;
    model?: string;
    systemPrompt?: string;
}

export class OpenAIProvider implements ILLMProvider {
    private apiKey: string;
    private model: string;
    private systemPrompt: string;
    private messages: { role: string; content: string }[];

    constructor(options: OpenAIOptions, messages?: { role: string; content: string }[]) {
        this.apiKey = options.apiKey;
        this.model = options.model || "gpt-4o-mini";
        this.systemPrompt = options.systemPrompt || "You are a helpful UI automation agent.";

        if (messages) {
            this.messages = messages;
        } else {
            this.messages = [
                { role: "system", content: this.systemPrompt }
            ];
        }
    }

    async prompt(userPrompt: string, options?: { responseConstraint?: any }): Promise<string> {
        // We append the new prompt
        const currentMessages = [...this.messages, { role: "user", content: userPrompt }];

        const body: any = {
            model: this.model,
            messages: currentMessages,
        };

        if (options?.responseConstraint) {
            // Convert simple responseConstraint to OpenAI structured outputs pattern (JSON Schema)
            // OpenAI requires response_format type json_schema with strict flags.
            body.response_format = {
                type: "json_schema",
                json_schema: {
                    name: "agent_action",
                    description: "The action to take.",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: options.responseConstraint.properties,
                        // Required array needs to include all properties to be strict
                        required: Object.keys(options.responseConstraint.properties),
                        additionalProperties: false
                    }
                }
            };
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const output = data.choices[0].message.content;

        this.messages.push({ role: "user", content: userPrompt });
        this.messages.push({ role: "assistant", content: output });

        return output;
    }

    async countTokens(text: string): Promise<number> {
        // Fast heuristic for gpt models (~4 chars per token)
        return Math.ceil(text.length / 4);
    }

    get contextWindow(): number {
        return 64000; // gpt-4o-mini has 128k context limit, but we want to leave room for the response
    }

    async clone(): Promise<ILLMProvider> {
        // Return a fresh provider with a copied message array
        return new OpenAIProvider(
            { apiKey: this.apiKey, model: this.model, systemPrompt: this.systemPrompt },
            JSON.parse(JSON.stringify(this.messages))
        );
    }

    destroy(): void {
        // No-op for REST
    }
}
