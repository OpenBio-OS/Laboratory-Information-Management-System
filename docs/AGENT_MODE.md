# Agent Mode

## Overview

OpenBio can run in **Agent-Only Mode**, which turns the application into a headless background coordinator for managing file-watching agents. This mode is designed for dedicated computers that monitor laboratory equipment like freezers, incubators, and microscopes.

**Important**: Agent-only mode does NOT run a database server. It only manages `openbio-agent` processes that watch directories and upload files to a remote Hub or Enterprise server.

## Features

### 1. Agent-Only Deployment

When configured in agent mode, OpenBio:
- Hides the UI completely and runs as a background process
- Starts automatically on system boot (in release builds)
- Provides a system tray icon for control and access
- **Does NOT run a local database or API server**
- Spawns and manages `openbio-agent` processes that watch folders
- Each agent uploads files to a **remote Hub or Enterprise API**

### 2. System Tray Icon

The system tray (macOS menu bar / Windows notification area) provides access to:
- **Show Window** - Reveals the hidden UI window
- **Re-configure...** - Deletes current config and restarts the setup wizard
- **Quit** - Exits the application

### 3. Auto-Start on Boot

In release builds, agent mode automatically:
- Registers the app to start on system boot
- Uses macOS LaunchAgent / Windows Registry / Linux systemd
- Ensures equipment monitoring continues after restarts

### 4. Local Agent Spawning

For "This PC" agent connections:
- Spawns individual `openbio-agent` processes per equipment
- Each agent watches a specific folder for new files
- Files are uploaded to the configured remote API (Hub or Enterprise)
- Agents are automatically stopped when equipment is deleted
- Process lifecycle managed via HashMap in AppState

**Agent Process Details**:
- Binary: `openbio-agent` (separate executable)
- Function: File watcher that uses `notify` crate to monitor directories
- On new file: Uploads to remote API via HTTP POST
- No local database - purely a file watcher/uploader

## Setup

### Configuring Agent Mode

1. On first launch, select "Agent-Only Mode" in the setup wizard
2. Configure the **Remote API URL** (your Hub or Enterprise server)
3. The UI will hide and the system tray icon will appear
4. The app will auto-start on next boot (release builds only)
5. Add equipment and set watch folders to spawn agent processes

### Re-configuring

To change settings or switch out of agent mode:
1. Click the system tray icon
2. Select "Re-configure..."
3. The setup wizard will appear
4. Choose a new deployment mode

## Architecture

### Process Model

```
Main Process (agent-only mode)
├── System Tray Icon (UI access)
├── NO database server
├── NO API server
└── Spawned Agent Processes (file watchers)
    ├── openbio-agent (Equipment 1) → uploads to remote API
    ├── openbio-agent (Equipment 2) → uploads to remote API
    └── openbio-agent (Equipment 3) → uploads to remote API
```

Each `openbio-agent` process:
- Monitors one watch directory using file system notifications
- Uploads new files to the remote Hub/Enterprise API
- Runs independently - main process just spawns/kills them

### Agent Process Management

```rust
// State tracking
AppState {
    config: Mutex<AppConfig>,
    local_agents: Mutex<HashMap<String, Child>>
}

// Spawning an agent
spawn_local_agent(equipment_id: String, watch_folder: String)

// Stopping an agent
stop_local_agent(equipment_id: String)
```

### System Tray Implementation

- Built using `tauri::tray::TrayIconBuilder`
- Menu created with `tauri::menu::Menu`
- Left-click shows window, menu provides re-configure/quit options

### Auto-Start Implementation

- Uses `tauri-plugin-autostart` plugin
- Enabled only in release builds via `#[cfg(not(debug_assertions))]`
- Configures LaunchAgent on macOS
- Automatically enabled when `config.mode == AgentOnly`

## Commands

### Tauri Commands

- `spawn_local_agent(equipment_id: String, watch_folder: String)` - Start monitoring
- `stop_local_agent(equipment_id: String)` - Stop monitoring
- `is_local_agent_running(equipment_id: String) -> bool` - Check status
- `list_local_agents() -> Vec<String>` - List all running agents
- `reinitialize()` - Reset to setup wizard

## Development

### Debug Mode

In debug builds:
- Auto-start is disabled (manual launch only)
- System tray still works for testing
- Agents can be spawned but won't persist across reboots

### Testing

```bash
# Build release version
cargo build --release

# Test agent spawning
tauri dev

# Build complete app bundle
npm run tauri build
```

### Requirements

- `openbio-agent` binary must be in same directory as main app
- Config file at `{data_dir}/OpenBio/config.toml`
- SQLite database for equipment metadata

## Troubleshooting

### Agent Won't Start on Boot

1. Check if auto-start is enabled:
   - macOS: `~/Library/LaunchAgents/` should contain OpenBio plist
   - Windows: Check Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
2. Ensure you're running a release build (not debug)
3. Check logs in `{data_dir}/OpenBio/openbio.log`

### Can't Access System Tray

- macOS: Check menu bar (top right, may be hidden in overflow menu)
- Windows: Check notification area (bottom right taskbar)
- Linux: Depends on desktop environment tray support

### Agent Process Not Spawning

1. Verify `openbio-agent` binary exists alongside main app
2. Check watch folder path is valid and accessible
3. Look for errors in terminal output or logs
4. Ensure equipment has `watchFolder` set before spawning

### Re-configure Not Working

If "Re-configure" menu item doesn't work:
1. Manually delete `{data_dir}/OpenBio/config.toml`
2. Restart the app - it will show setup wizard
3. Choose new deployment mode

## Security Considerations

- Agent-only mode does NOT expose any ports or run a server
- Agents upload files to remote API specified in configuration
- Remote API should use TLS (https://) in production
- Consider API key authentication for Enterprise deployments
- Watch folders should have appropriate file permissions
- No local database means no local data exposure risk

## Future Enhancements

- mDNS discovery for WiFi/LAN agents
- TLS/authentication for remote agent connections
- Web-based agent management dashboard
- Centralized logging and monitoring
- Agent health checks and auto-restart
