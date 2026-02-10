# OpenBio-OS Laboratory Information Management System (LIMS)

This is the detailed project infrastructure for the OpenBio-OS Laboratory Information Management System (LIMS).

**Before implementing ANYTHING**

This document clarifies the correct architecture:
- **An Experiment is a Notebook** (they are the same thing, not separate)
- **Library = Standalone paper collection** (not linked to experiments)
- **The Freezer is the Inventory** (not a separate module)
- **The Freezer has a hiearchy**:
    - **Facility (Building, physical location, address)**
        - **Room**
            - **Freezer (A room may have multiple freezers)**
                - **Freezer Shelf**
                    - **Box (A box is dynamic in size and can have X rows and Y Columns)**
                            - **Sample (in a specific X,Y position in a Box)**
- **An Experiment can have many Samples** (not the other way around)
- **An Experiment can have many Data Files** (not the other way around)
- **Equipment is the control and command for agents**
- **Agents are the automatic data importers of the system**
- **A pipeline is a nextflow/snakemake UI**
- **A pipeline takes the data from one or many experiments, builds a csv file for nextflow/snakemake to process, and then saves the results to the experiment**
- **A visual insight is a UI that takes the data from a pipeline or a manual upload and creates a visual representation of the data**

------

## Project Executive Summary

OpenBio-OS is a comprehensive Laboratory Information Management System (LIMS) designed to streamline laboratory workflows while being flexible, enhance data management, and facilitate collaboration. The platform serves as a centralized hub for managing experiments, samples, equipment, and research data, ensuring data integrity and operational efficiency.

The LIMS has a specific project flow, but can be flexible to accommodate different laboratory needs. The system is built on a modular architecture that allows for easy customization and integration with other systems and manual data imports.

------

## Problem definition

### Problem 1: The "Air-Gapped" Reality

#### The Issue: 

Physical samples, lab notebooks, and digital data files live on completely different systems that do not talk to each other.

Physical: The tube is in Freezer 4, Box B. (Tracked in Excel or on paper).

Procedural: The protocol used to treat the cells is in a notebook (or Benchling).

Digital: The 50GB output file is on a hard drive in a folder on the desktop named Final_Run_v2.fastq.

The Pain Point: Six months later, you find the file Final_Run_v2.fastq. You have zero idea which patient it came from, or if the drug concentration was 5mM or 10mM. The data is useless.

#### Solution:

The "Unity" Schema: We create a unified, private data hub, including samples, locations, experiment protocols, notes, and we link via database tables.

Result: You click on a digital dot in the UMAP visualization, and it traces all the way back to the specific freezer slot the cell came from, pulls in the notes and tells you when machines were last calibrated.

### Problem 2: The "Bus Factor" & Compliance

#### The Issue: 

Vital knowledge lives in people's heads.

"Oh, Steve knows where the cancer samples are."

"Alice knows how to run the analysis script."

The Pain Point: Steve gets hit by a bus (or gets a job at Moderna). Alice goes on maternity leave. The lab grinds to a halt. The FDA audits you, and you can't prove who handled the sample.

#### Solution:

Inventory & Experiment Module: The "Source of Truth" is the database, not Steve's memory. 

### Problem 3: The "IT Barrier" (The Deployment Problem)

#### The Issue: 

Existing Enterprise software (Benchling, LIMS) is too expensive and complex for small labs. Open-source tools require a DevOps degree to install.

Small labs stay on Excel because they can't afford $20k/year or hire a Cloud Engineer.

The Pain Point: There is no "middle ground" software. It's either "Excel" (Too simple) or "Enterprise Cloud" (Too hard).

#### Solution:

The "Tauri Hub" Architecture: We bring "Enterprise-grade" structure to a "Double-click install" executable.

Zero Config: The Setup Wizard (Tier 1 & 2) democratizes access. A PhD student can set up a fully traceable lab system in 5 minutes without touching a command line.

### Problem 4: The "Black Box" of Analysis

#### The Issue: 

Biology is becoming Data Science.

Biologists can pipette, but they can't code Python/R.

Bioinformaticians can code, but they don't understand the wet lab context.

The Pain Point: The Biologist waits 2 weeks for the coder to generate a static PDF plot. They want to explore the data themselves, but they can't run the scripts.

#### Solution:

We wrap the complex math (WASM) in a friendly UI. The Biologist can "Gate" (draw lasso) and "Test" (T-Test) without writing a single line of code. We empower the domain expert to find the insight.

------

## The User Story: "From Freezer to Insight"

### 1. The Library (Weeks before)

You're resarching an idea, you need a library of papers you've read.

You open the Library module, import a DOI or upload a PDF.

You create a folder, "E-coli papers".

You write notes into the entry of the paper.

"This protocol was interesting."

"This is worth investigating."

**What Does NOT Live in Library:**
- ❌ NOT linked to specific experiments
- ❌ NO experimental notes (those go in experiments)

**What Lives in Library:**
- ✅ Research papers you've read or want to read
- ✅ Your notes/comments about each paper
- ✅ Citation metadata (authors, journal, DOI, etc.)
- ✅ PDF files of papers (optional)

### 2. The Inventory (Morning)

Action: You walk to the freezer. You have a new patient sample. In OpenBio:

#### Mobile App:

You scan the QR code on the tube.

You scan the QR code on "Box 4".

The Link: The database now knows: Sample P-405 is in Box 4, Slot A1.

#### Desktop App:

You open the "freezer" module on your laptop, and you see a visual representation of your freezer.

You create a sample in your desired slot.

The Link: The database now knows: Sample P-405 is in Box 4, Slot A1.

#### Innovation: 

You can auto import these into your expeirment notebook.

### 3. The Experiment Setup (Noon)

You've read some papers, they're in your library, you want to run an experiment.

Action: You decide to run an RNA-Seq experiment on the sample in your freezer. In OpenBio:

You click "New Experiment".

You select Sample P-405 from the list (it knows where it is).

You mention you started this protocol by following "Paper A" from the library.

The Link: The database now knows: Experiment 505 contains Sample P-405 and was started by following "Paper A".

### 4. The Lab Work (Afternoon)

Action: You take the sample out, prep it, and put it inside the Sequencer Machine. In OpenBio:

You open Experiment 505 (which has a built-in laboratory notebook).

You type in the notebook: "Used Protocol A, but added extra reagent @Reagent-SDS. @Sample-P-405."

The Link: If the data looks weird later, you know exactly what you changed. The @mentions preserve metadata snapshots.

### 5. The Data Haul (The next day)

Action: The Sequencer finishes. It spits out a 50GB file (run_data.fastq).

#### Scenario A: Enterprise (Automated)

The Ingest Agent (installed on the Sequencer PC, maybe across facilities or in the same room) sees the file, it can upload to a Cloud S3 bucket or a local NAS.

It checks the schedule: "Who booked the machine yesterday? Ah, User Steve for Experiment 505."

It automatically uploads the file to the Server.

#### Scenario B: Small Lab (Automated)

The Ingest Agent installed on your local WiFi network sees the file.

It checks the schedule, it uploads to the harddrive in your laboratory.

#### Scenario C: Solo (Automated)

You plug the sequencer into your laptop, set an output folder to be monitored by OpenBio.

OpenBio automatically uploads the file to your laptop.

#### Scenario D: Enterprise/Small Lab/Solo (Manual)

You copy the file from the Sequencer to a USB stick (or external hard drive).

You plug it into your laptop.

You drag the file into OpenBio.

OpenBio asks: "Which Experiment is this?"

You select Experiment 505.

The Link: The database now knows: File run_data.fastq belongs to Experiment 505 (which used Sample P-405).

The experiment permanently imports the metadata for the papers written notes and the smaples description so if the sample is deleted or the paper is removed from the library, the experiment will still have access to the information.

### 6. The Processing (Nextflow)

#### Problem: 

The raw text file is useless. We need numbers. To run a pipeline manually, a bioinformatician types this into a black terminal:

```bash
nextflow run nf-core/rnaseq \
  -profile docker \
  --input_fastq "/data/raw_data/sample_*.fastq.gz" \
  --genome "GRCh38" \
  --outdir "/data/results/rnaseq_output" \
  --email "[EMAIL_ADDRESS]"
```

We cannot ask a biologist to type that. They will make a typo, point to the wrong file, or delete their hard drive.

#### Solution: 

Once the file is uploaded, you can trigger a NextFlow workflow in the UI.

##### What happens: 

You open the Pipeline Module. Select an experiment, the experiment's data is imported into the pipeline.

A loading bar appears: "Processing Data..."

Under the hood: The Wrapper runs the math to turn the text strings into a count matrix.

The "Wrapper" is a Rust function that constructs that command string programmatically based on the database state.

It performs 4 specific jobs:

Job A: Dynamic Configuration (The Translation)

The user clicks "Analyze Experiment 505". The Wrapper looks up Experiment 505 in the database.

Wrapper: "Okay, Exp 505 involves Sample A and Sample B."

Wrapper: "Sample A is located at C:\OpenBio\Files\run_1.fastq."

Wrapper: "I will generate the samplesheet.csv automatically so the user doesn't have to."

Job B: Process Management (The Spawning)

Rust uses std::process::Command to actually launch the Nextflow binary. It treats Nextflow like a sub-program.

Job C: The "Live Stream" (User Feedback)

Nextflow prints huge amounts of text logs ("Processing 10%...", "Error in Step 4").

The Wrapper hooks into the stdout pipe (the text output) of the Nextflow process.

It reads line-by-line in real-time.

It sends those lines over a WebSocket to the React Frontend.

Result: The user sees a "Terminal" window in the app that scrolls live, making them feel like a hacker without actually touching a command line.

Job D: The "Cleanup" (Auto-Linking)

This is the most critical part. When Nextflow finishes, it just dumps files in a folder. It doesn't tell the database "I'm done."

The Wrapper waits for the process to exit (child.wait()).

If exit_code == 0 (Success):

The Wrapper scans the output folder.

It finds matrix.mtx.

It updates the Database: "Create new DigitalAsset linked to Experiment 505."

Result: A new file is created: matrix.mtx. The matrix is uploaded to the database.

**NOTE:** All pipeline processing is computed on a local (Client) machine. Not on the server.

### 7. The Insight (Visualization)

#### Purpose:

The WASM/WebGL Engine.

Architecture

Data Flow:

Frontend requests file URL from API.

API returns Presigned S3 URL for enterprise mode (or Local File URL).

Frontend streams bytes -> WASM Memory.

Rendering: WASM parses -> WebGL draws.

Frontend: React + WASM + WebGL. 

1. The Problem: "The Static Image"
Usually, the pipeline outputs a static PDF. The biologist cannot interact with it. They cannot ask: "What is that weird cluster of cells in the top right?"

2. The Solution: The WASM Engine
We use WebAssembly (WASM) to run heavy math in the browser, and WebGL to render graphics that move at 60 frames per second.
	•	Architecture: The "Sidecar Pattern"
	◦	Stream A (The Heavy Math): React streams the matrix.mtx (Raw Numbers) directly into WASM Memory.
	◦	Stream B (The Context): React fetches the metadata.json (Sample Names) generated by the factory.
	◦	The Merge: When the user hovers a dot, React combines the WASM index with the JSON metadata to show the tooltip: "Sample P-405, Drug A."

	•	Feature A: The "Gating" (Lasso)
	◦	UI: User draws a freehand shape around a cluster.
	◦	WASM: Runs a "Point-in-Polygon" algorithm on 50,000 points.
	◦	Output: Returns a list of Cell IDs inside the shape.

	•	Feature B: The Stats (Differential Expression)
	◦	Trigger: User clicks "Analyze Selection".
	◦	WASM: Runs a Mann-Whitney U Test in parallel (using Rayon) for 20,000 genes.
	◦	Output: Returns the "Top Marker Genes" (e.g., Insulin is 5x higher in this cluster).

#### Flexibility:

This insight viewer is flexible for all outputs of Nextflow, it is not restricted to a single pipeline. It is a generic data viewer that can be used to view any type of data. It takes the specific type of nextflow pipeline which was ran (via pipeline metadata in the database or user selected workflow in the manual upload) and renders a specific insight viewer for that pipeline. 

#### Action:

The loading bar finishes. You get a notification: "Analysis Ready." 

In OpenBio:

You click "Create New Insight".

The WASM Engine loads the matrix.mtx.

You see the scatter plot (WebGL).

The Payoff: You hover over a red dot.

The Tooltip says: "This cell has high Insulin."

It also says: "This came from Sample P-405 (The one in Box 4)."

It also says: "You noted 'extra reagent' in the protocol."

##### The golden thread:

The Golden Thread: Pipeline → Insight

```
Pipeline Completes
      ↓
Creates matrix.mtx + metadata.json
      ↓
Updates DB: Experiment status = "Complete"
      ↓
User clicks "Insight" button
      ↓
Frontend requests file paths
      ↓
Rust streams matrix via memmap
      ↓
WASM parses into SharedArrayBuffer
      ↓
WebGL renders interactive visualization
      ↓
User hovers cell → Shows metadata from JSON
```

### 8. Equipment

The Equipment module is the command centre for the ingest agents.

In the equpment module you add a facility, then the facility has a room.

Inside the room you add a piece of equipment and it's relevant information: Microscope 201, last calibrated December, _needs to be calibrated every 200 days_.

OpenBio reminds you when your equipment was calibrated, it's saved in the database and the experiment knows how accurate the equipment used is.

------

## Architecture

### Technology Stack

The Client (Tauri Desktop App)

Framework: Tauri v2.

Frontend: Vite + React + TypeScript + TanStack Query + TailwindCSS + ShadCN/UI.

WASM Engine: Rust compiled to wasm32-unknown-unknown (for the Insight Module).

Visualization: regl or wgpu (WebGL).

The Server (Rust API)

Core: Axum (HTTP API).

Database: Prisma Client Rust.

Storage: Abstracted Trait (LocalFS or S3).

## Deployment Modes

### Solo Mode

The app can be deployed as both a server, client and agent.

#### The situation:

You're a solo PhD researcher. You have a laptop, a few reagents, and a sequencer. You don't have a server, and you don't have a team. You just want to get your work done.

#### The solution:

OpenBio runs locally on your laptop. It uses your laptop's hard drive for storage and your laptop's CPU for processing. It doesn't need an internet connection, and it doesn't need a server. It just works.

### Hub & Spoke Mode

The app can be deployed as both a server, client and agent.

#### The situation:

You have a small team, a single laboratory with a few people, you want to organise your data.

#### The solution:

OpenBio is deployed on one _beefy_ machine which has a large storage volume and is connected to the local network as a server. No one touches this machine, it stays on 24/7 and hums away in the corner, forgotten about.

Every team member has their own laptop or desktop and runs the client (user interface) locally. They connect to the server to get their data.

The server is broadcasting its information over mDNS, so you just click "find server" like you would connect to a WiFi network and find it is available. 

### Enterprise Mode

The app can be deployed as a docker container image to deploy the server to the cloud.

#### The situation:

You have a large team, multiple laboratories, you want to organise your data.

#### The solution:

OpenBio is deployed on a server in the cloud. Every team member has their own laptop or desktop and runs the client (user interface) locally. They connect to the server to get their data. The server is ran on Amazon or Googles cloud infrastructure and comes with the big-tech security and reliability.

## Setup Wizard

On the apps first intilisation, you are prompted to select a deployment mode. This will generate a config.toml file in the root of the application. This file is used to configure the application and is used to determine the deployment mode. The user will be prompted through a setup wizard to configure the application.

**Config Location:**
- **macOS**: `~/Library/Application Support/software.is-a.openbio/config.toml`
- **Windows**: `%APPDATA%/software.is-a.openbio/config.toml`
- **Linux**: `~/.local/share/software.is-a.openbio/config.toml`

### Solo Mode

In solo mode, the application will run locally on your machine. It will use your machine's hard drive for storage and your machine's CPU for processing. It will not need an internet connection, and it will not need a server. It just works, single click deployment.

1. Tauri launches an embeded server on the local system in a seperate thread
2. The client connects to the server at 127.0.0.1
3. The client can now use the application as normal

The database is a SQLite .db file located in the application data folder. All processing and storage is done on the laptop.

```
User's Computer
├── Tauri App (Client UI)
│   └── WASM Engine (processes data)
│   └── NextFlow Pipeline (runs on client)
└── Embedded Axum Server
    └── SQLite Database
    └── Local File Storage (/Users/admin/.../software.is-a.openbio/storage/)
```

### Hub & Spoke Mode

In hub & spoke mode, the application will run on a server in your local network. 

User opens Tauri App on their server, they click "host a lab".

The server broadcasts its IP address over mDNS, the UI hides and the server runs in the background. The server is now hosting the lab.

User opens Tauri App on their laptop, they click "join a lab", the UI launches but it doesn't spawn a server process.

The client discovers the server over mDNS and connects to it.

It will use the server's hard drive for storage and the clients's CPU for processing nextflow pipelines. It will not need an internet connection.

It just works, single click deployment.

```
Lab Server (Hub - 192.168.1.10)
├── Embedded Axum Server (port 3000)
│   └── SQLite Database
│   └── Local File Storage (/data/openbio/storage/)
└── mDNS broadcast

User's Laptop (Spoke - 192.168.1.50)
└── Tauri App (Client UI)
    └── WASM Engine (processes data)
    └── NextFlow Pipeline (runs on client)
```

### Enterprise Mode

In enterprise mode, the application creates a headless API server and will run in the cloud on a docker container. It will use a postgres database / S3 bucket for storage and the clients's CPU for processing nextflow pipelines. It will need an internet connection, and it will need a server. This requires a computer scientist to set up and maintain.

The employees connect to the API and the API directs data flow. The API is the central hub of the application.

```
AWS Cloud
├── Docker Container (API Server)
│   └── Postgres Database
│   └── S3 Bucket Configuration
└── S3 Bucket (s3://openbio-data/)
    └── experiments/
        └── exp-505/
            └── matrix.mtx

User's Laptop (anywhere with internet)
└── Tauri App (Client UI)
    └── WASM Engine (processes data)
    └── NextFlow Pipeline (runs on client)
```

### Agent Mode

#### What happens

The UI disappears, and the application runs as a background service. This has one purpose: detect output files from sequencers and upload them to the server. It will run on the same machine as the sequencer and upload to the database.

#### The process:

The Agent is "Locked" via the Experiment module. Once an agent is locked then any files it detects will be uploaded and attached to that specific experiment. If a machine is locked, another user can not use the same files for their own experiment. Once the machine is unlocked it will stop uploading files. If a machine is unlocked anyone can lock it to an experiment.

#### Three configuration modes:

Tier 1 (Solo mode): The client spawns a background process to watch a folder for new files. Typically the output folder of the sequencer. The sequencer is connected to the laptop. Those files are added to the database once they're created.

Tier 2 (hub & spoke mode): The agent broadcasts its IP address over mDNS, the UI hides and the server runs in the background. The server is now hosting the lab.

Tier 3 (enterprise mode): The client knows the IP address of the machine hosting the agent and connects to the agent, the client sends the agent the server IP address and the agent then uploads to the server once it has detected the output files. The server puts it in an S3 bucket.

------

## Implementation Q&A
Q: How does the Client know where the API is? 

A: Dynamic Context Injection.

On app launch, Rust determines the mode.

Rust emits a config_loaded event to the Frontend containing { apiUrl: "http://..." }.

React's QueryClient uses this URL for all requests.

Q: How does the Enterprise Docker Workflow work? 

A: The Dockerfile is API Only.

FROM rust:alpine.

Entrypoint: ./openbio-server.

It exposes port 3000.

Crucial: It does not launch or run any React files. The User already has the UI on their desktop.

Q: How do we handle Confirmable Databases? 

A: schema.prisma is the source of truth.

The Embedded Server runs prisma migrate deploy on the local SQLite file on startup.

The Enterprise Docker container runs prisma migrate deploy on the Postgres DB on startup.

No raw SQL is written regarding data generated by the application – not to be inserted, updated or deleted.

Q: How do we handle large files?

This guide explains how to move data from a 50GB file to a WebGL visualization without locking the UI or copying memory.
1. The Multi-Threaded Landscape
You will manage three distinct "zones" of execution:
• Zone A (Rust Core): Handles disk I/O, file streaming, and heavy pre-processing.
• Zone B (Web Worker/WASM): A background thread in the UI engine. Performs live math (Gating, T-Tests).
• Zone C (Main Thread/React): Only handles buttons and triggers WebGL draw calls.
2. Memory Map (Mmap) on the Backend
Don't use fs::read(). Use the memmap2 crate in the Rust Core. This allows the OS to map the 50GB file into the application's virtual address space without loading it all into RAM.
3. The SharedArrayBuffer Pipeline
To avoid the "JavaScript Tax," follow this transfer flow:
Step A: Initialization
1. React (Main Thread) creates a SharedArrayBuffer (SAB).
2. React sends a reference to this SAB to the Web Worker.
3. The Web Worker initializes the WASM Engine, pointing it at the SAB memory address.
Step B: The Data Stream
1. The Rust Core reads chunks of the biological data.
2. It sends these chunks to the Web Worker via Tauri's IPC as Uint8Array.
3. The Worker writes this data into the SAB.
Step C: The "React-less" Compute
1. When the user draws a "Lasso" in the UI, React sends only the coordinates of that lasso to the Worker.
2. The WASM Engine inside the Worker iterates over the data in the SAB.
3. It updates a "Selection Bitmask" (another SAB).
Step D: The Render
1. The WebGL Renderer uses the SABs as Vertex Buffer Objects (VBOs).
2. The GPU draws the points.
3. Crucial: React never sees the data points. It only sees a "Draw" command.
4. Critical Configuration
To allow threads to share memory in the WebView, you must set headers in your Tauri configuration to prevent security blocks:

5. Why this works
• No UI Lag: Since the WASM math is in a Worker, React's event loop is always free to handle clicks.
• No Memory Bloat: By using SharedArrayBuffer, you aren't creating copies of the data every time you want to run a calculation.
• Native Speed: The WASM runs at near-native speeds, and the memmap on the Rust side ensures you don't crash the user's computer by trying to fit a 50GB file into 8GB of RAM.

The Breakdown
• Rust Core (The Parent): This is the OS-level process. It has multiple native threads. It handles the "heavy lifting" (File I/O, Networking, Databases).
• The WebView (The Canvas): This is the window Tauri opens. It runs a JavaScript Engine.
• Main Thread (React): The "Boss" of the window. If this thread busy, the window freezes.
• Web Worker (JS Extra Thread): A "Sub-contractor" inside the window. It runs in the background. This is where your WASM should live.
2. Why WASM inside the Worker?
If you put your WASM math directly inside React (Main Thread) UI updates will fail.
By putting the WASM inside a Web Worker, you move the treadmill into a separate room.
3. How the "Shared Memory" bridge works
Since the Rust Core is a separate process from the WebView, they cannot share memory directly. They have to talk over a "bridge" (IPC).
The Trick:
1. Rust Core sends data chunks over the bridge to the Web Worker.
2. The Web Worker catches those chunks and stuffs them into a SharedArrayBuffer.
3. Now, the WASM (inside the worker) and your WebGL Renderer (in the main thread) can both "see" that same memory.

------

## Style Guidelines

Colour Pallete:

#17b978
#111111
#20e395
#118c5b
#2a2a2a
#000000
#ffffff

Dialog heders should be bg-white/5, background should be bg-neutral-900. Buttons should be text-sm, important forward indicating button fonts should be semi-bold.

------

## Auto updating

OpenBio uses different update mechanisms depending on deployment mode:

- **Local/Hub/Spoke modes**: Tauri auto-updater (desktop apps)
- **Enterprise mode**: Docker image updates

### Desktop App Updates (Tauri Updater)

#### Initial Setup

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
    "https://github.com/openbio-os/laboratory-information-management-system/releases/latest/download/latest.json"
  ]
  ```

#### Release Process

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

#### GitHub Actions (Automated)

Create `.github/workflows/release.yml`:

Add secrets to GitHub:
- `TAURI_PRIVATE_KEY`: Content of `~/.tauri/openbio.key`
- `TAURI_KEY_PASSWORD`: Password if you set one

### Docker Updates (Enterprise Mode)

#### Release Process

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

### Update Frequency

- **Check on startup**: Automatic (configured)
- **Manual check**: Can add a "Check for Updates" menu item

### Security

- Private key must remain secret
- Updates are verified using public key
- HTTPS required for update endpoints
- Tauri validates signatures before installing

------

## OpenBio Business Model: Instance-Based Licensing

### Executive Summary

**Instance-based licensing without user accounts**
- Charge per server/deployment, not per user
- No user management overhead
- Compliance-friendly for enterprises

### Pricing Tiers

### Solo Mode (FREE)
- Single researcher deployments
- Unlimited data
- No license required
- Forever free

### Hub Mode ($99/month-$990/year)
- Multi-researcher lab deployments
- Shared server
- $99/month or $990/year per instance
- 90-day free trial
- License key required after trial

### Enterprise Docker ($499/month-$4,990/year)
- Docker containerized deployment
- $499/month or $4,990/year per instance
- 90-day free trial
- Tied to specific Docker instance

### How It Works

#### User Flow

```
1. Download & Install
   ↓
2. Choose Deployment Mode
   ├─ Solo → Free, no license needed
   └─ Hub/Enterprise → Show payment options
      ├─ Start 90-day trial (generates license)
      └─ Go to openbio.is-a.software/pricing → Pay with Stripe → Get license key
   ↓
3. Enter License Key in Setup
   ↓
4. Validation
   ├─ Online: Check with backend API, cache locally
   └─ Offline: Use cached license (30-day grace period)
   ↓
5. License renews automatically (Stripe subscription)
```

### License Key Format

```
Example: LIC-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6

- Generated cryptographically
- Base58 encoded for readability
- Single key per instance
```

### Users Frontend (Tauri App)
- Detect deployment mode
- Show license dialog if needed
- Validate license (online/offline)
- Store cached license locally
- Poll if the license key is already on an active deployment via the OpenBio Busines Backend, if so, show a dialog to the user that they need to purchase a new license key or stop their old server.

### OpenBio Business Backend (Vercel + Supabase)
- **API Endpoints:**
  - `POST /api/license/validate` - Check license validity
  - `POST /api/license/purchase` - Start checkout or trial
  - `POST /api/stripe/webhook` - Handle payments
- **Database:** Supabase PostgreSQL
- **Payments:** Stripe subscriptions

### Database Tables

```sql
licenses
├── license_key (unique)
├── tier (hub, enterprise)
├── status (active, inactive, expired, revoked)
├── email (contact only)
├── organization_name
├── server_id (optional, for binding)
├── expires_at
├── stripe_subscription_id
└── metadata (JSONB)

license_validations
├── license_key (FK)
├── server_id
├── validated_at
├── valid (bool)
└── reason

stripe_webhooks
├── event_id (unique)
├── event_type
└── data
```

### Revenue Model

#### Example Scenarios

**Small Lab (Hub Mode, Annual)**
- $990/year = $82.50/month
- 3 researchers sharing 1 instance

**Enterprise Docker**
- $4,990/year = $415/month
- On-premise deployment

#### Projected Unit Economics (100 users)

| Tier | Users | Annual Revenue |
|------|-------|-----------------|
| Solo | 60 | $0 |
| Hub | 35 | $34,650 |
| Enterprise | 5 | $24,950 |
| **Total** | **100** | **$59,600** |

### Security Considerations

#### Key Protection
- Private keys stored in Supabase with encryption
- License validation requires HTTPS
- Stripe handles PCI compliance
- No sensitive data in client app

#### Fraud Prevention
- Online validation every 30 days required
- License revocation on payment failure
- Audit trail of all validations

#### No Data Collection
- No user tracking (no user accounts)
- License validation doesn't expose data
- Anonymous usage statistics only
- GDPR compliant (minimal data collection)

### Monetization Mechanics

#### Why This Works

1. **No User Accounts**
   - Eliminates account management overhead
   - Privacy-friendly for labs
   - Simpler compliance

2. **Instance-Based**
   - Easy to enforce (one active server = one license [+unlimited clients])
   - Fair pricing model
   - Scales with actual usage

3. **Soft Enforcement**
   - 90-day trial gets people invested
   - 30-day offline grace prevents anger
   - Non-blocking nags (not full lockout)
   - Focus on value, not punishment

4. **Open Source Trust**
   - Users know source is auditable
   - No hidden data collection
   - Support community adoption

### Support & Maintenance

#### Free Users (Solo)
- Community forums
- ChatGPT
- Documentation
- GitHub issues (The **Go-To** method for communicating issues)

#### Paid Users (Hub/Enterprise)
- Email support
- Guaranteed response time
- Custom deployment help

------

## How The Library, Freezer & Experiments Work Together

### @Mention System

When writing notes in an **Experiment**, you can type `@` to mention:

- **@samples** - Physical samples from inventory
- **@equipment** - Lab instruments
- **@papers** - Papers from your library (creates a reference)

When you @mention a paper from the library in an experiment:
1. The mention links to the Paper record
2. A snapshot is saved (title, authors, year, DOI, etc.)
3. The experiment now has a citation/reference to that paper
4. But the Paper itself doesn't "belong" to the experiment

### Example Workflow

1. **Add Paper to Library:**
   - Go to "Library" tab
   - Add paper: "Smith et al. 2024 - CRISPR Methods"
   - Write your notes: "Great protocol for gRNA design. Use section 3.2"

2. **Create Experiment:**
   - Go to "Experiments" tab
   - Create experiment: "CRISPR Screen - March 2024"
   - Write in the notebook area

3. **Reference the Paper:**
   ```
   Using protocol from @Smith-2024-CRISPR-Methods
   Modified the gRNA concentration to 10mM based on their findings.
   ```

4. **The Result:**
   - Paper stays in Library (not deleted when experiment ends)
   - Experiment has a mention/snapshot of the paper
   - You can use the same paper in multiple experiments

------

## Application Bundling (NextFlow + Docker)

OpenBio uses the "Skeleton Key" approach to avoid dependency hell for computer-illiterate users. Instead of bundling 2GB+ of tools in the installer, we ship a tiny micromamba binary that bootstraps the environment on first use.

### Architecture

#### What Gets Bundled (in the installer)
- **Micromamba binary** (~5MB per platform)
  - `src-tauri/bin/micromamba` (Linux x64)
  - `src-tauri/bin/micromamba.exe` (Windows x64)
  - `src-tauri/bin/micromamba` (macOS ARM64)
  - `src-tauri/bin/micromamba` (macOS x64)

#### What Gets Downloaded (on first pipeline access)
- **OpenJDK 17** (~150MB) - Java runtime for Nextflow
- **Nextflow** (~20MB) - Pipeline orchestrator
- **Docker** (~500MB) - Container runtime for pipelines
- **Dependencies** (~50MB) - Required libraries

Total bootstrap download: ~1GB (one-time)

### Directory Structure

```
AppData/software.is-a.openbio/
├── pipeline-env/
│   ├── micromamba/           # Micromamba root
│   │   ├── pkgs/            # Downloaded package cache
│   │   └── envs/
│   │       └── ...
│   └── env_config.json      # Saved environment info
```

### First-Time User Experience

#### Without Pipeline Access (No Setup)
```
User opens app → Uses Freezer/Library/Experiments → No setup needed
```

#### When Accessing Pipelines
```
1. User clicks "Pipelines" tab
2. App detects no environment exists
3. Shows setup wizard:
   ⏳ Downloading package manager...
   ⏳ Installing Java runtime...
   ⏳ Installing Nextflow...
4. Checks for Docker
   - If found: ✓ Ready to run pipelines
   - If missing: Shows Docker download guide
5. Success
   - ✓ Pipeline environment ready!
```

### Why This Works

#### For Non-Technical Users
- ✅ **Zero configuration** - Click and it works
- ✅ **No admin privileges** needed (except Docker)
- ✅ **No PATH modification**
- ✅ **No system-wide installation**
- ✅ **Self-contained** - Uninstall = delete folder

#### For Technical Users
- ✅ **Doesn't interfere** with system conda/Java/Nextflow
- ✅ **Reproducible** - Same environment every time
- ✅ **Isolated** - Pipeline deps don't pollute system

### Docker: The Exception

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

### Platform-Specific Notes

#### macOS
- **ARM64 (M1/M2/M3)**: `micromamba-osx-arm64`
- **Intel (x64)**: `micromamba-osx-64`
- Both ~5MB compressed

#### Windows
- **x64**: `micromamba.exe`
- ~6MB compressed
- No admin needed (installs to AppData)

#### Linux
- **x64**: `micromamba-linux-64`
- ~5MB compressed
- Works on Ubuntu, Fedora, Arch, etc.

### Download Sources

#### Micromamba Binaries
```
https://github.com/mamba-org/micromamba-releases/releases/latest/download/
- micromamba-linux-64
- micromamba-osx-64
- micromamba-osx-arm64
- micromamba-win-64.exe
```

#### Conda Channels Used
```yaml
channels:
  - conda-forge  # OpenJDK, general packages
  - bioconda     # Nextflow, bioinformatics tools
```

### Build Process

#### Step 1: Download Micromamba Binaries

Script is available in `scripts/download-micromamba.sh`

#### Step 2: Tauri Build Configuration
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

#### Step 3: Code Signing (macOS/Windows)
- Micromamba binaries must be signed
- Use Tauri's automatic code signing
- Notarize macOS app

### Runtime Execution

#### Pipeline Launch Flow
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

#### Environment Variables Set
```bash
JAVA_HOME=/Users/user/Library/Application Support/software.is-a.openbio/pipeline-env/micromamba/envs/openbio-pipelines
NXF_HOME=/Users/user/Library/Application Support/software.is-a.openbio/pipeline-env
PATH=/Users/user/Library/Application Support/software.is-a.openbio/pipeline-env/micromamba/envs/openbio-pipelines/bin:$PATH
```

### Possible Future Enhancement?

- [ ] Download micromamba on first launch (even smaller installer)
- [ ] Parallel package downloads (faster setup)
- [ ] Resume interrupted setups
- [ ] Offline mode (use cached packages)
- [ ] Auto-update Nextflow version
- [ ] Support multiple Nextflow versions (per-pipeline)
- [ ] Bundled nf-core pipeline cache
- [ ] Pre-pull common Docker images

### Troubleshooting

#### Setup Fails
- Check internet connection
- Check disk space (need ~10GB free)
- Check firewall (allows conda-forge/bioconda)
- View logs: `AppData/software.is-a.openbio/pipeline-env/setup.log`

### License Compliance

#### Micromamba
- **License**: BSD-3-Clause
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

#### OpenJDK
- **License**: GPL-2.0 with Classpath Exception
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

#### Nextflow
- **License**: Apache 2.0
- **Can redistribute**: ✅ Yes
- **Attribution**: Required

All licenses permit bundling and redistribution.

**Thank you to those amazing developers for their contribution to open-source software, making this project possible.**

------

## Prisma Client Information (Programmatic database handling using ORM)

This project uses [prisma-client-rust](https://github.com/Brendonovich/prisma-client-rust) for database access.

### Workflow for Schema Changes

When you modify `database/schema.prisma`:

1. **Create a migration:**
   ```bash
   cargo prisma migrate dev --name describe_your_change
   ```
   
   This generates:
   - A migration SQL file in `database/migrations/`
   - Updates the Prisma client

2. **Build and test:**
   ```bash
   cargo build
   ```

The app will automatically apply all pending migrations on startup!

### How It Works

- **Development**: Migrations are embedded at compile-time from `database/migrations/`
- **Runtime**: On app startup, the migration system:
  1. Creates `_prisma_migrations` tracking table
  2. Checks which migrations have been applied
  3. Applies pending migrations in order
  4. Each user's local database is automatically migrated

### Notes

- Migrations are embedded in the binary - no separate migration files needed at runtime
- Each user gets automatic database migrations on first launch
- Migration tracking is compatible with Prisma's standard `_prisma_migrations` table
- Never edit generated files in `database/migrations/` manually and never modify the database by writing raw SQL files, all applicaiton data should be handled via the Prisma client and its migrations generated by the prisma migrate command and prisma.schema in the database folder.

------

