// Module: Pipeline Metadata Storage
// Role: Store and retrieve pipeline run records from the database
// NOTE: The SERVER does NOT spawn Nextflow. All execution happens CLIENT-SIDE in Tauri.

use crate::db::prisma::PrismaClient;
use crate::error::ServerError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Pipeline execution request (metadata for creating a run record)
#[derive(Debug, Deserialize)]
pub struct PipelineRequest {
    pub experiment_id: String,
    pub pipeline_type: String,  // e.g., "nf-core/rnaseq"
    pub genome: Option<String>, // e.g., "GRCh38"
    pub custom_params: Option<serde_json::Value>,
}

/// Pipeline execution response
#[derive(Debug, Serialize)]
pub struct PipelineResponse {
    pub run_id: String,
    pub status: String,
    pub message: String,
}

/// Status of a pipeline run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PipelineStatus {
    Pending,
    Running,
    Completed,
    Failed(String),
    Cancelled,
    Unknown,
}

/// Manages pipeline run metadata in the database
/// NOTE: Does NOT spawn processes - that happens client-side
pub struct PipelineManager {
    db: Arc<PrismaClient>,
}

impl PipelineManager {
    pub fn new(db: Arc<PrismaClient>) -> Self {
        Self { db }
    }

    /// Create a new pipeline run record (metadata only)
    /// The actual pipeline execution happens client-side in Tauri
    pub async fn start_pipeline(
        &self,
        request: PipelineRequest,
    ) -> Result<PipelineResponse, ServerError> {
        // Create pipeline run record in DB with PENDING status
        let run_id = self.create_run_record(&request).await?;

        Ok(PipelineResponse {
            run_id: run_id.clone(),
            status: "PENDING".to_string(),
            message: format!(
                "Pipeline run {} created. Client will start execution.",
                run_id
            ),
        })
    }

    /// Create pipeline run record in database
    async fn create_run_record(&self, request: &PipelineRequest) -> Result<String, ServerError> {
        use crate::db::prisma::pipeline_run;

        // Serialize custom params to JSON string
        let config_json = request
            .custom_params
            .as_ref()
            .map(|p| serde_json::to_string(p).ok())
            .flatten();

        let mut params = vec![pipeline_run::status::set("PENDING".to_string())];
        if let Some(json) = config_json {
            params.push(pipeline_run::config_json::set(Some(json)));
        }

        let run = self
            .db
            .pipeline_run()
            .create(
                crate::db::prisma::experiment::id::equals(request.experiment_id.clone()),
                request.pipeline_type.clone(),
                params,
            )
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        Ok(run.id)
    }

    /// Update status in database (called by client via API)
    pub async fn update_run_status(
        &self,
        run_id: &str,
        status: &str,
        error_message: Option<String>,
    ) -> Result<(), ServerError> {
        use crate::db::prisma::pipeline_run;

        let mut updates = vec![pipeline_run::status::set(status.to_string())];

        // Set started_at when transitioning to RUNNING
        if status == "RUNNING" {
            updates.push(pipeline_run::started_at::set(Some(
                chrono::Utc::now().fixed_offset(),
            )));
        }

        // Set completed_at when finished
        if status == "COMPLETED" || status == "FAILED" || status == "CANCELLED" {
            updates.push(pipeline_run::completed_at::set(Some(
                chrono::Utc::now().fixed_offset(),
            )));
        }

        // Store error message in config_json if failed
        if let Some(err) = error_message {
            let error_json = serde_json::json!({ "error": err }).to_string();
            updates.push(pipeline_run::config_json::set(Some(error_json)));
        }

        self.db
            .pipeline_run()
            .update(pipeline_run::id::equals(run_id.to_string()), updates)
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        Ok(())
    }

    /// Cancel a pipeline (just updates status - actual cancellation happens client-side)
    pub async fn cancel_pipeline(&self, run_id: &str) -> Result<(), ServerError> {
        self.update_run_status(run_id, "CANCELLED", None).await
    }

    /// Get status of a pipeline run
    pub async fn get_status(&self, run_id: &str) -> Result<PipelineStatus, ServerError> {
        use crate::db::prisma::pipeline_run;

        let run = self
            .db
            .pipeline_run()
            .find_unique(pipeline_run::id::equals(run_id.to_string()))
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?
            .ok_or_else(|| ServerError::NotFound(format!("Pipeline run {}", run_id)))?;

        // Map DB status string to enum
        match run.status.as_str() {
            "PENDING" => Ok(PipelineStatus::Pending),
            "RUNNING" => Ok(PipelineStatus::Running),
            "COMPLETED" => Ok(PipelineStatus::Completed),
            "FAILED" => {
                let error_msg = run
                    .config_json
                    .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                    .and_then(|v| {
                        v.get("error")
                            .and_then(|e| e.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| "Check logs for details".to_string());
                Ok(PipelineStatus::Failed(error_msg))
            }
            "CANCELLED" => Ok(PipelineStatus::Cancelled),
            _ => Ok(PipelineStatus::Unknown),
        }
    }

    /// List all pipeline runs
    pub async fn list_runs(&self) -> Result<Vec<serde_json::Value>, ServerError> {
        use crate::db::prisma::pipeline_run;

        let runs = self
            .db
            .pipeline_run()
            .find_many(vec![])
            .with(pipeline_run::experiment::fetch())
            .order_by(pipeline_run::created_at::order(
                ::prisma_client_rust::Direction::Desc,
            ))
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        // Convert to JSON values expected by frontend
        let result = runs.into_iter().map(|r| {
            serde_json::json!({
                "id": r.id,
                "experimentId": r.experiment_id,
                "experimentName": r.experiment.map(|e| e.name).unwrap_or_else(|| "Unknown Experiment".to_string()),
                "pipelineType": r.pipeline_type,
                "status": r.status,
                "startedAt": r.started_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                "completedAt": r.completed_at.map(|d| d.to_rfc3339()),
                "error": if r.status == "FAILED" {
                    r.config_json.as_ref()
                        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
                        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                        .or_else(|| Some("Pipeline execution failed".to_string()))
                } else { None }
            })
        }).collect();

        Ok(result)
    }
}
