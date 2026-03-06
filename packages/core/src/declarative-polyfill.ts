import type { WebMCPToolkit } from "./webmcp-toolkit.js";

/**
 * A Polyfill enabling native, HTML-driven declarative WebMCP behavior today.
 * Bypasses ReAct agent loops by directly mapping `<form toolname="...">` semantic tags to the browser's registry.
 */
export class DeclarativePolyfill {
    private toolkit: WebMCPToolkit;
    private observer: MutationObserver;
    private knownForms: Set<HTMLFormElement> = new Set();

    constructor(toolkit: WebMCPToolkit) {
        this.toolkit = toolkit;
        this.observer = new MutationObserver((m) => this.handleMutations(m));
    }

    /**
     * Bootstraps the MutationObserver to live-bind any existing and future WebMCP declarative forms.
     */
    start() {
        if (!this.needsPolyfill()) {
            this.toolkit.log("Browser supports native Declarative WebMCP. Polyfill inactive.", "info");
            return;
        }

        this.toolkit.log("Starting Declarative WebMCP Polyfill Observer...", "info");

        // Scan existing DOM
        for (const f of document.querySelectorAll('form[toolname]')) {
            this.processForm(f as HTMLFormElement);
        }

        // Start observing for new forms
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['toolname', 'tooldescription']
        });

        this.polyfillSubmitEvent();
    }

    /**
     * Halts the polyfill DOM mutation observer.
     */
    stop() {
        this.observer.disconnect();
    }

    private needsPolyfill() {
        const _window = globalThis.window as any | undefined;
        return !Object.getOwnPropertyDescriptor(Event.prototype, 'agentInvoked') &&
            (!_window?.SubmitEvent || !Object.getOwnPropertyDescriptor(_window.SubmitEvent.prototype, 'agentInvoked'));
    }

    private polyfillSubmitEvent() {
        const _window = (globalThis.window as any) || globalThis;
        const Proto = _window.SubmitEvent?.prototype || Event.prototype;

        if (!Object.getOwnPropertyDescriptor(Proto, 'agentInvoked')) {
            Object.defineProperty(Proto, 'agentInvoked', {
                get() { return this._agentInvoked ?? false; },
                set(v) { this._agentInvoked = v; },
                configurable: true
            });
        }

        if (!Object.getOwnPropertyDescriptor(Proto, 'respondWith')) {
            Object.defineProperty(Proto, 'respondWith', {
                value: function (promise: Promise<any>) {
                    this._agentResponsePromise = promise;
                },
                configurable: true,
                writable: true
            });
        }
    }

    private processForm(form: HTMLFormElement) {
        if (this.knownForms.has(form)) return;

        const toolName = form.getAttribute('toolname');
        if (!toolName) return;

        this.knownForms.add(form);
        const description = form.getAttribute('tooldescription') ?? `Submit the ${toolName} form`;

        // Dynamically build JSON Schema based on HTML5 input properties
        // We bypass the typed Zod registry in the SDK and talk directly to the WebMCP layer for purely declarative forms.
        const inputSchema: any = {
            type: "object",
            properties: {},
            required: []
        };

        const inputElements = form.querySelectorAll('input[name], select[name], textarea[name]');
        for (const el of inputElements) {
            const name = el.getAttribute('name');
            if (!name) continue;

            const desc = el.getAttribute('toolparamdescription') ?? '';
            const isRequired = el.hasAttribute('required');

            let propertyDef: any = { description: desc };

            if (el.tagName === 'INPUT') {
                const typeAttr = el.getAttribute('type');
                if (typeAttr === 'number' || typeAttr === 'range') {
                    propertyDef.type = "number";
                    if (el.hasAttribute('min')) propertyDef.minimum = Number(el.getAttribute('min'));
                    if (el.hasAttribute('max')) propertyDef.maximum = Number(el.getAttribute('max'));
                } else if (typeAttr === 'checkbox' || typeAttr === 'radio') {
                    propertyDef.type = "boolean";
                } else {
                    propertyDef.type = "string";
                    if (el.hasAttribute('pattern')) propertyDef.pattern = el.getAttribute('pattern');
                    if (el.hasAttribute('maxlength')) propertyDef.maxLength = Number(el.getAttribute('maxlength'));
                    if (el.hasAttribute('minlength')) propertyDef.minLength = Number(el.getAttribute('minlength'));
                }
            } else if (el.tagName === 'SELECT') {
                propertyDef.type = "string";
                const options = [...(el as HTMLSelectElement).options];
                if (options.length > 0) {
                    propertyDef.enum = options.map(o => o.value || o.text);
                }
            } else {
                propertyDef.type = "string";
                if (el.hasAttribute('maxlength')) propertyDef.maxLength = Number(el.getAttribute('maxlength'));
                if (el.hasAttribute('minlength')) propertyDef.minLength = Number(el.getAttribute('minlength'));
            }

            inputSchema.properties[name] = propertyDef;

            if (isRequired) {
                inputSchema.required.push(name);
            }
        }

        if (globalThis.window.navigator && (globalThis.window.navigator as unknown as { modelContext: any }).modelContext) {
            (globalThis.window.navigator as unknown as { modelContext: any }).modelContext.registerTool({
                name: toolName,
                description: description,
                inputSchema: inputSchema,
                execute: async (args: Record<string, unknown>) => {
                    this.toolkit.log(`Declarative Polyfill invoked for form: ${toolName}`, "info");

                    // 1. Fill out the form fields with the agent's provided args
                    for (const [key, val] of Object.entries(args)) {
                        const el = form.querySelector(`[name="${key}"]`) as HTMLInputElement;
                        if (el) {
                            el.value = String(val);
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }

                    let submitEvent: Event;
                    try {
                        submitEvent = new (globalThis.window as any).SubmitEvent('submit', {
                            bubbles: true,
                            cancelable: true,
                            submitter: form.querySelector('button[type="submit"], input[type="submit"]')
                        });
                    } catch {
                        // Fallback for older browsers
                        submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                    }

                    // Attach polyfill properties
                    (submitEvent as any)._agentInvoked = true;
                    (submitEvent as any).agentInvoked = true;

                    // Ensure respondWith is definitely there for the implementation to use
                    if (!(submitEvent as any).respondWith) {
                        (submitEvent as any).respondWith = (promise: Promise<any>) => {
                            (submitEvent as any)._agentResponsePromise = promise;
                        };
                    }

                    form.dispatchEvent(submitEvent);

                    // 3. Resolve respondWith if handled by JS
                    if ((submitEvent as any)._agentResponsePromise) {
                        return await (submitEvent as any)._agentResponsePromise;
                    }

                    // 4. Fallback if not prevented (not handled perfectly in polyfill without true nav interception)
                    if (!submitEvent.defaultPrevented) {
                        if (form.hasAttribute('toolautosubmit')) {
                            this.toolkit.log("Form natively submitting due to toolautosubmit...", "warning");
                            form.submit();
                            return { status: "submitted" };
                        } else {
                            return { status: "filled_waiting_for_user" };
                        }
                    }

                    return { status: "success" };
                }
            });
            this.toolkit.log(`Polyfill registered declarative form '${toolName}' as WebMCP tool`, "success");
        }
    }

    private handleMutations(mutations: MutationRecord[]) {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        if (el.tagName === 'FORM' && el.hasAttribute('toolname')) {
                            this.processForm(el as HTMLFormElement);
                        } else {
                            for (const f of el.querySelectorAll('form[toolname]')) {
                                this.processForm(f as HTMLFormElement);
                            }
                        }
                    }
                }
            } else if (mutation.type === 'attributes') {
                const el = mutation.target as HTMLElement;
                if (el.tagName === 'FORM' && el.hasAttribute('toolname')) {
                    // Re-register if attributes changed heavily (simplification)
                    this.processForm(el as HTMLFormElement);
                }
            }
        }
    }
}
