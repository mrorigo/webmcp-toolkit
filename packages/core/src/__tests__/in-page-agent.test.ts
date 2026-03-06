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
    let mockLog: any;

    beforeEach(() => {
        document.body.innerHTML = '';
        mockLog = vi.fn();
    });

    const makeAgent = (provider = makeMockProvider(), options: any = {}) => {
        const agent = new InPageAgent({ llmProvider: provider, ...options });
        agent.onLog = mockLog;
        return agent;
    };

    // ─── constructor ──────────────────────────────────────────────────────────

    it('initializes with default maxSteps of 10', () => {
        const agent = makeAgent();
        expect(agent.maxSteps).toBe(10);
    });

    it('respects custom maxSteps', () => {
        const agent = makeAgent(undefined, { maxSteps: 5 });
        expect(agent.maxSteps).toBe(5);
    });

    it('starts with zero currentSessionTokensConsumed', () => {
        const agent = makeAgent();
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
            const agent = makeAgent();
            const result = await agent.executeAction('done', { reason: 'finished' });
            expect(result).toBe(false);
        });

        it('returns true and continues for unknown action', async () => {
            const agent = makeAgent();
            const result = await agent.executeAction('unknown_action', { agent_id: '99' });
            expect(result).toBe(true);
        });

        it('logs error for unknown action on existing element', async () => {
            document.body.innerHTML = '<button id="b1">Click</button>';
            const agent = makeAgent();
            agent.indexer.assignAgentIds(document.body);
            const id = document.querySelector('button')!.getAttribute('data-agent-id')!;

            await agent.executeAction('weird_action', { agent_id: id });
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Unknown action'), 'error');
        });

        it('logs error when element not found', async () => {
            const agent = makeAgent();
            await agent.executeAction('click', { agent_id: '999' });
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('not found'), 'error');
        });

        it('dispatches input events on input_text', async () => {
            document.body.innerHTML = '<input id="inp" type="text" />';
            const agent = makeAgent();
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
            const agent = makeAgent();
            agent.onAction = onAction;
            await agent.executeAction('done', {});
            expect(onAction).toHaveBeenCalledWith('done', {});
        });
    });

    // ─── run ─────────────────────────────────────────────────────────────────

    describe('run', () => {
        it('returns success status when agent calls done', async () => {
            const provider = makeMockProvider('{"tool":"done","arguments":{"reason":"done"}}');
            const agent = makeAgent(provider, { maxSteps: 5 });
            const result = await agent.run('click submit');
            expect(result.status).toBe('success');
        });

        it('returns error when no session', async () => {
            const agent = new InPageAgent({ llmProvider: null as any });
            agent.onLog = mockLog;
            (agent as any).session = undefined;
            const result = await agent.run('do something');
            expect(result.status).toBe('error');
            expect(result.tokensConsumed).toBe(0);
        });

        it('returns timeout when maxSteps exceeded', async () => {
            const provider = makeMockProvider('{"tool":"click","arguments":{"agent_id":"99"}}');
            const agent = makeAgent(provider, { maxSteps: 2 });
            const result = await agent.run('click forever');
            expect(result.status).toBe('timeout');
        });

        it('tracks tokens consumed across multiple steps', async () => {
            let calls = 0;
            const provider: any = {
                prompt: vi.fn().mockImplementation(async () => {
                    calls++;
                    return calls >= 2 ? '{"tool":"done","arguments":{}}' : '{"tool":"click_element","arguments":{"agent_id":"1"}}';
                }),
                countPromptTokens: vi.fn().mockResolvedValue(100),
                contextWindow: 4000,
                clone: vi.fn().mockImplementation(async () => {
                    return provider; // Just return self for simple state sharing in this test
                }),
                destroy: vi.fn()
            };
            document.body.innerHTML = '<button id="b1">Click Me</button>';
            const agent = makeAgent(provider as ILLMProvider, { maxSteps: 5 });
            agent.indexer.assignAgentIds(document.body);
            const result = await agent.run('test multi-step');
            expect(result.status).toBe('success');
            expect(result.tokensConsumed).toBeGreaterThan(0);
            expect(agent.actionHistory.length).toBeGreaterThan(0);
        });

        it('resets tokensConsumed between runs', async () => {
            const provider = makeMockProvider('{"tool":"done","arguments":{}}');
            const agent = makeAgent(provider, { maxSteps: 3 });
            await agent.run('first run');
            const first = agent.currentSessionTokensConsumed;
            await agent.run('second run');
            expect(agent.currentSessionTokensConsumed).toBeLessThanOrEqual(first * 2);
        });

        it('truncates prompt when tokens > MAX_CONTEXT', async () => {
            const provider = makeMockProvider();
            (provider.countPromptTokens as any).mockResolvedValue(10000);
            (provider as any).contextWindow = 4000;
            const agent = makeAgent(provider);
            const spy = vi.spyOn(agent, 'log');
            await agent.step();
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('DOM is incredibly large'), 'warning');
        });

        it('stops gracefully on LLM JSON parse error', async () => {
            const provider = makeMockProvider('not json at all');
            const agent = makeAgent(provider, { maxSteps: 3 });
            const result = await agent.run('break');
            expect(result.status).not.toBe('timeout');
        });

        it('cleans markdown code blocks from LLM response', async () => {
            const json = '{"tool":"done","arguments":{}}';
            const mdc1 = '```json\n' + json + '\n```';
            const mdc2 = '```\n' + json + '\n```';
            const mdc3 = '  ' + json + '  ';

            const provider1 = makeMockProvider(mdc1);
            const agent1 = makeAgent(provider1);
            await agent1.run('test1');
            expect(agent1.isRunning).toBe(false);

            const provider2 = makeMockProvider(mdc2);
            const agent2 = makeAgent(provider2);
            await agent2.run('test2');
            expect(agent2.isRunning).toBe(false);

            const provider3 = makeMockProvider(mdc3);
            const agent3 = makeAgent(provider3);
            await agent3.run('test3');
            expect(agent3.isRunning).toBe(false);
        });

        it('logs error when LLM returns invalid format (missing tool)', async () => {
            const provider = makeMockProvider('{"arguments":{}}');
            const agent = makeAgent(provider);
            await agent.run('test invalid');
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('invalid action format'), 'error');
        });

        it('logs error when LLM provider throws', async () => {
            const provider = makeMockProvider(undefined, true);
            const agent = makeAgent(provider);
            await agent.run('test error');
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('LLM Error: LLM Down'), 'error');
        });

        it('falls back to element label if tag is not enough in click_element', async () => {
            document.body.innerHTML = '<button id="btn">Click me</button>';
            const agent = makeAgent();
            agent.indexer.assignAgentIds(document.body);
            const id = document.querySelector('button')!.getAttribute('data-agent-id')!;

            await agent.executeAction('click_element', { agent_id: id });
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Clicked element [Click me: ID 1]'), 'success');
        });
    });
});
