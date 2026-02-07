//! OpenBio Agent Library
//! 
//! Runs on laboratory equipment to watch directories and upload files.
//! Exposes HTTP API for configuration and status.
//! Broadcasts presence via mDNS for discovery by clients.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// Agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// ID of equipment this agent monitors
    pub equipment_id: Option<String>,
    
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
}

impl AgentState {
    pub fn new(config: AgentConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            locked_by: Arc::new(Mutex::new(None)),
        }
    }
}

/// Run the agent HTTP server
pub async fn run_agent_server(port: u16, equipment_id: Option<String>) -> Result<()> {
    let config = AgentConfig {
        equipment_id,
        watch_dir: None,
        upload_api_url: None,
        api_key: None,
    };
    
    let state = AgentState::new(config);

    // Start mDNS broadcast
    tokio::spawn(async move {
        if let Err(e) = broadcast_mdns(port).await {
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
async fn broadcast_mdns(port: u16) -> Result<()> {
    let mdns = ServiceDaemon::new()?;
    
    let service_type = "_openbio-agent._tcp.local.";
    let instance_name = format!("OpenBio Agent on {}", hostname::get()?.to_string_lossy());
    
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

/// GET / - Status endpoint
async fn get_status(State(state): State<AgentState>) -> Json<serde_json::Value> {
    let config = state.config.lock().unwrap();
    let locked = state.locked_by.lock().unwrap();
    Json(serde_json::json!({
        "status": "running",
        "equipment_id": config.equipment_id,
        "watching": config.watch_dir.is_some(),
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

/// POST /start - Start watching directory
async fn start_watching(State(_state): State<AgentState>) -> Json<serde_json::Value> {
    // TODO: Implement file watching with notify crate
    // For now just acknowledge
    Json(serde_json::json!({"status": "watching"}))
}

/// POST /stop - Stop watching directory
async fn stop_watching(State(_state): State<AgentState>) -> Json<serde_json::Value> {
    // TODO: Implement stopping file watcher
    Json(serde_json::json!({"status": "stopped"}))
}
