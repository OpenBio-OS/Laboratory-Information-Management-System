# Project OpenBio: Master Architecture & Implementation Guide

## ⚠️ CRITICAL: Read EXPERIMENTS_AND_LIBRARY.md First

**Before implementing ANYTHING related to experiments or notebooks:**

👉 **READ: [docs/EXPERIMENTS_AND_LIBRARY.md](./EXPERIMENTS_AND_LIBRARY.md)**

This document clarifies the correct architecture:
- **Experiments = Notebooks** (they are the same thing, not separate)
- **Library = Standalone paper collection** (not linked to experiments)
- Do NOT create separate Notebook models or endpoints

## Problem definition

Problem 1: The "Air-Gapped" Reality

The Issue: Physical samples, lab notebooks, and digital data files live on completely different systems that do not talk to each other.

Physical: The tube is in Freezer 4, Box B. (Tracked in Excel or on paper).

Procedural: The protocol used to treat the cells is in a notebook (or Benchling).

Digital: The 50GB output file is on a hard drive named Final_Run_v2.fastq.

The Pain Point: Six months later, you find the file Final_Run_v2.fastq. You have zero idea which patient it came from, or if the drug concentration was 5mM or 10mM. The data is useless.

Problem 1 OpenBio Solution:

The "Unity" Schema: We force a hard link. You cannot import a file without tagging it to an Experiment. You cannot create an Experiment without tagging a Physical Sample.

Result: You click on a digital dot in the UMAP visualization, and it traces all the way back to the specific freezer slot the cell came from.

Problem 2: The "Bus Factor" & Compliance

The Issue: Vital knowledge lives in people's heads.

"Oh, Steve knows where the cancer samples are."

"Alice knows how to run the analysis script."

The Pain Point: Steve gets hit by a bus (or gets a job at Moderna). Alice goes on maternity leave. The lab grinds to a halt. The FDA audits you, and you can't prove who handled the sample.

Problem 2 OpenBio Solution:

Module A (Inventory): The "Source of Truth" is the database, not Steve's memory.

Module B (Experiment notebook): Git-backed protocols mean every change is timestamped and authored. We know exactly what changed and when.

Problem 3: The "IT Barrier" (The Deployment Problem)

The Issue: Existing Enterprise software (Benchling, LIMS) is too expensive and complex for small labs. Open-source tools require a DevOps degree to install.

Small labs stay on Excel because they can't afford $20k/year or hire a Cloud Engineer.

The Pain Point: There is no "middle ground" software. It's either "Excel" (Too simple) or "Enterprise Cloud" (Too hard).

Problem 3 OpenBio Solution:

The "Tauri Hub" Architecture: We bring "Enterprise-grade" structure to a "Double-click install" executable.

Zero Config: The Setup Wizard (Tier 1 & 2) democratizes access. A PhD student can set up a fully traceable lab system in 5 minutes without touching a command line.

Problem 4: The "Black Box" of Analysis

The Issue: Biology is becoming Data Science.

Biologists can pipette, but they can't code Python/R.

Bioinformaticians can code, but they don't understand the wet lab context.

The Pain Point: The Biologist waits 2 weeks for the coder to generate a static PDF plot. They want to explore the data themselves, but they can't run the scripts.

Problem 4 OpenBio Solution:

We wrap the complex math (WASM) in a friendly UI. The Biologist can "Gate" (draw lasso) and "Test" (T-Test) without writing a single line of code. We empower the domain expert to find the insight.

## The User Story: "From Freezer to Insight"

1. The Inventory (Morning)

Action: You walk to the freezer. You have a new patient sample. In OpenBio:

You scan the QR code on the tube.

You scan the QR code on "Box 4".

The Link: The database now knows: Sample P-405 is in Box 4, Slot A1.

2. The Experiment Setup (Noon)

Action: You decide to run an RNA-Seq experiment on that sample. In OpenBio:

You click "New Experiment".

You select Sample P-405 from the list (it knows where it is).

The Link: The database now knows: Experiment 505 contains Sample P-405.

3. The Lab Work (Afternoon)

Action: You take the sample out, prep it, and put it inside the Sequencer Machine. In OpenBio:

You open Experiment 505 (which has a built-in laboratory notebook).

You type in the notebook: "Used Protocol A, but added extra reagent. @Sample-P-405 from @Freezer-4."

The Link: If the data looks weird later, you know exactly what you changed. The @mentions preserve metadata snapshots.

4. The Data Haul (The next day)

Action: The Sequencer finishes. It spits out a 50GB file (run_data.fastq).

Scenario A: Enterprise (Automated)

The Ingest Agent (installed on the Sequencer PC) sees the file.

It checks the schedule: "Who booked the machine yesterday? Ah, User Steve for Experiment 505."

It automatically uploads the file to the Server.

Scenario B: Small Lab (Automated)

The Ingest Agent sees a new file.

It checks the schedule, it uploads to the hub.

Scenario C: Solo (Manual)

You copy the file from the Sequencer to a USB stick (or external hard drive).

You plug it into your laptop.

You drag the file into OpenBio.

OpenBio asks: "Which Experiment is this?"

You select Experiment 505.

The Link: The database now knows: File run_data.fastq belongs to Experiment 505 (which belongs to Sample P-405).

5. The Processing (Nextflow)

Action: The raw text file is useless. We need numbers. In OpenBio:

As soon as the file lands (Step 4), OpenBio automatically triggers Nextflow.

What happens: A loading bar appears: "Processing Data..."

Under the hood: The Wrapper runs the math to turn the text strings into a count matrix.

Result: A new file is created: matrix.mtx.

6. The Insight (Visualization)

Action: The loading bar finishes. You get a notification: "Analysis Ready." In OpenBio:

You click "View".

The WASM Engine loads the matrix.mtx.

You see the scatter plot (WebGL).

The Payoff: You hover over a red dot.

The Tooltip says: "This cell has high Insulin."

It also says: "This came from Sample P-405 (The one in Box 4)."

It also says: "You noted 'extra reagent' in the protocol."

## Architecture

### Project Overview

OpenBio is a local-first, modular "Biological Operating System" designed to bridge the gap between physical lab inventory, digital experimental notes, and computational analysis.

Core Philosophy: "Thick Client, Flexible Backend."

The UI: Always a Native Desktop App (Tauri). It never runs in the browser.

The Backend: Can be embedded (Local) or remote (Cloud).

Traceability: Every digital dot on a screen must be traceable back to a physical QR code on a tube.

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

Deployment:

Embedded: Runs as a background thread inside the Tauri App (Tier 1 & 2).

Headless: Runs as a Docker container (API Only) for Enterprise (Tier 3).

### Deployment Tiers (Configuration-Driven)

The User Experience is always the same app. The difference is where the data lives. The application checks for config.toml on launch. If missing, it redirects to the Setup Wizard route (/setup) to configure the deployment tier.

#### Setup Wizard:

Generates config.toml.

Redirects to setup wizard.

The user sees a UI:

1. Option A/Tier 1: "Just Me" (Solo Mode)

Context: Single User.

App Behavior:

Tauri starts.

Spawns Embedded Axum Server on 127.0.0.1.

Frontend connects to 127.0.0.1.

DB is a local SQLite file.

Result: The entire application is contained to a single machine, runs fully offline on localhost.

2. Option B/Tier 2: Small Lab (2-10 people on a LAN) (Hub & Spoke)

Context: Small Lab (2-10 people). Hub & Spoke model using bonjour.

App Behavior (The Hub):

User Action: Clicks "Host a Lab".

System Action: Sets mode = "hub".

Embedded Server restarts, listens on 0.0.0.0 (Public).

Broadcasts _openbio._tcp via mDNS.

App Behavior (The Spoke):

User opens Tauri App on their laptop.

User Action: Clicks "Join a Lab".

System action: Sets mode = "spoke".

App scans mDNS, finds "Lab Hub".

Frontend connects to Hub IP.

3. Option C/Tier 3: Large Enterprise (Remote API)

Context: Corporate Lab with mutliple facilities

App Behavior (Client):

User opens Tauri App.

No Embedded Server is spawned.

User configures "Enterprise URL" (e.g., https://api.biotech.com).

Frontend connects directly to that URL.

Server Behavior (Docker):

IT deploys API-Only Docker Image, pulled from docker hub.

Connects to Postgres + S3, configured by computer scientists in an IT department in a docker config.

Result: App acts as a frontend for the remote Docker API and DB/S3.

### Module Specifications

Below are the independent modules which will communicate via the API and DB.

#### Module A: The Freezer (Inventory & Identity)

Core Logic: "Polymorphic Storage." A Container stores its layout as JSON.

Hierarchy: Facility -> Room -> Freezer -> Shelf -> Box.

Facility: (e.g., "Building A")

Room: (e.g., "Room 304 - Wet Lab")

Unit: (e.g., "Freezer #4 (The -80°C)")

Shelf: (e.g., "Shelf 2")

Rack: (e.g., "Rack B - Vertical Metal Holder")

Box: (e.g., "Box 5 - 9x9 Cryobox")

Position: (e.g., "Row A, Col 1")

QR Workflow:

1. Scan Context (Freezer/Shelf QR).

2. Scan Sample (Tube QR).

3. Place in "Box Grid" UI.

4. DB records location.

#### Module B: The Experiment Notebook (Protocol)

Backend: Git-backed Markdown.

Tier 1/2: Writes to AppData/notebooks.

Tier 3: API handles Git commits on the server side.

UI: Markdown Editor with Smart Linking (@Sample_ID) to Inventory (freezer module + DB, keeping meta data about when the sample was frozen, used, and which samples were used).

#### Module C: Pipeline Automator (The Factory)

Backend: Wrapper around Nextflow/Snakemake.

1. The Problem: The "Wall of Text"

To run a pipeline manually, a bioinformatician types this into a black terminal:

```bash
nextflow run nf-core/rnaseq \
    --input /data/samplesheet.csv \
    --outdir /data/results \
    --genome GRCh38 \
    --min_mapped_reads 5 \
    -profile docker
```
We cannot ask a biologist to type that. They will make a typo, point to the wrong file, or delete their hard drive.

2. The Solution: The Rust Wrapper

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

#### Module D: The Ingest Agent (Separate Rust Binary):

Configuration: Agent must be configured with the Target API URL.

Tier 2: Discovers Hub via mDNS.

Tier 3: Configured with api url and API Key.

Action: Watches output folder -> Uploads to S3 -> Tags with Experiment ID via API.

Auto-Linking: Output files are automatically linked as children of the input Sample.

Deployment: Installed on Instrument PCs (Sequencers/Microscopes).

Config: Runs with flags: --machine-id="Seq-1" --api-url="http://hub-ip:3000" --watch-dir="/Data".

Logic (The "Handshake"):

Watch: Uses notify crate to detect new file creation (e.g., run_12.fastq).

Ping: Sends POST /api/agent/handshake with { machine_id: "Seq-1", timestamp: Now }.

Match: API checks DB: "Is there an 'Active' Experiment scheduled for Seq-1 right now?"

Response: API replies: { experiment_id: 505, tags: ["cancer", "patient-A"] }.

Tag & Upload: Agent attaches metadata and streams file to S3/Local Storage.

#### Module E: Insight (The Single-Cell Explorer)

The WASM/WebGL Engine.

Architecture

Data Flow:

Frontend requests file URL from API.

API returns Presigned S3 URL (or Local File URL).

Frontend streams bytes -> WASM Memory.

Rendering: WASM parses -> WebGL draws.

#### Module F: Library

The Problem: Scientists have 400 PDFs in a folder and 50 protocol versions.

The Feature: A Zotero-like reference manager that supports Markdown notes.

The Link: You can "@cite" a paper inside your Notebook (Module B).

The Benefit: When writing the final paper, OpenBio generates your bibliography based on the papers you actually looked at while doing the experiments.

#### Module G: Equipment calibration scheduler

Enter your equipment, calibration schedule to get automatic updates when equipment needs to be recalibrated.

The Feature: A digital logbook for every machine (Sequencer, PCR, Fridge).

The Link: Every data file ingested by the Agent (Module D) is tagged with the specific "Machine ID" and its "Last Calibration Date."

Insight: If a batch of data looks "noisy," the PI can check if the machine was overdue for service.

##### Module Roadmap

1. Data Engine: WASM parse_mtx (Zero-copy).

2. Renderer: WebGL Scatter Plot (Pan/Zoom).

3. Gating: WASM Ray-Casting (is_point_in_polygon).

4. Stats: T-Tests/Parallel Mann-Whitney U Test in WASM.

## Development Roadmap (Prompts for Antigravity)

### Phase 1: The Client, Core & Wizard

"Scaffold a Tauri v2 workspace. Implement startup:

Check config.toml.

If mode = local, spawn embedded Axum server.

If mode = hub, spawn embedded Axum server and broadcast mDNS.

if mode = spoke, check for broadcasted mDNS.

If mode = enterprise, skip server spawn and inject the remote API URL into React Context."

### Phase 2: Database & Inventory

"Initialize Prisma Client Rust. Define Sample, Container, Experiment schema. Build the React 'Box Grid' component."

### Phase 3: Networking & Discovery

"Implement mDNS in Rust. Build the 'Connection Settings' UI in React allowing users to switch between 'Local', 'Hub Discovery', and 'Enterprise URL' modes."

### Phase 4: Pipelines & Agent

"Build the 'Ingest Agent' CLI. Add a config flag --api-url for Enterprise mode. Implement the Nextflow wrapper command in the API."

## Implementation Q&A
Q: How does the Client know where the API is? A: Dynamic Context Injection.

On app launch, Rust determines the mode.

Rust emits a config_loaded event to the Frontend containing { apiUrl: "http://..." }.

React's QueryClient uses this URL for all requests.

Q: How does the Enterprise Docker Workflow work? A: The Dockerfile is API Only.

FROM rust:alpine.

Entrypoint: ./openbio-server.

It exposes port 3000.

Crucial: It does not contain React files. The User already has the UI on their desktop.

Q: How do we handle Confirmable Databases? A: schema.prisma is the source of truth.

The Embedded Server runs prisma migrate deploy on the local SQLite file on startup.

The Enterprise Docker container runs prisma migrate deploy on the Postgres DB on startup.

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

# Extracurricular

We also need a landing and advertising page for a place to explain and host downloadable executables (maybe on github pages), and a readme.md for github for developer audiences.

