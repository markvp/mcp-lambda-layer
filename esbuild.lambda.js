const { buildSync } = require('esbuild');
const { readdirSync, mkdirSync } = require('fs');
const { join } = require('path');

// Create lambdasDistDir directly
const lambdasDistDir = join(__dirname, 'dist/lambdas');
mkdirSync(lambdasDistDir, { recursive: true });

// Find all Lambda function directories
const srcDir = join(__dirname, 'src/lambdas');
const lambdaDirs = readdirSync(srcDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

// Build each Lambda function
for (const dir of lambdaDirs) {
    const outDir = join(lambdasDistDir, dir);
    mkdirSync(outDir, { recursive: true });

    buildSync({
        entryPoints: [join(srcDir, dir, 'index.ts')],
        resolveExtensions: ['.ts', '.js', '.json'],
        bundle: true,
        minify: true,
        sourcemap: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        outfile: join(outDir, 'index.js'),
        external: [
            '@aws-sdk/*',
            'aws-lambda'
        ],
        treeShaking: true,
        define: {
            'process.env.NODE_ENV': '"production"'
        },
    });
}
