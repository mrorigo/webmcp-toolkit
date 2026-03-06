export interface ILLMProvider {
    prompt(userPrompt: string, options?: { responseConstraint?: any }): Promise<string>;
    countPromptTokens(text: string): Promise<number>;
    clone(): Promise<ILLMProvider>;
    destroy?(): void;
    readonly contextWindow?: number | undefined;
}
