import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeclarativePolyfill } from '../declarative-polyfill.js';
import { WebMCPToolkit } from '../webmcp-toolkit.js';

const setupModelContext = () => {
    const registerTool = vi.fn();
    Object.defineProperty(globalThis, 'window', {
        value: {
            navigator: {
                modelContext: { registerTool }
            },
            SubmitEvent: class SubmitEvent extends Event {
                submitter: Element | null;
                constructor(type: string, init?: any) {
                    super(type, init);
                    this.submitter = init?.submitter ?? null;
                }
            }
        },
        writable: true,
        configurable: true
    });
    return registerTool;
};

const clearModelContext = () => {
    Object.defineProperty(globalThis, 'window', {
        value: { navigator: {} },
        writable: true,
        configurable: true
    });
};

describe('DeclarativePolyfill', () => {
    let toolkit: WebMCPToolkit;

    let polyfill: DeclarativePolyfill | undefined;

    beforeEach(() => {
        document.body.innerHTML = '';
        clearModelContext();
        toolkit = new WebMCPToolkit({ logHandler: vi.fn() });
        // Ensure prototypes are clean
        delete (Event.prototype as any).agentInvoked;
        delete (Event.prototype as any).respondWith;
    });

    afterEach(() => {
        polyfill?.stop();
        polyfill = undefined;
    });

    // ─── start / stop ─────────────────────────────────────────────────────────

    it('stop() disconnects the observer without error', () => {
        setupModelContext();
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        expect(() => polyfill!.stop()).not.toThrow();
    });

    it('logs that polyfill is inactive when native support is detected', () => {
        const logHandler = vi.fn();
        const t = new WebMCPToolkit({ logHandler });
        // Mock native support
        Object.defineProperty(Event.prototype, 'agentInvoked', { value: true, configurable: true });
        polyfill = new DeclarativePolyfill(t);
        polyfill.start();
        expect(logHandler).toHaveBeenCalledWith(expect.stringContaining('Polyfill inactive'), 'info');
        // Cleanup global prototype
        delete (Event.prototype as any).agentInvoked;
    });

    it('polyfills agentInvoked property on SubmitEvent', () => {
        setupModelContext();
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill.start();
        const ev = new (globalThis.window as any).SubmitEvent('submit') as any;
        expect(ev.agentInvoked).toBe(false);
        ev.agentInvoked = true;
        expect(ev.agentInvoked).toBe(true);
    });

    it('falls back to generic Event if SubmitEvent constructor fails', async () => {
        const reg = setupModelContext();
        // Force SubmitEvent to fail
        (globalThis.window as any).SubmitEvent = undefined;

        document.body.innerHTML = '<form toolname="test"><input name="q"></form>';
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill.start();
        await new Promise(r => setTimeout(r, 10));

        const call = reg.mock.calls[0]![0];
        await call.execute({ q: 'fall' }, {});
        // If it got here without crashing, fallback worked
        expect(true).toBe(true);
    });

    it('attaches respondWith to fallback Event if missing', async () => {
        setupModelContext();
        // Make SubmitEvent constructor throw to reach fallback
        (globalThis.window as any).SubmitEvent = function () { throw new Error('fail'); };

        document.body.innerHTML = '<form toolname="test"><input name="q"></form>';
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill.start();
        await new Promise(r => setTimeout(r, 10));

        const reg = (globalThis.window.navigator as any).modelContext.registerTool;
        const call = reg.mock.calls[0]![0];

        // We need to capture the event dispatched
        let capturedEvent: any;
        document.addEventListener('submit', (e) => { capturedEvent = e; }, { once: true });

        await call.execute({ q: 'val' }, {});
        expect(capturedEvent).toBeDefined();
        expect(capturedEvent.respondWith).toBeDefined();
        // Call it to cover the fallback implementation body
        capturedEvent.respondWith(Promise.resolve('ok'));
        expect(capturedEvent._agentResponsePromise).toBeDefined();
    });

    it('registers existing forms on start()', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="search" tooldescription="Search the catalog">
                <input name="query" type="text" toolparamdescription="Search query" required />
                <button type="submit">Go</button>
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        await new Promise(r => setTimeout(r, 10));
        polyfill!.start();
        expect(registerTool).toHaveBeenCalledOnce();
        const call = registerTool.mock.calls[0]?.[0];
        expect(call).toBeDefined();
        expect(call.name).toBe('search');
        expect(call.description).toBe('Search the catalog');
        expect(call.inputSchema.properties.query.type).toBe('string');
        expect(call.inputSchema.required).toContain('query');
    });

    it('skips forms without a toolname', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `<form><input name="q" /></form>`;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        expect(registerTool).not.toHaveBeenCalled();
    });

    it('does not register the same form twice', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="my_tool"><input name="x" /></form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        polyfill!.start(); // second call
        expect(registerTool).toHaveBeenCalledOnce();
    });

    it('infers default description from toolname when tooldescription is absent', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `<form toolname="checkout"><input name="x" /></form>`;
        polyfill = new DeclarativePolyfill(toolkit);
        await new Promise(r => setTimeout(r, 10));
        polyfill!.start();
        const call = registerTool.mock.calls[0]?.[0];
        expect(call).toBeDefined();
        expect(call.description).toContain('checkout');
    });

    // ─── schema inference ─────────────────────────────────────────────────────

    it('maps number inputs to JSON schema number type', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="rate">
                <input name="score" type="number" min="1" max="10" />
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        const schema = registerTool.mock.calls[0]?.[0].inputSchema;
        expect(schema).toBeDefined();
        expect(schema.properties.score.type).toBe('number');
        expect(schema.properties.score.minimum).toBe(1);
        expect(schema.properties.score.maximum).toBe(10);
    });

    it('maps checkbox inputs to boolean', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="subscribe">
                <input name="agree" type="checkbox" />
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        const schema = registerTool.mock.calls[0]?.[0].inputSchema;
        expect(schema).toBeDefined();
        expect(schema.properties.agree.type).toBe('boolean');
    });

    it('maps <select> to enum', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="pick_color">
                <select name="color">
                    <option value="red">Red</option>
                    <option value="blue">Blue</option>
                </select>
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        const schema = registerTool.mock.calls[0]?.[0].inputSchema;
        expect(schema).toBeDefined();
        expect(schema.properties.color.enum).toEqual(['red', 'blue']);
    });

    it('maps <textarea> to string', () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="feedback">
                <textarea name="message" maxlength="500"></textarea>
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        const schema = registerTool.mock.calls[0]?.[0].inputSchema;
        expect(schema).toBeDefined();
        expect(schema.properties.message.type).toBe('string');
        expect(schema.properties.message.maxLength).toBe(500);
    });

    // ─── execute handler ──────────────────────────────────────────────────────

    it('execute fills form fields and dispatches a submit event', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="book">
                <input name="destination" type="text" />
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        const executeHandler = registerTool.mock.calls[0]?.[0].execute;
        expect(executeHandler).toBeDefined();
        const form = document.querySelector('form') as HTMLFormElement;
        const submitSpy = vi.fn();
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submitSpy(e);
        });

        await executeHandler({ destination: 'Paris' });
        const input = form.querySelector('input[name="destination"]') as HTMLInputElement;
        expect(input.value).toBe('Paris');
        expect(submitSpy).toHaveBeenCalledOnce();
    });

    it('execute returns respondWith promise when provided', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `<form toolname="pay"><input name="amount" /></form>`;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        const executeHandler = registerTool.mock.calls[0]?.[0].execute;
        expect(executeHandler).toBeDefined();
        const form = document.querySelector('form') as HTMLFormElement;
        form.addEventListener('submit', (e: any) => {
            e.preventDefault();
            e.respondWith(Promise.resolve({ status: 'paid' }));
        });

        const result = await executeHandler({ amount: '100' });
        expect(result).toEqual({ status: 'paid' });
    });

    it('execute returns filled_waiting_for_user when form not prevented', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `<form toolname="subscribe"><input name="email" /></form>`;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        const executeHandler = registerTool.mock.calls[0]?.[0].execute;
        expect(executeHandler).toBeDefined();
        // Don't intercept the submit event
        const result = await executeHandler({ email: 'test@example.com' });
        expect(result).toEqual({ status: 'filled_waiting_for_user' });
    });

    // ─── MutationObserver (dynamic forms) ─────────────────────────────────────

    it('registers dynamically added forms', async () => {
        const registerTool = setupModelContext();
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        // Dynamically add a form
        const form = document.createElement('form');
        form.setAttribute('toolname', 'dynamic_tool');
        form.innerHTML = '<input name="q" />';
        document.body.append(form);

        // Give MutationObserver a tick
        await new Promise(r => setTimeout(r, 20));
        expect(registerTool).toHaveBeenCalledOnce();
    });

    it('registers nested forms added dynamically', async () => {
        const registerTool = setupModelContext();
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        const div = document.createElement('div');
        div.innerHTML = `
            <form toolname="nested_1"><input name="a"/></form>
            <form toolname="nested_2"><input name="b"/></form>
        `;
        document.body.append(div);

        await new Promise(r => setTimeout(r, 20));
        expect(registerTool).toHaveBeenCalledTimes(2);
    });

    it('re-registers form when toolname attribute is added later', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `<form id="late_form"><input name="q"/></form>`;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();
        expect(registerTool).not.toHaveBeenCalled();

        const form = document.getElementById('late_form') as HTMLFormElement;
        form.setAttribute('toolname', 'late_tool');

        await new Promise(r => setTimeout(r, 20));
        expect(registerTool).toHaveBeenCalledOnce();
        expect(registerTool.mock.calls[0]?.[0].name).toBe('late_tool');
    });

    it('handles toolautosubmit attribute', async () => {
        const registerTool = setupModelContext();
        document.body.innerHTML = `
            <form toolname="auto" toolautosubmit>
                <input name="field" />
            </form>
        `;
        polyfill = new DeclarativePolyfill(toolkit);
        polyfill!.start();

        const executeHandler = registerTool.mock.calls[0]?.[0].execute;
        const form = document.querySelector('form') as HTMLFormElement;
        const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => { });

        const result = await executeHandler({ field: 'val' });
        expect(submitSpy).toHaveBeenCalled();
        expect(result).toEqual({ status: 'submitted' });
    });
});
