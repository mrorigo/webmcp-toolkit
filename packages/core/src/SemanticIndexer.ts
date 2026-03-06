/**
 * Semantic DOM Indexer.
 * Navigates the current DOM, identifying actionable elements, injecting tracking metadata (`data-agent-id`),
 * and serializing the entire visual structure into a highly compressed semantic string format designed for Language Models.
 */
export class SemanticIndexer {
    nextAgentId: number = 1;
    actionableElements: Map<string, HTMLElement> = new Map();

    isActionable(element: HTMLElement): boolean {
        if (element.hasAttribute('toolname')) return true;

        const tagName = element.tagName.toLowerCase();
        if (['input', 'button', 'select', 'textarea', 'a'].includes(tagName)) {
            if ((element as HTMLInputElement).type === 'hidden') return false;
            return true;
        }

        const role = element.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'textbox') return true;

        if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return true;

        return false;
    }

    assignAgentIds(root: HTMLElement = document.body) {
        this.nextAgentId = 1;
        this.actionableElements.clear();

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node: Node) => {
                    return this.isActionable(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        let currentNode: Node | null = walker.currentNode;
        while (currentNode) {
            if (this.isActionable(currentNode as HTMLElement)) {
                const idStr = this.nextAgentId.toString();
                (currentNode as HTMLElement).setAttribute('data-agent-id', idStr);
                this.actionableElements.set(idStr, currentNode as HTMLElement);
                this.nextAgentId++;
            }
            currentNode = walker.nextNode();
        }
    }

    getElementLabel(element: HTMLElement): string {
        if (element.hasAttribute('aria-label')) return element.getAttribute('aria-label') || '';
        if (element.hasAttribute('title')) return element.getAttribute('title') || '';

        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`) as HTMLElement;
            if (label) return label.innerText.trim();
        }

        const tagName = element.tagName.toLowerCase();
        if (['button', 'a'].includes(tagName)) {
            return element.innerText.trim();
        }

        if (element.hasAttribute('placeholder')) return element.getAttribute('placeholder') || '';
        if (element.hasAttribute('name')) return element.getAttribute('name') || '';

        return '';
    }

    serializeActionableElement(element: HTMLElement, compressLevel: number = 0): string {
        const agentId = element.getAttribute('data-agent-id');
        const tagName = element.tagName.toLowerCase();
        let props: string[] = [];

        if (element.hasAttribute('toolname')) {
            props.push(`form_tool="${element.getAttribute('toolname')}"`);
            if (compressLevel < 1 && element.hasAttribute('tooldescription')) {
                props.push(`desc="${element.getAttribute('tooldescription')}"`);
            }
        } else {
            props.push(`tag="${tagName}"`);
        }

        const type = element.getAttribute('type');
        if (type && !element.hasAttribute('toolname')) props.push(`type="${type}"`);

        const label = this.getElementLabel(element);
        if (label) props.push(`label="${label}"`);

        if (compressLevel < 1 && element.hasAttribute('toolparamdescription')) {
            props.push(`param_desc="${element.getAttribute('toolparamdescription')}"`);
        }

        if (compressLevel < 2 && element.hasAttribute('required')) {
            props.push(`required`);
        }

        if (['input', 'textarea', 'select'].includes(tagName)) {
            const val = (element as HTMLInputElement).value;
            if (val) {
                props.push(`value="${val}"`);
            } else {
                props.push(`value="(empty)"`);
            }
        }

        return `[ID: ${agentId}] ${props.join(', ')}`;
    }

    /**
     * Traverses the live document body and produces a massive, syntactically-dense 
     * string representation of the current actionable landscape.
     * 
     * @param root The HTML element to start tracking from. Defaults to document.body.
     * @param compressLevel (0-2) Drives increasingly aggressive semantic pruning to conserve LLM context tokens.
     */
    serializeDOM(root: HTMLElement = document.body, compressLevel: number = 0): string {
        this.assignAgentIds(root);

        let lines: string[] = [];
        lines.push("Observation:");
        lines.push("The page contains the following interactive elements.");
        lines.push("-----------------------------------------------------");

        if (this.actionableElements.size === 0) {
            lines.push("No actionable elements found.");
            return lines.join('\n');
        }

        for (const element of this.actionableElements.values()) {
            lines.push(this.serializeActionableElement(element, compressLevel));
        }

        lines.push("-----------------------------------------------------");
        return lines.join('\n');
    }
}
