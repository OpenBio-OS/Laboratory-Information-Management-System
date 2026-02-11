// Tauri commands for Pipeline Automator module
// NOTE: Pipeline execution happens CLIENT-SIDE. Server only stores metadata.

use serde::{Deserialize, Serialize};
use std::io::Write; // Keep Write for file output
use std::process::Stdio;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct StartPipelineRequest {
    pub experiment_id: String,
    pub pipeline_type: String,
    pub genome: Option<String>,
    pub custom_params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ExperimentInput {
    pub experiment_id: String,
    pub experiment_name: String,
    pub sample_name: String,
    pub group: String,
    pub replicate: String,
    pub files: Vec<ExperimentFile>,
}

#[derive(Debug, Deserialize)]
struct ExperimentFile {
    pub filename: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineResponse {
    pub run_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineStatus {
    pub run_id: String,
    pub status: String,
    pub progress: Option<f32>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineInfo {
    pub name: String,
    pub description: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ParameterDefinition {
    pub name: String,
    pub label: String,
    pub r#type: String, // "text" | "number" | "select" | "boolean"
    pub required: bool,
    pub default: Option<String>,
    pub options: Option<Vec<String>>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PipelineTemplate {
    pub name: String,
    pub description: String,
    pub version: String,
    pub source: Option<PipelineSource>,
    pub parameters: Vec<ParameterDefinition>,
    pub is_custom: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PipelineSource {
    pub r#type: String, // "nf-core" | "github" | "local"
    pub location: String,
    pub revision: Option<String>,
}

/// Helper to get API base URL
fn get_api_base_url(state: &State<'_, crate::AppState>) -> String {
    let config = state.config.lock().unwrap();
    if config.mode == crate::DeploymentMode::Local || config.mode == crate::DeploymentMode::Hub {
        format!("http://localhost:{}/api/pipelines", config.server_port)
    } else {
        // For spoke/enterprise, use configured API URL
        let base = config
            .api_url
            .clone()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        format!("{}/pipelines", base.trim_end_matches('/'))
    }
}

/// Helper to get API base URL from AppHandle (for background tasks)
fn get_api_base_url_from_handle(app: &AppHandle) -> String {
    let state: tauri::State<'_, crate::AppState> = app.state();
    let config = state.config.lock().unwrap();
    if config.mode == crate::DeploymentMode::Local || config.mode == crate::DeploymentMode::Hub {
        format!("http://localhost:{}/api/pipelines", config.server_port)
    } else {
        let base = config
            .api_url
            .clone()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        format!("{}/pipelines", base.trim_end_matches('/'))
    }
}

// Helper to get persistent pipeline templates file
fn get_templates_path() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("software.is-a.openbio")
        .join("pipelines")
        .join("templates.json")
}

// Helper to get custom scripts directory
fn get_scripts_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("software.is-a.openbio")
        .join("pipelines")
        .join("scripts")
}

// Helper to get persistent log directory
fn get_log_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("software.is-a.openbio")
        .join("logs")
}

/// Update run status on the server
async fn update_run_status(
    api_base: &str,
    run_id: &str,
    status: &str,
    error_message: Option<String>,
) {
    let url = format!("{}/runs/{}/status", api_base, run_id);
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "status": status,
        "error_message": error_message
    });

    if let Err(e) = client.patch(&url).json(&payload).send().await {
        eprintln!("[pipeline] Failed to update status: {}", e);
    }
}

/// Start a new pipeline run
#[tauri::command]
pub async fn start_pipeline(
    request: StartPipelineRequest,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<PipelineResponse, String> {
    // Pre-flight checks
    // 1. Check if pipeline environment is initialized
    let env_config = crate::pipeline_env::load_environment_config(&app)
        .map_err(|e| format!("Failed to check pipeline environment: {}", e))?
        .ok_or_else(|| {
            "SETUP_REQUIRED: Pipeline environment not initialized. Please click 'Setup Environment' first.".to_string()
        })?;

    // 2. Check if Docker is available
    if !crate::pipeline_env::check_docker_available().unwrap_or(false) {
        return Err("DOCKER_REQUIRED: Docker is not installed or not running. Please install Docker Desktop and ensure it is running.".to_string());
    }

    // Step 1: Create run record in database via server API
    let api_base = get_api_base_url(&state);
    let url = format!("{}/run", api_base);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let run_response: PipelineResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    let run_id = run_response.run_id.clone();

    // Step 2: Spawn Nextflow in background thread
    let request_clone = request.clone();
    let run_id_clone = run_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        run_nextflow_pipeline(app_clone, run_id_clone, request_clone, env_config).await;
    });

    // Return immediately - pipeline runs in background
    Ok(PipelineResponse {
        run_id,
        status: "RUNNING".to_string(),
        message: "Pipeline started in background".to_string(),
    })
}

/// Actually run the Nextflow pipeline (runs in background)
async fn run_nextflow_pipeline(
    app: AppHandle,
    run_id: String,
    request: StartPipelineRequest,
    env: crate::pipeline_env::PipelineEnvironment,
) {
    let api_base = get_api_base_url_from_handle(&app);

    // Update status to RUNNING
    update_run_status(&api_base, &run_id, "RUNNING", None).await;

    // Create work directory for this run
    let work_dir = std::env::temp_dir().join(format!("nf_work_{}", &run_id));
    let out_dir = std::env::temp_dir().join(format!("nf_out_{}", &run_id));

    if let Err(e) = std::fs::create_dir_all(&work_dir) {
        update_run_status(
            &api_base,
            &run_id,
            "FAILED",
            Some(format!("Failed to create work dir: {}", e)),
        )
        .await;
        return;
    }
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        update_run_status(
            &api_base,
            &run_id,
            "FAILED",
            Some(format!("Failed to create output dir: {}", e)),
        )
        .await;
        return;
    }

    // Build Nextflow command via micromamba run
    // This properly activates the conda environment and handles paths with spaces
    // Get fresh micromamba path (with symlink) rather than saved config
    let micromamba_path = match crate::pipeline_env::get_micromamba_binary_path(&app) {
        Ok(p) => p,
        Err(e) => {
            update_run_status(
                &api_base,
                &run_id,
                "FAILED",
                Some(format!("Failed to get micromamba: {}", e)),
            )
            .await;
            return;
        }
    };

    let mut cmd = Command::new(&micromamba_path);
    let root_prefix = env
        .env_path
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(&env.env_path);
    let nxf_home = work_dir.join(".nextflow");

    println!("[pipeline] Preparing Nextflow command...");
    println!("[pipeline]   Binary: {:?}", micromamba_path);
    println!("[pipeline]   Root Prefix: {:?}", root_prefix);
    println!("[pipeline]   Env Path: {:?}", env.env_path);
    println!("[pipeline]   NXF_HOME: {:?}", nxf_home);
    println!("[pipeline]   JAVA_HOME: {:?}", env.java_home);

    // Smart Resource Sensing
    // Detect system memory and CPUs to avoid OOM on local machines
    let mut sys = sysinfo::System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    let total_mem_gb = sys.total_memory() / 1024 / 1024 / 1024;
    let cpu_count = sys.cpus().len();

    // Heuristics:
    // - Leave 4GB or 20% for the OS/UI
    // - Use all but 1 CPU core
    let max_mem = if total_mem_gb > 8 {
        total_mem_gb - 4
    } else {
        (total_mem_gb as f64 * 0.75) as u64
    };
    let max_cpus = if cpu_count > 1 { cpu_count - 1 } else { 1 };

    println!(
        "[pipeline] System detected: {}GB RAM, {} Cores",
        total_mem_gb, cpu_count
    );
    println!(
        "[pipeline] Resource limits: {}GB RAM, {} CPUs",
        max_mem, max_cpus
    );

    // Create a local nextflow.config to ensure resources are respected
    // Use process.resourceLimits (Nextflow 24.10+) AND global process overrides
    let config_path = work_dir.join("nextflow.config");
    let config_content = format!(
        "process {{\n    resourceLimits = [\n        cpus: {},\n        memory: '{}GB'\n    ]\n    withName: '.*' {{\n        cpus = {}\n        memory = '{}GB'\n    }}\n}}\ndocker.pull_policy = 'always'\n",
        max_cpus, max_mem, max_cpus, max_mem
    );
    if let Err(e) = std::fs::write(&config_path, &config_content) {
        eprintln!("[pipeline] [WARN] Failed to write nextflow.config: {}", e);
    }

    cmd.current_dir(&work_dir)
        .env("MAMBA_ROOT_PREFIX", root_prefix)
        .env("NXF_HOME", &nxf_home)
        .env("JAVA_HOME", &env.java_home)
        .arg("run")
        .arg("-p")
        .arg(&env.env_path)
        .arg("nextflow")
        .arg("run")
        .arg(&request.pipeline_type)
        .arg("-profile")
        .arg("docker")
        .arg("-c")
        .arg("nextflow.config")
        .arg("--outdir")
        .arg(&out_dir);

    // Add genome if specified
    if let Some(ref genome) = request.genome {
        cmd.arg("--genome").arg(genome);
    }

    // Add custom parameters
    let mut experiment_inputs_json = None;
    if let Some(ref params) = request.custom_params {
        if let Some(obj) = params.as_object() {
            for (key, value) in obj {
                if key == "experiment_inputs" {
                    if let Some(v) = value.as_str() {
                        experiment_inputs_json = Some(v.to_string());
                    } else {
                        experiment_inputs_json = Some(value.to_string());
                    }
                    continue;
                }

                if key == "max_memory" || key == "max_cpus" {
                    continue;
                }

                if let Some(v) = value.as_str() {
                    cmd.arg(format!("--{}", key)).arg(v);
                } else if let Some(v) = value.as_bool() {
                    if v {
                        cmd.arg(format!("--{}", key));
                    }
                } else {
                    cmd.arg(format!("--{}", key)).arg(value.to_string());
                }
            }
        }
    }

    // Generate samplesheet if inputs provided
    if let Some(json) = experiment_inputs_json {
        match generate_samplesheet(&json, &request.pipeline_type) {
            Ok(csv_content) => {
                let csv_path = work_dir.join("samplesheet.csv");
                if let Err(e) = std::fs::write(&csv_path, csv_content) {
                    update_run_status(
                        &api_base,
                        &run_id,
                        "FAILED",
                        Some(format!("Failed to write samplesheet.csv: {}", e)),
                    )
                    .await;
                    return;
                }
                println!("[pipeline] Generated samplesheet.csv at {:?}", csv_path);
                cmd.arg("--input").arg(csv_path);
            }
            Err(e) => {
                update_run_status(
                    &api_base,
                    &run_id,
                    "FAILED",
                    Some(format!("Failed to generate samplesheet: {}", e)),
                )
                .await;
                return;
            }
        }
    }

    // Configure stdout/stderr capture
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    println!("[pipeline] Starting Nextflow: {:?}", cmd);
    println!("[pipeline] Work dir: {:?}", work_dir);
    println!("[pipeline] Output dir: {:?}", out_dir);

    // Spawn the process
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            update_run_status(
                &api_base,
                &run_id,
                "FAILED",
                Some(format!("Failed to spawn Nextflow: {}", e)),
            )
            .await;
            return;
        }
    };

    // Stream logs to console (and could emit events to frontend)
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Log to persistent directory
    let log_dir = get_log_dir();
    if !log_dir.exists() {
        let _ = std::fs::create_dir_all(&log_dir);
    }
    let log_file_path = log_dir.join(format!("pipeline_{}.log", run_id));

    // Log stdout in background
    if let Some(stdout) = stdout {
        let run_id_clone = run_id.clone();
        let log_path = log_file_path.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                println!("[nf:{}] {}", &run_id_clone[..8], line);
                // Append to log file
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    if let Err(e) = writeln!(file, "{}", line) {
                        eprintln!("Failed to write to log file: {}", e);
                    }
                }
            }
        });
    }

    // Log stderr in background
    if let Some(stderr) = stderr {
        let run_id_clone = run_id.clone();
        let log_path = log_file_path.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[nf:{}] [ERR] {}", &run_id_clone[..8], line);
                // Append to log file
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    if let Err(e) = writeln!(file, "[ERR] {}", line) {
                        eprintln!("Failed to write to log file: {}", e);
                    }
                }
            }
        });
    }

    // Wait for process to complete
    // Register cancellation channel
    let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
    {
        let state = app.state::<crate::AppState>();
        let mut cancellations = state.pipeline_cancellations.lock().unwrap();
        cancellations.insert(run_id.clone(), cancel_tx);
    } // Drop lock

    // Wait for process to complete or be cancelled
    let status_result = tokio::select! {
        res = child.wait() => res,
        _ = cancel_rx.recv() => {
            println!("[pipeline] Cancellation received for run {}", run_id);
            // Try to kill the process
            if let Err(e) = child.start_kill() {
                eprintln!("[pipeline] Failed to kill process: {}", e);
            }
            // Wait for it to exit
            let _ = child.wait().await;

            update_run_status(&api_base, &run_id, "CANCELLED", Some("Cancelled by user".to_string())).await;

            // Cleanup and return
            {
                let state = app.state::<crate::AppState>();
                let mut cancellations = state.pipeline_cancellations.lock().unwrap();
                cancellations.remove(&run_id);
            }
            return;
        }
    };

    // Remove from cancellations map since it finished naturally
    {
        let state = app.state::<crate::AppState>();
        let mut cancellations = state.pipeline_cancellations.lock().unwrap();
        cancellations.remove(&run_id);
    }

    match status_result {
        Ok(status) => {
            if status.success() {
                println!(
                    "[pipeline] Nextflow completed successfully for run {}",
                    run_id
                );

                // Polymorphic Output Detection
                println!(
                    "[pipeline] Detecting outputs for pipeline type: {}",
                    request.pipeline_type
                );
                if let Err(e) =
                    detect_and_upload_outputs(&api_base, &run_id, &out_dir, &request.pipeline_type)
                        .await
                {
                    eprintln!("[pipeline] [WARN] Output detection failed: {}", e);
                } else {
                    println!("[pipeline] Output detection and upload completed");

                    // Auto-cleanup: Remove temp directories to save space
                    // Use tokio::fs for async cleanup
                    println!("[pipeline] Cleaning up temp directories...");
                    let out_dir_clone = out_dir.clone();
                    let work_dir_clone = work_dir.clone();
                    tokio::spawn(async move {
                        if out_dir_clone.exists() {
                            let _ = tokio::fs::remove_dir_all(&out_dir_clone).await;
                        }
                        if work_dir_clone.exists() {
                            let _ = tokio::fs::remove_dir_all(&work_dir_clone).await;
                        }
                    });
                }

                update_run_status(&api_base, &run_id, "COMPLETED", None).await;
            } else {
                let msg = format!("Nextflow exited with code: {:?}", status.code());
                println!("[pipeline] {}", msg);
                update_run_status(&api_base, &run_id, "FAILED", Some(msg)).await;
            }
        }
        Err(e) => {
            let msg = format!("Process error: {}", e);
            println!("[pipeline] {}", msg);
            update_run_status(&api_base, &run_id, "FAILED", Some(msg)).await;
        }
    }
}

/// Get status of a pipeline run
#[tauri::command]
pub async fn get_pipeline_status(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<PipelineStatus, String> {
    let url = format!("{}/runs/{}", get_api_base_url(&state), run_id);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    response
        .json::<PipelineStatus>()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

/// List all pipeline runs
#[tauri::command]
pub async fn list_pipeline_runs(
    state: State<'_, crate::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let url = format!("{}/runs", get_api_base_url(&state));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

/// Cancel a running pipeline
#[tauri::command]
pub async fn cancel_pipeline(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut local_signal_sent = false;

    // 1. Try to kill the local process if it exists
    {
        let state = state.inner(); // Get inner reference without lock
        let cancellations = state.pipeline_cancellations.lock().unwrap();
        if let Some(tx) = cancellations.get(&run_id) {
            // Send cancellation signal
            let _ = tx.try_send(()); // Ignore error if receiver dropped
            println!(
                "[pipeline] Sent cancellation signal to local run {}",
                run_id
            );
            local_signal_sent = true;
        }
    }

    // 2. Also tell the server (redundant but good for consistency/metadata)
    // If we sent a local signal, the local process loop will update the status to CANCELLED/FAILED.
    // Calling the server might race with that update, causing a 500 error (database locked).
    // So if we sent the signal, we treat server errors as warnings.
    let url = format!("{}/runs/{}/cancel", get_api_base_url(&state), run_id);

    let client = reqwest::Client::new();
    let response_result = client.post(&url).send().await;

    match response_result {
        Ok(response) => {
            if !response.status().is_success() {
                let msg = format!("Server returned error: {}", response.status());
                if local_signal_sent {
                    println!("[pipeline] [WARN] Server cancel failed (ignoring since local signal sent): {}", msg);
                } else {
                    return Err(format!("Server error: {}", response.status()));
                }
            }
        }
        Err(e) => {
            let msg = format!("Request failed: {}", e);
            if local_signal_sent {
                println!(
                    "[pipeline] [WARN] Server cancel failed (ignoring since local signal sent): {}",
                    msg
                );
            } else {
                return Err(msg);
            }
        }
    }

    Ok(())
}

/// Delete a pipeline run
#[tauri::command]
pub async fn delete_pipeline_run(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let url = format!("{}/runs/{}", get_api_base_url(&state), run_id);

    let client = reqwest::Client::new();
    let response = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    // Cleanup local files (logs and temp dirs)
    let log_path = get_log_dir().join(format!("pipeline_{}.log", run_id));
    if log_path.exists() {
        let _ = std::fs::remove_file(log_path);
        println!("[pipeline] Deleted log file for run {}", run_id);
    }

    // Cleanup temp directories if they exist
    let temp_dir = std::env::temp_dir();
    let work_dir = temp_dir.join(format!("nf_work_{}", run_id));
    let out_dir = temp_dir.join(format!("nf_out_{}", run_id));

    if work_dir.exists() {
        let _ = std::fs::remove_dir_all(work_dir);
        println!("[pipeline] Deleted work dir for run {}", run_id);
    }
    if out_dir.exists() {
        let _ = std::fs::remove_dir_all(out_dir);
        println!("[pipeline] Deleted out dir for run {}", run_id);
    }

    Ok(())
}

/// Reset the pipeline environment (delete .openbio-pipelines)
#[tauri::command]
pub async fn reset_pipeline_env(app_handle: tauri::AppHandle) -> Result<(), String> {
    let env_path = crate::pipeline_env::get_env_path(&app_handle)?;

    println!(
        "[pipeline] Resetting pipeline environment at: {:?}",
        env_path
    );

    if env_path.exists() {
        std::fs::remove_dir_all(&env_path)
            .map_err(|e| format!("Failed to delete environment: {}", e))?;
    }

    Ok(())
}

/// List available pipeline types
#[tauri::command]
pub async fn list_pipelines() -> Result<Vec<PipelineInfo>, String> {
    let templates = get_pipeline_templates().await?;
    Ok(templates
        .into_iter()
        .map(|t| PipelineInfo {
            name: t.name,
            description: t.description,
            version: t.version,
        })
        .collect())
}

/// Get detailed pipeline templates with parameters
#[tauri::command]
pub async fn get_pipeline_templates() -> Result<Vec<PipelineTemplate>, String> {
    let path = get_templates_path();

    let mut templates: Vec<PipelineTemplate> = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read templates: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse templates: {}", e))?
    } else {
        get_default_templates()
    };

    // Merge in any new default templates or update existing non-custom ones
    // This ensures users get the latest genome lists/parameter updates
    let defaults = get_default_templates();
    let mut changed = !path.exists();

    for d in defaults {
        if let Some(pos) = templates.iter().position(|t| t.name == d.name) {
            // If it's a default one (not marked custom), ensure it matches code's latest
            if templates[pos].is_custom != Some(true) && templates[pos] != d {
                templates[pos] = d;
                changed = true;
            }
        } else {
            templates.push(d);
            changed = true;
        }
    }

    // Save back if changed (and not first time)
    if changed && path.exists() {
        let json = serde_json::to_string_pretty(&templates)
            .map_err(|e| format!("Failed to serialize templates: {}", e))?;
        let _ = std::fs::write(&path, json);
    }

    Ok(templates)
}

/// Save a new pipeline template
#[tauri::command]
pub async fn save_pipeline_template(mut template: PipelineTemplate) -> Result<(), String> {
    let path = get_templates_path();
    let scripts_dir = get_scripts_dir();

    // Ensure scripts directory exists
    std::fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create scripts directory: {}", e))?;

    // If source is local, copy the script (directory or file) to our local storage
    if let Some(ref mut source) = template.source {
        if source.r#type == "local" {
            let src_path = std::path::PathBuf::from(&source.location);
            if src_path.exists() {
                let dest_name = src_path
                    .file_name()
                    .ok_or("Invalid source path file name")?
                    .to_string_lossy()
                    .to_string();
                let dest_path = scripts_dir.join(&dest_name);

                if src_path.is_dir() {
                    // Simple recursive copy (directory)
                    copy_dir_recursive(&src_path, &dest_path)?;
                } else {
                    // Copy file
                    std::fs::copy(&src_path, &dest_path)
                        .map_err(|e| format!("Failed to copy script file: {}", e))?;
                }

                // Update location to just the name, as it's now in our scripts dir
                source.location = dest_name;
            }
        }
    }

    let mut templates = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read templates: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse templates: {}", e))?
    } else {
        get_default_templates()
    };

    // Update or push
    if let Some(pos) = templates
        .iter()
        .position(|t: &PipelineTemplate| t.name == template.name)
    {
        templates[pos] = template;
    } else {
        templates.push(template);
    }

    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;

    std::fs::write(&path, json).map_err(|e| format!("Failed to save templates: {}", e))?;

    Ok(())
}

/// Delete a pipeline template
#[tauri::command]
pub async fn delete_pipeline_template(name: String) -> Result<(), String> {
    let path = get_templates_path();
    if !path.exists() {
        return Ok(());
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read templates: {}", e))?;
    let mut templates: Vec<PipelineTemplate> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse templates: {}", e))?;

    templates.retain(|t| t.name != name);

    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;

    std::fs::write(&path, json).map_err(|e| format!("Failed to save templates: {}", e))?;

    Ok(())
}

/// Helper for recursive directory copy
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Failed to create dest dir: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read src dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("Failed to get file type: {}", e))?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }
    Ok(())
}

/// Helper to get default templates
fn get_default_templates() -> Vec<PipelineTemplate> {
    vec![
        PipelineTemplate {
            name: "nf-core/rnaseq".to_string(),
            description: "Bulk RNA-sequencing analysis pipeline. Includes QC, alignment (STAR), and quantification (Salmon/RSEM). Ideal for gene expression studies.".to_string(),
            version: "3.14.0".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "rnaseq".to_string(),
                revision: Some("3.14.0".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Reference Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("GRCh38".to_string()),
                    options: Some(vec![
                        "GRCh38".to_string(),
                        "GRCm39".to_string(),
                        "GRCz11".to_string(),
                        "Rnor_6.0".to_string(),
                        "BDGP6".to_string(),
                        "WBcel235".to_string(),
                        "TAIR10".to_string(),
                        "R64-1-1".to_string(),
                        "IRGSP-1.0".to_string(),
                        "hg38".to_string(),
                        "mm10".to_string(),
                    ]),
                    description: Some("Common reference genomes from iGenomes. Select the one matching your species.".to_string()),
                },
                ParameterDefinition {
                    name: "aligner".to_string(),
                    label: "Alignment Method".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("star_salmon".to_string()),
                    options: Some(vec![
                        "star_salmon".to_string(),
                        "star_rsem".to_string(),
                        "hisat2".to_string(),
                    ]),
                    description: Some("STAR-Salmon is the industry standard for high accuracy.".to_string()),
                },
            ],
        },
        PipelineTemplate {
            name: "nf-core/scrnaseq".to_string(),
            description: "Single-cell RNA-sequencing analysis. Supports 10x Genomics, Smart-seq2, and more. Performs cell calling and quantification.".to_string(),
            version: "2.5.1".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "scrnaseq".to_string(),
                revision: Some("2.5.1".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Reference Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("GRCh38".to_string()),
                    options: Some(vec![
                        "GRCh38".to_string(),
                        "GRCm39".to_string(),
                        "GRCz11".to_string(),
                        "BDGP6".to_string(),
                    ]),
                    description: Some("Reference genome for single-cell alignment (STAR-solo/CellRanger).".to_string()),
                },
                ParameterDefinition {
                    name: "protocol".to_string(),
                    label: "Library Protocol".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("10xv3".to_string()),
                    options: Some(vec!["10xv3".to_string(), "10xv2".to_string(), "smartseq2".to_string()]),
                    description: Some("The experimental protocol used to prepare the libraries.".to_string()),
                },
            ],
        },
        PipelineTemplate {
            name: "nf-core/sarek".to_string(),
            description: "Germline and Somatic variant calling. Used for identifying mutations in cancer or genetic studies.".to_string(),
            version: "3.4.0".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "sarek".to_string(),
                revision: Some("3.4.0".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("GRCh38".to_string()),
                    options: Some(vec![
                        "GRCh38".to_string(),
                        "GRCm39".to_string(),
                        "GRCz11".to_string(),
                        "hg38".to_string(),
                    ]),
                    description: Some("Reference genome for variant calling.".to_string()),
                },
                ParameterDefinition {
                    name: "tools".to_string(),
                    label: "Variant Callers".to_string(),
                    r#type: "text".to_string(),
                    required: false,
                    default: Some("haplotypecaller,strelka".to_string()),
                    options: None,
                    description: Some("Comma-separated list of callers (e.g., haplotypecaller, freebayes).".to_string()),
                },
            ],
        },
        PipelineTemplate {
            name: "nf-core/atacseq".to_string(),
            description: "ATAC-seq analysis for chromatin accessibility. Includes peak calling and QC.".to_string(),
            version: "2.1.2".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "atacseq".to_string(),
                revision: Some("2.1.2".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    options: Some(vec![
                        "GRCh38".to_string(),
                        "GRCm39".to_string(),
                        "GRCz11".to_string(),
                        "TAIR10".to_string(),
                    ]),
                    default: Some("GRCh38".to_string()),
                    description: None,
                },
            ],
        },
        PipelineTemplate {
            name: "nf-core/chipseq".to_string(),
            description: "ChIP-seq analysis pipeline for protein-DNA interactions. Supports peak calling and differential binding.".to_string(),
            version: "2.0.0".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "chipseq".to_string(),
                revision: Some("2.0.0".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![],
        },
        PipelineTemplate {
            name: "nf-core/taxprofiler".to_string(),
            description: "Taxonomic profiling of shotgun metagenomic data. Supports Kraken2, MetaPhlAn, etc.".to_string(),
            version: "1.1.2".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "taxprofiler".to_string(),
                revision: Some("1.1.2".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![],
        },
        PipelineTemplate {
            name: "nf-core/mag".to_string(),
            description: "Assembly and binning of Metagenome-Assembled Genomes (MAGs).".to_string(),
            version: "3.2.1".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "mag".to_string(),
                revision: Some("3.2.1".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![],
        },
        PipelineTemplate {
            name: "nf-core/differentialabundance".to_string(),
            description: "Statistical analysis for differential abundance of genes, proteins, or metabolites.".to_string(),
            version: "1.5.0".to_string(),
            source: Some(PipelineSource {
                r#type: "nf-core".to_string(),
                location: "differentialabundance".to_string(),
                revision: Some("1.5.0".to_string()),
            }),
            is_custom: Some(false),
            parameters: vec![],
        },
    ]
}

/// Get logs for a pipeline run (reads local files since pipelines run client-side)
#[tauri::command]
pub async fn get_pipeline_logs(
    run_id: String,
    _state: State<'_, crate::AppState>,
) -> Result<String, String> {
    // Nextflow runs client-side, so logs are on the local machine
    let temp_dir = std::env::temp_dir();
    let work_dir = temp_dir.join(format!("nf_work_{}", &run_id));

    // Check possible log locations
    let possible_locations = [
        get_log_dir().join(format!("pipeline_{}.log", run_id)), // Permanent log
        work_dir.join("pipeline.log"),                          // Legacy temp log
        work_dir.join(".nextflow.log"),                         // Nextflow's internal log
        temp_dir
            .join(format!("nf_out_{}", &run_id))
            .join(".nextflow.log"),
    ];

    for log_path in &possible_locations {
        if tokio::fs::metadata(log_path).await.is_ok() {
            let content = tokio::fs::read_to_string(log_path)
                .await
                .map_err(|e| format!("Failed to read log file: {}", e))?;

            // Filter out problematic ANSI sequences like \x1b(B
            let filtered = content.replace("\x1b(B", "");
            return Ok(filtered);
        }
    }

    // If no log file found, check the status
    if let Ok(status_info) = get_pipeline_status(run_id.clone(), _state).await {
        if status_info.status == "COMPLETED" {
            return Ok(format!(
                "Pipeline Run: {}\nStatus: COMPLETED\n\nWorkflow completed successfully.\nTemporary log files have been cleaned up to save disk space.\n\nPlease view the Report or Insight tab for results.",
                run_id
            ));
        }
    }

    // If no log file found, return a status message
    Ok(format!(
        "Pipeline run: {}\n\nNo log file found on this machine.\nLogs are only available on the machine that started the pipeline.\nIf this run was started on another device, logs cannot be viewed here.\n\nWork directory: {}\nChecked locations:\n{}",
        run_id,
        work_dir.display(),
        possible_locations.iter().map(|p| format!("  - {}", p.display())).collect::<Vec<_>>().join("\n")
    ))
}

fn generate_samplesheet(inputs_json: &str, pipeline_type: &str) -> Result<String, String> {
    let experiments: Vec<ExperimentInput> = serde_json::from_str(inputs_json)
        .map_err(|e| format!("Failed to parse experiment inputs JSON: {}", e))?;

    let pipeline_type = pipeline_type.to_lowercase();
    let is_rnaseq = pipeline_type.contains("rnaseq") && !pipeline_type.contains("scrnaseq");
    let is_scrnaseq = pipeline_type.contains("scrnaseq");

    println!(
        "[pipeline] Generating samplesheet (type: {}, is_rnaseq: {}, is_scrnaseq: {})",
        pipeline_type, is_rnaseq, is_scrnaseq
    );

    let mut csv = if is_scrnaseq {
        String::from("sample,fastq_1,fastq_2\n")
    } else if is_rnaseq {
        String::from("sample,fastq_1,fastq_2,strandedness\n")
    } else {
        // Fallback for other pipelines
        String::from("sample,fastq_1,fastq_2,strandedness,group,replicate\n")
    };

    for exp in experiments {
        // Sanitize sample name for Nextflow (no spaces, no special chars except _ and -)
        let sample_name = exp
            .sample_name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();

        // Group files by prefix to find pairs
        let mut r1_files = Vec::new();
        let mut r2_files = Vec::new();

        for file in &exp.files {
            let filename = file.filename.to_lowercase();
            if filename.contains("_1.fastq")
                || filename.contains("_r1.fastq")
                || filename.contains("_r1_001.fastq")
            {
                r1_files.push(file);
            } else if filename.contains("_2.fastq")
                || filename.contains("_r2.fastq")
                || filename.contains("_r2_001.fastq")
            {
                r2_files.push(file);
            } else if filename.contains(".fastq") || filename.contains(".fq") {
                r1_files.push(file);
            }
        }

        // Sort to match pairs
        r1_files.sort_by_key(|f| &f.filename);
        r2_files.sort_by_key(|f| &f.filename);

        if r2_files.is_empty() {
            // Single end
            for f in r1_files {
                if csv.contains("group") {
                    csv.push_str(&format!(
                        "{},{},,auto,{},{}\n",
                        sample_name, f.path, exp.group, exp.replicate
                    ));
                } else {
                    csv.push_str(&format!("{},{},,auto\n", sample_name, f.path));
                }
            }
        } else {
            // Paired end
            for (i, f1) in r1_files.iter().enumerate() {
                let f2_path = if i < r2_files.len() {
                    r2_files[i].path.as_str()
                } else {
                    ""
                };

                if is_scrnaseq {
                    csv.push_str(&format!("{},{},{}\n", sample_name, f1.path, f2_path));
                } else if is_rnaseq {
                    csv.push_str(&format!("{},{},{},auto\n", sample_name, f1.path, f2_path));
                } else if csv.contains("group") {
                    csv.push_str(&format!(
                        "{},{},{},auto,{},{}\n",
                        sample_name, f1.path, f2_path, exp.group, exp.replicate
                    ));
                } else {
                    csv.push_str(&format!("{},{},{},auto\n", sample_name, f1.path, f2_path));
                }
            }
        }
    }

    Ok(csv)
}

async fn detect_and_upload_outputs(
    api_base: &str,
    run_id: &str,
    out_dir: &std::path::Path,
    _pipeline_type: &str,
) -> Result<(), String> {
    // 0. Update status to UPLOADING
    update_run_status(api_base, run_id, "UPLOADING", None).await;

    println!("[pipeline] Zipping output directory: {:?}", out_dir);

    // 1. Create Zip File
    let temp_dir = std::env::temp_dir();
    let zip_filename = format!("nf_out_{}.zip", run_id);
    let zip_path = temp_dir.join(&zip_filename);

    if let Err(e) = zip_directory(out_dir, &zip_path) {
        let err_msg = format!("Failed to zip output directory: {}", e);
        eprintln!("[pipeline] {}", err_msg);
        return Err(err_msg);
    }

    println!("[pipeline] Created zip file: {:?}", zip_path);

    // 2. Upload Zip File
    let client = reqwest::Client::new();
    let url = format!("{}/runs/{}/output", api_base, run_id);

    // Read file bytes
    let data = std::fs::read(&zip_path).map_err(|e| e.to_string())?;

    // Create multipart form
    let part = reqwest::multipart::Part::bytes(data).file_name(zip_filename.clone());
    let form = reqwest::multipart::Form::new().part("file", part);

    println!("[pipeline] Uploading zip file to: {}", url);

    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Server returned error: {}", text));
    }

    println!("[pipeline] Successfully uploaded output zip.");

    // 3. Delete Zip File
    let _ = std::fs::remove_file(&zip_path);

    Ok(())
}

fn zip_directory(src_dir: &std::path::Path, dst_file: &std::path::Path) -> Result<(), String> {
    if !src_dir.exists() {
        return Err(format!("Source directory not found: {:?}", src_dir));
    }

    let file = std::fs::File::create(dst_file).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let walker = walkdir::WalkDir::new(src_dir);
    let _prefix = src_dir.parent().unwrap_or(src_dir); // Use parent to keep the root folder name?
                                                       // Actually, user wants "every folder and every file inside it".
                                                       // If output is `nf_out_RUNID/foo.txt`, we probably want `foo.txt` at root of zip?
                                                       // Or `nf_out_RUNID/foo.txt`?
                                                       // User said "Nextflow outputs a folder... lets just keep every folder and every file inside it."
                                                       // Usually standard zip behavior is relative to the root of the zipped folder.
                                                       // Let's unzip INTO the target folder on server, so relative paths should be relative to `nf_out_RUNID`.

    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        let name = path
            .strip_prefix(src_dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        if path.is_file() {
            // println!("Adding file to zip: {}", name);
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        } else if !name.is_empty() {
            // println!("Adding dir to zip: {}", name);
            zip.add_directory(name, options)
                .map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Cleanup all temporary pipeline directories
#[tauri::command]
pub async fn cleanup_pipeline_temp() -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let mut count = 0;
    let mut errors = Vec::new();

    println!("[pipeline] Starting cleanup of temp dir: {:?}", temp_dir);

    // Read directory directly to avoid walkdir dependency if not strictly needed,
    // but we already use walkdir in this file so it's fine.
    // Using read_dir is safer for just one level.
    let mut entries = tokio::fs::read_dir(&temp_dir)
        .await
        .map_err(|e| format!("Failed to read temp directory: {}", e))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if let Some(fname) = path.file_name().map(|s| s.to_string_lossy()) {
            if (fname.starts_with("nf_work_") || fname.starts_with("nf_out_")) && path.is_dir() {
                println!("[pipeline] Deleting temp dir (async): {:?}", path);
                if let Err(e) = tokio::fs::remove_dir_all(&path).await {
                    let err_msg = format!("Failed to delete {:?}: {}", path, e);
                    eprintln!("[pipeline] {}", err_msg);
                    errors.push(err_msg);
                } else {
                    count += 1;
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(format!(
            "Cleaned up {} temporary pipeline directories.",
            count
        ))
    } else {
        // Return Ok even with errors so partial success is reported nicely
        Ok(format!(
            "Cleaned up {} directories. {} errors occurred (check logs).",
            count,
            errors.len()
        ))
    }
}

/// Download and open the pipeline report in the default browser
#[tauri::command]
pub async fn open_pipeline_report(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let api_base = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        if config.mode == crate::DeploymentMode::Local || config.mode == crate::DeploymentMode::Hub
        {
            format!("http://localhost:{}/api", config.server_port)
        } else {
            let base = config
                .api_url
                .clone()
                .unwrap_or_else(|| "http://localhost:3000".to_string());
            base.trim_end_matches('/').to_string()
        }
    };

    // 1. Get the list of assets to find an HTML report
    // 1. Get the list of assets to find an HTML report
    let client = reqwest::Client::new();
    // Endpoint is mounted at /pipelines/runs/{id}/assets
    let assets_url = format!("{}/pipelines/runs/{}/assets", api_base, run_id);
    println!("[pipeline] Fetching asset list from: {}", assets_url);

    let assets_response = client
        .get(&assets_url)
        .send()
        .await
        .map_err(|e| format!("Failed to request assets: {}", e))?;

    if !assets_response.status().is_success() {
        return Err(format!(
            "Failed to list assets. Status: {}",
            assets_response.status()
        ));
    }

    let assets: Vec<serde_json::Value> = assets_response
        .json()
        .await
        .map_err(|e| format!("Invalid assets JSON: {}", e))?;

    // Check for Directory Asset (New Strategy)
    // Look for mimeType = "application/x-directory" OR name ending in "_output"
    let dir_asset = assets.iter().find(|a| {
        let is_dir_mime = a.get("mimeType").and_then(|s| s.as_str())
            == Some("application/x-directory")
            || a.get("mime_type").and_then(|s| s.as_str()) == Some("application/x-directory");

        let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let is_output_dir = name.ends_with("_output");

        is_dir_mime || is_output_dir
    });

    let (report_url, report_filename) = if let Some(dir_asset) = dir_asset {
        // Handle Directory Asset
        let asset_id = dir_asset
            .get("id")
            .and_then(|s| s.as_str())
            .ok_or("Directory asset has no ID")?;
        println!("[pipeline] Found Directory Asset: {}", asset_id);

        let files_url = format!("{}/assets/{}/files", api_base, asset_id);
        let files_res = client
            .get(&files_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !files_res.status().is_success() {
            return Err(format!(
                "Failed to list directory files: {}",
                files_res.status()
            ));
        }

        let files: Vec<serde_json::Value> = files_res.json().await.map_err(|e| e.to_string())?;

        // Find report in files
        // Priority: multiqc_report.html -> any .html (excluding execution/timeline)
        let mut found_file = None;

        // 1. MultiQC (search for strict match OR ends_with for nested)
        if let Some(f) = files.iter().find(|f| {
            let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let path = f.get("path").and_then(|n| n.as_str()).unwrap_or(name);
            path.to_lowercase().ends_with("multiqc_report.html")
        }) {
            found_file = Some(f);
        }

        // 2. Any HTML
        if found_file.is_none() {
            found_file = files.iter().find(|f| {
                let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let name_lower = name.to_lowercase();
                name_lower.ends_with(".html")
                    && !name_lower.contains("execution_report")
                    && !name_lower.contains("timeline")
            });
        }

        // 3. Fallback
        if found_file.is_none() {
            found_file = files.iter().find(|f| {
                let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("");
                name.to_lowercase().ends_with(".html")
            });
        }

        if let Some(f) = found_file {
            let url = f
                .get("url")
                .and_then(|u| u.as_str())
                .ok_or("File has no URL")?;
            let name = f
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("report.html");

            // URL from server is relative e.g. /assets/...
            // We need to prepend api_base if it is not absolute.
            let clean_base = api_base.trim_end_matches('/');
            let full_url = format!("{}{}", clean_base, url);
            (full_url, name.to_string())
        } else {
            return Err("No HTML report found in directory asset.".to_string());
        }
    } else {
        // Legacy Logic (Individual Assets)
        println!("[pipeline] No Directory Asset found. Using legacy asset search.");
        let mut report_filename = String::new();
        let mut report_id = String::new();

        // First pass: look for multiqc
        for asset in &assets {
            if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                if name.to_lowercase() == "multiqc_report.html" {
                    report_filename = name.to_string();
                    if let Some(id) = asset.get("id").and_then(|i| i.as_str()) {
                        report_id = id.to_string();
                    }
                    break;
                }
            }
        }

        // Second pass: look for any .html report
        if report_filename.is_empty() {
            for asset in &assets {
                if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                    // Check if it is a report type or just ends in html
                    let is_report = asset
                        .get("asset_type")
                        .and_then(|t| t.as_str())
                        .map(|t| t == "REPORT")
                        .unwrap_or(false);

                    if (is_report || name.ends_with(".html"))
                        && !name.contains("execution_report")
                        && !name.contains("timeline")
                    {
                        report_filename = name.to_string();
                        if let Some(id) = asset.get("id").and_then(|i| i.as_str()) {
                            report_id = id.to_string();
                        }
                        break;
                    }
                }
            }
        }

        // Third pass: Fallback to anything
        if report_filename.is_empty() {
            for asset in &assets {
                if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                    if name.ends_with(".html") {
                        report_filename = name.to_string();
                        if let Some(id) = asset.get("id").and_then(|i| i.as_str()) {
                            report_id = id.to_string();
                        }
                        break;
                    }
                }
            }
        }

        if report_filename.is_empty() || report_id.is_empty() {
            return Err("No HTML report found for this pipeline run.".to_string());
        }

        let report_url = format!("{}/files/{}/view", api_base, report_id);
        (report_url, report_filename)
    };

    println!(
        "[pipeline] Selected report: {} (URL: {})",
        report_filename, report_url
    );

    let response = client
        .get(&report_url)
        .send()
        .await
        .map_err(|e| format!("Failed to request report: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Report not found. Has the pipeline finished uploading? (Status: {})",
            response.status()
        ));
    }

    let content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to download report content: {}", e))?;

    // 2. Save to temp file
    // We append run_id to filename to avoid collisions and allow multiple open reports
    let temp_file_name = format!("report_{}.html", run_id);
    let temp_path = std::env::temp_dir().join(&temp_file_name);

    std::fs::write(&temp_path, content)
        .map_err(|e| format!("Failed to write temp report: {}", e))?;

    // 3. Open with default browser
    open::that(&temp_path).map_err(|e| format!("Failed to open report in browser: {}", e))?;

    Ok(format!("Opened report at {:?}", temp_path))
}
