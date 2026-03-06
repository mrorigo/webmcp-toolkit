import { ILLMProvider } from './ILLMProvider.js';

export class ChromePromptProvider implements ILLMProvider {
    session: any;

    constructor(session: any) {
        this.session = session;
    }

    async prompt(userPrompt: string, options?: { responseConstraint?: any }): Promise<string> {
        return await this.session.prompt(userPrompt, options);
    }

    async countTokens(text: string): Promise<number> {
        return await this.session.countPromptTokens(text);
    }

    get contextWindow(): number | undefined {
        return this.session.contextWindow;
    }

    async clone(): Promise<ILLMProvider> {
        return new ChromePromptProvider(await this.session.clone());
    }

    destroy(): void {
        if (typeof this.session.destroy === 'function') {
            this.session.destroy();
        }
    }
}
