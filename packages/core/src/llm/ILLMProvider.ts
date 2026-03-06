export interface ILLMProvider {
    prompt(userPrompt: string, options?: { responseConstraint?: any }): Promise<string>;
    countTokens(text: string): Promise<number>;
    clone(): Promise<ILLMProvider>;
    destroy?(): void;
    readonly contextWindow?: number;
}
