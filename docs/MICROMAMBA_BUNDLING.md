# Micromamba Bundling Strategy

## Overview

OpenBio uses the "Skeleton Key" approach to avoid dependency hell for computer-illiterate users. Instead of bundling 2GB+ of tools in the installer, we ship a tiny micromamba binary that bootstraps the environment on first use.

## Architecture

### What Gets Bundled (in the installer)
- **Micromamba binary** (~5MB per platform)
  - `src-tauri/bin/micromamba` (Linux x64)
  - `src-tauri/bin/micromamba.exe` (Windows x64)
  - `src-tauri/bin/micromamba` (macOS ARM64)
  - `src-tauri/bin/micromamba` (macOS x64)

### What Gets Downloaded (on first pipeline access)
- **OpenJDK 17** (~150MB) - Java runtime for Nextflow
- **Nextflow** (~20MB) - Pipeline orchestrator
- **Dependencies** (~50MB) - Required libraries

Total bootstrap download: ~220MB (one-time)

## Directory Structure

```
AppData/OpenBio/
├── pipeline-env/
│   ├── micromamba/           # Micromamba root
│   │   ├── pkgs/            # Downloaded package cache
│   │   └── envs/
│   │       └── openbio-pipelines/
│   │           ├── bin/
│   │           │   ├── java         # Private Java runtime
│   │           │   └── nextflow     # Private Nextflow
│   │           └── lib/            # Java/Nextflow dependencies
│   └── env_config.json      # Saved environment info
```

## First-Time User Experience

### Without Pipeline Access (No Setup)
```
User opens app → Uses Freezer/Library/Experiments → No setup needed
```

### When Accessing Pipelines
```
1. User clicks "Pipelines" tab
2. App detects no environment exists
3. Shows setup wizard:
   ⏳ Downloading package manager...
   ⏳ Installing Java runtime...
   ⏳ Installing Nextflow...
   ✓ Pipeline environment ready!
4. Checks for Docker
   - If found: ✓ Ready to run pipelines
   - If missing: Shows Docker download guide
```

## Why This Works

### For Non-Technical Users
- ✅ **Zero configuration** - Click and it works
- ✅ **No admin privileges** needed (except Docker)
- ✅ **No PATH modification**
- ✅ **No system-wide installation**
- ✅ **Self-contained** - Uninstall = delete folder

### For Technical Users
- ✅ **Doesn't interfere** with system conda/Java/Nextflow
- ✅ **Reproducible** - Same environment every time
- ✅ **Isolated** - Pipeline deps don't pollute system

## Docker: The Exception

Docker **cannot** be bundled because:
- 500MB+ download
- Requires admin privileges
- Has licensing considerations (Docker Desktop)
- Needs kernel-level virtualization

**Solution**: Lazy check when user runs first pipeline
```
1. User launches pipeline
2. App checks: docker --version
3. If missing:
   → Show friendly dialog
   → Link to Docker Desktop download
   → Explain what Docker does
   → Offer to recheck after installation
```

## Platform-Specific Notes

### macOS
- **ARM64 (M1/M2/M3)**: `micromamba-osx-arm64`
- **Intel (x64)**: `micromamba-osx-64`
- Both ~5MB compressed

### Windows
- **x64**: `micromamba.exe`
- ~6MB compressed
- No admin needed (installs to AppData)

### Linux
- **x64**: `micromamba-linux-64`
- ~5MB compressed
- Works on Ubuntu, Fedora, Arch, etc.

## Micromamba vs Conda/Mamba

| Feature | Micromamba | Conda | Mamba |
|---------|-----------|-------|-------|
| Size | 5MB | 500MB | 100MB |
| Dependencies | None | Python | Python |
| Install time | Instant | 5 min | 2 min |
| Admin required | No | No | No |
| Speed | Fastest | Slow | Fast |

## Download Sources

### Micromamba Binaries
```
https://github.com/mamba-org/micromamba-releases/releases/latest/download/
- micromamba-linux-64
- micromamba-osx-64
- micromamba-osx-arm64
- micromamba-win-64.exe
```

### Conda Channels Used
```yaml
channels:
  - conda-forge  # OpenJDK, general packages
  - bioconda     # Nextflow, bioinformatics tools
```

## Build Process

### Step 1: Download Micromamba Binaries
```bash
# In scripts/download-micromamba.sh
VERSION="2.0.0"
PLATFORMS=("linux-64" "osx-64" "osx-arm64" "win-64")

for PLATFORM in "${PLATFORMS[@]}"; do
  wget https://github.com/mamba-org/micromamba-releases/releases/download/${VERSION}/micromamba-${PLATFORM}
  # Place in src-tauri/bin/
done
```

### Step 2: Tauri Build Configuration
```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "resources": [
      "bin/micromamba*"
    ]
  }
}
```

### Step 3: Code Signing (macOS/Windows)
- Micromamba binaries must be signed
- Use Tauri's automatic code signing
- Notarize macOS app

## Runtime Execution

### Pipeline Launch Flow
```rust
// When user runs a pipeline:
1. Load env_config.json
2. Get nextflow_path and java_home
3. Execute:
   Command::new(nextflow_path)
       .env("JAVA_HOME", java_home)
       .env("NXF_HOME", env_path)
       .arg("run")
       .arg(pipeline_name)
```

### Environment Variables Set
```bash
JAVA_HOME=/Users/user/Library/Application Support/OpenBio/pipeline-env/micromamba/envs/openbio-pipelines
NXF_HOME=/Users/user/Library/Application Support/OpenBio/pipeline-env
PATH=/Users/user/Library/Application Support/OpenBio/pipeline-env/micromamba/envs/openbio-pipelines/bin:$PATH
```

## Future Enhancements

### Phase 1 (Current)
- [x] Bundle micromamba
- [x] Bootstrap OpenJDK + Nextflow
- [x] Check Docker availability
- [x] Setup wizard UI

### Phase 2
- [ ] Download micromamba on first launch (even smaller installer)
- [ ] Parallel package downloads (faster setup)
- [ ] Resume interrupted setups
- [ ] Offline mode (use cached packages)

### Phase 3
- [ ] Auto-update Nextflow version
- [ ] Support multiple Nextflow versions (per-pipeline)
- [ ] Bundled nf-core pipeline cache
- [ ] Pre-pull common Docker images

## Troubleshooting

### Setup Fails
- Check internet connection
- Check disk space (need ~500MB free)
- Check firewall (allows conda-forge/bioconda)
- View logs: `AppData/OpenBio/pipeline-env/setup.log`

### Pipeline Won't Run
- Verify Docker is running: `docker --version`
- Check Nextflow version: `nextflow -version`
- View environment: `AppData/OpenBio/pipeline-env/env_config.json`

### Reset Environment
```typescript
// In Settings tab:
"Reset Pipeline Environment" button
→ Deletes AppData/OpenBio/pipeline-env/
→ Next pipeline access triggers fresh bootstrap
```

## License Compliance

### Micromamba
- **License**: BSD-3-Clause
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

### OpenJDK
- **License**: GPL-2.0 with Classpath Exception
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

### Nextflow
- **License**: Apache 2.0
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

All licenses permit bundling and redistribution.
