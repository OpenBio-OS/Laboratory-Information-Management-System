#!/usr/bin/env node

// Build the WASM module and copy output to the frontend source tree.
// Cross-platform (works on Windows, macOS, Linux).

import { execSync } from 'child_process';
import { cpSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const wasmCrate = resolve(projectRoot, 'crates', 'openbio-wasm');
const wasmOut = resolve(projectRoot, 'web', 'src', 'wasm');

console.log('🔨 Building WASM module...');
execSync(`wasm-pack build --target web "${wasmCrate}"`, {
    stdio: 'inherit',
    cwd: projectRoot,
});

console.log(`📦 Copying WASM output to ${wasmOut}...`);
mkdirSync(wasmOut, { recursive: true });

const filesToCopy = [
    'openbio_wasm.js',
    'openbio_wasm.d.ts',
    'openbio_wasm_bg.wasm',
    'openbio_wasm_bg.wasm.d.ts',
    'package.json',
];

for (const file of filesToCopy) {
    cpSync(resolve(wasmCrate, 'pkg', file), resolve(wasmOut, file));
}

console.log('✅ WASM build complete.');
