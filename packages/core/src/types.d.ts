// WebMCP and Chrome Prompt API custom types

export interface ILanguageModel {
    prompt: (text: string, options?: { responseConstraint?: any }) => Promise<string>;
    countPromptTokens: (text: string) => Promise<number>;
    clone: () => Promise<ILanguageModel>;
    destroy?: () => void;
    contextWindow?: number;
}

declare global {
    interface Window {
        LanguageModel?: {
            availability?: () => Promise<'available' | 'no' | string>;
            capabilities?: () => Promise<{ available: string }>;
            create: (options: {
                systemPrompt?: string;
                temperature?: number;
                topK?: number;
            }) => Promise<ILanguageModel>;
        };
        ai?: {
            languageModel: {
                create: (options: any) => Promise<ILanguageModel>;
            };
        };
    }

    interface Navigator {
        modelContext?: {
            registerTool(toolDef: {
                name: string;
                description: string;
                inputSchema: any;
                readOnly?: boolean;
                execute: (args: any, context?: { client: any }) => Promise<any>;
            }): void;
        };
    }

    class SubmitEvent extends Event {
        readonly submitter: HTMLElement | null;
        agentInvoked?: boolean;
        respondWith?(response: Promise<any>): void;
    }
}

