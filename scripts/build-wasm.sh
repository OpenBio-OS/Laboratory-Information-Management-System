#!/usr/bin/env bash
set -euo pipefail

# Build the WASM module and copy output to the frontend source tree.
# This script is called by `npm run build:wasm` and from Tauri's beforeDevCommand.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WASM_CRATE="$PROJECT_ROOT/crates/openbio-wasm"
WASM_OUT="$PROJECT_ROOT/web/src/wasm"

echo "🔨 Building WASM module..."
wasm-pack build --target web "$WASM_CRATE"

echo "📦 Copying WASM output to $WASM_OUT..."
mkdir -p "$WASM_OUT"

cp "$WASM_CRATE/pkg/openbio_wasm.js"          "$WASM_OUT/"
cp "$WASM_CRATE/pkg/openbio_wasm.d.ts"        "$WASM_OUT/"
cp "$WASM_CRATE/pkg/openbio_wasm_bg.wasm"     "$WASM_OUT/"
cp "$WASM_CRATE/pkg/openbio_wasm_bg.wasm.d.ts" "$WASM_OUT/"
cp "$WASM_CRATE/pkg/package.json"              "$WASM_OUT/"

echo "✅ WASM build complete."
