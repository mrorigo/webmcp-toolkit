import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: 'dist/index.js',
            format: 'es',
            sourcemap: true
        },
        {
            file: 'dist/browser.js',
            format: 'iife',
            name: 'UniversalWebMCPAgent',
            sourcemap: true,
            globals: {
                zod: 'Zod'
            }
        }
    ],
    external: ['zod'],
    plugins: [typescript({ compilerOptions: { declaration: false } })]
};
