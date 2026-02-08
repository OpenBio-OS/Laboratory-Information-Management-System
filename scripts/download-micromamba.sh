#!/bin/bash

# Download micromamba binaries for all platforms
# This script must be run before building the Tauri app

set -e

MICROMAMBA_VERSION="2.5.0-1"
BASE_URL="https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_VERSION}"
BIN_DIR="$(dirname "$0")/../src-tauri/bin"

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

echo "🔧 Downloading micromamba v${MICROMAMBA_VERSION} for all platforms..."
echo "📁 Target directory: $BIN_DIR"
echo ""

# List of platform binaries
BINARIES=(
    "micromamba-linux-64"
    "micromamba-osx-64"
    "micromamba-osx-arm64"
    "micromamba-win-64.exe"
)

# Download each platform binary
for filename in "${BINARIES[@]}"; do
    url="${BASE_URL}/${filename}"
    output_path="${BIN_DIR}/${filename}"
    
    echo "⬇️  Downloading $filename..."
    
    if curl -L -f -o "$output_path" "$url"; then
        # Make executable on Unix platforms
        if [[ "$filename" != *.exe ]]; then
            chmod +x "$output_path"
        fi
        
        size=$(du -h "$output_path" | cut -f1)
        echo "   ✅ Downloaded: $size"
    else
        echo "   ❌ Failed to download $filename"
        exit 1
    fi
    
    echo ""
done

echo "✨ All micromamba binaries downloaded successfully!"
echo ""
echo "📋 Downloaded files:"
ls -lh "$BIN_DIR"
echo ""
echo "🚀 Ready to build! Run: pnpm tauri build"
