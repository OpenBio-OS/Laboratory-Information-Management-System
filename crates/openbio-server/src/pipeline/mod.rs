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

/// Helper to recursively fetch container hierarchy for a sample
pub async fn get_sample_location(
    db: &crate::db::prisma::PrismaClient,
    container_id: Option<String>,
    slot: Option<String>,
) -> Option<String> {
    let mut current_id = container_id;
    let mut parts = Vec::new();

    while let Some(id) = current_id {
        let container = db
            .container()
            .find_unique(crate::db::prisma::container::id::equals(id))
            .with(crate::db::prisma::container::parent::fetch())
            .exec()
            .await
            .ok()
            .flatten();

        if let Some(c) = container {
            parts.push(c.name.clone());
            current_id = c.parent_id;
        } else {
            break;
        }
    }

    if parts.is_empty() {
        return None;
    }

    parts.reverse();
    let mut path = parts.join(" > ");
    if let Some(s) = slot {
        path.push_str(&format!(" ({})", s));
    }
    Some(path)
}

/// Unescape basic HTML entities
fn html_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
}

/// Extract a data-attribute value from an HTML tag
fn get_html_attr(tag: &str, attr_name: &str) -> Option<String> {
    let prefix = format!("{}=\"", attr_name);
    tag.find(&prefix).and_then(|start| {
        let val_start = start + prefix.len();
        tag[val_start..]
            .find('"')
            .map(|end| html_unescape(&tag[val_start..val_start + end]))
    })
}

/// Parse <span data-type="mention" ...> tags from HTML content into samples/equipment/papers
fn parse_mentions_from_html(
    html: &str,
    all_samples: &mut std::collections::HashMap<String, serde_json::Value>,
    all_equipment: &mut std::collections::HashMap<String, serde_json::Value>,
    all_papers: &mut std::collections::HashMap<String, serde_json::Value>,
) {
    let mut search_from = 0;
    while let Some(pos) = html[search_from..].find("data-type=\"mention\"") {
        let abs_pos = search_from + pos;
        let span_start = match html[..abs_pos].rfind("<span") {
            Some(s) => s,
            None => {
                search_from = abs_pos + 1;
                continue;
            }
        };
        let tag_end = match html[abs_pos..].find('>') {
            Some(e) => abs_pos + e + 1,
            None => {
                search_from = abs_pos + 1;
                continue;
            }
        };
        let tag = &html[span_start..tag_end];

        let entity_type = get_html_attr(tag, "data-entity-type").unwrap_or_default();
        let entity_id = get_html_attr(tag, "data-id").unwrap_or_default();
        let name = get_html_attr(tag, "data-name").unwrap_or_default();
        let notes = get_html_attr(tag, "data-notes");
        let category = get_html_attr(tag, "data-category");
        let path_str = get_html_attr(tag, "data-path");

        let location: Option<String> = path_str.and_then(|p| {
            serde_json::from_str::<Vec<String>>(&p).ok().map(|parts| {
                let hierarchy: Vec<&String> =
                    parts.iter().take(parts.len().saturating_sub(1)).collect();
                if hierarchy.is_empty() {
                    parts.join(" > ")
                } else {
                    hierarchy
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(" > ")
                }
            })
        });

        println!(
            "[snapshot] HTML mention: type={}, id={}, name={}, notes={:?}",
            entity_type, entity_id, name, notes
        );

        match entity_type.as_str() {
            "sample" => {
                all_samples.entry(entity_id.clone()).or_insert_with(|| {
                    serde_json::json!({
                        "id": entity_id,
                        "name": name,
                        "type": category.unwrap_or_else(|| "Unknown".to_string()),
                        "metadata": notes,
                        "role": "Mentioned",
                        "location": location,
                    })
                });
            }
            "equipment" => {
                all_equipment.entry(entity_id.clone()).or_insert_with(|| {
                    serde_json::json!({
                        "id": entity_id,
                        "name": name,
                        "type": category.unwrap_or_else(|| "Unknown".to_string()),
                    })
                });
            }
            "paper" => {
                all_papers.entry(entity_id.clone()).or_insert_with(|| {
                    serde_json::json!({
                        "id": entity_id,
                        "title": name,
                        "notes": notes,
                    })
                });
            }
            _ => {}
        }
        search_from = tag_end;
    }
}

/// Helper to capture a full metadata snapshot for an experiment (or multiple experiments)
pub async fn capture_experiment_snapshot(
    db: &crate::db::prisma::PrismaClient,
    experiment_ids: Vec<String>,
) -> Option<String> {
    if experiment_ids.is_empty() {
        return None;
    }

    let mut all_samples: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    let mut all_equipment: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    let mut all_papers: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    let mut aggregated_notebook_content = String::new();

    for experiment_id in &experiment_ids {
        let experiment = db
            .experiment()
            .find_unique(crate::db::prisma::experiment::id::equals(
                experiment_id.clone(),
            ))
            .with(crate::db::prisma::experiment::entries::fetch(vec![]))
            .with(crate::db::prisma::experiment::equipment::fetch())
            .with(crate::db::prisma::experiment::locked_equipment::fetch(
                vec![],
            ))
            .exec()
            .await
            .ok()
            .flatten();

        if experiment.is_none() {
            println!(
                "[snapshot] WARNING: Experiment {} not found in database",
                experiment_id
            );
        }

        if let Some(exp) = experiment {
            // Aggregate notebook content
            let notebook_header = if experiment_ids.len() > 1 {
                format!("<h2 style=\"margin-bottom: 8px; color: #17b978; font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;\">Experiment: {}</h2>", exp.name)
            } else {
                String::new()
            };

            if !exp.content.is_empty() || exp.description.is_some() {
                if !aggregated_notebook_content.is_empty() {
                    aggregated_notebook_content.push_str("<div style=\"margin: 32px 0;\"></div>");
                }
                aggregated_notebook_content.push_str(&notebook_header);

                if let Some(desc) = exp.description.as_ref() {
                    aggregated_notebook_content.push_str(&format!(
                        "<!-- [DESCRIPTION_START] --> <p style=\"color: rgba(255,255,255,0.6); font-style: italic; margin-bottom: 24px;\">{}</p> <!-- [DESCRIPTION_END] -->",
                        desc
                    ));
                }

                if !exp.content.is_empty() {
                    aggregated_notebook_content.push_str(&exp.content);
                }

                // Aggregate Experiment Entries (logs, imports)
                let empty_entries = vec![];
                let entries = exp.entries().unwrap_or(&empty_entries);
                if !entries.is_empty() {
                    aggregated_notebook_content.push_str("<div style=\"margin: 24px 0;\"></div>");
                    aggregated_notebook_content.push_str("<h4 style=\"color: rgba(255,255,255,0.4); font-size: 0.9rem; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px;\">Recorded Entries</h4>");
                    for entry in entries {
                        let author_str = entry
                            .author
                            .as_ref()
                            .map(|a| format!(" by {}", a))
                            .unwrap_or_default();
                        aggregated_notebook_content.push_str(&format!(
                            "<div style=\"border-left: 2px solid rgba(255,255,255,0.1); padding-left: 16px; margin-bottom: 16px;\">
                                <p style=\"font-size: 0.8rem; color: rgba(255,255,255,0.3); margin-bottom: 4px;\">[{}] {}</p>
                                <div style=\"font-size: 0.9rem; color: rgba(255,255,255,0.8);\">{}</div>
                             </div>",
                            entry.timestamp.to_rfc3339().chars().take(16).collect::<String>().replace("T", " "),
                            author_str,
                            entry.content
                        ));
                    }
                }
            }

            println!(
                "[snapshot] Processing experiment {}: equipment={}, entries={}",
                exp.id,
                exp.equipment().map(|e| e.is_some()).unwrap_or(false) as usize,
                exp.entries().map(|e| e.len()).unwrap_or(0)
            );

            // Parse mentions (samples, equipment) from HTML content spans
            if !exp.content.is_empty() {
                println!(
                    "[snapshot] Parsing HTML content ({} chars) for mentions...",
                    exp.content.len()
                );
                parse_mentions_from_html(
                    &exp.content,
                    &mut all_samples,
                    &mut all_equipment,
                    &mut all_papers,
                );
                println!(
                    "[snapshot] After HTML parsing: samples={}, equipment={}",
                    all_samples.len(),
                    all_equipment.len()
                );
            }

            // Aggregate equipment from link
            if let Ok(Some(e)) = exp.equipment() {
                println!(
                    "[snapshot] Extracting equipment from experiment linkage: {}",
                    e.id
                );
                all_equipment.insert(
                    e.id.clone(),
                    serde_json::json!({
                        "id": e.id.clone(),
                        "name": e.name.clone(),
                        "type": e.r#type.clone(),
                        "model": e.model.clone(),
                        "serialNumber": e.serial_number.clone(),
                    }),
                );
            }
            let empty_locked = vec![];
            for e in exp.locked_equipment().unwrap_or(&empty_locked) {
                println!(
                    "[snapshot] Extracting locked equipment from experiment: {}",
                    e.id
                );
                all_equipment
                    .entry(e.id.clone())
                    .or_insert(serde_json::json!({
                        "id": e.id.clone(),
                        "name": e.name.clone(),
                        "type": e.r#type.clone(),
                        "model": e.model.clone(),
                        "serialNumber": e.serial_number.clone(),
                    }));
            }
        }
    }

    // Resolve paper IDs that were found in HTML content - enrich with full DB metadata
    let paper_ids: Vec<String> = all_papers.keys().cloned().collect();

    println!(
        "[snapshot] Found {} paper IDs to resolve: {:?}",
        paper_ids.len(),
        paper_ids
    );

    if !paper_ids.is_empty() {
        if let Ok(p) = db
            .paper()
            .find_many(vec![crate::db::prisma::paper::id::in_vec(paper_ids)])
            .exec()
            .await
        {
            for paper in p {
                // Overwrite the minimal HTML-derived entry with full DB data
                all_papers.insert(
                    paper.id.clone(),
                    serde_json::json!({
                        "id": paper.id,
                        "title": paper.title,
                        "authors": paper.authors,
                        "journal": paper.journal,
                        "year": paper.year,
                        "doi": paper.doi,
                        "url": paper.url,
                        "abstract": paper.r#abstract,
                        "notes": paper.notes,
                    }),
                );
            }
        }
    }

    // Use the first experiment's metadata as the "primary" context if multiple exist
    let (primary_id, primary_desc) = if let Some(first_id) = experiment_ids.get(0) {
        // Find the first experiment in the results we fetched
        let first_exp = db
            .experiment()
            .find_unique(crate::db::prisma::experiment::id::equals(first_id.clone()))
            .exec()
            .await
            .ok()
            .flatten();

        match first_exp {
            Some(e) => (e.id, e.description),
            None => (first_id.clone(), None),
        }
    } else {
        ("unknown".to_string(), None)
    };

    let snapshot = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "experiments": experiment_ids,
        "experiment": {
            "id": primary_id,
            "content": aggregated_notebook_content,
            "description": primary_desc,
        },
        "samples": all_samples.into_values().collect::<Vec<_>>(),
        "equipment": all_equipment.into_values().collect::<Vec<_>>(),
        "linked_papers": all_papers.into_values().collect::<Vec<_>>(),
    });

    serde_json::to_string(&snapshot).ok()
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
        let config_json = request.custom_params.as_ref();

        let config_json_str = config_json.map(|p| serde_json::to_string(p).ok()).flatten();

        let mut params = vec![pipeline_run::status::set("PENDING".to_string())];
        if let Some(json) = config_json_str {
            params.push(pipeline_run::config_json::set(Some(json)));
        }

        // Aggregate experiment IDs for multi-experiment runs
        let mut experiment_ids = vec![request.experiment_id.clone()];
        if let Some(p) = config_json {
            if let Some(inputs) = p.get("experiment_inputs").and_then(|v| v.as_array()) {
                for input in inputs {
                    if let Some(id) = input.get("experiment_id").and_then(|v| v.as_str()) {
                        let id_str = id.to_string();
                        if !experiment_ids.contains(&id_str) {
                            experiment_ids.push(id_str);
                        }
                    }
                }
            }
        }

        // Capture metadata snapshot at start of run
        if let Some(snapshot) = capture_experiment_snapshot(&self.db, experiment_ids).await {
            params.push(pipeline_run::metadata_snapshot::set(Some(snapshot)));
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

        // NEW: Auto-create Visualization (Insight) on completion
        if status == "COMPLETED" {
            let run = self
                .db
                .pipeline_run()
                .find_unique(pipeline_run::id::equals(run_id.to_string()))
                .exec()
                .await
                .map_err(|e| ServerError::Database(e.to_string()))?
                .ok_or_else(|| ServerError::NotFound(format!("Pipeline run {}", run_id)))?;

            use crate::db::prisma::visualization;

            // Create Visualization record
            // Type mapping: simple heuristic based on pipeline type
            let viz_type = if run.pipeline_type.contains("scrna")
                || run.pipeline_type.contains("scanpy")
            {
                "SCANVAS"
            } else if run.pipeline_type.contains("rnaseq") || run.pipeline_type.contains("bulk") {
                "BULK_DASHBOARD"
            } else {
                "REPORT"
            };

            let viz_name = format!(
                "Analysis: {} ({})",
                run.pipeline_type,
                run_id.chars().take(8).collect::<String>()
            );

            let mut viz_params = vec![visualization::experiment::connect(
                crate::db::prisma::experiment::id::equals(run.experiment_id.clone()),
            )];

            // Copy metadata snapshot from pipeline run to visualization
            if let Some(snapshot) = run.metadata_snapshot.as_ref() {
                println!(
                    "[server] update_run_status: Copying snapshot ({} chars) to viz",
                    snapshot.len()
                );
                viz_params.push(visualization::metadata_snapshot::set(Some(
                    snapshot.clone(),
                )));
            } else {
                println!(
                    "[server] update_run_status: WARNING: No snapshot found on pipeline run {}",
                    run_id
                );
            }

            let viz = self
                .db
                .visualization()
                .create(viz_name, viz_type.to_string(), viz_params)
                .exec()
                .await
                .map_err(|e| ServerError::Database(e.to_string()))?;

            // Link all assets from this run to the new visualization
            use crate::db::prisma::digital_asset;
            self.db
                .digital_asset()
                .update_many(
                    vec![digital_asset::pipeline_run_id::equals(Some(
                        run_id.to_string(),
                    ))],
                    vec![digital_asset::visualization_id::set(Some(viz.id))],
                )
                .exec()
                .await
                .map_err(|e| ServerError::Database(e.to_string()))?;
        }

        Ok(())
    }

    /// Cancel a pipeline (just updates status - actual cancellation happens client-side)
    pub async fn cancel_pipeline(&self, run_id: &str) -> Result<(), ServerError> {
        self.update_run_status(run_id, "CANCELLED", None).await
    }

    /// Delete a pipeline run and all associated assets from disk and DB (Smart Deletion)
    pub async fn delete_run(
        &self,
        run_id: &str,
        storage_path: &std::path::Path,
    ) -> Result<(), ServerError> {
        use crate::db::prisma::{digital_asset, pipeline_run};

        // 1. Fetch assets associated with this run to apply Smart Deletion
        let assets = self
            .db
            .digital_asset()
            .find_many(vec![digital_asset::pipeline_run_id::equals(Some(
                run_id.to_string(),
            ))])
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        for asset in assets {
            // Smart Deletion Logic: Only delete from disk/DB if no other parents exist
            let has_experiment = asset.experiment_id.is_some();
            let has_visualization = asset.visualization_id.is_some();

            // Note: We are about to delete THIS pipeline run, so we don't need to check other pipeline runs
            // unless the schema allows many-to-many, but currently it's one pipelineRunId per asset.

            if !has_experiment && !has_visualization {
                // Truly orphan - delete file and record
                let path = storage_path.join(&asset.storage_key);
                if path.exists() {
                    let _ = std::fs::remove_file(path);
                }
                let _ = self
                    .db
                    .digital_asset()
                    .delete(digital_asset::id::equals(asset.id))
                    .exec()
                    .await;
            } else {
                // Shared asset - just detach it from this run
                let _ = self
                    .db
                    .digital_asset()
                    .update(
                        digital_asset::id::equals(asset.id),
                        vec![digital_asset::pipeline_run_id::set(None)],
                    )
                    .exec()
                    .await;
            }
        }

        // 2. Delete the specific run folder on disk if it exists
        // (This folder should contain temporary run files, not the actual assets which are moved to storage)
        let run_dir = storage_path.join("pipelines").join(run_id);
        if run_dir.exists() {
            let _ = std::fs::remove_dir_all(&run_dir);
        }

        // 3. Delete the run record itself
        self.db
            .pipeline_run()
            .delete(pipeline_run::id::equals(run_id.to_string()))
            .exec()
            .await
            .map_err(|e| ServerError::Database(e.to_string()))?;

        Ok(())
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
