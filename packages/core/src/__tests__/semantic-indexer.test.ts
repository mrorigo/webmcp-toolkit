import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticIndexer } from '../semantic-indexer.js';

describe('SemanticIndexer', () => {
    let indexer: SemanticIndexer;

    beforeEach(() => {
        indexer = new SemanticIndexer();
        document.body.innerHTML = '';
    });

    // ─── isActionable ────────────────────────────────────────────────────────

    describe('isActionable', () => {
        it('returns true for <button>', () => {
            const el = document.createElement('button');
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns true for <input> (text)', () => {
            const el = document.createElement('input');
            el.type = 'text';
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns false for <input type="hidden">', () => {
            const el = document.createElement('input');
            el.type = 'hidden';
            expect(indexer.isActionable(el)).toBe(false);
        });

        it('returns true for element with toolname attribute', () => {
            const el = document.createElement('form');
            el.setAttribute('toolname', 'my_tool');
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns true for <a>', () => {
            const el = document.createElement('a');
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns true for [role="button"]', () => {
            const el = document.createElement('div');
            el.setAttribute('role', 'button');
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns true for tabindex element', () => {
            const el = document.createElement('div');
            el.setAttribute('tabindex', '0');
            expect(indexer.isActionable(el)).toBe(true);
        });

        it('returns false for tabindex="-1"', () => {
            const el = document.createElement('div');
            el.setAttribute('tabindex', '-1');
            expect(indexer.isActionable(el)).toBe(false);
        });

        it('returns false for a plain div', () => {
            const el = document.createElement('div');
            expect(indexer.isActionable(el)).toBe(false);
        });
    });

    // ─── assignAgentIds ───────────────────────────────────────────────────────

    describe('assignAgentIds', () => {
        it('assigns sequential data-agent-id to actionable elements', () => {
            document.body.innerHTML = `
                <button>A</button>
                <input type="text" />
                <div></div>
            `;
            indexer.assignAgentIds(document.body);
            expect(document.querySelector('button')?.getAttribute('data-agent-id')).toBe('1');
            expect(document.querySelector('input')?.getAttribute('data-agent-id')).toBe('2');
            expect(indexer.actionableElements.size).toBe(2);
        });

        it('resets IDs on repeated calls', () => {
            document.body.innerHTML = '<button>A</button>';
            indexer.assignAgentIds(document.body);
            indexer.assignAgentIds(document.body);
            expect(document.querySelector('button')?.getAttribute('data-agent-id')).toBe('1');
            expect(indexer.actionableElements.size).toBe(1);
        });
    });

    // ─── getElementLabel ──────────────────────────────────────────────────────

    describe('getElementLabel', () => {
        it('prefers aria-label', () => {
            const el = document.createElement('button');
            el.setAttribute('aria-label', 'Close dialog');
            expect(indexer.getElementLabel(el)).toBe('Close dialog');
        });

        it('uses title when no aria-label', () => {
            const el = document.createElement('input');
            el.setAttribute('title', 'Search');
            expect(indexer.getElementLabel(el)).toBe('Search');
        });

        it('uses associated <label> element by id', () => {
            document.body.innerHTML = `
                <label for="email">Email address</label>
                <input id="email" type="text" />
            `;
            const input = document.querySelector('#email') as HTMLInputElement;
            // jsdom doesn't implement innerText, so query via the label text
            const label = document.querySelector('label[for="email"]') as HTMLLabelElement;
            expect(label.textContent?.trim()).toBe('Email address');
            // The actual label lookup exercises the for-attr branch
            expect(indexer.getElementLabel(input)).toBeTruthy();
        });

        it('uses innerText for buttons', () => {
            document.body.innerHTML = '<button>Submit order</button>';
            const el = document.querySelector('button') as HTMLButtonElement;
            expect(indexer.getElementLabel(el)).toBe('Submit order');
        });

        it('uses placeholder as fallback', () => {
            const el = document.createElement('input');
            el.setAttribute('placeholder', 'Enter city');
            expect(indexer.getElementLabel(el)).toBe('Enter city');
        });

        it('uses name attribute as last resort', () => {
            const el = document.createElement('input');
            el.setAttribute('name', 'phone');
            expect(indexer.getElementLabel(el)).toBe('phone');
        });

        it('returns empty string for unlabelled element', () => {
            const el = document.createElement('div');
            expect(indexer.getElementLabel(el)).toBe('');
        });
    });

    // ─── serializeDOM ─────────────────────────────────────────────────────────

    describe('serializeDOM', () => {
        it('returns no-elements message for empty body', () => {
            const result = indexer.serializeDOM(document.body);
            expect(result).toContain('No actionable elements found.');
        });

        it('includes element IDs and tags in output', () => {
            document.body.innerHTML = '<button>Buy now</button>';
            const result = indexer.serializeDOM(document.body);
            expect(result).toContain('[ID: 1]');
            expect(result).toContain('tag="button"');
        });

        it('includes value for input elements', () => {
            document.body.innerHTML = '<input type="text" value="hello" />';
            const result = indexer.serializeDOM(document.body);
            expect(result).toContain('value="hello"');
        });

        it('suppresses descriptions at compressLevel=1', () => {
            document.body.innerHTML = `
                <form toolname="checkout" tooldescription="Buy items" tooldescription="...">
                    <button>Pay</button>
                </form>
            `;
            const full = indexer.serializeDOM(document.body, 0);
            expect(full).toContain('form_tool=');

            const compressed = indexer.serializeDOM(document.body, 1);
            expect(compressed).not.toContain('desc=');
        });
    });
});
