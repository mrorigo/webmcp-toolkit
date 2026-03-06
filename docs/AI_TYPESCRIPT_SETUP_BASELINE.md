# The AI TypeScript Baseline - Nothing else is good enough

AI agents are powerful, but they are also prone to "hallucinating" archaic patterns, overlooking null safety, and introducing subtle type inconsistencies. When an agent is working on a codebase, **standard configurations are no longer sufficient.** You need hyper-strict, opinionated guardrails that force the agent into modern, safe, and idiomatic patterns.

This document defines the absolute baseline for any TypeScript project where AI agents (like Antigravity) are expected to contribute.

## 1. The "Extreme" ESLint Flat Config

Forget standard "recommended" sets. We use a combination of `@typescript-eslint` and `eslint-plugin-unicorn` with the Flat Config system to enforce a specific, high-integrity dialect of TypeScript.

### Required Plugins
- `@typescript-eslint/eslint-plugin`: For deep type-aware linting.
- `eslint-plugin-unicorn`: For opinionated, modern JavaScript idioms. We use the **recommended** unicorn set as our foundation.

### The Guardrail Rules
These rules are non-negotiable for AI-driven development:

| Rule                                           | Purpose                            | Why for AI?                                                                                        |
| :--------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------- |
| `@typescript-eslint/prefer-nullish-coalescing` | Use `??` instead of double-pipe or | Prevents agents from accidentally overriding `0` or `""` with defaults.                            |
| `@typescript-eslint/prefer-optional-chain`     | Use `?.` everywhere                | Forces safe property access and reduces verbose `if` guards.                                       |
| `@typescript-eslint/consistent-type-imports`   | Enforce `import type`              | Prevents circular dependencies and clarifies that imports are for types only.                      |
| `unicorn/prefer-global-this`                   | Use `globalThis`                   | Standardizes global access across Node, Browser, and Workers.                                      |
| `@typescript-eslint/no-inferrable-types`       | Remove `: string = ""`             | Keeps the code clean and prevents redundant type noise.                                            |
| `unicorn/filename-case`                        | Enforce `kebab-case`               | Prevents the messy mix of PascalCase and camelCase filenames.                                      |
| `unicorn/no-null`                              | Prefer `undefined`                 | Simplifies state checks; `null` is often a source of "which one should I use?" confusion for LLMs. |

---

## 2. The Build Pipeline Guardrails

Linting must not be an optional "sidebar." It must be the gatekeeper of the build.

### Modern Linting Script
We combine `oxlint` for high-performance logic/performance checks with `eslint` for deep idiomatic enforcement.

```json
"scripts": {
  "lint": "npx -y oxlint -D perf && npx eslint src/**/*.ts",
  "build": "npm run build:full && npm run build:declarative"
}
```

---

## 3. Recommended: The Ironclad Repo

To truly ensure an AI agent never commits "garbage" code, we recommend moving these checks to the pre-commit stage via [Husky](https://typicode.github.io/husky/).

### Husky & Lint-Staged
Install Husky and lint-staged to ensure that every single commit is verified.

```bash
npx husky-init && npm install
npm install --save-dev lint-staged
```

**Pre-commit Hook (`.husky/pre-commit`):**
```bash
npx lint-staged
```

**`package.json` Configuration:**
```json
"lint-staged": {
  "src/**/*.ts": [
    "npm run lint",
    "npm run build"
  ]
}
```

## 4. The Philosophy: "Hyper-Strictness is Freedom"

When rules are ambiguous, AI agents drift. When the environment is hyper-strict:
1. **Errors are caught instantly**: The agent gets immediate feedback if it tries to use `window` instead of `globalThis`.
2. **Review overhead drops**: You don't need to check for "style"; the CI/CD and pre-commit hooks have already enforced it.
3. **Consistency is guaranteed**: The entire codebase looks like it was written by one highly disciplined developer.

**If your config isn't erroring on `||` for defaults, your config is broken.**
