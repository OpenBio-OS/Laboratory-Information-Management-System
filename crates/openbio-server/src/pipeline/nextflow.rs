// Nextflow wrapper - handles process spawning, monitoring, and cleanup

use crate::db::prisma::PrismaClient;
use crate::error::ServerError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

/// Configuration for Nextflow pipeline execution
#[derive(Debug, Clone)]
pub struct NextflowConfig {
    pub pipeline_name: String, // e.g., "nf-core/rnaseq"
    pub input_samplesheet: PathBuf,
    pub output_dir: PathBuf,
    pub genome: Option<String>,
    pub profile: String, // e.g., "docker", "singularity"
    pub extra_params: Vec<(String, String)>,
}

impl Default for NextflowConfig {
    fn default() -> Self {
        Self {
            pipeline_name: String::new(),
            input_samplesheet: PathBuf::new(),
            output_dir: PathBuf::new(),
            genome: None,
            profile: "docker".to_string(),
            extra_params: Vec::new(),
        }
    }
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

/// Wrapper around Nextflow process
pub struct NextflowWrapper {
    run_id: String,
    config: NextflowConfig,
    process: Option<Child>,
    log_sender: Option<mpsc::UnboundedSender<String>>,
    status: PipelineStatus,
}

impl NextflowWrapper {
    pub fn new(run_id: String, config: NextflowConfig) -> Self {
        Self {
            run_id,
            config,
            process: None,
            log_sender: None,
            status: PipelineStatus::Pending,
        }
    }

    /// Job B: Spawn Nextflow process
    pub async fn start(
        &mut self,
        log_sender: mpsc::UnboundedSender<String>,
    ) -> Result<(), ServerError> {
        self.log_sender = Some(log_sender.clone());
        self.status = PipelineStatus::Running;

        // Build Nextflow command
        let mut cmd = Command::new("nextflow");
        cmd.arg("run")
            .arg(&self.config.pipeline_name)
            .arg("--input")
            .arg(&self.config.input_samplesheet)
            .arg("--outdir")
            .arg(&self.config.output_dir)
            .arg("-profile")
            .arg(&self.config.profile);

        if let Some(genome) = &self.config.genome {
            cmd.arg("--genome").arg(genome);
        }

        // Add custom parameters
        for (key, value) in &self.config.extra_params {
            cmd.arg(format!("--{}", key)).arg(value);
        }

        // Configure stdout/stderr capture
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd.spawn().map_err(|e| {
            ServerError::Internal(format!("Failed to spawn Nextflow: {}", e))
        })?;

        // Job C: Stream logs in real-time
        let stdout = child.stdout.take().ok_or_else(|| {
            ServerError::Internal("Failed to capture stdout".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            ServerError::Internal("Failed to capture stderr".to_string())
        })?;

        // Spawn tasks to read stdout and stderr
        let log_tx_stdout = log_sender.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = log_tx_stdout.send(line);
            }
        });

        let log_tx_stderr = log_sender;
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = log_tx_stderr.send(format!("[ERROR] {}", line));
            }
        });

        self.process = Some(child);
        Ok(())
    }

    /// Wait for process completion and handle cleanup
    pub async fn wait_and_cleanup(
        &mut self,
        db_client: &PrismaClient,
    ) -> Result<(), ServerError> {
        if let Some(mut process) = self.process.take() {
            match process.wait().await {
                Ok(status) => {
                    if status.success() {
                        // Job D: Auto-linking and metadata generation
                        self.status = PipelineStatus::Completed;
                        self.link_outputs(db_client).await?;
                    } else {
                        self.status = PipelineStatus::Failed(
                            format!("Exit code: {:?}", status.code())
                        );
                    }
                }
                Err(e) => {
                    self.status = PipelineStatus::Failed(e.to_string());
                }
            }
        }
        Ok(())
    }

    /// Job D: Scan output folder and link files to experiment
    async fn link_outputs(&self, _db_client: &PrismaClient) -> Result<(), ServerError> {
        
        // Scan output directory for key files
        let output_dir = &self.config.output_dir;
        
        // Look for common output patterns
        let patterns = vec![
            "matrix.mtx",
            "genes.tsv",
            "barcodes.tsv",
            "*.h5",
            "*.csv",
        ];

        // TODO: Implement file scanning
        // TODO: Create DigitalAsset records
        // TODO: Generate metadata.json with experiment context
        
        Ok(())
    }

    /// Cancel the running process
    pub async fn cancel(&self) -> Result<(), ServerError> {
        if let Some(_process) = &self.process {
            // Kill process gracefully
            // TODO: Implement process termination
        }
        Ok(())
    }

    /// Get current status
    pub fn status(&self) -> PipelineStatus {
        self.status.clone()
    }
}
