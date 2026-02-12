#!/usr/bin/env node

// Download micromamba binaries for all platforms.
// Cross-platform replacement for download-micromamba.sh.

import { execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MICROMAMBA_VERSION = '2.5.0-1';
const BASE_URL = `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_VERSION}`;
const BIN_DIR = resolve(__dirname, '..', 'src-tauri', 'bin');

mkdirSync(BIN_DIR, { recursive: true });

console.log(`🔧 Downloading micromamba v${MICROMAMBA_VERSION} for all platforms...`);
console.log(`📁 Target directory: ${BIN_DIR}\n`);

const BINARIES = [
    'micromamba-linux-64',
    'micromamba-osx-64',
    'micromamba-osx-arm64',
    'micromamba-win-64.exe',
];

for (const filename of BINARIES) {
    const url = `${BASE_URL}/${filename}`;
    const outputPath = resolve(BIN_DIR, filename);

    console.log(`⬇️  Downloading ${filename}...`);

    try {
        execSync(`curl -L -f -o "${outputPath}" "${url}"`, { stdio: 'inherit' });

        // Make executable on Unix platforms
        if (!filename.endsWith('.exe') && process.platform !== 'win32') {
            chmodSync(outputPath, 0o755);
        }

        console.log(`   ✅ Downloaded\n`);
    } catch {
        console.error(`   ❌ Failed to download ${filename}`);
        process.exit(1);
    }
}

console.log('✨ All micromamba binaries downloaded successfully!');
