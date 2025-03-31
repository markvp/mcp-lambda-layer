const isESM = process.env.NODE_ENV === 'esm';

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: isESM ? 'esm' : 'cjs',
  outdir: isESM ? 'dist/esm' : 'dist/cjs',
  sourcemap: true,
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  dropLabels: ['DEBUG'],
  external: [
    '@modelcontextprotocol/sdk',
    'zod',
    '@aws-sdk/*',
    'node:*',
    'stream',
    'stream/promises',
    'stream/web',
    'stream/consumers',
    'stream/readable',
    'stream/writable',
    'stream/duplex',
    'stream/transform',
    'stream/pass-through',
  ],
  resolveExtensions: ['.ts', '.js'],
  alias: {
    'node:stream': 'stream',
    'node:stream/promises': 'stream/promises',
  },
};

require('esbuild')
  .build(config)
  .catch(() => process.exit(1));
