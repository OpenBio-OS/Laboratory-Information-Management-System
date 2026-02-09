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
        self.active_runs
            .write()
            .await
            .insert(run_id.clone(), wrapper);

        // Update status in DB to RUNNING
        self.update_run_status(&run_id, "RUNNING", None).await?;

        Ok(PipelineResponse {
            run_id: run_id.clone(),
            status: "RUNNING".to_string(),
            message: format!("Pipeline {} started", run_id),
        })
    }

    /// Generate Nextflow configuration from database state
    async fn generate_config(
        &self,
        request: &PipelineRequest,
    ) -> Result<NextflowConfig, ServerError> {
        let mut config = NextflowConfig::default();
        config.pipeline_name = request.pipeline_type.clone();

        // Parse custom_params to get experiment inputs
        if let Some(params) = &request.custom_params {
            if let Some(inputs) = params.get("experiment_inputs").and_then(|v| v.as_array()) {
                // Generate samplesheet content
                let mut csv_content =
                    String::from("sample,fastq_1,fastq_2,strandedness,replicate\n");

                for input in inputs {
                    let experiment_name = input["experiment_name"].as_str().unwrap_or("unknown");
                    let group = input["group"].as_str().unwrap_or("treatment"); // Default to treatment if missing
                                                                                // Use group as sample name prefix or just use experiment name?
                                                                                // For now, use experiment name as sample name to keep it simple
                                                                                // But maybe user wants group info in samplesheet?
                                                                                // The standard nf-core/rnaseq samplesheet has: sample,fastq_1,fastq_2,strandedness
                                                                                // Some pipelines use 'group' column. Let's include 'group' if possible or map it to sample name.
                                                                                // Actually, let's stick to the standard 4 columns: sample,fastq_1,fastq_2,strandedness
                                                                                // And replicate?

                    // Let's use the schema: sample,fastq_1,fastq_2,strandedness
                    // And maybe append group to sample name: "ExperimentName_Group"
                    let sample_name = format!("{}_{}", experiment_name, group);

                    let files = input["files"].as_array();
                    if let Some(files) = files {
                        // Naive pairing: find first two fastq files
                        let fastqs: Vec<&str> = files
                            .iter()
                            .filter_map(|f| {
                                let path = f["path"].as_str()?;
                                if path.ends_with(".fastq")
                                    || path.ends_with(".fastq.gz")
                                    || path.ends_with(".fq")
                                    || path.ends_with(".fq.gz")
                                {
                                    Some(path)
                                } else {
                                    None
                                }
                            })
                            .collect();

                        if !fastqs.is_empty() {
                            let fq1 = fastqs[0];
                            let fq2 = if fastqs.len() > 1 { fastqs[1] } else { "" };
                            let strandedness = "auto"; // Default
                            let replicate = "1"; // Default

                            // Standard nf-core/rnaseq: sample,fastq_1,fastq_2,strandedness
                            // Custom columns can be added. Let's add 'replicate' too just in case.
                            // CSV line: sample,fastq_1,fastq_2,strandedness
                            csv_content.push_str(&format!(
                                "{},{},{},{}\n",
                                sample_name, fq1, fq2, strandedness
                            ));
                        }
                    }
                }

                // Write to temp file
                use std::io::Write;
                let mut temp_path = std::env::temp_dir();
                temp_path.push(format!("samplesheet_{}.csv", uuid::Uuid::new_v4()));

                let mut file = std::fs::File::create(&temp_path).map_err(|e| {
                    ServerError::Internal(format!("Failed to create samplesheet: {}", e))
                })?;

                file.write_all(csv_content.as_bytes()).map_err(|e| {
                    ServerError::Internal(format!("Failed to write samplesheet: {}", e))
                })?;

                config.input_samplesheet = temp_path;
            }
        }

        // Output directory (temp for now)
        let mut out_dir = std::env::temp_dir();
        out_dir.push(format!("nf_out_{}", uuid::Uuid::new_v4()));
        config.output_dir = out_dir;

        Ok(config)
    }

    /// Create pipeline run record in database
    async fn create_run_record(&self, request: &PipelineRequest) -> Result<String, ServerError> {
        use crate::db::prisma::pipeline_run;

        let config_json = request
            .custom_params
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "{}".to_string());

        let run = self
            .db
            .pipeline_run()
            .create(
                crate::db::prisma::experiment::id::equals(request.experiment_id.clone()),
                request.pipeline_type.clone(),
                vec![
                    pipeline_run::status::set("PENDING".to_string()),
                    pipeline_run::started_at::set(Some(chrono::Utc::now().into())),
                    pipeline_run::config_json::set(Some(config_json)),
                ],
            )
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        Ok(run.id)
    }

    /// Update status in database
    async fn update_run_status(
        &self,
        run_id: &str,
        status: &str,
        exit_code: Option<i32>,
    ) -> Result<(), ServerError> {
        use crate::db::prisma::pipeline_run;

        let mut updates = vec![pipeline_run::status::set(status.to_string())];

        if let Some(code) = exit_code {
            updates.push(pipeline_run::exit_code::set(Some(code)));
        }

        if status == "COMPLETED" || status == "FAILED" || status == "CANCELLED" {
            updates.push(pipeline_run::completed_at::set(Some(
                chrono::Utc::now().into(),
            )));
        }

        self.db
            .pipeline_run()
            .update(pipeline_run::id::equals(run_id.to_string()), updates)
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        Ok(())
    }

    /// Cancel a running pipeline
    pub async fn cancel_pipeline(&self, run_id: &str) -> Result<(), ServerError> {
        if let Some(wrapper) = self.active_runs.write().await.remove(run_id) {
            wrapper.cancel().await?;
        }

        self.update_run_status(run_id, "CANCELLED", None).await?;

        Ok(())
    }

    /// Get status of a pipeline run
    pub async fn get_status(&self, run_id: &str) -> Result<PipelineStatus, ServerError> {
        // First check active runs (in memory)
        if let Some(wrapper) = self.active_runs.read().await.get(run_id) {
            return Ok(wrapper.status());
        }

        // If not active, check database
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
            "FAILED" => Ok(PipelineStatus::Failed("Detailed error in logs".to_string())),
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
                "error": if r.status == "FAILED" { Some("Pipeline execution failed") } else { None }
            })
        }).collect();

        Ok(result)
    }
}
