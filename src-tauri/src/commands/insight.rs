// Tauri commands for Insight module - file streaming and data loading

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct Experiment {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentFiles {
    pub matrix_path: Option<String>,
    pub coords_path: Option<String>,
    pub report_path: Option<String>,
    pub counts_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileChunk {
    chunk: Vec<u8>,
    complete: bool,
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

/// Get file paths for an experiment's analysis outputs
#[tauri::command]
pub async fn get_experiment_files(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<ExperimentFiles, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments/{}/files", api_base, experiment_id);

    // Fetch files from API
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let files = json
        .get("files")
        .and_then(|f| f.as_array())
        .ok_or("No files field in response")?;

    // Find specific assets by assetType
    let find_path = |type_: &str| -> Option<String> {
        files
            .iter()
            .find(|f| f["assetType"].as_str() == Some(type_))
            .and_then(|f| f["path"].as_str())
            .map(|s| s.to_string())
    };

    let relative_matrix = find_path("MATRIX");
    let relative_coords = find_path("COORDS"); // Assumes we might add this later
    let relative_report = find_path("REPORT");
    let relative_counts = find_path("COUNTS");

    // Construct detailed paths
    // If local, prepend app_data_dir to get absolute path for reading
    let config = state.config.lock().unwrap();
    let is_local =
        config.mode == crate::DeploymentMode::Local || config.mode == crate::DeploymentMode::Hub;

    let resolve_path = |rel: Option<String>| -> Option<String> {
        if let Some(r) = rel {
            if is_local {
                // Prepend app data dir
                let data_dir = dirs::data_dir()
                    .unwrap_or(PathBuf::from("."))
                    .join("software.is-a.openbio");
                let abs = data_dir.join(r);
                Some(abs.to_string_lossy().to_string())
            } else {
                // If remote, maybe return full URL?
                // For now, assume consistent pathing or handle via presigned URL logic elsewhere
                Some(r)
            }
        } else {
            None
        }
    };

    Ok(ExperimentFiles {
        matrix_path: resolve_path(relative_matrix),
        coords_path: resolve_path(relative_coords),
        report_path: resolve_path(relative_report),
        counts_path: resolve_path(relative_counts),
    })
}

/// Get the URL for an experiment's report asset
#[tauri::command]
pub async fn get_experiment_report_url(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments/{}/files", api_base, experiment_id);

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let files = json
        .get("files")
        .and_then(|f| f.as_array())
        .ok_or("No files field in response")?;

    let report_asset = files
        .iter()
        .find(|f| f["assetType"].as_str() == Some("REPORT"))
        .ok_or("No report asset found")?;

    let asset_id = report_asset["id"].as_str().ok_or("Asset has no ID")?;

    Ok(format!("{}/files/{}/view", api_base, asset_id))
}

/// Stream a file in chunks using memory mapping
/// This avoids loading the entire 50GB file into RAM
#[tauri::command]
pub async fn stream_file_chunk(
    path: String,
    offset: usize,
    chunk_size: usize,
) -> Result<FileChunk, String> {
    use memmap2::Mmap;
    use std::fs::File;

    // Open file with memory mapping
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };

    // Check if we've reached the end
    if offset >= mmap.len() {
        return Ok(FileChunk {
            chunk: Vec::new(),
            complete: true,
        });
    }

    // Calculate actual chunk size (may be smaller at end of file)
    let end = (offset + chunk_size).min(mmap.len());
    let chunk = mmap[offset..end].to_vec();
    let complete = end >= mmap.len();

    Ok(FileChunk { chunk, complete })
}

/// Load coordinates file (CSV with x,y columns)
#[tauri::command]
pub async fn load_coordinates(path: String) -> Result<Vec<f32>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let file = File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut coords = Vec::new();

    for line in reader.lines().skip(1) {
        // Skip header
        let line = line.map_err(|e| e.to_string())?;
        let parts: Vec<&str> = line.split(',').collect();

        if parts.len() >= 2 {
            let x: f32 = parts[0]
                .parse()
                .map_err(|e| format!("Parse error: {}", e))?;
            let y: f32 = parts[1]
                .parse()
                .map_err(|e| format!("Parse error: {}", e))?;
            coords.push(x);
            coords.push(y);
        }
    }

    Ok(coords)
}

/// Get metadata for an experiment (used in tooltips)
#[tauri::command]
pub async fn get_experiment_metadata(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments/{}", api_base, experiment_id); // This calls existing get_experiment which I updated to include pipelineRuns

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Extract pipeline type from first run
    let pipeline_type = json
        .get("pipelineRuns")
        .and_then(|r| r.as_array())
        .and_then(|arr| arr.first())
        .and_then(|run| run.get("pipelineType"))
        .and_then(|t| t.as_str())
        .unwrap_or("unknown")
        .to_string();

    // Construct metadata
    Ok(serde_json::json!({
        "experiment_id": json["id"],
        "name": json["name"],
        "pipeline_type": pipeline_type,
        "status": json["status"],
        "samples": json["samples"],
        "equipment": json["equipment"],
    }))
}

/// List all experiments from the server
#[tauri::command]
pub async fn list_experiments(
    state: State<'_, crate::AppState>,
) -> Result<Vec<Experiment>, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments", api_base);

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let experiments: Vec<Experiment> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(experiments)
}

/// Get all assets for an experiment (raw list)
#[tauri::command]
pub async fn get_experiment_assets(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let api_base = get_api_base_url(&state);
    let url = format!("{}/experiments/{}/files", api_base, experiment_id);

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let files = json
        .get("files")
        .and_then(|f| f.as_array())
        .ok_or("No files field in response")?
        .clone();

    Ok(files)
}
