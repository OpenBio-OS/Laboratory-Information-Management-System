# Data Flow Architecture - Clarification

## Where Does Processing Happen?

**ALL data processing happens CLIENT-SIDE in the browser WASM module.**

The server NEVER processes biological data - it only stores and serves files.

## The Three Deployment Modes

### 1. Solo Mode (Client = Server, same computer)

```
User's Computer
├── Tauri App (Client UI)
│   └── WASM Engine (processes data)
└── Embedded Axum Server
    └── SQLite Database
    └── Local File Storage (/Users/admin/.../OpenBio/storage/)
```

**Data Flow:**
1. User clicks "View Data" 
2. Frontend → Tauri Command: `get_experiment_files(exp_id)`
3. Server → Response: `{ matrixUrl: "file:///Users/.../matrix.mtx" }`
4. Tauri reads local file, streams chunks to WASM Worker
5. WASM parses data into SharedArrayBuffer
6. WebGL renders from SharedArrayBuffer

**Key Point:** No network involved. File read is direct from disk.

### 2. Hub+Spoke Mode (Server on LAN, clients connect)

```
Lab Server (Hub - 192.168.1.10)
├── Embedded Axum Server (port 3000)
│   └── SQLite Database
│   └── Local File Storage (/data/openbio/storage/)
└── mDNS broadcast

User's Laptop (Spoke - 192.168.1.50)
└── Tauri App (Client UI)
    └── WASM Engine (processes data)
```

**Data Flow:**
1. User clicks "View Data"
2. Frontend → HTTP POST to http://192.168.1.10:3000/api/experiments/{id}/files
3. Server → Response: `{ matrixUrl: "http://192.168.1.10:3000/files/exp-505/matrix.mtx" }`
4. Tauri fetches file from server via HTTP, streams chunks to WASM Worker
5. WASM parses data into SharedArrayBuffer (on client laptop)
6. WebGL renders from SharedArrayBuffer (on client laptop)

**Key Point:** File downloads to client over LAN, then client processes it locally.

### 3. Enterprise Mode (Cloud server, S3 storage)

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
```

**Data Flow:**
1. User clicks "View Data"
2. Frontend → HTTPS POST to https://api.openbio.com/experiments/{id}/files
3. Server → Response: `{ matrixUrl: "https://openbio-data.s3.amazonaws.com/exp-505/matrix.mtx?signature=..." }`
4. Tauri fetches file directly from S3 (NOT through API server), streams chunks to WASM Worker
5. WASM parses data into SharedArrayBuffer (on client laptop)
6. WebGL renders from SharedArrayBuffer (on client laptop)

**Key Point:** Client downloads directly from S3 using presigned URL. API server never touches the file.

## Storage Abstraction Layer

The server has a storage trait that handles both modes:

```rust
pub trait Storage {
    async fn store(&self, key: &str, data: Vec<u8>) -> Result<()>;
    async fn get_url(&self, key: &str) -> Result<String>;
}

// Solo + Hub Mode
pub struct LocalStorage {
    base_path: PathBuf,
}

impl Storage for LocalStorage {
    async fn get_url(&self, key: &str) -> Result<String> {
        // Solo: Returns file:/// path
        // Hub: Returns http://server-ip:port/files/{key}
    }
}

// Enterprise Mode
pub struct S3Storage {
    bucket: String,
    region: String,
}

impl Storage for S3Storage {
    async fn get_url(&self, key: &str) -> Result<String> {
        // Returns presigned S3 URL with 1 hour expiration
        // https://bucket.s3.region.amazonaws.com/{key}?signature=...
    }
}
```

## Why Client-Side Processing?

**Advantages:**
1. **Scalability:** Server doesn't get bogged down with computation
2. **Responsiveness:** UI can stay interactive during processing
3. **Cost:** Server only needs to serve files, not process 50GB datasets
4. **Security:** Sensitive data can stay encrypted until client decrypts

**How We Handle Large Files:**
- Use SharedArrayBuffer (no copying)
- Memory-mapped I/O on Tauri side
- Streaming chunks (don't load entire file at once)
- WASM near-native speed

## Current Implementation Status

**What's Built:**
- ✅ WASM engine with matrix parsing, gating, statistics
- ✅ Web Worker infrastructure  
- ✅ Tauri commands skeleton for file streaming
- ✅ React components

**What Needs Implementation:**
- [ ] Storage abstraction layer in openbio-server
- [ ] Presigned S3 URL generation for Enterprise mode
- [ ] HTTP file serving endpoint for Hub mode
- [ ] Tauri file fetch for all three modes
- [ ] WASM module build integration

## Next Steps

1. **Implement Storage Layer:**
   - Create `Storage` trait in `openbio-core`
   - Implement `LocalStorage` and `S3Storage`
   - Wire into server state

2. **Fix Tauri Commands:**
   - Update `get_experiment_files` to use Storage trait
   - Update `stream_file_chunk` to handle URLs not just paths
   - Add S3 fetch capability

3. **Build WASM Module:**
   ```bash
   cd crates/openbio-wasm
   wasm-pack build --target web
   cp -r pkg ../../../web/src/wasm/
   ```

4. **Test Each Mode:**
   - Solo: Direct file read
   - Hub: HTTP fetch from local server
   - Enterprise: S3 presigned URL fetch

Does this clarify the architecture?
