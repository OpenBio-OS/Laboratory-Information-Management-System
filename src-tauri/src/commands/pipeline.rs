// Tauri commands for Pipeline Automator module
// NOTE: Pipeline execution happens CLIENT-SIDE. Server only stores metadata.

use serde::{Deserialize, Serialize};
use std::io::Write; // Keep Write for file output
use std::process::Stdio;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Debug, Deserialize, Serialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ParameterDefinition {
    pub name: String,
    pub label: String,
    pub r#type: String, // "text" | "number" | "select" | "boolean"
    pub required: bool,
    pub default: Option<String>,
    pub options: Option<Vec<String>>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineTemplate {
    pub name: String,
    pub description: String,
    pub version: String,
    pub parameters: Vec<ParameterDefinition>,
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

    let log_file_path = work_dir.join("pipeline.log");

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
    Ok(vec![
        PipelineInfo {
            name: "nf-core/rnaseq".to_string(),
            description: "RNA sequencing analysis pipeline".to_string(),
            version: "3.14.0".to_string(),
        },
        PipelineInfo {
            name: "nf-core/atacseq".to_string(),
            description: "ATAC-seq analysis pipeline".to_string(),
            version: "2.1.2".to_string(),
        },
        PipelineInfo {
            name: "nf-core/scrnaseq".to_string(),
            description: "Single-cell RNA-seq analysis pipeline".to_string(),
            version: "2.5.1".to_string(),
        },
    ])
}

/// Get detailed pipeline templates with parameters
#[tauri::command]
pub async fn get_pipeline_templates() -> Result<Vec<PipelineTemplate>, String> {
    Ok(vec![
        PipelineTemplate {
            name: "nf-core/rnaseq".to_string(),
            description: "RNA sequencing analysis pipeline".to_string(),
            version: "3.14.0".to_string(),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Reference Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("GRCh38".to_string()),
                    options: Some(vec![
                        "GRCh38".to_string(),
                        "GRCh37".to_string(),
                        "GRCm39".to_string(),
                        "GRCm38".to_string(),
                        "R64-1-1".to_string(),
                        "WBcel235".to_string(),
                        "BDGP6".to_string(),
                        "TAIR10".to_string(),
                        "GRCz11".to_string(),
                        "Rnor_6.0".to_string(),
                        "CanFam3.1".to_string(),
                        "Sscrofa11.1".to_string(),
                        "UMD3.1".to_string(),
                    ]),
                    description: Some(
                        "The reference genome to use for alignment and quantification.".to_string(),
                    ),
                },
                ParameterDefinition {
                    name: "aligner".to_string(),
                    label: "Aligner".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("star_salmon".to_string()),
                    options: Some(vec![
                        "star_salmon".to_string(),
                        "star_rsem".to_string(),
                        "hisat2".to_string(),
                    ]),
                    description: Some("The alignment tool to use.".to_string()),
                },
            ],
        },
        PipelineTemplate {
            name: "nf-core/scrnaseq".to_string(),
            description: "Single-cell RNA-seq analysis pipeline".to_string(),
            version: "2.5.1".to_string(),
            parameters: vec![
                ParameterDefinition {
                    name: "genome".to_string(),
                    label: "Reference Genome".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("GRCh38".to_string()),
                    options: Some(vec!["GRCh38".to_string(), "GRCm39".to_string()]),
                    description: Some("Reference genome for single-cell alignment.".to_string()),
                },
                ParameterDefinition {
                    name: "protocol".to_string(),
                    label: "Protocol".to_string(),
                    r#type: "select".to_string(),
                    required: true,
                    default: Some("10XV3".to_string()),
                    options: Some(vec![
                        "10XV2".to_string(),
                        "10XV3".to_string(),
                        "drop-seq".to_string(),
                    ]),
                    description: Some("Single-cell sequencing protocol.".to_string()),
                },
            ],
        },
    ])
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
        work_dir.join("pipeline.log"), // Our custom captured log (stdout + stderr)
        work_dir.join(".nextflow.log"), // Nextflow's internal log
        temp_dir
            .join(format!("nf_out_{}", &run_id))
            .join(".nextflow.log"),
    ];

    for log_path in &possible_locations {
        if log_path.exists() {
            return std::fs::read_to_string(log_path)
                .map_err(|e| format!("Failed to read log file: {}", e));
        }
    }

    // If no log file found, return a status message
    Ok(format!(
        "Pipeline run: {}\n\nNo log file found yet.\n\nLogs will appear here once the pipeline starts.\nWork directory: {}\nChecked locations:\n{}",
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
    pipeline_type: &str,
) -> Result<(), String> {
    // 0. Update status to UPLOADING
    update_run_status(api_base, run_id, "UPLOADING", None).await;

    let pipeline_type = pipeline_type.to_lowercase();
    let is_scrnaseq = pipeline_type.contains("scrnaseq");
    let is_rnaseq = pipeline_type.contains("rnaseq") && !is_scrnaseq;

    // 1. Universal: MultiQC Report
    let report_paths = vec![
        out_dir.join("multiqc").join("multiqc_report.html"),
        out_dir.join("multiqc_report.html"),
    ];
    for path in report_paths {
        if path.exists() {
            println!(
                "[pipeline] Found MultiQC report at {:?}, uploading...",
                path
            );
            let _ = upload_asset(api_base, run_id, &path, "REPORT").await;
            break;
        }
    }

    // 2. Scenario A: Single-Cell (Matrix Market)
    if is_scrnaseq {
        // Recursive search for matrix.mtx might be needed, but let's try standard paths first
        // Simple heuristic: walk the dir to find matrix.mtx
        let walker = walkdir::WalkDir::new(out_dir).into_iter();
        for entry in walker.filter_map(|e| e.ok()) {
            let fname = entry.file_name().to_string_lossy();
            let path = entry.path();

            if fname == "matrix.mtx" || fname == "matrix.mtx.gz" {
                println!("[pipeline] Found SC Matrix at {:?}, uploading...", path);
                let _ = upload_asset(api_base, run_id, path, "MATRIX").await;
            } else if fname == "barcodes.tsv" || fname == "barcodes.tsv.gz" {
                let _ = upload_asset(api_base, run_id, path, "BARCODES").await;
            } else if fname == "features.tsv" || fname == "features.tsv.gz" || fname == "genes.tsv"
            {
                let _ = upload_asset(api_base, run_id, path, "FEATURES").await;
            }
        }
    }

    // 3. Scenario B: Bulk RNA (Counts Table)
    if is_rnaseq {
        // Look for salmon.merged.gene_counts.tsv
        let walker = walkdir::WalkDir::new(out_dir).into_iter();
        for entry in walker.filter_map(|e| e.ok()) {
            let fname = entry.file_name().to_string_lossy();
            if fname.contains("salmon.merged.gene_counts.tsv") || fname.contains("gene_counts.tsv")
            {
                println!(
                    "[pipeline] Found Counts Table at {:?}, uploading...",
                    entry.path()
                );
                let _ = upload_asset(api_base, run_id, entry.path(), "COUNTS").await;
                break; // Only need one main counts file usually
            }
        }
    }

    // 4. Universal: Coordinate Files (UMAP, t-SNE, PCA)
    // Run this for ALL pipelines to be scalable/compatible with future modules
    let walker = walkdir::WalkDir::new(out_dir).into_iter();
    for entry in walker.filter_map(|e| e.ok()) {
        let fname = entry.file_name().to_string_lossy();
        let path = entry.path();

        if (fname.contains("umap")
            || fname.contains("tsne")
            || fname.contains("projection")
            || fname.contains("pca"))
            && fname.ends_with(".csv")
        {
            println!("[pipeline] Found Coordinates at {:?}, uploading...", path);
            let _ = upload_asset(api_base, run_id, path, "COORDS").await;
        }
    }

    Ok(())
}

async fn upload_asset(
    api_base: &str,
    run_id: &str,
    file_path: &std::path::Path,
    asset_type: &str, // Added asset_type parameter
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{}/runs/{}/assets", api_base, run_id);

    if !file_path.exists() {
        return Err(format!("File not found: {:?}", file_path));
    }

    let filename = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Read file bytes
    let data = std::fs::read(file_path).map_err(|e| e.to_string())?;

    // Create multipart form
    // Note: requires "multipart" feature in reqwest
    let part = reqwest::multipart::Part::bytes(data).file_name(filename.clone());
    let mut form = reqwest::multipart::Form::new().part("file", part);

    // Add asset type field
    form = form.text("asset_type", asset_type.to_string());

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

    println!("[pipeline] Uploaded {} as {}", filename, asset_type);
    Ok(())
}
