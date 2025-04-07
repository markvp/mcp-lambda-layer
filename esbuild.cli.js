const { build } = require('esbuild');
const { join, resolve } = require('path');
const alias = require('esbuild-plugin-alias');
const { dependencies } = require('./package.json');

const entry = join(__dirname, 'src/bin/mcp-lambda-sam.ts');
const outfile = join(__dirname, 'bin/mcp-lambda-sam.js');

async function buildProject() {
    await build({
        entryPoints: [entry],
        resolveExtensions: ['.ts', '.js', '.json'],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        sourcemap: true,
        minify: true,
        define: {
            'process.env.NODE_ENV': '"production"',
        },
        plugins: [
            alias({
                '../deploy': resolve(__dirname, 'dist/deploy.js'),
            }),
        ],
        treeShaking: true,
        external: [...Object.keys(dependencies || {}), '../dist/deploy.js'],
    }).catch(() => process.exit(1));
}

buildProject();