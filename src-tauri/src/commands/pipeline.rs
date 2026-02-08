// Tauri commands for Pipeline Automator module

use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::Utc;

#[derive(Debug, Deserialize)]
pub struct StartPipelineRequest {
    pub experiment_id: String,
    pub pipeline_type: String,
    pub genome: Option<String>,
    pub custom_params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct PipelineResponse {
    pub run_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct PipelineStatus {
    pub run_id: String,
    pub status: String,
    pub progress: Option<f32>,
    pub message: Option<String>,
}

/// Start a new pipeline run
#[tauri::command]
pub async fn start_pipeline(
    request: StartPipelineRequest,
    state: State<'_, crate::AppState>,
) -> Result<PipelineResponse, String> {
    // TODO: Use openbio-server's PipelineManager
    // For now, return a mock response
    
    Ok(PipelineResponse {
        run_id: "run-123".to_string(),
        status: "RUNNING".to_string(),
        message: format!("Started {} pipeline", request.pipeline_type),
    })
}

/// Get status of a pipeline run
#[tauri::command]
pub async fn get_pipeline_status(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<PipelineStatus, String> {
    // TODO: Query PipelineManager
    
    Ok(PipelineStatus {
        run_id,
        status: "RUNNING".to_string(),
        progress: Some(0.5),
        message: Some("Processing samples...".to_string()),
    })
}

/// Cancel a running pipeline
#[tauri::command]
pub async fn cancel_pipeline(
    run_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // TODO: Call PipelineManager.cancel_pipeline
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

/// List all pipeline runs
#[tauri::command]
pub async fn list_pipeline_runs(
    state: State<'_, crate::AppState>,
) -> Result<Vec<PipelineRun>, String> {
    // TODO: Query database for all pipeline runs
    // For now, return mock data
    Ok(vec![
        PipelineRun {
            id: "run-1".to_string(),
            experiment_id: "exp-1".to_string(),
            experiment_name: "Sample Batch A - scRNA-seq".to_string(),
            pipeline_type: "nf-core/scrnaseq".to_string(),
            status: "RUNNING".to_string(),
            progress: Some(0.45),
            started_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            error: None,
        },
        PipelineRun {
            id: "run-2".to_string(),
            experiment_id: "exp-2".to_string(),
            experiment_name: "PBMC Analysis".to_string(),
            pipeline_type: "nf-core/rnaseq".to_string(),
            status: "COMPLETED".to_string(),
            progress: Some(1.0),
            started_at: chrono::Utc::now()
                .checked_sub_signed(chrono::Duration::hours(2))
                .unwrap()
                .to_rfc3339(),
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
            error: None,
        },
    ])
}

#[derive(Debug, Serialize)]
pub struct PipelineRun {
    pub id: String,
    pub experiment_id: String,
    pub experiment_name: String,
    pub pipeline_type: String,
    pub status: String,
    pub progress: Option<f32>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PipelineInfo {
    pub name: String,
    pub description: String,
    pub version: String,
}
