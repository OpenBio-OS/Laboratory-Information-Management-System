# OpenBio Configuration Reference

Configuration is stored in the user's app data directory and **generated automatically by the Setup Wizard** on first launch.

## Config Location
- **macOS**: `~/Library/Application Support/OpenBio/config.toml`
- **Windows**: `%APPDATA%/OpenBio/config.toml`
- **Linux**: `~/.local/share/OpenBio/config.toml`

## Options

| Field | Description |
|-------|-------------|
| `mode` | `local`, `hub`, `spoke`, or `enterprise` |
| `api_url` | Remote API URL (spoke/enterprise only) |
| `server_port` | Local server port (default: 3000) |
| `lab_name` | mDNS discovery name (hub mode) |
| `data_path` | Relative path for SQLite and files |
