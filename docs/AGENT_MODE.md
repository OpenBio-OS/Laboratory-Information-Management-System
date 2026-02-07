# Agent Architecture

## The Fucking Simple Truth

**There are TWO ways agents run:**

### 1. Agent Deployment Mode (Dedicated Equipment Computer)

```
User runs openbio.exe → Setup Wizard → Select "Agent Mode"
↓
Enter agent name (e.g. "Microscope Room 301", "Flow Cytometer Lab A")
↓
Main app runs embedded openbio-agent code
↓
UI minimizes to system tray
↓
Agent broadcasts via mDNS with unique name on port (default 3000)
↓
Client discovers "Flow Cytometer Lab A" in mDNS browser
↓
Client connects to http://<agent-ip>:3000
↓
Client sends POST /config with watch folder & upload URL
↓
Client sends POST /lock to lock the agent
↓
Agent watches folder, uploads files to server API
↓
Client sends POST /unlock when done
```

**Key Points:**
- Agent code is embedded in openbio.exe
- No separate binary needed
- **MUST configure agent_name during setup** (shows in mDNS discovery)
- Broadcasts as `_openbio-agent._tcp.local.` with instance name = agent_name
- Multiple agents on same network need unique names
- Auto-starts on boot (release builds)
- Controlled via system tray (Show/Reconfigure/Quit)

**Agent Naming:**
- Names should be descriptive and unique on your network
- Good: "Microscope Room 301", "Flow Cytometer Lab A", "Freezer -80C Wing B"
- Bad: "Agent 1", "Computer", "Lab Equipment"
- If not configured, falls back to hostname (e.g. "OpenBio Agent on macbook-pro.local")

### 2. Local Agents (Solo/Hub Mode)

```
User runs openbio.exe → Setup Wizard → Select "Solo" or "Hub"
↓
Main app runs openbio-server (database + API)
↓
User adds equipment, selects "Run agent on this PC"
↓
Main app spawns openbio-agent binary as background process
↓
Each agent gets unique port: 8080, 8081, 8082...
↓
Agent binds to localhost:<port>
↓
Main app configures agent via HTTP API
↓
Agent watches folder, uploads to localhost:3000/api/...
```

**Key Points:**
- Separate openbio-agent.exe binary spawned as child process
- Multiple agents can run simultaneously (different ports)
- No UI, no mDNS broadcast (localhost only)
- Lifecycle tied to main app (killed when app closes)
- Configured automatically by main app

## The Code

### openbio-agent (Library + Binary)

**Location:** `crates/openbio-agent/`

**What it does:**
- HTTP server with endpoints: `/config`, `/lock`, `/unlock`, `/start`, `/stop`
- mDNS broadcast
- File watching (TODO: implement with notify crate)
- File upload to server API

**Used by:**
- Main app imports `openbio_agent::run_agent_server()` for Agent deployment mode
- Standalone `openbio-agent` binary for local agents

### Main App (openbio.exe)

**Agent Mode:**
- `src-tauri/src/lib.rs` line ~575
- Hides UI, creates system tray
- Calls `openbio_agent::run_agent_server(port, None, None, None)`
- Enables auto-start

**Local Agent Spawning:**
- `src-tauri/src/lib.rs` `spawn_local_agent()` command
- Finds available port starting from 8080
- Spawns `openbio-agent --port <port> --equipment-id <id>`
- Stores Child process in HashMap

## HTTP API

All agents expose the same API:

```
GET  /              - Status (agent_name, locked, watching, equipment_id)
GET  /config        - Get configuration
POST /config        - Set configuration (watch_dir, upload_api_url, agent_name)
POST /lock          - Lock agent (client_id required)
POST /unlock        - Unlock agent
POST /start         - Start watching directory
POST /stop          - Stop watching
```

**Status Response Example:**
```json
{
  "status": "running",
  "agent_name": "Flow Cytometer Lab A",
  "equipment_id": "fc-123",
  "watching": true,
  "locked": true,
  "locked_by": "laptop-user-123"
}
```

## Client Workflow

**Connecting to Agent:**

1. Discover agent via mDNS or enter IP manually
2. GET `/` to check status
3. POST `/lock` with `{"client_id": "laptop-123"}`
4. POST `/config` with `{"watch_dir": "/path", "upload_api_url": "http://server:3000/api/upload"}`
5. POST `/start` to begin watching
6. Agent detects files, uploads to server
7. POST `/unlock` when done

**Configuration Example:**

```javascript
// Discover agents via mDNS
const agents = await discoverAgents(); // Returns list of {name, ip, port}
// Example: [{name: "Flow Cytometer Lab A", ip: "192.168.1.101", port: 3000}]

// Connect to specific agent by name
const agent = agents.find(a => a.name === "Flow Cytometer Lab A");

// Lock the agent
await fetch(`http://${agent.ip}:${agent.port}/lock`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({client_id: 'my-laptop'})
});

// Configure it
await fetch(`http://${agent.ip}:${agent.port}/config`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    watch_dir: '/data/sequencer/output',
    upload_api_url: 'http://192.168.1.50:3000/api/experiments/upload'
  })
});

// Start watching
await fetch(`http://${agent.ip}:${agent.port}/start`, {method: 'POST'});
```

## File Upload Flow

```
Sequencer writes file.fastq → /data/output/file.fastq
↓
Agent detects new file (notify crate watches directory)
↓
Agent reads file
↓
Agent POSTs to upload_api_url: 
  POST http://server:3000/api/experiments/upload
  Content-Type: multipart/form-data
  Body: file data
↓
Server saves file, creates experiment entry
↓
Agent marks file as uploaded
```

## Port Allocation

- **Agent deployment mode:** Uses configured port (default 3000)
- **Local agents:** Auto-allocated starting from 8080
  - Agent 1: localhost:8080
  - Agent 2: localhost:8081
  - Agent 3: localhost:8082
  - etc.

## Process Management

**Agent Mode:**
- Process: Main openbio.exe process
- Kill: System tray → Quit
- Restart: Auto-starts on boot
- Logs: Check application logs

**Local Agents:**
- Process: Spawned child processes
- Kill: Stop from UI or main app exit
- Lifecycle: Managed by main app
- HashMap tracks: `equipment_id -> Child`

## NO BULLSHIT RULES

1. **Agent mode = dedicated computer.** Don't run this on your personal laptop.
2. **Local agents = convenience.** For equipment physically connected to your PC.
3. **Agents are dumb.** They watch folders and upload files. That's it.
4. **Client does the thinking.** Client tells agent what to watch and where to upload.
5. **Lock before use.** Always lock the agent so others can't interfere.
6. **One upload destination.** Agent uploads to ONE server URL you configure.
7. **No database in agents.** Agents don't store anything. They forward files.
8. **Unique names required.** Each agent on your network MUST have a unique, descriptive name for mDNS discovery.

## mDNS Discovery

**How clients find agents:**

1. Client browses for `_openbio-agent._tcp.local.` services
2. mDNS returns list of agents with their names:
   - "Microscope Room 301" at 192.168.1.100:3000
   - "Flow Cytometer Lab A" at 192.168.1.101:3000
   - "Freezer -80C Wing B" at 192.168.1.102:3000
3. User selects "Flow Cytometer Lab A" from list
4. Client connects to 192.168.1.101:3000

**If multiple agents have the same name:**
- mDNS will show duplicate instances (confusing!)
- Use unique, descriptive names during agent setup
- Names can be changed by reconfiguring the agent

**Agent name sources:**
- **Agent deployment mode**: Set during setup wizard (`config.agent_name`)
- **Local agents**: Can be set via CLI flag `--agent-name "Plate Reader"`
- **Fallback**: Uses hostname if no name configured ("OpenBio Agent on macbook-pro.local")

## How to Configure Agent Name

### For Agent Deployment Mode (Dedicated Equipment)

**Initial Setup:**
1. Launch openbio.exe on the equipment computer
2. Setup Wizard appears
3. Select "Agent-Only Mode"
4. **Enter Agent Name** in the text field (REQUIRED)
   - Example: "Microscope Room 301"
   - Example: "Flow Cytometer Lab A"
   - Example: "Freezer -80C Wing B"
5. Click Continue
6. App minimizes to system tray and broadcasts with that name

**Changing the Name:**
1. Click system tray icon
2. Select "Re-configure..."
3. Setup Wizard re-appears
4. Select "Agent-Only Mode" again
5. Enter new agent name
6. Click Continue
7. Agent restarts with new name

### For Local Agents (Spawned from Solo/Hub Mode)

Local agents (port 8080+) can optionally specify a name via CLI:

```bash
openbio-agent --port 8080 --equipment-id "plate-reader-1" --agent-name "Plate Reader"
```

Currently the main app doesn't pass agent names when spawning local agents (they don't broadcast mDNS anyway since they're localhost-only). If you need this, update the spawn command in `src-tauri/src/lib.rs` to include the `--agent-name` flag.

### Via Configuration File

You can also manually edit the config file at `~/Library/Application Support/OpenBio/config.toml` (macOS) or equivalent on Windows/Linux:

```toml
mode = "agent"
agentName = "Flow Cytometer Lab A"
serverPort = 3000
```

Then restart the app.

## Troubleshooting

**"Tauri API not available"**
- Missing import: `import { invoke } from '@tauri-apps/api/core';`

**"Agent already locked"**
- Another client has the lock
- POST `/unlock` from the other client first

**"Port 8080 in use"**
- Normal - next agent will use 8081
- Check `find_available_port()` is working

**"openbio-agent not found"**
- Binary must be in same directory as openbio.exe
- Check build output in `target/release/`

**"File not uploading"**
- Check watch_dir is correct
- Check upload_api_url is reachable
- Verify server API endpoint exists
- Look at agent logs

**"Can't find my agent in mDNS browser"**
- Ensure agent is running (check system tray in Agent mode)
- Verify both devices are on same network/subnet
- Check firewall isn't blocking mDNS (port 5353 UDP)
- Wait 30-60 seconds for mDNS propagation
- If multiple agents, verify each has unique name

**"Multiple agents showing same name"**
- Reconfigure each agent with unique names
- System tray → Re-configure → Enter new name
- Or update config file and restart
- Good naming: "Flow Cytometer Lab A" vs "Flow Cytometer Lab B"

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT DEPLOYMENT MODE                    │
│                                                             │
│  Equipment PC #1 (192.168.1.100)                           │
│  ┌──────────────────────────────────────┐                 │
│  │ openbio.exe (Agent Mode)             │                 │
│  │ agent_name: "Microscope Room 301"    │                 │
│  │ ├─ Embedded openbio-agent code       │                 │
│  │ ├─ HTTP Server :3000                 │                 │
│  │ ├─ mDNS: "Microscope Room 301"       │                 │
│  │ └─ System Tray UI                    │                 │
│  └──────────────────────────────────────┘                 │
│                                                             │
│  Equipment PC #2 (192.168.1.101)                           │
│  ┌──────────────────────────────────────┐                 │
│  │ openbio.exe (Agent Mode)             │                 │
│  │ agent_name: "Flow Cytometer Lab A"   │                 │
│  │ ├─ Embedded openbio-agent code       │                 │
│  │ ├─ HTTP Server :3000                 │                 │
│  │ ├─ mDNS: "Flow Cytometer Lab A"      │                 │
│  │ └─ System Tray UI                    │                 │
│  └──────────────────────────────────────┘                 │
│           ▲                        ▲                       │
│           │                        │                       │
│           └────────────┬───────────┘                       │
│                        │ HTTP (discover via mDNS)          │
│  ┌────────────────────┴──────────────────┐                │
│  │ Client (Personal Laptop)              │                │
│  │ openbio.exe (Solo/Hub/Spoke)         │                 │
│  │ - Browses mDNS for agents             │                 │
│  │ - Shows: "Microscope Room 301"        │                 │
│  │          "Flow Cytometer Lab A"       │                 │
│  │ - User selects agent by name          │                 │
│  │ - Configures watch folder + upload    │                 │
│  └───────────────────────────────────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    SOLO/HUB MODE                            │
│                                                             │
│  Personal PC (localhost)                                   │
│  ┌──────────────────────────────────────┐                 │
│  │ openbio.exe (Solo Mode)              │                 │
│  │ ├─ openbio-server :3000              │                 │
│  │ ├─ UI (Full App)                     │                 │
│  │ └─ Spawns local agents:              │                 │
│  │    ├─ openbio-agent :8080            │                 │
│  │    │  └─ No mDNS (localhost only)    │                 │
│  │    ├─ openbio-agent :8081            │                 │
│  │    │  └─ No mDNS (localhost only)    │                 │
│  │    └─ openbio-agent :8082            │                 │
│  │       └─ No mDNS (localhost only)    │                 │
│  └──────────────────────────────────────┘                 │
│           │ Configures via HTTP                            │
│           ▼                                                │
│  Each agent watches folder → uploads to localhost:3000    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
