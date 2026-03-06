// WebMCP and Chrome Prompt API custom types

declare global {
    interface Window {
        LanguageModel?: {
            availability?: () => Promise<'available' | 'no' | string>;
            capabilities?: () => Promise<{ available: string }>;
            create: (options: any) => Promise<any>;
        };
        ai?: {
            languageModel: any;
        };
    }

    interface Navigator {
        modelContext?: {
            registerTool(toolDef: any): void;
        };
    }

    class SubmitEvent extends Event {
        readonly submitter: HTMLElement | null;
        agentInvoked?: boolean;
        respondWith?(response: any): void;
    }
}

export { };
