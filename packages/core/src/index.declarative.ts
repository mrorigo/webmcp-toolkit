/**
 * Declarative-only entry point.
 * Includes WebMCPToolkit and DeclarativePolyfill — no InPageAgent, no LLM providers.
 * Use this for pages that only need <form toolname="..."> declarative tool registration.
 */
export { WebMCPToolkit } from './web-mcp-toolkit.js';
export type { ToolRegistration, Schema, WebMCPClient, WebMCPToolkitOptions } from './web-mcp-toolkit.js';
export { DeclarativePolyfill } from './declarative-polyfill.js';
