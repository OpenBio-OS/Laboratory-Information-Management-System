// Tauri commands for Insight module - file streaming and data loading

use serde::{Deserialize, Serialize};
use std::io::Write;
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
    let client = reqwest::Client::new();

    // 1. Try fetching as a visualization first
    let viz_url = format!("{}/visualizations/{}/files", api_base, experiment_id);
    let mut resp = client
        .get(&viz_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // 2. Fallback to experiment if visualization not found
    if !resp.status().is_success() {
        let exp_url = format!("{}/experiments/{}/files", api_base, experiment_id);
        resp = client
            .get(&exp_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Server returned {}", resp.status()));
        }
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Handle both array (visualizations) and object with "files" key (experiments)
    let files = if let Some(arr) = json.as_array() {
        arr
    } else if let Some(obj) = json.as_object() {
        obj.get("files")
            .and_then(|f| f.as_array())
            .ok_or("No files field in response")?
    } else {
        return Err("Invalid response format".to_string());
    };

    // Find specific assets by assetType OR name/path extension
    let find_path = |type_: &str, ext: &str| -> Option<String> {
        let found = files.iter().find(|f| {
            f["assetType"].as_str() == Some(type_)
                || f["name"]
                    .as_str()
                    .map(|n| n.to_lowercase().ends_with(ext))
                    .unwrap_or(false)
        });

        if let Some(f) = found {
            let path = f["path"].as_str().map(|s| s.to_string());
            println!("Found asset {} at path: {:?}", type_, path);
            path
        } else {
            println!("Asset {} not found (ext: {})", type_, ext);
            None
        }
    };

    let relative_matrix = find_path("MATRIX", ".mtx");
    let relative_coords = find_path("COORDS", "coords.csv");
    let relative_report = find_path("REPORT", ".html");
    let relative_counts = find_path("COUNTS", "counts.tsv");

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

/// Unescape basic HTML entities
fn html_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
}

/// Extract a single data-attribute value from an HTML tag string
fn get_html_attr(tag: &str, attr_name: &str) -> Option<String> {
    let prefix = format!("{}=\"", attr_name);
    if let Some(start) = tag.find(&prefix) {
        let val_start = start + prefix.len();
        if let Some(end_offset) = tag[val_start..].find('"') {
            return Some(html_unescape(&tag[val_start..val_start + end_offset]));
        }
    }
    None
}

/// Parse all <span data-type="mention" ...> tags from HTML content and extract entity data
fn parse_mentions_from_html(
    html: &str,
) -> (
    Vec<serde_json::Value>,
    Vec<serde_json::Value>,
    Vec<serde_json::Value>,
) {
    let mut samples = Vec::new();
    let mut equipment = Vec::new();
    let mut papers = Vec::new();
    let mut search_from = 0;

    while let Some(pos) = html[search_from..].find("data-type=\"mention\"") {
        let abs_pos = search_from + pos;

        // Find the enclosing <span ...> tag
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

        // Parse the path array to build a location string like "Facility > Bedroom > Freezer1"
        let location: Option<String> = path_str.and_then(|p| {
            serde_json::from_str::<Vec<String>>(&p).ok().map(|parts| {
                // Skip the last element which is the sample name itself
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
            "[tauri] HTML mention parsed: type={}, id={}, name={}, notes={:?}, location={:?}",
            entity_type, entity_id, name, notes, location
        );

        match entity_type.as_str() {
            "sample" => {
                samples.push(serde_json::json!({
                    "id": entity_id,
                    "name": name,
                    "type": category.unwrap_or_else(|| "Unknown".to_string()),
                    "metadata": notes,
                    "role": "Mentioned",
                    "location": location,
                }));
            }
            "equipment" => {
                equipment.push(serde_json::json!({
                    "id": entity_id,
                    "name": name,
                    "type": category.unwrap_or_else(|| "Unknown".to_string()),
                }));
            }
            "paper" => {
                papers.push(serde_json::json!({
                    "id": entity_id,
                    "title": name,
                    "notes": notes,
                }));
            }
            _ => {}
        }

        search_from = tag_end;
    }

    (samples, equipment, papers)
}

/// Get metadata for an experiment (used in tooltips)
#[tauri::command]
pub async fn get_experiment_metadata(
    id: String, // Can be experiment_id OR visualization_id
    state: State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let api_base = get_api_base_url(&state);
    let client = reqwest::Client::new();

    // 1. Try fetching as a visualization first
    let viz_url = format!("{}/visualizations/{}", api_base, id);
    let viz_resp = client
        .get(&viz_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if viz_resp.status().is_success() {
        let viz: serde_json::Value = viz_resp.json().await.map_err(|e| e.to_string())?;

        // Map visualization type back to pipeline_type for the frontend container
        let viz_type = viz["type"].as_str().unwrap_or("Analysis");
        let pipeline_type = match viz_type {
            "SCANVAS" => "scRNA-seq",
            "BULK_DASHBOARD" => "Bulk RNA-seq",
            "REPORT" => "Report",
            other => other,
        };

        // Parse metadata snapshot if available
        let snapshot_str = viz.get("metadataSnapshot").and_then(|s| s.as_str());
        let experiment_id_from_viz = viz
            .get("experimentId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        println!("=== [tauri] GET_EXPERIMENT_METADATA DEBUG START ===");
        println!(
            "[tauri] viz ID={}, experimentId={:?}, snapshot_found={}",
            id,
            experiment_id_from_viz,
            snapshot_str.is_some()
        );

        let snapshot: serde_json::Value = snapshot_str
            .and_then(|s| {
                let parsed = serde_json::from_str(s);
                if let Err(e) = &parsed {
                    println!("[tauri] ERROR parsing snapshot JSON: {}", e);
                }
                parsed.ok()
            })
            .unwrap_or(serde_json::json!({}));

        // Try pre-computed arrays from snapshot
        let mut samples = snapshot["samples"].as_array().cloned().unwrap_or_default();
        let mut equipment = snapshot["equipment"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut papers = snapshot["linked_papers"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let description = snapshot["experiment"]["description"].clone();
        let content = snapshot["experiment"]["content"].clone();

        println!(
            "[tauri] Snapshot arrays: samples={}, equipment={}, papers={}",
            samples.len(),
            equipment.len(),
            papers.len()
        );

        // FALLBACK: Parse mentions directly from the HTML content in the snapshot
        // This is where the data actually lives - as data-* attributes on <span> tags
        if samples.is_empty() && equipment.is_empty() && papers.is_empty() {
            if let Some(html) = content.as_str() {
                println!(
                    "[tauri] Parsing mentions from HTML content ({} chars)...",
                    html.len()
                );
                let (s, e, p) = parse_mentions_from_html(html);
                println!(
                    "[tauri] HTML parsing result: samples={}, equipment={}, papers={}",
                    s.len(),
                    e.len(),
                    p.len()
                );
                samples = s;
                equipment = e;
                papers = p;
            } else {
                println!("[tauri] No content string in snapshot to parse");
            }
        }

        // FALLBACK 2: If still empty, fetch experiment live and parse its content
        if samples.is_empty() && equipment.is_empty() && papers.is_empty() {
            if let Some(ref exp_id) = experiment_id_from_viz {
                println!(
                    "[tauri] Still empty, fetching live experiment {} to parse content",
                    exp_id
                );
                let exp_url = format!("{}/experiments/{}", api_base, exp_id);
                if let Ok(exp_resp) = client.get(&exp_url).send().await {
                    if exp_resp.status().is_success() {
                        if let Ok(exp_json) = exp_resp.json::<serde_json::Value>().await {
                            // Try pre-built arrays from experiment API
                            if let Some(exp_samples) = exp_json["samples"].as_array() {
                                if !exp_samples.is_empty() {
                                    for s in exp_samples {
                                        samples.push(s.clone());
                                    }
                                }
                            }
                            if let Some(exp_equip) = exp_json["equipment"].as_array() {
                                for e in exp_equip {
                                    equipment.push(e.clone());
                                }
                            }

                            // If still empty, parse the experiment's own content HTML
                            if samples.is_empty() && equipment.is_empty() {
                                if let Some(exp_content) = exp_json["content"].as_str() {
                                    println!(
                                        "[tauri] Parsing live experiment content ({} chars)...",
                                        exp_content.len()
                                    );
                                    let (s, e, p) = parse_mentions_from_html(exp_content);
                                    samples = s;
                                    equipment = e;
                                    if papers.is_empty() {
                                        papers = p;
                                    }
                                }
                            }

                            println!(
                                "[tauri] After live fetch: samples={}, equipment={}, papers={}",
                                samples.len(),
                                equipment.len(),
                                papers.len()
                            );
                        }
                    }
                }
            }
        }

        println!(
            "[tauri] FINAL: samples={}, equipment={}, papers={}",
            samples.len(),
            equipment.len(),
            papers.len()
        );
        println!("=== [tauri] GET_EXPERIMENT_METADATA DEBUG END ===");

        return Ok(serde_json::json!({
            "experiment_id": viz["experimentId"],
            "name": viz["name"],
            "pipeline_type": pipeline_type,
            "status": "READY",
            "samples": samples,
            "equipment": equipment,
            "linked_papers": papers,
            "description": description,
            "content": content,
        }));
    }

    // 2. Fallback to fetching as an experiment
    let exp_url = format!("{}/experiments/{}", api_base, id);
    let resp = client
        .get(&exp_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to find experiment or visualization with ID {}",
            id
        ));
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

    Ok(serde_json::json!({
        "experiment_id": json["id"],
        "name": json["name"],
        "description": json["description"],
        "content": json["content"],
        "linked_papers": json["linked_papers"], // Matches backend rename
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
    let server_root = api_base.trim_end_matches("/api").to_string();

    // 1. Try analysis-files for experiment first
    let url = format!("{}/experiments/{}/analysis-files", api_base, experiment_id);
    println!("[tauri] get_experiment_assets: trying {}", url);

    let client = reqwest::Client::new();
    let mut resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    // 2. Fallback to visualizations if not found
    if !resp.status().is_success() {
        println!(
            "[tauri] get_experiment_assets: first tier failed ({}), trying fallback",
            resp.status()
        );
        let viz_url = format!("{}/visualizations/{}/files", api_base, experiment_id);
        resp = client
            .get(&viz_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            println!(
                "[tauri] get_experiment_assets: fallback ALSO failed ({})",
                resp.status()
            );
            return Err(format!(
                "Server returned {} for both experiment and visualization",
                resp.status()
            ));
        }
    }

    let status = resp.status();
    let mut files_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // 3. Post-process URLs to be absolute (essential for Tauri-React cross-origin)
    if let Some(files_array) = files_json.as_array_mut() {
        for file in files_array {
            if let Some(url_val) = file.get_mut("url") {
                if let Some(url_str) = url_val.as_str() {
                    if url_str.starts_with("/") {
                        let relative_path = if url_str.starts_with("/api/") {
                            url_str.to_string()
                        } else {
                            format!("/api{}", url_str)
                        };
                        *url_val =
                            serde_json::Value::String(format!("{}{}", server_root, relative_path));
                    }
                }
            }
        }
    }

    let files: Vec<serde_json::Value> = if let Some(arr) = files_json.as_array() {
        arr.clone()
    } else {
        vec![]
    };

    println!(
        "[tauri] get_experiment_assets: success ({}), found {} items",
        status,
        files.len()
    );
    Ok(files)
}

/// Upload a visualization zip file
#[tauri::command]
pub async fn upload_visualization_zip(
    path: String,
    experiment_id: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    use std::path::Path;
    use tokio::fs::File;
    use tokio_util::codec::{BytesCodec, FramedRead};

    let api_base = get_api_base_url(&state);

    // Determine target URL
    let url = if let Some(exp_id) = &experiment_id {
        if exp_id.trim().is_empty() {
            format!("{}/visualizations/upload", api_base)
        } else {
            // Note: Use the standalone endpoint if exp_id is invalid or if the backend route logic differs
            // But we implemented /{id}/visualizations/upload on backend
            format!("{}/experiments/{}/visualizations/upload", api_base, exp_id)
        }
    } else {
        format!("{}/visualizations/upload", api_base)
    };

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let file = File::open(file_path).await.map_err(|e| e.to_string())?;
    let stream = FramedRead::new(file, BytesCodec::new());
    let file_body = reqwest::Body::wrap_stream(stream);

    let filename = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let part = reqwest::multipart::Part::stream(file_body)
        .file_name(filename)
        .mime_str("application/zip")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Upload failed: {} - {}", status, text));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

/// Helper to zip a directory recursively
fn zip_dir<W: std::io::Write + std::io::Seek>(
    it: &mut walkdir::IntoIter,
    prefix: &std::path::Path,
    writer: &mut zip::ZipWriter<W>,
) -> Result<(), String> {
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut buffer = Vec::new();
    for entry in it {
        let entry = entry.map_err(|e: walkdir::Error| e.to_string())?;
        let path = entry.path();
        let name = path
            .strip_prefix(prefix)
            .map_err(|e: std::path::StripPrefixError| e.to_string())?;

        if path.is_file() {
            #[allow(deprecated)]
            writer
                .start_file_from_path(name, options)
                .map_err(|e| e.to_string())?;
            let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
            use std::io::Read;
            f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            writer.write_all(&buffer).map_err(|e| e.to_string())?;
            buffer.clear();
        } else if !name.as_os_str().is_empty() {
            #[allow(deprecated)]
            writer
                .add_directory_from_path(name, options)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Upload a visualization folder (zips it locally first)
#[tauri::command]
pub async fn upload_visualization_folder(
    path: String,
    experiment_id: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    use std::fs::File;
    use std::path::Path;

    let src_dir = Path::new(&path);
    if !src_dir.exists() || !src_dir.is_dir() {
        return Err(format!("Folder not found or not a directory: {}", path));
    }

    // Create a temporary zip file
    let temp_dir = std::env::temp_dir();
    let zip_filename = format!("upload_{}.zip", uuid::Uuid::new_v4());
    let zip_path = temp_dir.join(zip_filename);

    let file = File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);

    let mut walk = walkdir::WalkDir::new(src_dir).into_iter();
    zip_dir(&mut walk, src_dir, &mut zip)?;
    zip.finish().map_err(|e| e.to_string())?;

    // Use the existing zip upload logic
    let result =
        upload_visualization_zip(zip_path.to_string_lossy().to_string(), experiment_id, state)
            .await;

    // Cleanup temp file
    let _ = std::fs::remove_file(zip_path);

    result
}
