// Tauri commands for pipeline environment management

use crate::pipeline_env::*;
use tauri::{AppHandle, Emitter, Window};

/// Check if pipeline environment is initialized
#[tauri::command]
pub async fn check_pipeline_environment(app_handle: AppHandle) -> Result<bool, String> {
    println!("[cmd] check_pipeline_environment called");
    let result = check_environment_initialized(&app_handle);
    println!("[cmd] check_pipeline_environment -> {:?}", result);
    result
}

/// Check if Docker is available
#[tauri::command]
pub async fn check_docker_installed() -> Result<bool, String> {
    check_docker_available()
}

/// Get Docker version information
#[tauri::command]
pub async fn get_docker_info() -> Result<Option<String>, String> {
    Ok(get_docker_version())
}

/// Bootstrap the pipeline environment
#[tauri::command]
pub async fn setup_pipeline_environment(
    app_handle: AppHandle,
    window: Window,
) -> Result<PipelineEnvironment, String> {
    println!("[cmd] setup_pipeline_environment called");

    let window_clone = window.clone();

    let env = bootstrap_environment(&app_handle, move |progress| {
        println!(
            "[cmd]   emitting progress event: stage={} msg={} progress={}",
            progress.stage, progress.message, progress.progress
        );
        let emit_result = window_clone.emit("pipeline-setup-progress", &progress);
        println!("[cmd]   emit result: {:?}", emit_result);
    })
    .await?;

    // Config is already saved inside bootstrap_environment -> finalize_environment
    // No need to double-save

    println!("[cmd] setup_pipeline_environment -> OK");
    Ok(env)
}

/// Get saved environment configuration
#[tauri::command]
pub async fn get_pipeline_environment(
    app_handle: AppHandle,
) -> Result<Option<PipelineEnvironment>, String> {
    load_environment_config(&app_handle)
}

/// Get the path to Nextflow executable
#[tauri::command]
pub async fn get_nextflow_path(app_handle: AppHandle) -> Result<String, String> {
    let config = load_environment_config(&app_handle)?
        .ok_or_else(|| "Environment not initialized".to_string())?;

    Ok(config.nextflow_path.to_string_lossy().to_string())
}

/// Verify environment is working by running nextflow -version
#[tauri::command]
pub async fn verify_pipeline_environment(app_handle: AppHandle) -> Result<String, String> {
    let config = load_environment_config(&app_handle)?
        .ok_or_else(|| "Environment not initialized".to_string())?;

    let output = std::process::Command::new(&config.nextflow_path)
        .arg("-version")
        .env("JAVA_HOME", &config.java_home)
        .output()
        .map_err(|e| format!("Failed to run nextflow: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Nextflow verification failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.to_string())
}

/// Update Nextflow to the latest version
#[tauri::command]
pub async fn update_nextflow(
    app_handle: AppHandle,
    window: Window,
) -> Result<PipelineEnvironment, String> {
    println!("[cmd] update_nextflow called");

    let window_clone = window.clone();

    let env = update_environment(&app_handle, move |progress| {
        let _ = window_clone.emit("pipeline-update-progress", &progress);
    })
    .await?;

    println!("[cmd] update_nextflow -> OK");
    Ok(env)
}
