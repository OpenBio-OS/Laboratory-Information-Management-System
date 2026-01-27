//! OpenBio Tauri Application
//!
//! Handles app lifecycle, config management, and embedded server spawning.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

/// Deployment mode
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeploymentMode {
    #[default]
    Unconfigured,
    Local,
    Hub,
    Spoke,
    Enterprise,
}

/// Application config (matches frontend SetupConfig)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub mode: DeploymentMode,
    #[serde(rename = "labName")]
    pub lab_name: Option<String>,
    #[serde(rename = "apiUrl")]
    pub api_url: Option<String>,
    #[serde(rename = "serverPort")]
    pub server_port: u16,
}

/// Shared application state
pub struct AppState {
    config: Mutex<AppConfig>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(AppConfig::default()),
        }
    }
}

/// Get the config directory path
fn config_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("OpenBio")
}

/// Get the config file path
fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

/// Get the database file path
fn database_path() -> PathBuf {
    config_dir().join("data").join("openbio.db")
}

/// Get database URL for SQLite
fn database_url() -> String {
    let db_path = database_path();
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    format!("file:{}", db_path.display())
}

/// Get current config
#[tauri::command]
fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

/// Save config to disk and update state
#[tauri::command]
fn save_config(config: AppConfig, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    // Create config directory if needed
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Serialize and save
    let content = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())?;

    // Update state
    *state.config.lock().unwrap() = config.clone();

    // If local/hub mode, spawn the embedded server with migrations
    if config.mode == DeploymentMode::Local || config.mode == DeploymentMode::Hub {
        let db_url = database_url();
        // Apply migrations for local/hub mode (embedded SQLite database)
        openbio_server::spawn_embedded_server(config.server_port, db_url, true);

        // For hub mode, start mDNS broadcast
        if config.mode == DeploymentMode::Hub {
            if let Some(lab_name) = &config.lab_name {
                start_mdns_broadcast(lab_name.clone(), config.server_port);
            }
        }
    }

    // Emit config event to frontend
    let api_url = match config.mode {
        DeploymentMode::Local | DeploymentMode::Hub => {
            format!("http://localhost:{}", config.server_port)
        }
        DeploymentMode::Spoke | DeploymentMode::Enterprise => {
            config.api_url.clone().unwrap_or_default()
        }
        DeploymentMode::Unconfigured => String::new(),
    };

    app.emit(
        "openbio:config",
        serde_json::json!({
            "apiUrl": api_url,
            "mode": config.mode,
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Check if config exists
#[tauri::command]
fn needs_setup() -> bool {
    !config_path().exists()
}

/// Start mDNS broadcast for hub discovery
fn start_mdns_broadcast(lab_name: String, port: u16) {
    std::thread::spawn(move || {
        use mdns_sd::{ServiceDaemon, ServiceInfo};

        let mdns = match ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Failed to create mDNS daemon: {}", e);
                return;
            }
        };

        let service_type = "_openbio._tcp.local.";
        let host_name = format!("{}.local.", lab_name.replace(' ', "-").to_lowercase());

        let service_info =
            match ServiceInfo::new(service_type, &lab_name, &host_name, "", port, None) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to create service info: {}", e);
                    return;
                }
            };

        if let Err(e) = mdns.register(service_info) {
            eprintln!("Failed to register mDNS service: {}", e);
            return;
        }

        println!("mDNS: Broadcasting '{}' on port {}", lab_name, port);

        // Keep thread alive to maintain registration
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

/// Discovered Hub information
#[derive(Debug, Serialize, Clone)]
struct DiscoveredHub {
    name: String,
    address: String, // IP:Port
}

/// Scan for OpenBio hubs on the network
#[tauri::command]
async fn scan_for_hubs() -> Result<Vec<DiscoveredHub>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};
    use std::time::Duration;

    // Create daemon and keep it alive for the entire scan
    let mdns = ServiceDaemon::new().map_err(|e| {
        eprintln!("Failed to create mDNS daemon: {}", e);
        e.to_string()
    })?;

    let service_type = "_openbio._tcp.local.";
    let receiver = mdns.browse(service_type).map_err(|e| {
        eprintln!("Failed to start mDNS browse: {}", e);
        e.to_string()
    })?;

    println!("mDNS: Scanning for OpenBio hubs...");

    let mut hubs = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(5); // Increased from 2s

    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(event) => {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let name = info
                            .get_fullname()
                            .replace(&format!(".{}", service_type), "");
                        // Prefer IPv4
                        if let Some(addr) = info.get_addresses().iter().find(|ip| ip.is_ipv4()) {
                            let hub = DiscoveredHub {
                                name: name.clone(),
                                address: format!("http://{}:{}", addr, info.get_port()),
                            };
                            println!("mDNS: Found hub '{}' at {}", hub.name, hub.address);
                            hubs.push(hub);
                        }
                    }
                    ServiceEvent::SearchStarted(_) => {
                        println!("mDNS: Search started");
                    }
                    ServiceEvent::ServiceFound(_, _) => {
                        // Service found but not yet resolved, continue waiting
                    }
                    _ => {}
                }
            }
            Err(_) => {
                // Timeout or other error, continue scanning
            }
        }
    }

    // Properly shutdown the daemon before dropping
    if let Err(e) = mdns.shutdown() {
        eprintln!("Failed to shutdown mDNS daemon: {}", e);
    }

    // Sort by name and remove duplicates
    hubs.sort_by(|a, b| a.name.cmp(&b.name));
    hubs.dedup_by(|a, b| a.address == b.address);

    println!("mDNS: Scan complete, found {} hub(s)", hubs.len());

    Ok(hubs)
}

/// Find an available port starting from preferred
fn find_available_port(start: u16) -> u16 {
    (start..start + 100)
        .find(|port| std::net::TcpListener::bind(("0.0.0.0", *port)).is_ok())
        .unwrap_or(start) // Fallback to start if all fail (unlikely)
}

/// Load config from disk
fn load_config_from_disk() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = toml::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

/// Check for app updates and install if available
async fn check_for_updates(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let updater = app.updater_builder().build()?;
    
    if let Some(update) = updater.check().await? {
        tracing::info!("Update available: {}", update.version);
        
        // Download and install the update
        // The dialog option in tauri.conf.json will show a prompt to the user
        let mut downloaded = 0;
        update.download_and_install(
            |chunk_length, content_length| {
                downloaded += chunk_length;
                tracing::debug!("Downloaded {} of {:?} bytes", downloaded, content_length);
            },
            || {
                tracing::info!("Download complete, installing...");
            }
        ).await?;
        
        tracing::info!("Update installed successfully");
    } else {
        tracing::info!("App is up to date");
    }
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Load existing config or default
    let mut config = load_config_from_disk();

    // If configured for local/hub, check port and spawn server
    if config.mode == DeploymentMode::Local || config.mode == DeploymentMode::Hub {
        let db_url = database_url();
        // Check if configured port is actually available, otherwise find new one
        let preferred_port = config.server_port;
        let actual_port = find_available_port(preferred_port);

        // If port changed, update config and save immediately
        if actual_port != preferred_port {
            tracing::info!(
                "Preferred port {} busy, using {}",
                preferred_port,
                actual_port
            );
            config.server_port = actual_port;

            // Save updated config
            if let Ok(content) = toml::to_string_pretty(&config) {
                // Ensure directory exists
                let _ = fs::create_dir_all(config_dir());
                let _ = fs::write(config_path(), content);
            }
        }

        // Spawn server with migrations for local/hub mode
        openbio_server::spawn_embedded_server(actual_port, db_url, true);

        if config.mode == DeploymentMode::Hub {
            if let Some(lab_name) = &config.lab_name {
                start_mdns_broadcast(lab_name.clone(), actual_port);
            }
        }
    }

    // Create state now that config is finalized/updated
    let state = AppState {
        config: Mutex::new(config.clone()),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            needs_setup,
            scan_for_hubs,
        ])
        .setup(move |app| {
            // Check for updates on startup (non-blocking) - only in release builds
            #[cfg(not(debug_assertions))]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = check_for_updates(app_handle).await {
                        tracing::error!("Failed to check for updates: {}", e);
                    }
                });
            }

            // Emit final config to frontend
            // config is moved into this closure since it's a clone
            let api_url = match config.mode {
                DeploymentMode::Local | DeploymentMode::Hub => {
                    format!("http://localhost:{}", config.server_port)
                }
                DeploymentMode::Spoke | DeploymentMode::Enterprise => {
                    config.api_url.clone().unwrap_or_default()
                }
                DeploymentMode::Unconfigured => String::new(),
            };

            app.emit(
                "openbio:config",
                serde_json::json!({
                    "apiUrl": api_url,
                    "mode": config.mode,
                }),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
