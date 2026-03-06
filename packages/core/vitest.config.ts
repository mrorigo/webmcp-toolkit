import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        extensions: ['.ts', '.tsx', '.js']
    },
    test: {
        environment: 'jsdom',
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/index.ts',
                'src/index.declarative.ts',
                'src/__tests__/**',
                'src/llm/illm-provider.ts',
                'src/types.d.ts'
            ],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 84,
                statements: 90
            }
        }
    }
});
