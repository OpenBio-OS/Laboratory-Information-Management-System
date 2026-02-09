// Tauri commands for Pipeline Automator module

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Deserialize, Serialize)]
pub struct StartPipelineRequest {
    pub experiment_id: String,
    pub pipeline_type: String,
    pub genome: Option<String>,
    pub custom_params: Option<serde_json::Value>,
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

/// Start a new pipeline run
#[tauri::command]
pub async fn start_pipeline(
    request: StartPipelineRequest,
    state: State<'_, crate::AppState>,
) -> Result<PipelineResponse, String> {
    let url = format!("{}/run", get_api_base_url(&state));

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

    response
        .json::<PipelineResponse>()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
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
    let url = format!("{}/runs/{}/cancel", get_api_base_url(&state), run_id);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
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
