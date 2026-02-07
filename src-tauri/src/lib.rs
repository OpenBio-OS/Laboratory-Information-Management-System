//! OpenBio Tauri Application
//!
//! Handles app lifecycle, config management, and embedded server spawning.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
    /// Agent mode - headless equipment computer with system tray
    #[serde(rename = "agent")]
    Agent,
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
    /// Track local agent processes by equipment ID
    local_agents: Mutex<HashMap<String, Child>>,
    /// Agent lock state (for Agent mode): tracks which client has locked this agent
    agent_locked_by: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(AppConfig::default()),
            local_agents: Mutex::new(HashMap::new()),
            agent_locked_by: Mutex::new(None),
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

/// Get the storage directory path for files (PDFs, etc.)
fn storage_path() -> PathBuf {
    config_dir().join("storage")
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

    // Handle different deployment modes
    match config.mode {
        DeploymentMode::Local | DeploymentMode::Hub => {
            let db_url = database_url();
            let storage = storage_path();
            // Apply migrations for local/hub mode (embedded SQLite database)
            openbio_server::spawn_embedded_server(config.server_port, db_url, storage, true);

            // For hub mode, start mDNS broadcast
            if config.mode == DeploymentMode::Hub {
                if let Some(lab_name) = &config.lab_name {
                    start_mdns_broadcast(lab_name.clone(), config.server_port);
                }
            }
        }
        _ => {}
    }

    // Emit config event to frontend
    let api_url = match config.mode {
        DeploymentMode::Local | DeploymentMode::Hub => {
            format!("http://localhost:{}", config.server_port)
        }
        DeploymentMode::Spoke | DeploymentMode::Enterprise => {
            config.api_url.clone().unwrap_or_default()
        }
        _ => String::new(),
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

/// Spawn a local agent for equipment monitoring
#[tauri::command]
fn spawn_local_agent(
    equipment_id: String,
    watch_folder: String,
    state: State<AppState>,
) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    
    // Get API URL based on current mode
    let api_url = match config.mode {
        DeploymentMode::Local | DeploymentMode::Hub => {
            // Local/Hub mode: agents upload to the local server
            format!("http://localhost:{}", config.server_port)
        }
        _ => {
            return Err("Can only spawn local agents in Local or Hub mode".to_string());
        }
    };
    drop(config);

    // Get path to the openbio-agent binary (should be in same dir as main executable)
    let agent_exe = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("openbio-agent")))
        .ok_or_else(|| "Could not determine agent executable path".to_string())?;

    // Check if agent binary exists
    if !agent_exe.exists() {
        // Try with .exe extension on Windows
        #[cfg(target_os = "windows")]
        let agent_exe = agent_exe.with_extension("exe");
        
        #[cfg(not(target_os = "windows"))]
        if !agent_exe.exists() {
            return Err(format!("Agent executable not found at {:?}", agent_exe));
        }
    }

    // Find an available port for this agent (start from 8080)
    let agent_port = find_available_port(8080);
    tracing::info!("Using port {} for agent {}", agent_port, equipment_id);

    // Spawn the agent process
    let child = Command::new(&agent_exe)
        .arg("--port")
        .arg(agent_port.to_string())
        .arg("--equipment-id")
        .arg(&equipment_id)
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;

    // Store the child process
    let mut agents = state.local_agents.lock().unwrap();
    
    // Kill existing agent for this equipment if any
    if let Some(mut old_child) = agents.remove(&equipment_id) {
        let _ = old_child.kill();
    }
    
    agents.insert(equipment_id.clone(), child);
    
    tracing::info!("Spawned local agent for equipment {}", equipment_id);
    Ok(())
}

/// Stop a local agent
#[tauri::command]
fn stop_local_agent(equipment_id: String, state: State<AppState>) -> Result<(), String> {
    let mut agents = state.local_agents.lock().unwrap();
    
    if let Some(mut child) = agents.remove(&equipment_id) {
        child.kill().map_err(|e| format!("Failed to kill agent: {}", e))?;
        tracing::info!("Stopped local agent for equipment {}", equipment_id);
        Ok(())
    } else {
        Err(format!("No agent running for equipment {}", equipment_id))
    }
}

/// Check if a local agent is running for equipment
#[tauri::command]
fn is_local_agent_running(equipment_id: String, state: State<AppState>) -> bool {
    state.local_agents.lock().unwrap().contains_key(&equipment_id)
}

/// Get list of running local agent equipment IDs
#[tauri::command]
fn list_local_agents(state: State<AppState>) -> Vec<String> {
    state
        .local_agents
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

/// Re-initialize the application (reset config and show setup wizard)
#[tauri::command]
fn reinitialize(app: AppHandle) -> Result<(), String> {
    // Delete the config file to trigger setup wizard
    let path = config_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete config: {}", e))?;
    }
    
    // Show the window if it was hidden (agent mode)
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    
    // Emit event to frontend to reload/show setup
    app.emit("openbio:reinitialize", ()).map_err(|e| e.to_string())?;
    
    tracing::info!("Application re-initialized, config reset");
    Ok(())
}

/// Build system tray for agent mode
fn build_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let reconfigure_item = MenuItem::with_id(app, "reconfigure", "Re-configure...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[&show_item, &reconfigure_item, &quit_item])?;
    
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(move |app: &AppHandle, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "reconfigure" => {
                    if let Err(e) = reinitialize(app.clone()) {
                        tracing::error!("Failed to re-initialize: {}", e);
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    
    Ok(())
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
/// Only used in release builds, so allow dead_code in debug
#[allow(dead_code)]
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
        let storage = storage_path();
        openbio_server::spawn_embedded_server(actual_port, db_url, storage, true);

        if config.mode == DeploymentMode::Hub {
            if let Some(lab_name) = &config.lab_name {
                start_mdns_broadcast(lab_name.clone(), actual_port);
            }
        }
    }

    // Create state now that config is finalized/updated
    let state = AppState {
        config: Mutex::new(config.clone()),
        local_agents: Mutex::new(HashMap::new()),
        agent_locked_by: Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            needs_setup,
            scan_for_hubs,
            spawn_local_agent,
            stop_local_agent,
            is_local_agent_running,
            list_local_agents,
            reinitialize,
        ])
        .setup(move |app| {
            // Check if running in Agent mode
            if config.mode == DeploymentMode::Agent {
                // Hide UI and create system tray
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                
                if let Err(e) = build_system_tray(app.handle()) {
                    tracing::error!("Failed to create system tray: {}", e);
                }
                
                // Run embedded agent server
                let port = config.server_port;
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = openbio_agent::run_agent_server(port, None).await {
                        tracing::error!("Agent server failed: {}", e);
                    }
                });
                
                // Enable auto-start on boot
                #[cfg(not(debug_assertions))]
                {
                    use tauri_plugin_autostart::ManagerExt;
                    if let Err(e) = app.autolaunch().enable() {
                        tracing::error!("Failed to enable auto-start: {}", e);
                    } else {
                        tracing::info!("Auto-start on boot enabled");
                    }
                }
                
                tracing::info!("Running in Agent mode (headless)");
            } else {
                // Normal client mode - show UI
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

                // Emit final config to frontend (not in Agent mode since UI is hidden)
                let api_url = match config.mode {
                    DeploymentMode::Local | DeploymentMode::Hub => {
                        format!("http://localhost:{}", config.server_port)
                    }
                    DeploymentMode::Spoke | DeploymentMode::Enterprise => {
                        config.api_url.clone().unwrap_or_default()
                    }
                    _ => String::new(),
                };

                app.emit(
                    "openbio:config",
                    serde_json::json!({
                        "apiUrl": api_url,
                        "mode": config.mode,
                    }),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
