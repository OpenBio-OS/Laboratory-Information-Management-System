# Update Distribution Strategy

## Overview

OpenBio uses different update mechanisms depending on deployment mode:

- **Local/Hub/Spoke modes**: Tauri auto-updater (desktop apps)
- **Enterprise mode**: Docker image updates

## Desktop App Updates (Tauri Updater)

### Initial Setup

1. **Generate signing keys** (one-time setup):
```bash
npm run tauri signer generate -- -w ~/.tauri/openbio.key
```

This creates:
- Private key: `~/.tauri/openbio.key` (NEVER commit this!)
- Public key: printed to console (add to tauri.conf.json)

2. **Update `tauri.conf.json`** with the public key:
```json
"plugins": {
  "updater": {
    "pubkey": "YOUR_PUBLIC_KEY_HERE"
  }
}
```

3. **Choose update hosting**:

**Option A: GitHub Releases (Recommended)**
- Update endpoint in `tauri.conf.json`:
  ```json
  "endpoints": [
    "https://github.com/YOUR_USERNAME/openbio-os/releases/latest/download/latest.json"
  ]
  ```

### Release Process

1. **Update version** in:
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `package.json`

2. **Commit and tag**:
```bash
git add .
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

3. **GitHub Actions handles the rest**:
   - Builds for macOS (ARM + Intel), Linux, and Windows
   - Signs the installers using `TAURI_SIGNING_PRIVATE_KEY` secret
   - Creates GitHub Release automatically
   - Uploads all platform installers

4. **Users get updates**:
   - App checks for updates on startup
   - Shows dialog prompting user to install
   - Downloads and installs automatically

### GitHub Actions (Automated)

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    strategy:
      matrix:
        platform: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: dtolnay/rust-toolchain@stable
      
      - name: Install dependencies
        run: npm install
      
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'OpenBio ${{ github.ref_name }}'
          releaseBody: 'See CHANGELOG.md for details'
          releaseDraft: false
          prerelease: false
```

Add secrets to GitHub:
- `TAURI_PRIVATE_KEY`: Content of `~/.tauri/openbio.key`
- `TAURI_KEY_PASSWORD`: Password if you set one

## Docker Updates (Enterprise Mode)

### Release Process

1. **Update version** in `Cargo.toml`

2. **Build Docker image**:
```bash
docker build -t openbio-server:0.1.1 .
docker tag openbio-server:0.1.1 openbio-server:latest
```

3. **Push to registry**:
```bash
docker push yourregistry/openbio-server:0.1.1
docker push yourregistry/openbio-server:latest
```

4. **Enterprise users update**:
```bash
docker pull yourregistry/openbio-server:latest
docker-compose up -d
```

## Update Frequency

- **Check on startup**: Automatic (configured)
- **Manual check**: Can add a "Check for Updates" menu item
- **Silent updates**: Configure `dialog: false` in tauri.conf.json

## Rollback Strategy

If an update causes issues:

1. **Desktop apps**: Users can reinstall previous version from GitHub releases
2. **Docker**: `docker pull yourregistry/openbio-server:0.1.0`

## Testing Updates

1. **Test locally**:
```bash
# Change version in tauri.conf.json
npm run tauri build
# Install the built app
# Change version again
npm run tauri build
# Upload to test endpoint
# Run installed app to test update
```

2. **Beta channel** (optional):
   - Create separate update endpoint
   - Use for testing before production release

## Security

- Private key must remain secret
- Updates are verified using public key
- HTTPS required for update endpoints
- Tauri validates signatures before installing

## Monitoring

Track update success/failure:
- Add telemetry to `check_for_updates()` function
- Log update attempts
- Monitor GitHub release downloads
