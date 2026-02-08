//! OpenBio Agent Library
//! 
//! Runs on laboratory equipment to watch directories and upload files.
//! Exposes HTTP API for configuration and status.
//! Broadcasts presence via mDNS for discovery by clients.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use anyhow::Result;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn, error};

/// Agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// ID of equipment this agent monitors
    pub equipment_id: Option<String>,
    
    /// Human-readable name for this agent (for mDNS discovery)
    /// e.g. "Microscope Room 301", "Flow Cytometer", "Freezer Monitor"
    pub agent_name: Option<String>,
    
    /// Directory to watch for new files
    pub watch_dir: Option<PathBuf>,
    
    /// API URL to upload files to (Hub or Enterprise)
    pub upload_api_url: Option<String>,
    
    /// API key for authentication
    pub api_key: Option<String>,
}

/// Agent state
#[derive(Clone)]
pub struct AgentState {
    config: Arc<Mutex<AgentConfig>>,
    locked_by: Arc<Mutex<Option<String>>>,
    /// Handle to stop the file watcher
    watcher_active: Arc<Mutex<bool>>,
    /// Map of known files -> (size, modified_time) to detect changes
    known_files: Arc<Mutex<HashMap<PathBuf, (u64, SystemTime)>>>,
}

impl AgentState {
    pub fn new(config: AgentConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            locked_by: Arc::new(Mutex::new(None)),
            watcher_active: Arc::new(Mutex::new(false)),
            known_files: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Run the agent HTTP server
pub async fn run_agent_server(
    port: u16,
    equipment_id: Option<String>,
    agent_name: Option<String>,
) -> Result<()> {
    let config = AgentConfig {
        equipment_id,
        agent_name: agent_name.clone(),
        watch_dir: None,
        upload_api_url: None,
        api_key: None,
    };
    
    let state = AgentState::new(config);

    // Start mDNS broadcast
    let broadcast_name = agent_name;
    tokio::spawn(async move {
        if let Err(e) = broadcast_mdns(port, broadcast_name).await {
            warn!("mDNS broadcast failed: {}", e);
        }
    });

    // Build HTTP API
    let app = Router::new()
        .route("/", get(get_status))
        .route("/config", get(get_config).post(set_config))
        .route("/lock", post(lock_agent))
        .route("/unlock", post(unlock_agent))
        .route("/start", post(start_watching))
        .route("/stop", post(stop_watching))
        .with_state(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    info!("OpenBio Agent listening on {}", addr);
    info!("Broadcasting via mDNS as '_openbio-agent._tcp.local.'");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Broadcast agent presence via mDNS
async fn broadcast_mdns(port: u16, agent_name: Option<String>) -> Result<()> {
    let mdns = ServiceDaemon::new()?;
    
    let service_type = "_openbio-agent._tcp.local.";
    
    // Use agent_name if provided, otherwise fallback to hostname
    let instance_name = if let Some(name) = agent_name {
        name
    } else {
        format!("OpenBio Agent on {}", hostname::get()?.to_string_lossy())
    };
    
    let service_info = ServiceInfo::new(
        service_type,
        &instance_name,
        &instance_name,
        "",
        port,
        None,
    )?;
    
    mdns.register(service_info)?;
    info!("mDNS service registered: {}", instance_name);
    
    // Keep the service alive
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    }
}

/// Upload a file to the server's ingest endpoint
async fn upload_file_to_server(api_url: &str, equipment_id: &str, file_path: &PathBuf) -> Result<()> {
    let filename = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let file_data = tokio::fs::read(file_path).await?;
    let file_size = file_data.len();

    // Guess mime type from extension
    let mime_type = match file_path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("tif") | Some("tiff") => "image/tiff",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("csv") => "text/csv",
        Some("tsv") => "text/tab-separated-values",
        Some("txt") => "text/plain",
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("xls") => "application/vnd.ms-excel",
        Some("zip") => "application/zip",
        Some("gz") => "application/gzip",
        Some("fasta") | Some("fa") => "text/plain",
        Some("fastq") | Some("fq") => "text/plain",
        Some("bam") => "application/octet-stream",
        Some("vcf") => "text/plain",
        _ => "application/octet-stream",
    };

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(file_data)
        .file_name(filename.clone())
        .mime_str(mime_type)?;

    let form = reqwest::multipart::Form::new()
        .part("file", file_part);

    let client = reqwest::Client::new();
    let url = format!("{}/api/equipment/{}/ingest", api_url, equipment_id);

    info!("Uploading {} ({} bytes) to {}", filename, file_size, url);

    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await?;

    if response.status().is_success() {
        info!("Successfully uploaded {}", filename);
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("Failed to upload {}: {} - {}", filename, status, body);
        anyhow::bail!("Upload failed: {} - {}", status, body);
    }

    Ok(())
}

/// Scan a directory for existing files and record them as known
fn scan_existing_files(dir: &PathBuf) -> HashMap<PathBuf, (u64, SystemTime)> {
    let mut files = HashMap::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = std::fs::metadata(&path) {
                    let size = meta.len();
                    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    files.insert(path, (size, mtime));
                }
            }
        }
    }
    files
}

/// Start the file watcher background task
fn spawn_file_watcher(state: AgentState) {
    let config = state.config.lock().unwrap().clone();
    
    let watch_dir = match &config.watch_dir {
        Some(dir) => dir.clone(),
        None => {
            warn!("No watch directory configured, cannot start watcher");
            return;
        }
    };
    
    let api_url = match &config.upload_api_url {
        Some(url) => url.clone(),
        None => {
            warn!("No upload API URL configured, cannot start watcher");
            return;
        }
    };
    
    let equipment_id = match &config.equipment_id {
        Some(id) => id.clone(),
        None => {
            warn!("No equipment ID configured, cannot start watcher");
            return;
        }
    };
    
    // Scan existing files so we don't re-upload them
    let existing = scan_existing_files(&watch_dir);
    {
        let mut known = state.known_files.lock().unwrap();
        *known = existing;
    }
    
    info!("Starting file watcher on {:?} ({} existing files)", watch_dir, state.known_files.lock().unwrap().len());
    
    // Mark watcher as active
    *state.watcher_active.lock().unwrap() = true;
    
    let watcher_active = state.watcher_active.clone();
    let known_files = state.known_files.clone();
    
    // Use a channel to bridge sync notify callbacks to async tokio
    let (tx, mut rx) = mpsc::channel::<PathBuf>(256);
    
    // Spawn the notify watcher in a blocking thread
    let watch_dir_clone = watch_dir.clone();
    std::thread::spawn(move || {
        let tx_clone = tx.clone();
        let mut watcher = match RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                match res {
                    Ok(event) => {
                        // We care about newly created or modified files
                        match event.kind {
                            EventKind::Create(_) | EventKind::Modify(_) => {
                                for path in event.paths {
                                    if path.is_file() {
                                        let _ = tx_clone.blocking_send(path);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        error!("File watcher error: {}", e);
                    }
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                error!("Failed to create file watcher: {}", e);
                return;
            }
        };
        
        if let Err(e) = watcher.watch(&watch_dir_clone, RecursiveMode::NonRecursive) {
            error!("Failed to watch directory {:?}: {}", watch_dir_clone, e);
            return;
        }
        
        info!("File watcher active on {:?}", watch_dir_clone);
        
        // Keep thread alive while watcher is active
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            // Note: watcher is dropped when this thread exits
        }
    });
    
    // Spawn async task to process file events and upload.
    // We debounce: wait for events to settle, then deduplicate by path.
    tokio::spawn(async move {
        loop {
            // Wait for the first event (blocks until something arrives)
            let first = match rx.recv().await {
                Some(p) => p,
                None => break, // channel closed
            };

            // Check if watcher is still active
            if !*watcher_active.lock().unwrap() {
                info!("Watcher deactivated, stopping upload processor");
                break;
            }

            // Collect the first path and then drain any further events that
            // arrive within a 1.5-second debounce window.  This collapses the
            // Create + Modify burst that `notify` fires into a single upload.
            let mut pending = std::collections::HashSet::<PathBuf>::new();
            pending.insert(first);

            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(1500);
            loop {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match tokio::time::timeout(remaining, rx.recv()).await {
                    Ok(Some(p)) => { pending.insert(p); }
                    _ => break,
                }
            }

            // Process each unique path once
            for path in pending {
                // Verify file still exists and is not empty, and read metadata
                let meta = match tokio::fs::metadata(&path).await {
                    Ok(m) if m.len() > 0 => m,
                    _ => continue,
                };
                let size = meta.len();
                let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                // Skip if we already uploaded this exact version (same size + mtime)
                {
                    let known = known_files.lock().unwrap();
                    if let Some(&(known_size, known_mtime)) = known.get(&path) {
                        if known_size == size && known_mtime == mtime {
                            continue;
                        }
                    }
                }

                // Upload the file
                match upload_file_to_server(&api_url, &equipment_id, &path).await {
                    Ok(()) => {
                        // Re-read metadata after upload in case it changed during transfer
                        let final_meta = tokio::fs::metadata(&path).await;
                        let (final_size, final_mtime) = match final_meta {
                            Ok(m) => (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                            _ => (size, mtime),
                        };
                        known_files.lock().unwrap().insert(path.clone(), (final_size, final_mtime));
                        info!("File ingested: {:?}", path);
                    }
                    Err(e) => {
                        error!("Failed to ingest file {:?}: {}", path, e);
                        // Don't mark as known - will retry on next modification event
                    }
                }
            }
        }
    });
}

/// GET / - Status endpoint
async fn get_status(State(state): State<AgentState>) -> Json<serde_json::Value> {
    let config = state.config.lock().unwrap();
    let locked = state.locked_by.lock().unwrap();
    let watching = *state.watcher_active.lock().unwrap();
    Json(serde_json::json!({
        "status": "running",
        "agent_name": config.agent_name,
        "equipment_id": config.equipment_id,
        "watching": watching,
        "watch_dir": config.watch_dir,
        "locked": locked.is_some(),
        "locked_by": locked.as_ref(),
    }))
}

/// GET /config - Get current configuration
async fn get_config(State(state): State<AgentState>) -> Json<AgentConfig> {
    let config = state.config.lock().unwrap();
    Json(config.clone())
}

/// POST /config - Update configuration
async fn set_config(
    State(state): State<AgentState>,
    Json(new_config): Json<AgentConfig>,
) -> Json<serde_json::Value> {
    let mut config = state.config.lock().unwrap();
    *config = new_config;
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
struct LockRequest {
    client_id: String,
}

/// POST /lock - Lock agent for exclusive use
async fn lock_agent(
    State(state): State<AgentState>,
    Json(req): Json<LockRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let mut locked = state.locked_by.lock().unwrap();
    if locked.is_some() {
        return Err((axum::http::StatusCode::CONFLICT, "Agent is already locked".to_string()));
    }
    *locked = Some(req.client_id.clone());
    info!("Agent locked by client: {}", req.client_id);
    Ok(Json(serde_json::json!({"status": "locked"})))
}

/// POST /unlock - Unlock agent
async fn unlock_agent(State(state): State<AgentState>) -> Json<serde_json::Value> {
    let mut locked = state.locked_by.lock().unwrap();
    *locked = None;
    info!("Agent unlocked");
    Json(serde_json::json!({"status": "unlocked"}))
}

/// POST /start - Start watching directory for new files
async fn start_watching(State(state): State<AgentState>) -> Json<serde_json::Value> {
    // Check if already watching
    if *state.watcher_active.lock().unwrap() {
        return Json(serde_json::json!({"status": "already_watching"}));
    }
    
    // Validate configuration
    {
        let config = state.config.lock().unwrap();
        if config.watch_dir.is_none() {
            return Json(serde_json::json!({"status": "error", "message": "No watch directory configured"}));
        }
        if config.upload_api_url.is_none() {
            return Json(serde_json::json!({"status": "error", "message": "No upload API URL configured"}));
        }
        if config.equipment_id.is_none() {
            return Json(serde_json::json!({"status": "error", "message": "No equipment ID configured"}));
        }
    }
    
    spawn_file_watcher(state);
    
    Json(serde_json::json!({"status": "watching"}))
}

/// POST /stop - Stop watching directory
async fn stop_watching(State(state): State<AgentState>) -> Json<serde_json::Value> {
    *state.watcher_active.lock().unwrap() = false;
    info!("File watcher stopped");
    Json(serde_json::json!({"status": "stopped"}))
}
