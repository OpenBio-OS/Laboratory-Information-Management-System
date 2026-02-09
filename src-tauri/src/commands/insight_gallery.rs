// Tauri commands for Insight module - listing and managing visualizations

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightInstance {
    pub id: String,
    pub experiment_id: String,
    pub experiment_name: String,
    pub created_at: String,
    pub data_type: String,
    pub cell_count: Option<u32>,
    pub gene_count: Option<u32>,
    pub status: String,
    pub thumbnail_url: Option<String>,
}

/// Helper to get API base URL
fn get_api_base_url(state: &State<'_, crate::AppState>) -> String {
    let config = state.config.lock().unwrap();
    if config.mode == crate::DeploymentMode::Local || config.mode == crate::DeploymentMode::Hub {
        format!("http://localhost:{}/api", config.server_port)
    } else {
        let base = config
            .api_url
            .clone()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        base.trim_end_matches('/').to_string()
    }
}

/// List all insight instances (experiments with completed pipelines)
#[tauri::command]
pub async fn list_insight_instances(
    state: State<'_, crate::AppState>,
) -> Result<Vec<InsightInstance>, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments", api_base); // Assuming list_experiments endpoint returns JSON array

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let experiments_json: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;

    // Map experiments to InsightInstances
    // Filter only those with at least one COMPLETED pipeline run
    // The experiment JSON should contain "pipelineRuns"

    let mut instances = Vec::new();

    for exp in experiments_json {
        let runs = exp.get("pipelineRuns").and_then(|r| r.as_array());

        if let Some(runs) = runs {
            // Find the most recent completed run
            // Assuming strict ordering or check timestamps if provided
            let completed_run = runs
                .iter()
                .find(|r| r.get("status").and_then(|s| s.as_str()) == Some("COMPLETED"));

            if let Some(run) = completed_run {
                let pipeline_type = run
                    .get("pipelineType")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                // Determine data type for UI label
                let data_type = if pipeline_type.contains("scrnaseq") {
                    "scRNA-seq"
                } else if pipeline_type.contains("rnaseq") {
                    "Bulk RNA-seq"
                } else {
                    "Analysis"
                };

                let instance = InsightInstance {
                    id: format!("insight-{}", exp["id"].as_str().unwrap_or("unknown")),
                    experiment_id: exp["id"].as_str().unwrap_or("").to_string(),
                    experiment_name: exp["name"]
                        .as_str()
                        .unwrap_or("Unnamed Experiment")
                        .to_string(),
                    created_at: run["createdAt"]
                        .as_str()
                        .unwrap_or(&Utc::now().to_rfc3339())
                        .to_string(),
                    data_type: data_type.to_string(),
                    cell_count: None, // Could parse from metrics file later
                    gene_count: None,
                    status: "READY".to_string(),
                    thumbnail_url: None, // Could generate if we have images
                };
                instances.push(instance);
            } else {
                // Check if any run is IN_PROGRESS
                let running_run = runs.iter().find(|r| {
                    let s = r.get("status").and_then(|s| s.as_str());
                    s == Some("RUNNING") || s == Some("PENDING")
                });

                if let Some(run) = running_run {
                    // Show actively running pipelines too?
                    let pipeline_type = run
                        .get("pipelineType")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let instance = InsightInstance {
                        id: format!("insight-{}", exp["id"].as_str().unwrap_or("unknown")),
                        experiment_id: exp["id"].as_str().unwrap_or("").to_string(),
                        experiment_name: exp["name"]
                            .as_str()
                            .unwrap_or("Unnamed Experiment")
                            .to_string(),
                        created_at: run["createdAt"]
                            .as_str()
                            .unwrap_or(&Utc::now().to_rfc3339())
                            .to_string(),
                        data_type: if pipeline_type.contains("scrnaseq") {
                            "scRNA-seq"
                        } else {
                            "Pipeline"
                        }
                        .to_string(),
                        cell_count: None,
                        gene_count: None,
                        status: "PROCESSING".to_string(),
                        thumbnail_url: None,
                    };
                    // Optional: decide if we want to show pending runs in Gallery
                    instances.push(instance);
                }
            }
        }
    }

    // --- NEW: Fetch permanent visualizations from backend ---
    let viz_url = format!("{}/visualizations", api_base);
    let viz_resp = client
        .get(&viz_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if viz_resp.status().is_success() {
        let visualizations: Vec<serde_json::Value> =
            viz_resp.json().await.map_err(|e| e.to_string())?;

        for viz in visualizations {
            let instance = InsightInstance {
                id: viz["id"].as_str().unwrap_or("unknown").to_string(),
                experiment_id: viz["experimentId"]
                    .as_str()
                    .unwrap_or("standalone")
                    .to_string(),
                experiment_name: viz["name"]
                    .as_str()
                    .unwrap_or("Unnamed Visualization")
                    .to_string(),
                created_at: viz["createdAt"]
                    .as_str()
                    .unwrap_or(&Utc::now().to_rfc3339())
                    .to_string(),
                data_type: viz["type"].as_str().unwrap_or("Analysis").to_string(),
                cell_count: None,
                gene_count: None,
                status: "READY".to_string(),
                thumbnail_url: None,
            };
            instances.push(instance);
        }
    }

    Ok(instances)
}

/// Delete an insight instance
#[tauri::command]
pub async fn delete_insight_instance(
    id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // Determine if it's a permanent visualization (standard UUID) or a pipeline run reference (insight-xxxx)
    if id.starts_with("insight-") {
        // This is a reference to a pipeline run experiment - we don't delete experiments from the gallery
        // for now, or maybe we do? Let's just return OK or handle if needed.
        return Ok(());
    }

    let api_base = get_api_base_url(&state);
    let url = format!("{}/visualizations/{}", api_base, id);

    let client = reqwest::Client::new();
    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed to delete visualization: {}", resp.status()));
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub name: String,
    pub r#type: String,
    pub path: String,
}

/// Create a new insight instance from experiment results
#[tauri::command]
pub async fn register_visualization(
    name: String,
    r#type: String,
    path: String,
    experiment_id: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/visualizations", api_base);

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "name": name,
        "visualizationType": r#type,
        "dataPath": path,
        "experimentId": experiment_id,
    });

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to register visualization: {}",
            resp.status()
        ));
    }

    Ok(())
}
