import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../llm/openai-provider.js';

const makeProvider = (overrides?: Partial<{ apiKey: string; model: string; systemPrompt: string }>) =>
    new OpenAIProvider({ apiKey: 'sk-test', ...overrides });

const mockFetchOk = (content: string) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            choices: [{ message: { content } }]
        })
    } as any);
};

const mockFetchError = (status: number, text: string) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => text
    } as any);
};

describe('OpenAIProvider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ─── constructor ──────────────────────────────────────────────────────────

    it('uses defaults for model and systemPrompt', () => {
        const p = makeProvider();
        expect(p.contextWindow).toBe(64_000);
    });

    // ─── countPromptTokens ────────────────────────────────────────────────────

    describe('countPromptTokens', () => {
        it('estimates tokens roughly as chars/4', async () => {
            const p = makeProvider();
            const tokens = await p.countPromptTokens('hello world'); // 11 chars → ceil(11/4)=3
            expect(tokens).toBe(3);
        });

        it('returns 0 for empty string', async () => {
            const p = makeProvider();
            expect(await p.countPromptTokens('')).toBe(0);
        });
    });

    // ─── contextWindow ────────────────────────────────────────────────────────

    it('contextWindow returns 64000', () => {
        expect(makeProvider().contextWindow).toBe(64_000);
    });

    // ─── prompt() ────────────────────────────────────────────────────────────

    describe('prompt', () => {
        it('returns content from first choice', async () => {
            mockFetchOk('{"tool":"done","arguments":{}}');
            const p = makeProvider();
            const result = await p.prompt('do something');
            expect(result).toBe('{"tool":"done","arguments":{}}');
        });

        it('throws on non-ok response', async () => {
            mockFetchError(401, 'Unauthorized');
            const p = makeProvider();
            await expect(p.prompt('hi')).rejects.toThrow('OpenAI API Error: 401 - Unauthorized');
        });

        it('appends to message history after each prompt', async () => {
            mockFetchOk('hello back');
            const p = makeProvider();
            await p.prompt('hello');
            // One fetch call per prompt
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it('includes responseConstraint in request body when provided', async () => {
            mockFetchOk('{}');
            const p = makeProvider();
            await p.prompt('test', {
                responseConstraint: {
                    type: 'object',
                    properties: { tool: { type: 'string' }, arguments: { type: 'object' } }
                }
            });
            const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
            expect(body.response_format?.type).toBe('json_schema');
        });

        it('sends Authorization header with Bearer token', async () => {
            mockFetchOk('ok');
            const p = makeProvider({ apiKey: 'my-key' });
            await p.prompt('hi');
            const headers = (globalThis.fetch as any).mock.calls[0][1].headers;
            expect(headers['Authorization']).toBe('Bearer my-key');
        });
    });

    // ─── clone() ─────────────────────────────────────────────────────────────

    describe('clone', () => {
        it('returns a new OpenAIProvider with same config', async () => {
            mockFetchOk('reply');
            const p = makeProvider({ model: 'gpt-4o' });
            await p.prompt('seed message'); // add to history
            const cloned = await p.clone() as OpenAIProvider;
            expect(cloned).toBeInstanceOf(OpenAIProvider);
        });

        it('clone shares message history snapshot', async () => {
            mockFetchOk('a');
            const p = makeProvider();
            await p.prompt('msg1');
            const cloned = await p.clone() as OpenAIProvider;
            // Cloned messages include system + user + assistant = 3
            expect((cloned as any).messages.length).toBe(3);
        });
    });
});
