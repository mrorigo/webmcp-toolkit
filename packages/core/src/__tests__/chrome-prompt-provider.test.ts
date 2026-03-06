import { describe, it, expect, vi } from 'vitest';
import { ChromePromptProvider } from '../llm/chrome-prompt-provider.js';

const makeMockSession = (overrides?: Record<string, any>) => ({
    prompt: vi.fn().mockResolvedValue('response'),
    countPromptTokens: vi.fn().mockResolvedValue(42),
    contextWindow: 8192,
    clone: vi.fn().mockResolvedValue({ prompt: vi.fn(), countPromptTokens: vi.fn(), contextWindow: 8192, clone: vi.fn(), destroy: vi.fn() }),
    destroy: vi.fn(),
    ...overrides
});

describe('ChromePromptProvider', () => {
    it('delegates prompt() to the session', async () => {
        const session = makeMockSession();
        const p = new ChromePromptProvider(session);
        const result = await p.prompt('hello', { responseConstraint: { type: 'object' } });
        expect(session.prompt).toHaveBeenCalledWith('hello', { responseConstraint: { type: 'object' } });
        expect(result).toBe('response');
    });

    it('delegates countPromptTokens() to the session', async () => {
        const session = makeMockSession();
        const p = new ChromePromptProvider(session);
        const tokens = await p.countPromptTokens('test text');
        expect(session.countPromptTokens).toHaveBeenCalledWith('test text');
        expect(tokens).toBe(42);
    });

    it('exposes contextWindow from session', () => {
        const session = makeMockSession({ contextWindow: 32_768 });
        const p = new ChromePromptProvider(session);
        expect(p.contextWindow).toBe(32_768);
    });

    it('returns undefined contextWindow when session has none', () => {
        const session = makeMockSession({ contextWindow: undefined });
        const p = new ChromePromptProvider(session);
        expect(p.contextWindow).toBeUndefined();
    });

    it('clone() wraps cloned session in a new ChromePromptProvider', async () => {
        const session = makeMockSession();
        const p = new ChromePromptProvider(session);
        const cloned = await p.clone();
        expect(cloned).toBeInstanceOf(ChromePromptProvider);
        expect(session.clone).toHaveBeenCalledOnce();
    });

    it('destroy() calls session.destroy()', () => {
        const session = makeMockSession();
        const p = new ChromePromptProvider(session);
        p.destroy();
        expect(session.destroy).toHaveBeenCalledOnce();
    });

    it('destroy() does not throw if session.destroy is absent', () => {
        const session = makeMockSession({ destroy: undefined });
        const p = new ChromePromptProvider(session);
        expect(() => p.destroy()).not.toThrow();
    });
});
