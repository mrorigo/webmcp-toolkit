import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InPageAgent } from '../in-page-agent.js';
import type { ILLMProvider } from '../llm/illm-provider.js';

const makeMockProvider = (response = '{"tool":"done","arguments":{"reason":"task complete"}}', shouldFail = false): ILLMProvider => ({
    prompt: shouldFail ? vi.fn().mockRejectedValue(new Error("LLM Down")) : vi.fn().mockResolvedValue(response),
    countPromptTokens: vi.fn().mockResolvedValue(50),
    contextWindow: 4000,
    clone: vi.fn().mockImplementation(async function (this: any) {
        return makeMockProvider(response, shouldFail);
    }),
    destroy: vi.fn()
});

describe('InPageAgent', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    // ─── constructor ──────────────────────────────────────────────────────────

    it('initializes with default maxSteps of 10', () => {
        const agent = new InPageAgent({ llmProvider: makeMockProvider() });
        expect(agent.maxSteps).toBe(10);
    });

    it('respects custom maxSteps', () => {
        const agent = new InPageAgent({ llmProvider: makeMockProvider(), maxSteps: 5 });
        expect(agent.maxSteps).toBe(5);
    });

    it('starts with zero currentSessionTokensConsumed', () => {
        const agent = new InPageAgent({ llmProvider: makeMockProvider() });
        expect(agent.currentSessionTokensConsumed).toBe(0);
    });

    // ─── log ─────────────────────────────────────────────────────────────────

    it('falls back to console.log when no onLog handler', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const agent = new InPageAgent({ llmProvider: makeMockProvider() });
        agent.log('test', 'info');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('calls onLog handler when set', () => {
        const handler = vi.fn();
        const agent = new InPageAgent({ llmProvider: makeMockProvider() });
        agent.onLog = handler;
        agent.log('msg', 'error');
        expect(handler).toHaveBeenCalledWith('msg', 'error');
    });

    // ─── executeAction ────────────────────────────────────────────────────────

    describe('executeAction', () => {
        it('returns false for "done" action', async () => {
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            const result = await agent.executeAction('done', { reason: 'finished' });
            expect(result).toBe(false);
        });

        it('returns true and continues for unknown action', async () => {
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            const result = await agent.executeAction('unknown_action', { agent_id: '99' });
            expect(result).toBe(true);
        });

        it('logs error when element not found', async () => {
            const handler = vi.fn();
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            agent.onLog = handler;
            await agent.executeAction('click', { agent_id: '999' });
            expect(handler).toHaveBeenCalledWith(expect.stringContaining('not found'), 'error');
        });

        it('dispatches input events on input_text', async () => {
            document.body.innerHTML = '<input id="inp" type="text" />';
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            agent.indexer.assignAgentIds(document.body);
            const id = document.querySelector('input')!.getAttribute('data-agent-id')!;

            const dispatchSpy = vi.spyOn(document.querySelector('input')!, 'dispatchEvent');
            vi.useFakeTimers();
            const promise = agent.executeAction('input_text', { agent_id: id, text: 'hello' });
            vi.runAllTimersAsync();
            await promise;
            expect(dispatchSpy).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('calls onAction hook before executing', async () => {
            const onAction = vi.fn().mockResolvedValue(undefined);
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            agent.onAction = onAction;
            await agent.executeAction('done', {});
            expect(onAction).toHaveBeenCalledWith('done', {});
        });
    });

    // ─── run ─────────────────────────────────────────────────────────────────

    describe('run', () => {
        it('returns success status when agent calls done', async () => {
            const provider = makeMockProvider('{"tool":"done","arguments":{"reason":"done"}}');
            const agent = new InPageAgent({ llmProvider: provider, maxSteps: 5 });
            const result = await agent.run('click submit');
            expect(result.status).toBe('success');
        });

        it('returns error when no session', async () => {
            const agent = new InPageAgent({ llmProvider: null as any });
            (agent as any).session = undefined;
            const result = await agent.run('do something');
            expect(result.status).toBe('error');
            expect(result.tokensConsumed).toBe(0);
        });

        it('returns timeout when maxSteps exceeded', async () => {
            // Provider never returns "done"
            const provider = makeMockProvider('{"tool":"click","arguments":{"agent_id":"99"}}');
            const agent = new InPageAgent({ llmProvider: provider, maxSteps: 2 });
            const result = await agent.run('click forever');
            expect(result.status).toBe('timeout');
        });

        it('accumulates tokensConsumed across steps', async () => {
            let calls = 0;
            const provider: ILLMProvider = {
                prompt: vi.fn().mockImplementation(async () => {
                    calls++;
                    return calls >= 2 ? '{"tool":"done","arguments":{}}' : '{"tool":"click","arguments":{"agent_id":"99"}}';
                }),
                countPromptTokens: vi.fn().mockResolvedValue(100),
                contextWindow: 4000,
                clone: vi.fn().mockResolvedValue({
                    prompt: vi.fn().mockResolvedValue('{"tool":"done","arguments":{}}'),
                    countPromptTokens: vi.fn().mockResolvedValue(100),
                    contextWindow: 4000,
                    clone: vi.fn(),
                    destroy: vi.fn()
                }),
                destroy: vi.fn()
            };
            const agent = new InPageAgent({ llmProvider: provider, maxSteps: 5 });
            const result = await agent.run('test task');
            expect(result.tokensConsumed).toBeGreaterThan(0);
        });

        it('resets tokensConsumed between runs', async () => {
            const provider = makeMockProvider('{"tool":"done","arguments":{}}');
            const agent = new InPageAgent({ llmProvider: provider, maxSteps: 3 });
            await agent.run('first run');
            const first = agent.currentSessionTokensConsumed;
            await agent.run('second run');
            // Should be reset and re-accumulated, not double-counted
            expect(agent.currentSessionTokensConsumed).toBeLessThanOrEqual(first * 2);
        });

        it('stops gracefully on LLM JSON parse error', async () => {
            const provider = makeMockProvider('not json at all');
            const agent = new InPageAgent({ llmProvider: provider, maxSteps: 3 });
            const result = await agent.run('break');
            expect(result.status).not.toBe('timeout');
        });

        it('logs error when LLM returns invalid format (missing tool)', async () => {
            const handler = vi.fn();
            const provider = makeMockProvider('{"arguments":{}}');
            const agent = new InPageAgent({ llmProvider: provider });
            agent.onLog = handler;
            await agent.run('test invalid');
            expect(handler).toHaveBeenCalledWith(expect.stringContaining('invalid action format'), 'error');
        });

        it('logs error when LLM provider throws', async () => {
            const handler = vi.fn();
            const provider = makeMockProvider(undefined, true);
            const agent = new InPageAgent({ llmProvider: provider });
            agent.onLog = handler;
            await agent.run('test error');
            expect(handler).toHaveBeenCalledWith(expect.stringContaining('LLM Error: LLM Down'), 'error');
        });

        it('falls back to element label if tag is not enough in click_element', async () => {
            document.body.innerHTML = '<button id="btn">Click me</button>';
            const logHandler = vi.fn();
            const agent = new InPageAgent({ llmProvider: makeMockProvider() });
            agent.onLog = logHandler;
            agent.indexer.assignAgentIds(document.body);
            const id = document.querySelector('button')!.getAttribute('data-agent-id')!;

            await agent.executeAction('click_element', { agent_id: id });
            expect(logHandler).toHaveBeenCalledWith(expect.stringContaining('Clicked element [Click me: ID 1]'), 'success');
        });
    });
});
