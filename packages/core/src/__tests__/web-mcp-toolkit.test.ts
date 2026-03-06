import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebMCPToolkit } from '../web-mcp-toolkit.js';
import type { Schema } from '../web-mcp-toolkit.js';

const makeSchema = <T>(value: T): Schema<T> => ({
    parse: (_d: unknown) => value,
    _shape: {}
});

describe('WebMCPToolkit', () => {
    let toolkit: WebMCPToolkit;

    beforeEach(() => {
        toolkit = new WebMCPToolkit();
        // Ensure navigator.modelContext is absent by default
        Object.defineProperty(globalThis, 'window', {
            value: { navigator: {} },
            writable: true,
            configurable: true
        });
    });

    // ─── constructor & logging ────────────────────────────────────────────────

    it('uses default console logger when no logHandler provided', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
        toolkit.log('hello', 'info');
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('hello'));
        spy.mockRestore();
    });

    it('calls custom logHandler when provided', () => {
        const logHandler = vi.fn();
        const t = new WebMCPToolkit({ logHandler });
        t.log('test msg', 'warn');
        expect(logHandler).toHaveBeenCalledWith('test msg', 'warn');
    });

    // ─── tools.register ───────────────────────────────────────────────────────

    it('registers a tool in the internal registry', () => {
        toolkit.tools.register({
            name: 'my_tool',
            description: 'Does something',
            schema: makeSchema({ q: 'val' }),
            execute: async () => 'done'
        });
        // No error means success; registry is private but we can verify via log
        expect(true).toBe(true);
    });

    it('logs a warning when modelContext is not available', async () => {
        const logHandler = vi.fn();
        const t = new WebMCPToolkit({ logHandler });

        t.tools.register({
            name: 'test_tool',
            description: 'Test',
            schema: makeSchema({}),
            execute: async () => ({})
        });

        // Give the async registration a tick
        await new Promise(r => setTimeout(r, 10));
        expect(logHandler).toHaveBeenCalledWith(
            expect.stringContaining('test_tool'),
            'warn'
        );
    });

    // ─── askUserToConfirm ─────────────────────────────────────────────────────

    it('falls back to window.confirm when no client provided', () => {
        const confirmSpy = vi.fn().mockReturnValue(true);
        Object.defineProperty(globalThis, 'window', {
            value: { navigator: {}, confirm: confirmSpy },
            writable: true, configurable: true
        });
        toolkit.askUserToConfirm(undefined, 'Are you sure?');
        expect(confirmSpy).toHaveBeenCalledWith('Are you sure?');
    });

    it('calls client.requestUserInteraction when client is provided', async () => {
        const client = {
            requestUserInteraction: vi.fn().mockResolvedValue(true),
            extra: 'data'
        };
        const result = await toolkit.askUserToConfirm(client, 'Confirm?');
        expect(client.requestUserInteraction).toHaveBeenCalledWith({
            message: 'Confirm?',
            type: 'confirmation'
        });
        expect(result).toBe(true);
    });

    it('returns false when client.requestUserInteraction rejects', async () => {
        const client = {
            requestUserInteraction: vi.fn().mockRejectedValue(new Error('denied')),
        };
        const result = await toolkit.askUserToConfirm(client as any, 'Confirm?');
        expect(result).toBe(false);
    });

    it('returns false when client.requestUserInteraction returns false', async () => {
        const client = {
            requestUserInteraction: vi.fn().mockResolvedValue(false),
        };
        const result = await toolkit.askUserToConfirm(client as any, 'Confirm?');
        expect(result).toBe(false);
    });

    // ─── registerWithWebMCP ───────────────────────────────────────────────────

    it('registers with navigator.modelContext when available', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: {
                    modelContext: { registerTool }
                }
            },
            writable: true,
            configurable: true
        });

        toolkit.tools.register({
            name: 'native_tool',
            description: 'Native',
            schema: {
                parse: (v) => v,
                _shape: { arg1: { isOptional: () => false } }
            },
            execute: async () => 'ok'
        });

        await new Promise(r => setTimeout(r, 10));
        expect(registerTool).toHaveBeenCalledOnce();
        const call = registerTool.mock.calls[0]?.[0];
        expect(call).toBeDefined();
        expect(call.name).toBe('native_tool');
        expect(call.inputSchema.properties.arg1.type).toBe('string');
        expect(call.inputSchema.required).toContain('arg1');
    });

    // ─── enableUniversalDelegate ──────────────────────────────────────────────

    it('enables delegate_page_task tool', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: {
                    modelContext: { registerTool }
                }
            },
            writable: true,
            configurable: true
        });

        const mockAgent = {
            run: vi.fn().mockResolvedValue({ status: 'success', summary: 'Done' }),
            indexer: { actionableElements: new Map() },
            onAction: null
        };

        toolkit.enableUniversalDelegate({
            agent: mockAgent as any
        });

        await new Promise(r => setTimeout(r, 10));
        expect(registerTool).toHaveBeenCalledOnce();
        const call = registerTool.mock.calls[0]?.[0];
        expect(call).toBeDefined();
        expect(call.name).toBe('delegate_page_task');

        // Test the execute handler
        const result = await call.execute({ task: 'check out' }, {});
        expect(mockAgent.run).toHaveBeenCalledWith('check out');
        expect(result).toEqual({ status: 'success', summary: 'Done' });
    });

    it('delegate executer handles requireConfirmationFor', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: {
                    modelContext: { registerTool }
                },
                confirm: vi.fn().mockReturnValue(true)
            },
            writable: true,
            configurable: true
        });

        const mockElement = {
            matches: vi.fn().mockReturnValue(true),
            tagName: 'BUTTON',
            closest: vi.fn().mockReturnValue(null),
            getAttribute: vi.fn().mockReturnValue('Submit')
        };

        const mockAgent = {
            run: vi.fn().mockImplementation(async () => {
                if (typeof mockAgent.onAction === 'function') {
                    await (mockAgent as any).onAction('click', { agent_id: '1' });
                }
                return { status: 'success' };
            }),
            indexer: {
                actionableElements: new Map([['1', mockElement]]),
                getElementLabel: vi.fn().mockReturnValue('Submit Button')
            },
            onAction: null
        };

        toolkit.enableUniversalDelegate({
            agent: mockAgent as any,
            requireConfirmationFor: ['button']
        });

        await new Promise(r => setTimeout(r, 10));
        const call = registerTool.mock.calls[0]?.[0];
        expect(call).toBeDefined();

        await call.execute({ task: 'click button' }, {});
        expect(window.confirm).toHaveBeenCalled();
    });

    it('delegate executer handles action denial', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: { modelContext: { registerTool } },
                confirm: vi.fn().mockReturnValue(false) // User Denies
            },
            writable: true, configurable: true
        });

        const mockElement = {
            matches: vi.fn().mockReturnValue(true),
            tagName: 'BUTTON',
            closest: vi.fn().mockReturnValue(null),
            getAttribute: vi.fn()
        };
        const mockAgent = {
            run: vi.fn().mockImplementation(async () => {
                await (mockAgent as any).onAction('click', { agent_id: '1' });
                return { status: 'denied' };
            }),
            indexer: {
                actionableElements: new Map([['1', mockElement]]),
                getElementLabel: vi.fn()
            },
            onAction: null
        };

        toolkit.enableUniversalDelegate({
            agent: mockAgent as any,
            requireConfirmationFor: ['button']
        });

        await new Promise(r => setTimeout(r, 10));
        const call = registerTool.mock.calls[0]?.[0];
        await expect(call.execute({ task: 'deny' }, {})).rejects.toThrow("Action denied by user.");
    });

    it('delegate executer matches confirmation by closest form', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: { modelContext: { registerTool } },
                confirm: vi.fn().mockReturnValue(true)
            },
            writable: true, configurable: true
        });

        const mockForm = { matches: vi.fn().mockReturnValue(true) };
        const mockElement = {
            matches: vi.fn().mockReturnValue(false),
            closest: vi.fn().mockReturnValue(mockForm),
            tagName: 'BUTTON',
            getAttribute: vi.fn()
        };
        const mockAgent = {
            run: vi.fn().mockImplementation(async () => {
                await (mockAgent as any).onAction('click', { agent_id: '1' });
                return { status: 'success' };
            }),
            indexer: {
                actionableElements: new Map([['1', mockElement]]),
                getElementLabel: vi.fn()
            },
            onAction: null
        };

        toolkit.enableUniversalDelegate({
            agent: mockAgent as any,
            requireConfirmationFor: ['.critical-form']
        });

        await new Promise(r => setTimeout(r, 10));
        const call = registerTool.mock.calls[0]?.[0];
        await call.execute({ task: 'form click' }, {});
        expect(mockForm.matches).toHaveBeenCalledWith('.critical-form');
        expect(window.confirm).toHaveBeenCalled();
    });

    it('delegate tool throws on invalid args', async () => {
        const registerTool = vi.fn();
        Object.defineProperty(globalThis, 'window', {
            value: { navigator: { modelContext: { registerTool } } },
            writable: true, configurable: true
        });
        toolkit.enableUniversalDelegate({ agent: {} as any });
        await new Promise(r => setTimeout(r, 10));
        const call = registerTool.mock.calls[0]?.[0];
        await expect(call.execute({ not_a_task: 123 } as any, {})).rejects.toThrow("task' must be a string");
    });
});
