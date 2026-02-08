# OpenBio–OS: Laboratory Information Management System (OBOS LIMS)

![Banner](https://raw.githubusercontent.com/OpenBio-OS/.github/refs/heads/main/profile/LIMS.png)

_Local-first Laboratory Information Management System built with Tauri (Rust) and React (TypeScript)._

## Prerequisites

- Node.js
- Rust (stable)
- Tauri prerequisites (see [Tauri docs](https://tauri.app/v1/guides/getting-started/prerequisites))

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Prisma Client Rust CLI:
   ```bash
   cargo install prisma-client-rust-cli
   ```
   *Required only once - generates the Rust client from the schema.*

3. Download micromamba binaries (required for pipeline features):
   ```bash
   ./scripts/download-micromamba.sh
   ```
   *Downloads platform-specific binaries (~60MB total). Required before building the app.*

## Running

Start the development server:
```bash
npm run tauri dev
```

**That's it!** The Prisma client is automatically regenerated on build if the schema changes. The database file (`openbio.db`) is created automatically in the project root on first run.