// Module: Pipeline Automator
// Role: The "Factory" - wraps Nextflow/Snakemake to automate bioinformatics pipelines

mod nextflow;
mod websocket;

pub use nextflow::{NextflowConfig, NextflowWrapper, PipelineStatus};
pub use websocket::PipelineWebSocket;

use crate::db::prisma::PrismaClient;
use crate::error::ServerError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Pipeline execution request
#[derive(Debug, Deserialize)]
pub struct PipelineRequest {
    pub experiment_id: String,
    pub pipeline_type: String, // e.g., "nf-core/rnaseq"
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

/// Manages active pipeline runs
pub struct PipelineManager {
    db: Arc<PrismaClient>,
    active_runs: Arc<RwLock<std::collections::HashMap<String, NextflowWrapper>>>,
}

impl PipelineManager {
    pub fn new(db: Arc<PrismaClient>) -> Self {
        Self {
            db,
            active_runs: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Start a new pipeline run
    pub async fn start_pipeline(
        &self,
        request: PipelineRequest,
    ) -> Result<PipelineResponse, ServerError> {
        // Job A: Dynamic Configuration - generate config from DB state
        let config = self.generate_config(&request).await?;

        // Create pipeline run record in DB
        let run_id = self.create_run_record(&request).await?;

        // Job B: Process Management - spawn Nextflow in background
        let wrapper = NextflowWrapper::new(run_id.clone(), config);
        
        // Store active run
        self.active_runs.write().await.insert(run_id.clone(), wrapper);

        Ok(PipelineResponse {
            run_id: run_id.clone(),
            status: "RUNNING".to_string(),
            message: format!("Pipeline {} started", run_id),
        })
    }

    /// Generate Nextflow configuration from database state
    async fn generate_config(
        &self,
        _request: &PipelineRequest,
    ) -> Result<NextflowConfig, ServerError> {
        // TODO: Query DB for experiment data
        // - Get linked samples
        // - Get input files (DigitalAssets)
        // - Generate samplesheet.csv
        // - Set output directory
        
        Ok(NextflowConfig::default())
    }

    /// Create pipeline run record in database
    async fn create_run_record(&self, _request: &PipelineRequest) -> Result<String, ServerError> {
        // TODO: Create PipelineRun record in DB
        Ok("run-123".to_string())
    }

    /// Cancel a running pipeline
    pub async fn cancel_pipeline(&self, run_id: &str) -> Result<(), ServerError> {
        if let Some(wrapper) = self.active_runs.write().await.remove(run_id) {
            wrapper.cancel().await?;
        }
        Ok(())
    }

    /// Get status of a pipeline run
    pub async fn get_status(&self, run_id: &str) -> Result<PipelineStatus, ServerError> {
        if let Some(wrapper) = self.active_runs.read().await.get(run_id) {
            Ok(wrapper.status())
        } else {
            // Query DB for completed runs
            Ok(PipelineStatus::Unknown)
        }
    }
}
