//! OpenBio Tauri Application
//!
//! Handles app lifecycle, config management, and embedded server spawning.

mod commands;
mod licensing;
mod pipeline_env;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
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
    #[serde(rename = "agentName")]
    pub agent_name: Option<String>,
    #[serde(rename = "apiUrl")]
    pub api_url: Option<String>,
    #[serde(rename = "licenseKey")]
    pub license_key: Option<String>,
    #[serde(rename = "serverPort")]
    pub server_port: u16,
    #[serde(rename = "autoStart", default)]
    pub auto_start: bool,
    #[serde(rename = "minimizeToTray", default)]
    pub minimize_to_tray: bool,
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

/// Get the logs directory path
fn logs_dir() -> PathBuf {
    config_dir().join("logs")
}

/// Write a timestamped line to the agent log file (creates/appends)
fn write_agent_log(equipment_id: &str, msg: &str) {
    let dir = logs_dir();
    let _ = fs::create_dir_all(&dir);
    let log_path = dir.join(format!("agent-{}.log", equipment_id));
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] {}\n", timestamp, msg);
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Get current config
#[tauri::command]
fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

/// Save config to disk and update state
#[tauri::command]
fn save_config(
    mut config: AppConfig,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Set default auto_start for Hub and Agent modes if not explicitly set
    if !config.auto_start
        && (config.mode == DeploymentMode::Hub || config.mode == DeploymentMode::Agent)
    {
        config.auto_start = true;
    }

    // Validate SERVER license for Hub and Enterprise modes
    if licensing::requires_license(&config.mode) {
        if let Some(license_key) = &config.license_key {
            if license_key.is_empty() {
                return Err("License key is required for Hub and Enterprise modes".to_string());
            }
            // TODO: Validate license with online service here
            // For now, just check it's not empty
        } else {
            return Err("License key is required for Hub and Enterprise modes".to_string());
        }
    }

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

                // License is already validated above
                tracing::info!("Hub instance running with valid license");
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
    write_agent_log(&equipment_id, "========== SPAWN LOCAL AGENT ==========");
    write_agent_log(&equipment_id, &format!("equipment_id: {}", equipment_id));
    write_agent_log(&equipment_id, &format!("watch_folder: {}", watch_folder));

    let config = state.config.lock().unwrap();

    // Get API URL based on current mode
    let api_url = match config.mode {
        DeploymentMode::Local | DeploymentMode::Hub => {
            format!("http://localhost:{}", config.server_port)
        }
        _ => {
            let msg = "Can only spawn local agents in Local or Hub mode";
            write_agent_log(&equipment_id, &format!("ERROR: {}", msg));
            return Err(msg.to_string());
        }
    };
    let server_port = config.server_port;
    write_agent_log(
        &equipment_id,
        &format!("server_port: {}, api_url: {}", server_port, api_url),
    );
    drop(config);

    // Get path to the openbio-agent binary
    let current_exe = std::env::current_exe();
    write_agent_log(&equipment_id, &format!("current_exe: {:?}", current_exe));

    let agent_exe = current_exe
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("openbio-agent")))
        .ok_or_else(|| "Could not determine agent executable path".to_string())?;

    write_agent_log(&equipment_id, &format!("agent_exe path: {:?}", agent_exe));
    write_agent_log(
        &equipment_id,
        &format!("agent_exe exists: {}", agent_exe.exists()),
    );

    if !agent_exe.exists() {
        #[cfg(target_os = "windows")]
        let agent_exe = agent_exe.with_extension("exe");

        #[cfg(not(target_os = "windows"))]
        if !agent_exe.exists() {
            let msg = format!("Agent executable not found at {:?}", agent_exe);
            write_agent_log(&equipment_id, &format!("ERROR: {}", msg));
            return Err(msg);
        }
    }

    // Check watch folder exists
    let watch_path = std::path::Path::new(&watch_folder);
    write_agent_log(
        &equipment_id,
        &format!("watch_folder exists: {}", watch_path.exists()),
    );
    write_agent_log(
        &equipment_id,
        &format!("watch_folder is_dir: {}", watch_path.is_dir()),
    );
    if !watch_path.is_dir() {
        let msg = format!(
            "Watch folder does not exist or is not a directory: {}",
            watch_folder
        );
        write_agent_log(&equipment_id, &format!("ERROR: {}", msg));
        return Err(msg);
    }

    // Find an available port for this agent
    let agent_port = find_available_port(8080);
    write_agent_log(&equipment_id, &format!("agent_port: {}", agent_port));

    // Create log file for agent process stdout/stderr
    let agent_stdout_path = logs_dir().join(format!("agent-{}-stdout.log", equipment_id));
    let agent_stderr_path = logs_dir().join(format!("agent-{}-stderr.log", equipment_id));
    let _ = fs::create_dir_all(logs_dir());

    let stdout_file = fs::File::create(&agent_stdout_path)
        .map_err(|e| format!("Failed to create stdout log: {}", e))?;
    let stderr_file = fs::File::create(&agent_stderr_path)
        .map_err(|e| format!("Failed to create stderr log: {}", e))?;

    write_agent_log(
        &equipment_id,
        &format!("stdout log: {:?}", agent_stdout_path),
    );
    write_agent_log(
        &equipment_id,
        &format!("stderr log: {:?}", agent_stderr_path),
    );

    // Spawn the agent process with stdout/stderr redirected to log files
    write_agent_log(&equipment_id, "Spawning agent process...");
    let child = Command::new(&agent_exe)
        .arg("--port")
        .arg(agent_port.to_string())
        .arg("--equipment-id")
        .arg(&equipment_id)
        .stdout(std::process::Stdio::from(stdout_file))
        .stderr(std::process::Stdio::from(stderr_file))
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to spawn agent: {}", e);
            write_agent_log(&equipment_id, &format!("ERROR: {}", msg));
            msg
        })?;

    write_agent_log(
        &equipment_id,
        &format!("Agent process spawned, pid: {}", child.id()),
    );

    // Store the child process
    let mut agents = state.local_agents.lock().unwrap();
    if let Some(mut old_child) = agents.remove(&equipment_id) {
        write_agent_log(&equipment_id, "Killing previous agent process");
        let _ = old_child.kill();
    }
    agents.insert(equipment_id.clone(), child);
    drop(agents);

    // Configure the agent in a background thread
    let equip_id = equipment_id.clone();
    let watch_folder_clone = watch_folder.clone();
    std::thread::spawn(move || {
        write_agent_log(
            &equip_id,
            "Background thread: waiting 2s for agent to start...",
        );
        std::thread::sleep(std::time::Duration::from_secs(2));

        let agent_api = format!("http://localhost:{}", agent_port);
        write_agent_log(&equip_id, &format!("Agent API: {}", agent_api));

        // First, check if agent is alive
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        match client.get(&agent_api).send() {
            Ok(resp) => {
                let body = resp.text().unwrap_or_default();
                write_agent_log(&equip_id, &format!("Agent health check OK: {}", body));
            }
            Err(e) => {
                write_agent_log(
                    &equip_id,
                    &format!("ERROR: Agent not reachable at {}: {}", agent_api, e),
                );
                return;
            }
        }

        // Configure the agent
        let config_payload = serde_json::json!({
            "equipment_id": equip_id,
            "agent_name": null,
            "watch_dir": watch_folder_clone,
            "upload_api_url": format!("http://localhost:{}", server_port),
            "api_key": null,
        });

        write_agent_log(&equip_id, &format!("Sending config: {}", config_payload));

        match client
            .post(format!("{}/config", agent_api))
            .json(&config_payload)
            .send()
        {
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().unwrap_or_default();
                write_agent_log(
                    &equip_id,
                    &format!("Config response: {} - {}", status, body),
                );
            }
            Err(e) => {
                write_agent_log(&equip_id, &format!("ERROR: Failed to set config: {}", e));
                return;
            }
        }

        // Start watching
        write_agent_log(&equip_id, "Sending /start...");
        match client.post(format!("{}/start", agent_api)).send() {
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().unwrap_or_default();
                write_agent_log(&equip_id, &format!("Start response: {} - {}", status, body));
            }
            Err(e) => {
                write_agent_log(&equip_id, &format!("ERROR: Failed to start watcher: {}", e));
            }
        }

        write_agent_log(&equip_id, "========== AGENT SETUP COMPLETE ==========");
    });

    let log_location = logs_dir().join(format!("agent-{}.log", equipment_id));
    write_agent_log(
        &equipment_id,
        &format!("Setup initiated. Full log at: {:?}", log_location),
    );
    Ok(())
}

/// Stop a local agent
#[tauri::command]
fn stop_local_agent(equipment_id: String, state: State<AppState>) -> Result<(), String> {
    let mut agents = state.local_agents.lock().unwrap();

    if let Some(mut child) = agents.remove(&equipment_id) {
        child
            .kill()
            .map_err(|e| format!("Failed to kill agent: {}", e))?;
        tracing::info!("Stopped local agent for equipment {}", equipment_id);
        Ok(())
    } else {
        Err(format!("No agent running for equipment {}", equipment_id))
    }
}

/// Check if a local agent is running for equipment
#[tauri::command]
fn is_local_agent_running(equipment_id: String, state: State<AppState>) -> bool {
    state
        .local_agents
        .lock()
        .unwrap()
        .contains_key(&equipment_id)
}

/// Get list of running local agent equipment IDs
#[tauri::command]
fn list_local_agents(state: State<AppState>) -> Vec<String> {
    state.local_agents.lock().unwrap().keys().cloned().collect()
}

/// Update auto-start setting
#[tauri::command]
fn update_auto_start(enabled: bool, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.auto_start = enabled;

    // Save to disk
    let content = toml::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())?;

    // Apply auto-start setting immediately
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_autostart::ManagerExt;
        if enabled {
            app.autolaunch().enable().map_err(|e| e.to_string())?;
            tracing::info!("Auto-start enabled");
        } else {
            app.autolaunch().disable().map_err(|e| e.to_string())?;
            tracing::info!("Auto-start disabled");
        }
    }

    Ok(())
}

/// Update minimize-to-tray setting
#[tauri::command]
fn update_minimize_to_tray(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.minimize_to_tray = enabled;

    // Save to disk
    let content = toml::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())?;

    tracing::info!("Minimize to tray: {}", enabled);
    Ok(())
}

/// Update lab name (mDNS broadcast name for Hub mode)
#[tauri::command]
fn update_lab_name(lab_name: String, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();

    // Only allow for Hub mode
    if config.mode != DeploymentMode::Hub {
        return Err("Lab name can only be set in Hub mode".to_string());
    }

    config.lab_name = Some(lab_name.clone());

    // Save to disk
    let content = toml::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())?;

    tracing::info!("Lab name updated to: {}", lab_name);

    // Note: mDNS broadcast needs app restart to take effect
    // The mDNS service is registered in a background thread and can't be easily restarted
    Ok(())
}

/// Update agent name (mDNS broadcast name for Agent mode)
#[tauri::command]
fn update_agent_name(agent_name: String, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();

    // Only allow for Agent mode
    if config.mode != DeploymentMode::Agent {
        return Err("Agent name can only be set in Agent mode".to_string());
    }

    config.agent_name = Some(agent_name.clone());

    // Save to disk
    let content = toml::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())?;

    tracing::info!("Agent name updated to: {}", agent_name);

    // Note: mDNS broadcast needs app restart to take effect
    Ok(())
}

/// Reset database and storage (delete all data)
#[tauri::command]
fn reset_database_and_storage(state: State<AppState>) -> Result<(), String> {
    // Stop all running local agents first
    let mut agents = state.local_agents.lock().unwrap();
    let agent_ids: Vec<String> = agents.keys().cloned().collect();

    for equipment_id in agent_ids {
        if let Some(mut child) = agents.remove(&equipment_id) {
            let _ = child.kill();
            tracing::info!(
                "Stopped local agent for equipment {} during reset",
                equipment_id
            );
        }
    }
    drop(agents); // Release lock

    let db_path = database_path();
    let storage_dir = storage_path();

    // Delete database file
    if db_path.exists() {
        fs::remove_file(&db_path).map_err(|e| format!("Failed to delete database: {}", e))?;
    }

    // Delete storage directory
    if storage_dir.exists() {
        fs::remove_dir_all(&storage_dir).map_err(|e| format!("Failed to delete storage: {}", e))?;
    }

    Ok(())
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
    app.emit("openbio:reinitialize", ())
        .map_err(|e| e.to_string())?;

    tracing::info!("Application re-initialized, config reset");
    Ok(())
}

/// Build system tray for agent mode
fn build_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let reconfigure_item =
        MenuItem::with_id(app, "reconfigure", "Re-configure...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &reconfigure_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(move |app: &AppHandle, event| match event.id.as_ref() {
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
        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    tracing::debug!("Downloaded {} of {:?} bytes", downloaded, content_length);
                },
                || {
                    tracing::info!("Download complete, installing...");
                },
            )
            .await?;

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
        .plugin(tauri_plugin_process::init())
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
            update_auto_start,
            update_minimize_to_tray,
            update_lab_name,
            update_agent_name,
            reset_database_and_storage,
            reinitialize,
            // Pipeline commands
            commands::start_pipeline,
            commands::get_pipeline_status,
            commands::get_pipeline_logs,
            commands::cancel_pipeline,
            commands::list_pipelines,
            commands::list_pipeline_runs,
            // Pipeline environment commands
            commands::check_pipeline_environment,
            commands::check_docker_installed,
            commands::get_docker_info,
            commands::setup_pipeline_environment,
            commands::get_pipeline_environment,
            commands::get_nextflow_path,
            commands::verify_pipeline_environment,
            // Insight commands
            commands::get_experiment_files,
            commands::stream_file_chunk,
            commands::load_coordinates,
            commands::get_experiment_metadata,
            commands::list_insight_instances,
            commands::delete_insight_instance,
            commands::register_visualization,
            commands::get_experiment_report_url,
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
                let agent_name = config.agent_name.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = openbio_agent::run_agent_server(port, None, agent_name).await {
                        tracing::error!("Agent server failed: {}", e);
                    }
                });

                // Enable auto-start on boot based on config setting
                if config.auto_start {
                    #[cfg(not(debug_assertions))]
                    {
                        use tauri_plugin_autostart::ManagerExt;
                        if let Err(e) = app.autolaunch().enable() {
                            tracing::error!("Failed to enable auto-start: {}", e);
                        } else {
                            tracing::info!("Auto-start on boot enabled");
                        }
                    }
                }

                tracing::info!("Running in Agent mode (headless)");
            } else {
                // Normal client mode - show UI (or minimize to tray if configured)

                // Minimize to tray on startup for Hub mode if configured
                if config.mode == DeploymentMode::Hub && config.minimize_to_tray {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }

                    if let Err(e) = build_system_tray(app.handle()) {
                        tracing::error!("Failed to create system tray: {}", e);
                    }
                }

                // Enable auto-start on boot if configured
                if config.auto_start {
                    #[cfg(not(debug_assertions))]
                    {
                        use tauri_plugin_autostart::ManagerExt;
                        if let Err(e) = app.autolaunch().enable() {
                            tracing::error!("Failed to enable auto-start: {}", e);
                        } else {
                            tracing::info!(
                                "Auto-start on boot enabled for {} mode",
                                match config.mode {
                                    DeploymentMode::Hub => "Hub",
                                    DeploymentMode::Local => "Solo",
                                    DeploymentMode::Spoke => "Spoke",
                                    DeploymentMode::Enterprise => "Enterprise",
                                    _ => "Unknown",
                                }
                            );
                        }
                    }
                } else {
                    // Disable auto-start if it was previously enabled but is now turned off
                    #[cfg(not(debug_assertions))]
                    {
                        use tauri_plugin_autostart::ManagerExt;
                        let _ = app.autolaunch().disable();
                    }
                }

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
