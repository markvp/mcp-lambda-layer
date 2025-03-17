const isESM = process.env.NODE_ENV === 'esm';

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
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
    '@aws-sdk/*'
  ]
};

require('esbuild').build(config).catch(() => process.exit(1)); 