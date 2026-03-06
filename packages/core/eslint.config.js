import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unicornPlugin from "eslint-plugin-unicorn";

export default [
    {
        ignores: ["dist/**", "node_modules/**"]
    },
    unicornPlugin.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            "unicorn": unicornPlugin,
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/no-inferrable-types": "error",
            "@typescript-eslint/prefer-nullish-coalescing": "error",
            "@typescript-eslint/prefer-optional-chain": "error",
            "@typescript-eslint/prefer-string-starts-ends-with": "error",
            "unicorn/filename-case": ["error", { "case": "kebabCase" }],
            "unicorn/no-null": "error",
            "unicorn/prefer-array-find": "error",
            "unicorn/prefer-global-this": "error",
            "unicorn/prefer-includes": "error",
            "unicorn/prefer-modern-dom-apis": "error",
            "unicorn/prefer-node-protocol": "error",
            "unicorn/prefer-optional-catch-binding": "error",
            "unicorn/prefer-spread": "error",
            "unicorn/prefer-string-slice": "error",
        },
    },
];
