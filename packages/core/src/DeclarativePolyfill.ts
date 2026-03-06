import { WebMCPToolkit } from "./WebMCPToolkit.js";

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
        this.observer = new MutationObserver(this.handleMutations.bind(this));
    }

    /**
     * Bootstraps the MutationObserver to live-bind any existing and future WebMCP declarative forms.
     */
    start() {
        if (!this.needsPolyfill()) {
            this.toolkit['log']("Browser supports native Declarative WebMCP. Polyfill inactive.", "info");
            return;
        }

        this.toolkit['log']("Starting Declarative WebMCP Polyfill Observer...", "info");

        // Scan existing DOM
        document.querySelectorAll('form[toolname]').forEach(f => this.processForm(f as HTMLFormElement));

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
        const _window = typeof window !== 'undefined' ? window as any : null;
        return typeof Object.getOwnPropertyDescriptor(Event.prototype, 'agentInvoked') === 'undefined' &&
            (_window && _window.SubmitEvent && typeof Object.getOwnPropertyDescriptor(_window.SubmitEvent.prototype, 'agentInvoked') === 'undefined');
    }

    private polyfillSubmitEvent() {
        // We override the global window.SubmitEvent to add agentInvoked and respondWith
        if (typeof window.SubmitEvent !== 'undefined') {
            const originalSubmitEvent = window.SubmitEvent;

            // Allow modifying the event objects
            Object.defineProperty(originalSubmitEvent.prototype, 'agentInvoked', {
                get() { return this._agentInvoked || false; },
                set(v) { this._agentInvoked = v; },
                configurable: true
            });

            Object.defineProperty(originalSubmitEvent.prototype, 'respondWith', {
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
        const description = form.getAttribute('tooldescription') || `Submit the ${toolName} form`;

        // Very basic JSON representation since we lack full Zod integration for dynamic generation here
        // We bypass the typed Zod registry in the SDK and talk directly to the WebMCP layer for purely declarative forms.
        const inputSchema: any = {
            type: "object",
            properties: {},
            required: []
        };

        const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
        inputs.forEach(el => {
            const name = el.getAttribute('name');
            if (!name) return;

            const desc = el.getAttribute('toolparamdescription') || '';
            const isRequired = el.hasAttribute('required');

            inputSchema.properties[name] = {
                type: "string",
                description: desc
            };

            if (isRequired) {
                inputSchema.required.push(name);
            }
        });

        if (typeof window.navigator !== "undefined" && (window.navigator as any).modelContext) {
            (window.navigator as any).modelContext.registerTool({
                name: toolName,
                description: description,
                inputSchema: inputSchema,
                execute: async (args: any) => {
                    this.toolkit['log'](`Declarative Polyfill invoked for form: ${toolName}`, "info");

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
                        submitEvent = new (window as any).SubmitEvent('submit', {
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

                    form.dispatchEvent(submitEvent);

                    // 3. Resolve respondWith if handled by JS
                    if ((submitEvent as any)._agentResponsePromise) {
                        return await (submitEvent as any)._agentResponsePromise;
                    }

                    // 4. Fallback if not prevented (not handled perfectly in polyfill without true nav interception)
                    if (!submitEvent.defaultPrevented) {
                        if (form.hasAttribute('toolautosubmit')) {
                            this.toolkit['log']("Form natively submitting due to toolautosubmit...", "warning");
                            form.submit();
                            return { status: "submitted" };
                        } else {
                            return { status: "filled_waiting_for_user" };
                        }
                    }

                    return { status: "success" };
                }
            });
            this.toolkit['log'](`Polyfill registered declarative form '${toolName}' as WebMCP tool`, "success");
        }
    }

    private handleMutations(mutations: MutationRecord[]) {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        if (el.tagName === 'FORM' && el.hasAttribute('toolname')) {
                            this.processForm(el as HTMLFormElement);
                        } else {
                            el.querySelectorAll('form[toolname]').forEach(f => this.processForm(f as HTMLFormElement));
                        }
                    }
                });
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
