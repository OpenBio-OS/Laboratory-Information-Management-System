# Testing the Pipeline Environment Setup

This guide explains how to test the auto-installer for the pipeline environment (micromamba + Nextflow).

## Prerequisites

1. Download micromamba binaries:
   ```bash
   ./scripts/download-micromamba.sh
   ```

2. Start the app in dev mode:
   ```bash
   npm run tauri dev
   ```

## Testing the Setup Flow

### First Launch (No Environment)

1. **Open the app** → You should see the main interface
2. **Click "Pipelines" tab** → Setup wizard should automatically appear
3. **Watch the progress**:
   - Stage 1: "Checking environment..." (1-2 seconds)
   - Stage 2: "Setting up pipeline environment..." (2-3 minutes)
     - Creating micromamba environment
     - Installing OpenJDK 17 (~150MB download)
     - Installing Nextflow (~20MB download)
   - Stage 3: "Checking Docker..." (1 second)
     - If Docker installed → Proceeds to completion
     - If Docker missing → Shows download prompt
   - Stage 4: "Complete!" → Environment ready

### Expected Behavior

#### With Docker Installed
```
✓ Environment setup complete
✓ Docker detected
✓ Ready to run pipelines
```

#### Without Docker Installed
```
✓ Environment setup complete
⚠ Docker not found
→ Shows "Download Docker" button
→ User can install Docker later
→ App is still functional (setup complete)
```

### Subsequent Launches

1. **Open app** → Click "Pipelines" tab
2. **No wizard shown** → Environment already initialized
3. **Pipeline list loads** → Ready to use immediately

## Manual Testing Scenarios

### Test 1: Fresh Setup (Recommended)
```bash
# Clear any existing environment
rm -rf ~/Library/Application\ Support/OpenBio/pipeline-env

# Start app
npm run tauri dev

# Navigate to Pipelines tab → Should show wizard
```

### Test 2: Interrupted Setup
```bash
# Start setup, then kill app mid-download
# Restart app → Should detect incomplete setup and re-run
```

### Test 3: Docker Detection
```bash
# With Docker running:
docker --version  # Should output version

# Without Docker:
# Stop Docker Desktop or uninstall temporarily
# App should detect and prompt for installation
```

### Test 4: Environment Verification
After successful setup, verify the environment:

```bash
# Check environment directory
ls -la ~/Library/Application\ Support/OpenBio/pipeline-env/

# Expected structure:
# pipeline-env/
#   ├── micromamba/
#   │   └── envs/
#   │       └── openbio-pipelines/
#   │           ├── bin/
#   │           │   ├── java
#   │           │   └── nextflow
#   │           └── lib/
#   └── env_config.json

# Verify config file
cat ~/Library/Application\ Support/OpenBio/pipeline-env/env_config.json

# Expected content:
# {
#   "env_path": "/Users/.../pipeline-env",
#   "micromamba_path": "/Users/.../micromamba-osx-arm64",
#   "nextflow_path": "/Users/.../bin/nextflow",
#   "java_home": "/Users/.../openbio-pipelines",
#   "is_initialized": true,
#   "nextflow_version": "24.XX.X"
# }
```

### Test 5: Nextflow Execution
After setup, test Nextflow works:

```bash
# Get paths from config
ENV_PATH=~/Library/Application\ Support/OpenBio/pipeline-env
NEXTFLOW=$ENV_PATH/micromamba/envs/openbio-pipelines/bin/nextflow
JAVA_HOME=$ENV_PATH/micromamba/envs/openbio-pipelines

# Test nextflow command
JAVA_HOME=$JAVA_HOME $NEXTFLOW -version

# Expected output:
# nextflow version 24.XX.X
# build XXXX
# created XX-XX-XXXX XX:XX UTC
```

## Troubleshooting

### Setup Wizard Stuck
**Symptoms**: Progress bar stuck at X%

**Solutions**:
1. Check internet connection
2. Check console for errors: `Cmd+Opt+I` → Console tab
3. Look for blocked network requests (firewall/VPN)
4. Check disk space: Need ~500MB free

### Micromamba Binary Not Found
**Symptoms**: Error "Micromamba binary not found"

**Solution**: Re-download binaries
```bash
./scripts/download-micromamba.sh
cargo clean
npm run tauri dev
```

### Docker Check Fails
**Symptoms**: Setup completes but says "Docker not found"

**Solutions**:
1. Verify Docker is running: `docker --version`
2. Restart Docker Desktop
3. Check Docker is in PATH: `which docker`

### Environment Corrupted
**Symptoms**: Setup succeeds but pipelines won't run

**Solution**: Delete and recreate environment
```bash
# Delete environment
rm -rf ~/Library/Application\ Support/OpenBio/pipeline-env

# Restart app → Setup wizard will re-run
```

### Permission Errors (macOS)
**Symptoms**: "Permission denied" errors during setup

**Solutions**:
1. Grant app disk access: System Settings → Privacy & Security → Files and Folders
2. Make sure App Support directory is writable:
   ```bash
   chmod -R u+w ~/Library/Application\ Support/OpenBio
   ```

## Platform-Specific Paths

### macOS
```
Environment: ~/Library/Application Support/OpenBio/pipeline-env
Binary: micromamba-osx-arm64 (M1/M2/M3) or micromamba-osx-64 (Intel)
```

### Windows
```
Environment: %APPDATA%\OpenBio\pipeline-env
Binary: micromamba-win-64.exe
```

### Linux
```
Environment: ~/.local/share/OpenBio/pipeline-env
Binary: micromamba-linux-64
```

## Development Notes

### Skipping Setup for Testing
If you want to test the main pipeline UI without waiting for setup:

```typescript
// In PipelineManager.tsx, comment out the setup check:
// const needsSetup = false;  // Force skip setup
```

### Debugging Setup Progress
Enable detailed logging:

```rust
// In pipeline_env.rs, add more logging:
println!("DEBUG: Running command: {:?}", cmd);
```

### Simulating Docker Not Found
Temporarily rename Docker:

```bash
# macOS
sudo mv /usr/local/bin/docker /usr/local/bin/docker.bak

# Test app → Should show Docker not found

# Restore
sudo mv /usr/local/bin/docker.bak /usr/local/bin/docker
```

## Success Criteria

A successful setup should:
1. ✅ Complete without errors
2. ✅ Create `env_config.json` with valid paths
3. ✅ Install Nextflow 24.x.x
4. ✅ Install OpenJDK 17
5. ✅ Detect Docker (if installed)
6. ✅ Allow subsequent app launches without re-setup
7. ✅ Enable pipeline execution

## Next Steps After Testing

Once setup works:
1. Test actual pipeline execution (see EXPERIMENTS_AND_LIBRARY.md)
2. Test on Windows and Linux
3. Test with various Docker configurations
4. Test network failure scenarios
5. Test disk space constraints
