/**
 * Universal WebMCP Agent - Semantic DOM Indexer (Phase 1.2)
 * 
 * Traverses the DOM, assigns ephemeral IDs to actionable elements,
 * and serializes the state into a text representation for the LLM
 * to consume during its 'Observation' phase.
 */

class SemanticIndexer {
    constructor() {
        this.nextAgentId = 1;
        this.actionableElements = new Map(); // string id -> HTMLElement
    }

    isActionable(element) {
        // High priority: Elements tagged explicitly for WebMCP form/tool usage
        if (element.hasAttribute('toolname')) return true;

        const tagName = element.tagName.toLowerCase();
        if (['input', 'button', 'select', 'textarea', 'a'].includes(tagName)) {
            // Ignore hidden fields
            if (element.type === 'hidden') return false;
            return true;
        }

        // Roles that usually represent interactivity
        const role = element.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'textbox') return true;

        if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return true;

        return false;
    }

    assignAgentIds(root = document.body) {
        this.nextAgentId = 1;
        this.actionableElements.clear();

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return this.isActionable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        let currentNode = walker.currentNode;
        while (currentNode) {
            if (this.isActionable(currentNode)) {
                const idStr = this.nextAgentId.toString();
                currentNode.setAttribute('data-agent-id', idStr);
                this.actionableElements.set(idStr, currentNode);
                this.nextAgentId++;
            }
            currentNode = walker.nextNode();
        }
    }

    getElementLabel(element) {
        if (element.hasAttribute('aria-label')) return element.getAttribute('aria-label');
        if (element.hasAttribute('title')) return element.getAttribute('title');

        // Check for an associated <label> using id
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) return label.innerText.trim();
        }

        // Fallback for buttons and links: inner text
        const tagName = element.tagName.toLowerCase();
        if (['button', 'a'].includes(tagName)) {
            return element.innerText.trim();
        }

        // Placeholders and names
        if (element.hasAttribute('placeholder')) return element.getAttribute('placeholder');
        if (element.hasAttribute('name')) return element.getAttribute('name');

        return '';
    }

    serializeActionableElement(element) {
        const agentId = element.getAttribute('data-agent-id');
        const tagName = element.tagName.toLowerCase();
        let props = [];

        // Special case for our declarative WebMCP form tools
        if (element.hasAttribute('toolname')) {
            props.push(`form_tool="${element.getAttribute('toolname')}"`);
            if (element.hasAttribute('tooldescription')) {
                props.push(`desc="${element.getAttribute('tooldescription')}"`);
            }
        } else {
            props.push(`tag="${tagName}"`);
        }

        // Standard HTML inputs
        const type = element.getAttribute('type');
        if (type && !element.hasAttribute('toolname')) props.push(`type="${type}"`);

        const label = this.getElementLabel(element);
        if (label) props.push(`label="${label}"`);

        if (element.hasAttribute('toolparamdescription')) {
            props.push(`param_desc="${element.getAttribute('toolparamdescription')}"`);
        }

        if (element.hasAttribute('required')) {
            props.push(`required`);
        }

        // Current state for inputs
        if (['input', 'textarea', 'select'].includes(tagName)) {
            const val = element.value;
            if (val) {
                props.push(`value="${val}"`);
            } else {
                props.push(`value="(empty)"`);
            }
        }

        return `[ID: ${agentId}] ${props.join(', ')}`;
    }

    serializeDOM(root = document.body) {
        this.assignAgentIds(root);

        let lines = [];
        lines.push("Observation:");
        lines.push("The page contains the following interactive elements.");
        lines.push("-----------------------------------------------------");

        if (this.actionableElements.size === 0) {
            lines.push("No actionable elements found.");
            return lines.join('\n');
        }

        for (const [id, element] of this.actionableElements.entries()) {
            lines.push(this.serializeActionableElement(element));
        }

        lines.push("-----------------------------------------------------");
        return lines.join('\n');
    }
}

// ----------------------------------------------------
// Playground Integration
// ----------------------------------------------------

// Expose globally for the playground
window.AgentIndexer = new SemanticIndexer();

function updateLog() {
    const logEl = document.getElementById('log');
    if (!logEl) return;

    // Parse DOM and generate the prompt state
    const domState = window.AgentIndexer.serializeDOM();
    logEl.textContent = domState;
}

// Initial index and serialization on load
window.addEventListener('DOMContentLoaded', () => {
    updateLog();

    // Provide real-time feedback in the playground log
    // Whenever an input changes, re-serialize DOM to show updated state.
    document.addEventListener('input', () => updateLog());
});
