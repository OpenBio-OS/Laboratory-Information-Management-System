//! API route handlers
use crate::db::prisma::{
    self, container, digital_asset, equipment, equipment_location, experiment, experiment_entry,
    experiment_folder, experiment_mention, library, paper, sample,
};
use crate::AppState;
use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
/// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

/// Health check endpoint
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// API routes
pub fn api_routes() -> Router<AppState> {
    Router::new()
        // Inventory (Module A) routes
        .nest("/inventory", inventory_routes())
        // Experiments routes (experiments ARE the notebooks)
        .nest("/experiments", experiment_routes())
        // Collections routes (for organizing papers)
        .nest("/collections", collection_routes())
        // Library routes (papers)
        .nest("/library", library_routes())
        // Equipment routes
        .nest("/equipment", equipment_routes())
        // Pipeline routes
        .nest("/pipelines", pipeline_routes())
        // Visualization routes
        .nest("/visualizations", visualization_routes())
        // File serving route
        .route("/files/{id}/view", get(serve_file))
        // Directory Asset Routes
        .route("/assets/{id}/files", get(list_directory_asset_files))
        .route(
            "/assets/{id}/files/{*path}",
            get(serve_directory_asset_file),
        )
}

fn pipeline_routes() -> Router<AppState> {
    Router::new()
        .route("/run", post(start_pipeline_run))
        .route("/runs", get(list_pipeline_runs))
        .route("/runs/{id}", get(get_pipeline_run_status))
        .route("/runs/{id}/status", patch(update_pipeline_status))
        .route("/runs/{id}", delete(delete_pipeline_run))
        .route("/runs/{id}/cancel", post(cancel_pipeline_run))
        .route(
            "/runs/{id}/assets",
            post(upload_pipeline_asset).get(list_pipeline_assets),
        )
        // New endpoint for zipped output ingestion
        .route("/runs/{id}/output", post(ingest_pipeline_output))
}

fn visualization_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_visualizations).post(register_visualization))
        .route("/{id}", get(get_visualization).delete(delete_visualization))
        .route(
            "/upload",
            axum::routing::post(upload_standalone_visualization),
        )
        .route("/{id}/files", get(get_visualization_files))
}

// Pipeline Handlers

async fn start_pipeline_run(
    State(state): State<AppState>,
    Json(request): Json<crate::pipeline::PipelineRequest>,
) -> impl IntoResponse {
    match state.pipeline_manager.start_pipeline(request).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn list_pipeline_runs(State(state): State<AppState>) -> impl IntoResponse {
    match state.pipeline_manager.list_runs().await {
        Ok(runs) => (StatusCode::OK, Json(runs)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_pipeline_run_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.pipeline_manager.get_status(&id).await {
        Ok(status) => (StatusCode::OK, Json(status)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct StatusUpdateRequest {
    status: String,
    error_message: Option<String>,
}

async fn update_pipeline_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<StatusUpdateRequest>,
) -> impl IntoResponse {
    match state
        .pipeline_manager
        .update_run_status(&id, &payload.status, payload.error_message)
        .await
    {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn cancel_pipeline_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.pipeline_manager.cancel_pipeline(&id).await {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_pipeline_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state
        .pipeline_manager
        .delete_run(&id, &state.storage_path)
        .await
    {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub struct PipelineAssetResponse {
    pub asset_id: String,
    pub filename: String,
}

// Visualization management
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterVisualizationRequest {
    pub name: String,
    pub visualization_type: String,
    pub experiment_id: Option<String>,
    pub config_json: Option<String>,
    pub data_path: Option<String>,
}

async fn register_visualization(
    State(state): State<AppState>,
    Json(payload): Json<RegisterVisualizationRequest>,
) -> Result<Json<crate::db::prisma::visualization::Data>, (StatusCode, String)> {
    let mut params = vec![];

    if let Some(config) = payload.config_json.as_ref() {
        params.push(crate::db::prisma::visualization::config_json::set(Some(
            config.clone(),
        )));
    }

    if let Some(exp_id) = payload.experiment_id.as_ref() {
        params.push(crate::db::prisma::visualization::experiment::connect(
            crate::db::prisma::experiment::id::equals(exp_id.clone()),
        ));
    }

    // Create visualization with metadata snapshot
    let snapshot_data = if let Some(exp_id) = payload.experiment_id.as_ref() {
        crate::pipeline::capture_experiment_snapshot(&state.db, exp_id).await
    } else {
        None
    };

    if let Some(snapshot) = snapshot_data {
        params.push(crate::db::prisma::visualization::metadata_snapshot::set(
            Some(snapshot),
        ));
    }

    let visualization = state
        .db
        .visualization()
        .create(
            payload.name.clone(),
            payload.visualization_type.clone(),
            params,
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // If data_path provided, register all files as DigitalAssets and link
    if let Some(path_str) = payload.data_path.as_ref() {
        let path = std::path::Path::new(&path_str);
        if path.exists() {
            let mut files_to_process = vec![];

            if path.is_dir() {
                // Recursively find all files
                get_files_recursive(path, &mut files_to_process);
            } else {
                files_to_process.push(path.to_path_buf());
            }

            for file_path in files_to_process {
                let rel_path = if path.is_dir() {
                    file_path
                        .strip_prefix(path)
                        .unwrap_or(&file_path)
                        .to_path_buf()
                } else {
                    file_path
                        .file_name()
                        .map(std::path::PathBuf::from)
                        .unwrap_or(file_path.clone())
                };

                let filename = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unnamed_data")
                    .to_string();

                // Create storage key and copy to storage
                let storage_key =
                    format!("visualizations/{}/{}", visualization.id, rel_path.display());
                let target_path = state.storage_path.join(&storage_key);

                if let Some(parent) = target_path.parent() {
                    let _ = fs::create_dir_all(parent).await;
                }

                if let Err(e) = fs::copy(&file_path, &target_path).await {
                    tracing::error!("Failed to copy file {}: {}", file_path.display(), e);
                    continue;
                }

                let file_size = fs::metadata(&target_path)
                    .await
                    .map(|m| m.len() as i32)
                    .unwrap_or(0);

                // Create and link DigitalAsset
                let mut asset_params = vec![
                    crate::db::prisma::digital_asset::visualization::connect(
                        crate::db::prisma::visualization::id::equals(visualization.id.clone()),
                    ),
                    crate::db::prisma::digital_asset::size_bytes::set(Some(file_size)),
                    crate::db::prisma::digital_asset::asset_type::set("DATA".to_string()),
                ];

                // Also link to experiment if provided
                if let Some(exp_id) = payload.experiment_id.as_ref() {
                    asset_params.push(crate::db::prisma::digital_asset::experiment::connect(
                        crate::db::prisma::experiment::id::equals(exp_id.clone()),
                    ));
                }

                let _ = state
                    .db
                    .digital_asset()
                    .create(filename, storage_key, asset_params)
                    .exec()
                    .await;
            }
        }
    }

    Ok(Json(visualization))
}

fn get_files_recursive(dir: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                get_files_recursive(&path, files);
            } else {
                files.push(path);
            }
        }
    }
}
async fn list_visualizations(
    State(state): State<AppState>,
) -> Json<Vec<crate::db::prisma::visualization::Data>> {
    let viz = state
        .db
        .visualization()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
    Json(viz)
}

async fn get_visualization(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::db::prisma::visualization::Data>, (StatusCode, String)> {
    let viz = state
        .db
        .visualization()
        .find_unique(crate::db::prisma::visualization::id::equals(id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Visualization not found".to_string()))?;

    Ok(Json(viz))
}

async fn delete_visualization(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // 1. Find the visualization and its assets
    let viz = match state
        .db
        .visualization()
        .find_unique(crate::db::prisma::visualization::id::equals(id.clone()))
        .with(crate::db::prisma::visualization::assets::fetch(vec![]))
        .exec()
        .await
    {
        Ok(Some(v)) => v,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    // 2. Process assets with Smart Deletion logic
    if let Ok(assets) = viz.assets() {
        for asset in assets {
            // Simplified Smart Deletion:
            // 1. Detach from this visualization (Prisma delete will handle this if we delete the visualization)
            // 2. Check if the asset record itself still has other parents

            let asset_record = state
                .db
                .digital_asset()
                .find_unique(crate::db::prisma::digital_asset::id::equals(
                    asset.id.clone(),
                ))
                .exec()
                .await;

            if let Ok(Some(a)) = asset_record {
                let has_experiment = a.experiment_id.is_some();
                let has_pipeline = a.pipeline_run_id.is_some();

                // Count other visualizations for this asset
                let other_viz_count = state
                    .db
                    .visualization()
                    .count(vec![
                        crate::db::prisma::visualization::assets::some(vec![
                            crate::db::prisma::digital_asset::id::equals(a.id.clone()),
                        ]),
                        crate::db::prisma::visualization::id::not(id.clone()),
                    ])
                    .exec()
                    .await
                    .unwrap_or(0);

                if !has_experiment && !has_pipeline && other_viz_count == 0 {
                    // Truly orphaned - delete file and record
                    let path = state.storage_path.join(&a.storage_key);
                    if path.exists() {
                        let _ = fs::remove_file(path).await;
                    }
                    let _ = state
                        .db
                        .digital_asset()
                        .delete(crate::db::prisma::digital_asset::id::equals(a.id))
                        .exec()
                        .await;
                }
            }
        }
    }

    // 3. Delete visualization record
    match state
        .db
        .visualization()
        .delete(crate::db::prisma::visualization::id::equals(id))
        .exec()
        .await
    {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// Upload pipeline asset (e.g. multiqc_report.html)
async fn upload_pipeline_asset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // 1. Verify pipeline run exists
    let run = state
        .db
        .pipeline_run()
        .find_unique(crate::db::prisma::pipeline_run::id::equals(id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Pipeline run not found".to_string()))?;

    // 2. Process multipart - robustly handle field order
    let mut asset_type = "REPORT".to_string(); // Default
    let mut file_processed = false;
    let mut saved_filename = String::new();
    let mut saved_size = 0;
    let mut saved_content_type = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();

        if name == "asset_type" {
            if let Ok(val) = field.text().await {
                asset_type = val;
            }
        } else if name == "file" {
            let filename = field.file_name().unwrap_or("unknown").to_string();
            let content_type = field.content_type().map(|s| s.to_string());

            // Stream to disk immediately
            let run_dir = state.storage_path.join("pipelines").join(&id);
            tokio::fs::create_dir_all(&run_dir).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create storage dir: {}", e),
                )
            })?;

            let target_path = run_dir.join(&filename);
            let mut file = tokio::fs::File::create(&target_path).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create file: {}", e),
                )
            })?;

            // Read bytes (for now load into memory, ideally stream if very large but Axum Multipart isn't easily streamable to File without buffer)
            // Actually field.bytes() reads full into memory. For large files we should use streaming,
            // but for now this is fine for typical 50-100MB files.
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            saved_size = data.len() as i32;
            saved_content_type = content_type;
            saved_filename = filename;

            file.write_all(&data).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write file: {}", e),
                )
            })?;

            file_processed = true;
        }
    }

    if file_processed {
        // 3. Create DigitalAsset
        let storage_key = format!("pipelines/{}/{}", id, saved_filename);

        let mut params = vec![
            digital_asset::pipeline_run::connect(crate::db::prisma::pipeline_run::id::equals(
                id.clone(),
            )),
            digital_asset::size_bytes::set(Some(saved_size)),
            digital_asset::mime_type::set(saved_content_type),
            digital_asset::asset_type::set(asset_type.clone()),
        ];

        // Link to parent experiment
        params.push(digital_asset::experiment::connect(
            crate::db::prisma::experiment::id::equals(run.experiment_id.clone()),
        ));

        let asset = state
            .db
            .digital_asset()
            .create(saved_filename.clone(), storage_key, params)
            .exec()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        return Ok(Json(serde_json::json!({
            "status": "ok",
            "asset_id": asset.id,
            "filename": saved_filename,
            "asset_type": asset_type
        })));
    }

    Err((StatusCode::BAD_REQUEST, "No file field found".to_string()))
}

// List assets for a pipeline run
async fn list_pipeline_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    // 1. Verify pipeline run exists
    let _run = state
        .db
        .pipeline_run()
        .find_unique(crate::db::prisma::pipeline_run::id::equals(id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Pipeline run not found".to_string()))?;

    // 2. Fetch assets linked to this run
    let assets = state
        .db
        .digital_asset()
        .find_many(vec![
            crate::db::prisma::digital_asset::pipeline_run_id::equals(Some(id)),
        ])
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 3. Convert to JSON
    let json_assets: Vec<serde_json::Value> = assets
        .into_iter()
        .map(|a| {
            serde_json::json!({
                "id": a.id,
                "name": a.filename,
                "path": a.storage_key,
                "asset_type": a.asset_type,
                "created_at": a.created_at.to_string(),
                "size_bytes": a.size_bytes
            })
        })
        .collect();

    Ok(Json(json_assets))
}

fn inventory_routes() -> Router<AppState> {
    Router::new()
        .route("/samples", get(list_samples).post(create_sample))
        .route(
            "/samples/{id}",
            axum::routing::delete(delete_sample).patch(update_sample),
        )
        .route("/containers", get(list_containers).post(create_container))
        .route("/containers/{id}", axum::routing::delete(delete_container))
}

fn experiment_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_experiments).post(create_experiment))
        .route(
            "/{id}",
            get(get_experiment)
                .patch(update_experiment)
                .delete(delete_experiment),
        )
        .route(
            "/{id}/entries",
            get(list_experiment_entries).post(create_experiment_entry),
        )
        .route(
            "/{id}/mentions",
            get(list_experiment_mentions).post(create_experiment_mention),
        )
        .route("/{id}/upload", axum::routing::post(upload_experiment_file))
        .route("/{id}/files", get(list_experiment_files))
        .route("/{id}/analysis-files", get(get_analysis_files))
        .route(
            "/{id}/visualizations/upload",
            axum::routing::post(upload_visualization_output),
        )
        .route(
            "/{id}/files/{asset_id}",
            axum::routing::delete(delete_experiment_file),
        )
        .route("/search-entities", get(search_entities))
        .route(
            "/folders",
            get(list_experiment_folders).post(create_experiment_folder),
        )
        .route(
            "/folders/{id}",
            axum::routing::delete(delete_experiment_folder),
        )
}

fn collection_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_collections).post(create_collection))
        .route(
            "/{id}",
            get(get_collection)
                .patch(update_collection)
                .delete(delete_collection),
        )
}

fn library_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_papers).post(create_paper))
        .route("/lookup-doi", get(lookup_doi))
        .route(
            "/{id}",
            get(get_paper).patch(update_paper).delete(delete_paper),
        )
        .route("/{id}/pdf", get(get_paper_pdf).post(upload_paper_pdf))
}

fn equipment_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_equipment).post(create_equipment))
        .route(
            "/{id}",
            get(get_equipment)
                .patch(update_equipment)
                .delete(delete_equipment),
        )
        .route("/{id}/lock", axum::routing::post(lock_equipment))
        .route("/{id}/unlock", axum::routing::post(unlock_equipment))
        .route("/{id}/ingest", axum::routing::post(ingest_equipment_file))
        .route(
            "/locations",
            get(list_equipment_locations).post(create_equipment_location),
        )
        .route(
            "/locations/{id}",
            axum::routing::delete(delete_equipment_location),
        )
}

// ==========================================
// Inventory Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreateSampleRequest {
    pub name: String,
    pub type_: String, // "type" is reserved in Rust
    pub metadata: Option<String>,
    pub external_id: Option<String>,
    pub container_id: Option<String>,
    pub slot_position: Option<String>,
}

async fn list_samples(State(state): State<AppState>) -> Json<Vec<sample::Data>> {
    let samples = state
        .db
        .sample()
        .find_many(vec![] as Vec<sample::WhereParam>)
        .exec()
        .await
        .unwrap_or_default();
    Json(samples)
}

async fn create_sample(
    State(state): State<AppState>,
    Json(payload): Json<CreateSampleRequest>,
) -> Json<sample::Data> {
    let mut params: Vec<sample::SetParam> = vec![];

    if let Some(metadata) = payload.metadata {
        params.push(sample::metadata::set(Some(metadata)));
    }

    if let Some(eid) = payload.external_id {
        params.push(sample::external_id::set(Some(eid)));
    }

    if let Some(cid) = payload.container_id {
        params.push(sample::container::connect(container::id::equals(cid)));
    }

    if let Some(slot) = payload.slot_position {
        params.push(sample::slot_position::set(Some(slot)));
    }

    let sample = state
        .db
        .sample()
        .create(payload.name, payload.type_, params)
        .exec()
        .await
        .expect("Failed to create sample");
    Json(sample)
}

#[derive(Deserialize)]
pub struct UpdateSampleRequest {
    pub name: Option<String>,
    pub metadata: Option<String>,
}

async fn update_sample(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateSampleRequest>,
) -> Json<sample::Data> {
    let mut params: Vec<sample::SetParam> = vec![];

    if let Some(name) = payload.name {
        params.push(sample::name::set(name));
    }

    if let Some(metadata) = payload.metadata {
        params.push(sample::metadata::set(Some(metadata)));
    }

    let sample = state
        .db
        .sample()
        .update(sample::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update sample");
    Json(sample)
}

async fn delete_sample(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    state
        .db
        .sample()
        .delete(sample::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete sample");
    Json(())
}

#[derive(Deserialize)]
pub struct CreateContainerRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub external_id: Option<String>,
    pub parent_id: Option<String>,
    pub layout_config: Option<serde_json::Value>,
}

async fn list_containers(State(state): State<AppState>) -> Json<Vec<container::Data>> {
    let containers = state
        .db
        .container()
        .find_many(vec![] as Vec<container::WhereParam>)
        .with(container::children::fetch(vec![])) // Fetch immediate children
        .exec()
        .await
        .unwrap_or_default();
    Json(containers)
}

async fn create_container(
    State(state): State<AppState>,
    Json(payload): Json<CreateContainerRequest>,
) -> Json<container::Data> {
    let mut params: Vec<container::SetParam> = vec![];

    if let Some(eid) = payload.external_id {
        params.push(container::external_id::set(Some(eid)));
    }

    if let Some(pid) = payload.parent_id {
        params.push(container::parent::connect(container::id::equals(pid)));
    }

    if let Some(layout) = payload.layout_config {
        params.push(container::layout_config::set(Some(layout.to_string())));
    }

    let container = state
        .db
        .container()
        .create(payload.name, payload.type_, params)
        .exec()
        .await
        .expect("Failed to create container");
    Json(container)
}

async fn delete_container(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    // Recursively delete all children and samples before deleting the container
    delete_container_cascade(&state, &id).await;
    Json(())
}

/// Recursively delete a container and all its children
fn delete_container_cascade<'a>(
    state: &'a AppState,
    container_id: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        // Find all child containers
        let children = state
            .db
            .container()
            .find_many(vec![container::parent_id::equals(Some(
                container_id.to_string(),
            ))])
            .exec()
            .await
            .expect("Failed to find child containers");

        // Recursively delete each child
        for child in children {
            delete_container_cascade(state, &child.id).await;
        }

        // Delete all samples in this container
        state
            .db
            .sample()
            .delete_many(vec![sample::container_id::equals(Some(
                container_id.to_string(),
            ))])
            .exec()
            .await
            .expect("Failed to delete samples in container");

        // Finally, delete the container itself
        state
            .db
            .container()
            .delete(container::id::equals(container_id.to_string()))
            .exec()
            .await
            .expect("Failed to delete container");
    })
}

// ==========================================
// Experiment Handlers (Experiments ARE notebooks)
// ==========================================

#[derive(Deserialize)]
pub struct CreateExperimentRequest {
    pub name: String,
    pub description: Option<String>,
    pub content: Option<String>,
    pub status: Option<String>,
    pub folder_id: Option<String>,
}

async fn list_experiments(State(state): State<AppState>) -> Json<Vec<experiment::Data>> {
    let start = std::time::Instant::now();
    let experiments = state
        .db
        .experiment()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_else(|e| {
            println!("Error listing experiments: {}", e);
            vec![]
        });
    println!(
        "[server] list_experiments: {} items in {:?}",
        experiments.len(),
        start.elapsed()
    );
    Json(experiments)
}

async fn create_experiment(
    State(state): State<AppState>,
    Json(payload): Json<CreateExperimentRequest>,
) -> Json<experiment::Data> {
    let mut params: Vec<experiment::SetParam> = vec![];

    if let Some(description) = payload.description {
        params.push(experiment::description::set(Some(description)));
    }

    if let Some(content) = payload.content {
        params.push(experiment::content::set(content));
    }

    if let Some(status) = payload.status {
        params.push(experiment::status::set(status));
    }

    if let Some(folder_id) = payload.folder_id {
        params.push(experiment::folder::connect(experiment_folder::id::equals(
            folder_id,
        )));
    }

    let experiment = state
        .db
        .experiment()
        .create(payload.name, params)
        .exec()
        .await
        .expect("Failed to create experiment");
    Json(experiment)
}

async fn get_experiment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let start = std::time::Instant::now();
    let experiment = state
        .db
        .experiment()
        .find_unique(experiment::id::equals(id.clone()))
        .with(experiment::samples::fetch(vec![]))
        .with(experiment::assets::fetch(vec![]))
        .with(experiment::pipeline_runs::fetch(vec![]))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Experiment not found".to_string()))?;

    // Convert to JSON Value to extend it
    let mut json = serde_json::to_value(&experiment)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch linked papers via mentions
    let mentions = state
        .db
        .experiment_mention()
        .find_many(vec![
            experiment_mention::experiment_id::equals(id.clone()),
            experiment_mention::entity_type::equals("paper".to_string()),
        ])
        .exec()
        .await
        .unwrap_or(vec![]);

    let paper_ids: Vec<String> = mentions.into_iter().map(|m| m.entity_id).collect();

    if !paper_ids.is_empty() {
        let papers = state
            .db
            .paper()
            .find_many(vec![paper::id::in_vec(paper_ids)])
            .exec()
            .await
            .unwrap_or(vec![]);

        if let Some(obj) = json.as_object_mut() {
            obj.insert(
                "linkedPapers".to_string(),
                serde_json::to_value(papers).unwrap_or(serde_json::json!([])),
            );
        }
    } else {
        if let Some(obj) = json.as_object_mut() {
            obj.insert("linkedPapers".to_string(), serde_json::json!([]));
        }
    }

    println!(
        "[server] get_experiment ({}): assets={}, in {:?}",
        id,
        experiment.assets.as_ref().map(|a| a.len()).unwrap_or(0),
        start.elapsed()
    );
    Ok(Json(json))
}

#[derive(Deserialize)]
pub struct UpdateExperimentRequest {
    pub name: Option<String>,
    pub content: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
}

async fn update_experiment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateExperimentRequest>,
) -> Json<experiment::Data> {
    let mut params: Vec<experiment::SetParam> = vec![];

    if let Some(name) = payload.name {
        params.push(experiment::name::set(name));
    }

    if let Some(content) = payload.content {
        params.push(experiment::content::set(content));
    }

    if let Some(description) = payload.description {
        params.push(experiment::description::set(Some(description)));
    }

    if let Some(status) = payload.status {
        params.push(experiment::status::set(status));
    }

    let experiment = state
        .db
        .experiment()
        .update(experiment::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update experiment");
    Json(experiment)
}

async fn delete_experiment(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    state
        .db
        .experiment()
        .delete(experiment::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete experiment");
    Json(())
}

#[derive(Serialize)]
pub struct ExperimentFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub url: String,
    pub visualization_id: Option<String>,
}

// Recursive function to find relevant analysis files
fn find_analysis_files(
    dir_path: &std::path::Path,
    base_url: &str,
    relative_root: &str,
) -> Vec<ExperimentFile> {
    let mut results = Vec::new();
    let relevant_extensions = vec!["mtx", "tsv", "csv", "rds", "h5ad", "json"];

    if let Ok(entries) = std::fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                let new_relative = if relative_root.is_empty() {
                    file_name.clone()
                } else {
                    format!("{}/{}", relative_root, file_name)
                };
                results.extend(find_analysis_files(&path, base_url, &new_relative));
            } else {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if relevant_extensions.contains(&ext.to_lowercase().as_str()) {
                        let relative_path = if relative_root.is_empty() {
                            file_name.clone()
                        } else {
                            format!("{}/{}", relative_root, file_name)
                        };

                        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        let mime = mime_guess::from_path(&path)
                            .first_or_octet_stream()
                            .to_string();

                        // Construct URL: /assets/{asset_id}/files/{relative_path}
                        let url = format!("{}/{}", base_url, relative_path);

                        results.push(ExperimentFile {
                            path: relative_path,
                            name: file_name,
                            size,
                            mime_type: mime,
                            url,
                            visualization_id: None, // Populated by caller
                        });
                    }
                }
            }
        }
    }
    results
}

async fn get_analysis_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Vec<ExperimentFile>> {
    // 1. Fetch assets directly linked to experiment
    let mut assets = state
        .db
        .digital_asset()
        .find_many(vec![digital_asset::experiment_id::equals(Some(id.clone()))])
        .exec()
        .await
        .unwrap_or(vec![]);

    // 2. Fetch assets linked via VISUALIZATIONS (User confirmation: this is where analysis files live)
    // Find assets where the associated visualization is linked to this experiment
    let viz_assets = state
        .db
        .digital_asset()
        .find_many(vec![digital_asset::visualization::is(vec![
            crate::db::prisma::visualization::experiment_id::equals(Some(id.clone())),
        ])])
        .exec()
        .await
        .unwrap_or_default();

    assets.extend(viz_assets);

    // Deduplicate by ID
    assets.sort_by(|a, b| a.id.cmp(&b.id));
    assets.dedup_by(|a, b| a.id == b.id);

    let mut files = Vec::new();

    for asset in assets {
        // Look for Directory Assets (common for pipeline outputs)
        let is_dir = asset.mime_type.as_deref() == Some("application/x-directory")
            || asset.filename.ends_with("_output");

        if is_dir {
            let storage_path = if std::path::Path::new(&asset.storage_key).is_absolute() {
                std::path::PathBuf::from(&asset.storage_key)
            } else {
                state.storage_path.join(&asset.storage_key)
            };

            let base_url = format!("/assets/{}/files", asset.id);

            if storage_path.exists() {
                let mut found_files = find_analysis_files(&storage_path, &base_url, "");

                // Populate visualization_id if available
                let viz_id = asset.visualization_id.clone().or_else(|| {
                    asset
                        .visualization
                        .as_ref()
                        .and_then(|v| v.as_ref())
                        .map(|v| v.id.clone())
                });
                if let Some(id) = viz_id {
                    for file in &mut found_files {
                        file.visualization_id = Some(id.clone());
                    }
                }

                files.extend(found_files);
            }
        }
    }

    files.sort_by(|a, b| a.name.cmp(&b.name));

    Json(files)
}

// Experiment Entries
#[derive(Deserialize)]
pub struct CreateExperimentEntryRequest {
    pub content: String,
    pub author: Option<String>,
    pub attached_asset_id: Option<String>,
}

async fn list_experiment_entries(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
) -> Json<Vec<experiment_entry::Data>> {
    let entries = state
        .db
        .experiment_entry()
        .find_many(vec![experiment_entry::experiment_id::equals(experiment_id)])
        .exec()
        .await
        .unwrap_or_default();
    Json(entries)
}

async fn create_experiment_entry(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
    Json(payload): Json<CreateExperimentEntryRequest>,
) -> Json<experiment_entry::Data> {
    let mut params: Vec<experiment_entry::SetParam> = vec![];

    if let Some(author) = payload.author {
        params.push(experiment_entry::author::set(Some(author)));
    }

    if let Some(asset_id) = payload.attached_asset_id {
        params.push(experiment_entry::attached_asset_id::set(Some(asset_id)));
    }

    let entry = state
        .db
        .experiment_entry()
        .create(
            experiment::id::equals(experiment_id),
            payload.content,
            params,
        )
        .exec()
        .await
        .expect("Failed to create experiment entry");
    Json(entry)
}

// Experiment Mentions
#[derive(Deserialize)]
pub struct CreateExperimentMentionRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub snapshot_data: String,
    pub position: Option<i32>,
}

async fn list_experiment_mentions(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
) -> Json<Vec<experiment_mention::Data>> {
    let mentions = state
        .db
        .experiment_mention()
        .find_many(vec![experiment_mention::experiment_id::equals(
            experiment_id,
        )])
        .exec()
        .await
        .unwrap_or_default();
    Json(mentions)
}

async fn create_experiment_mention(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
    Json(payload): Json<CreateExperimentMentionRequest>,
) -> Json<experiment_mention::Data> {
    let mut params: Vec<experiment_mention::SetParam> = vec![];

    if let Some(position) = payload.position {
        params.push(experiment_mention::position::set(Some(position)));
    }

    let mention = state
        .db
        .experiment_mention()
        .create(
            experiment::id::equals(experiment_id),
            payload.entity_type,
            payload.entity_id,
            payload.snapshot_data,
            params,
        )
        .exec()
        .await
        .expect("Failed to create experiment mention");
    Json(mention)
}

// Search entities for @mentions
#[derive(Serialize)]
pub struct SearchResult {
    pub entity_type: String,
    pub id: String,
    pub name: String,
    pub category: String, // Top-level category: "Freezer", "Library", "Equipment"
    pub subcategory: String, // Second level: container name, library name, equipment type
    pub path: Vec<String>, // Full path for navigation
    pub notes: Option<String>, // Sample metadata/notes or paper notes at time of mention
}

async fn search_entities(State(state): State<AppState>) -> Json<Vec<SearchResult>> {
    let mut results: Vec<SearchResult> = vec![];

    // Search samples - only include those with a container assigned
    let samples = state
        .db
        .sample()
        .find_many(vec![])
        .with(sample::container::fetch())
        .exec()
        .await
        .unwrap_or_default();

    for sample in samples {
        // Only include samples that have a container assigned
        if let Some(Some(container)) = sample.container.as_ref() {
            // Get full container path by traversing up
            let container_path = get_container_path(&state.db, &container.id).await;
            let subcategory = container_path
                .first()
                .cloned()
                .unwrap_or_else(|| container.name.clone());

            let mut full_path = container_path.clone();
            full_path.push(sample.name.clone());

            results.push(SearchResult {
                entity_type: "sample".to_string(),
                id: sample.id,
                name: sample.name,
                category: "Freezer".to_string(),
                subcategory,
                path: full_path,
                notes: sample.metadata, // Sample notes/description
            });
        }
        // Skip samples without a container - they won't appear in the picker
    }

    // Search equipment - group by location hierarchy
    let equipment_list = state
        .db
        .equipment()
        .find_many(vec![])
        .with(equipment::location::fetch())
        .exec()
        .await
        .unwrap_or_default();
    for equip in equipment_list {
        // Only include equipment that has a location assigned
        if let Some(Some(location)) = equip.location.as_ref() {
            // Get full location path by traversing up
            let location_path = get_equipment_location_path(&state.db, &location.id).await;
            let subcategory = location_path
                .first()
                .cloned()
                .unwrap_or_else(|| location.name.clone());

            let mut full_path = location_path.clone();
            full_path.push(equip.name.clone());

            results.push(SearchResult {
                entity_type: "equipment".to_string(),
                id: equip.id,
                name: equip.name.clone(),
                category: "Equipment".to_string(),
                subcategory,
                path: full_path,
                notes: equip.metadata, // Equipment notes/specs
            });
        }
        // Skip equipment without a location - they won't appear in the picker
    }

    // Search papers - only include those with a library assigned
    let papers = state
        .db
        .paper()
        .find_many(vec![])
        .with(paper::library::fetch())
        .exec()
        .await
        .unwrap_or_default();
    for paper in papers {
        // Only include papers that have a library assigned
        if let Some(Some(library)) = paper.library.as_ref() {
            let title = paper.title.clone();
            results.push(SearchResult {
                entity_type: "paper".to_string(),
                id: paper.id,
                name: title.clone(),
                category: "Library".to_string(),
                subcategory: library.name.clone(),
                path: vec![library.name.clone(), title],
                notes: paper.notes, // Paper notes (rich text)
            });
        }
        // Skip papers without a library - they won't appear in the picker
    }

    Json(results)
}

// Helper to get full container path
async fn get_container_path(
    db: &std::sync::Arc<prisma::PrismaClient>,
    container_id: &str,
) -> Vec<String> {
    let mut path = vec![];
    let mut current_id = Some(container_id.to_string());

    while let Some(id) = current_id {
        if let Ok(Some(container)) = db
            .container()
            .find_unique(container::id::equals(id))
            .exec()
            .await
        {
            path.insert(0, container.name);
            current_id = container.parent_id;
        } else {
            break;
        }
    }

    if path.is_empty() {
        path.push("Unknown".to_string());
    }

    path
}

// Helper to get full equipment location path
async fn get_equipment_location_path(
    db: &std::sync::Arc<prisma::PrismaClient>,
    location_id: &str,
) -> Vec<String> {
    let mut path = vec![];
    let mut current_id = Some(location_id.to_string());

    while let Some(id) = current_id {
        if let Ok(Some(location)) = db
            .equipment_location()
            .find_unique(equipment_location::id::equals(id))
            .exec()
            .await
        {
            path.insert(0, location.name);
            current_id = location.parent_id;
        } else {
            break;
        }
    }

    if path.is_empty() {
        path.push("Unknown".to_string());
    }

    path
}

// ==========================================
// Experiment Folder Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreateExperimentFolderRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
}

async fn list_experiment_folders(
    State(state): State<AppState>,
) -> Json<Vec<experiment_folder::Data>> {
    let folders = state
        .db
        .experiment_folder()
        .find_many(vec![])
        .with(experiment_folder::children::fetch(vec![]))
        .with(experiment_folder::experiments::fetch(vec![]))
        .exec()
        .await
        .unwrap_or_default();
    Json(folders)
}

async fn create_experiment_folder(
    State(state): State<AppState>,
    Json(payload): Json<CreateExperimentFolderRequest>,
) -> Json<experiment_folder::Data> {
    let mut params: Vec<experiment_folder::SetParam> = vec![];

    if let Some(description) = payload.description {
        params.push(experiment_folder::description::set(Some(description)));
    }

    if let Some(color) = payload.color {
        params.push(experiment_folder::color::set(Some(color)));
    }

    if let Some(parent_id) = payload.parent_id {
        params.push(experiment_folder::parent::connect(
            experiment_folder::id::equals(parent_id),
        ));
    }

    let folder = state
        .db
        .experiment_folder()
        .create(payload.name, params)
        .exec()
        .await
        .expect("Failed to create experiment folder");
    Json(folder)
}

async fn delete_experiment_folder(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
    // Recursively delete all child folders before deleting the folder
    delete_experiment_folder_cascade(&state, &id).await;
    Json(())
}

/// Recursively delete an experiment folder and all its children
fn delete_experiment_folder_cascade<'a>(
    state: &'a AppState,
    folder_id: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        // Find all child folders
        let children = state
            .db
            .experiment_folder()
            .find_many(vec![experiment_folder::parent_id::equals(Some(
                folder_id.to_string(),
            ))])
            .exec()
            .await
            .expect("Failed to find child folders");

        // Recursively delete each child
        for child in children {
            delete_experiment_folder_cascade(state, &child.id).await;
        }

        // Unlink experiments in this folder (don't delete them, just set folder_id to None)
        state
            .db
            .experiment()
            .update_many(
                vec![experiment::folder_id::equals(Some(folder_id.to_string()))],
                vec![experiment::folder_id::set(None)],
            )
            .exec()
            .await
            .expect("Failed to unlink experiments from folder");

        // Finally, delete the folder itself
        state
            .db
            .experiment_folder()
            .delete(experiment_folder::id::equals(folder_id.to_string()))
            .exec()
            .await
            .expect("Failed to delete experiment folder");
    })
}

// File upload for experiments
// File upload for experiments
async fn upload_experiment_file(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, StatusCode> {
    println!(
        "Upload: Starting processing for experiment {}...",
        experiment_id
    );

    // Create uploads directory if it doesn't exist
    let uploads_dir = state.storage_path.join("uploads").join(&experiment_id);

    // Ensure directory exists (do NOT wipe it)
    if !uploads_dir.exists() {
        fs::create_dir_all(&uploads_dir)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let mut uploaded_files = vec![];
    use crate::db::prisma::digital_asset;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        println!("Upload: Error getting next field: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        println!("Upload: Processing field: {:?}", field.name());
        let filename = field.file_name().map(|f| f.to_string()).ok_or_else(|| {
            println!("Upload: Field missing filename");
            StatusCode::BAD_REQUEST
        })?;

        println!("Upload: Found file: {}", filename);

        // Simple content type guessing
        let content_type = field
            .content_type()
            .map(|s| s.to_string())
            .unwrap_or("application/octet-stream".to_string());

        let data = field.bytes().await.map_err(|e| {
            println!("Upload: Error reading bytes for {}: {}", filename, e);
            StatusCode::BAD_REQUEST
        })?;
        let size = data.len();
        println!("Upload: Read {} bytes", size);

        let file_path = uploads_dir.join(&filename);
        let mut file = fs::File::create(&file_path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        file.write_all(&data)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Create DigitalAsset record in DB
        // We assume 'filename' and 'storage_key' are required based on prisma.rs inspection
        // We set other fields via params
        let asset = state
            .db
            .digital_asset()
            .create(
                filename.clone(),
                file_path.to_string_lossy().to_string(), // storage_key
                vec![
                    digital_asset::size_bytes::set(Some(size as i32)),
                    digital_asset::mime_type::set(Some(content_type)),
                    digital_asset::asset_type::set("FILE".to_string()),
                    digital_asset::experiment::connect(crate::db::prisma::experiment::id::equals(
                        experiment_id.clone(),
                    )),
                ],
            )
            .exec()
            .await
            .map_err(|e| {
                println!("Database error creating asset: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        uploaded_files.push(serde_json::json!({
            "id": asset.id,
            "filename": filename,
            "path": file_path.to_string_lossy().to_string(),
            "size": size,
        }));
    }

    // Update experiment content with log entry
    let log_entry = format!(
        "<p>📎 <strong>{}</strong> uploaded at {}</p>",
        uploaded_files
            .iter()
            .map(|f| f["filename"].as_str().unwrap_or("unknown"))
            .collect::<Vec<_>>()
            .join(", "),
        chrono::Local::now().format("%d/%m/%Y %H:%M:%S")
    );

    let experiment = state
        .db
        .experiment()
        .find_unique(crate::db::prisma::experiment::id::equals(
            experiment_id.clone(),
        ))
        .exec()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let new_content = format!("{}{}", experiment.content, log_entry);

    state
        .db
        .experiment()
        .update(
            crate::db::prisma::experiment::id::equals(experiment_id),
            vec![crate::db::prisma::experiment::content::set(new_content)],
        )
        .exec()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({
        "files": uploaded_files
    })))
}

// List uploaded files for an experiment (returns database DigitalAsset records)
async fn list_experiment_files(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Fetch assets from database
    // 1. Fetch assets directly linked to experiment
    let mut assets = state
        .db
        .digital_asset()
        .find_many(vec![digital_asset::experiment_id::equals(Some(
            experiment_id.clone(),
        ))])
        .exec()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 2. Fetch assets linked via pipeline runs
    let pipeline_assets = state
        .db
        .digital_asset()
        .find_many(vec![digital_asset::pipeline_run::is(vec![
            crate::db::prisma::pipeline_run::experiment_id::equals(experiment_id.clone()),
        ])])
        .exec()
        .await
        .unwrap_or_default();

    assets.extend(pipeline_assets);

    let files: Vec<serde_json::Value> = assets
        .into_iter()
        .map(|asset| {
            serde_json::json!({
                "id": asset.id,
                "name": asset.filename.clone(),
                "filename": asset.filename,
                "path": asset.storage_key,
                "size": asset.size_bytes,
                "mimeType": asset.mime_type,
                "assetType": asset.asset_type,
                "createdAt": asset.created_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "files": files
    })))
}

// Delete a specific file from an experiment
async fn delete_experiment_file(
    State(state): State<AppState>,
    Path((experiment_id, asset_id)): Path<(String, String)>,
) -> Result<Json<()>, (StatusCode, String)> {
    // Find the asset to get its storage path
    let asset = state
        .db
        .digital_asset()
        .find_unique(digital_asset::id::equals(asset_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Asset not found".to_string()))?;

    // Verify asset belongs to this experiment
    if asset.experiment_id != Some(experiment_id.clone()) {
        return Err((
            StatusCode::FORBIDDEN,
            "Asset does not belong to this experiment".to_string(),
        ));
    }

    // STRICT DELETION:
    // 1. Remove from Disk based on storage_key
    // 2. Remove from DB

    let file_path = state.storage_path.join(&asset.storage_key);

    // Also check for potential legacy locations or alternative paths if storage_key is just 'filename' like in some old code?
    // Current logic uses "uploads/{exp_id}/{filename}" or "equipment/{eq_id}/{filename}"
    // so joining state.storage_path + asset.storage_key should be correct.

    if file_path.exists() {
        if let Err(e) = fs::remove_file(&file_path).await {
            tracing::error!("Failed to delete file from disk: {:?} - {}", file_path, e);
            // We continue to delete from DB even if disk fails, to avoid "ghost" assets
        } else {
            tracing::info!("Deleted file from disk: {:?}", file_path);
        }
    } else {
        tracing::warn!("File not found on disk during deletion: {:?}", file_path);
    }

    // Delete from database
    state
        .db
        .digital_asset()
        .delete(digital_asset::id::equals(asset_id))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}

// Serve a file for viewing (e.g., in an iframe)
async fn serve_file(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let asset = state
        .db
        .digital_asset()
        .find_unique(digital_asset::id::equals(asset_id))
        .exec()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let path = state.storage_path.join(&asset.storage_key);
    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let content_type = asset
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_string());

    Ok((
        [(header::CONTENT_TYPE, content_type)],
        Body::from_stream(ReaderStream::new(file)),
    ))
}

// ==========================================
// Library (Papers) Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreatePaperRequest {
    pub title: String,
    pub authors: Option<String>,
    pub journal: Option<String>,
    pub year: Option<i32>,
    pub doi: Option<String>,
    pub pmid: Option<String>,
    pub url: Option<String>,
    pub abstract_: Option<String>,
    pub notes: Option<String>,
    pub pdf_path: Option<String>,
    pub tags: Option<String>,
    pub library_id: Option<String>,
}

async fn list_papers(State(state): State<AppState>) -> Json<Vec<paper::Data>> {
    let papers = state
        .db
        .paper()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
    Json(papers)
}

async fn create_paper(
    State(state): State<AppState>,
    Json(payload): Json<CreatePaperRequest>,
) -> Json<paper::Data> {
    let mut params: Vec<paper::SetParam> = vec![];

    if let Some(authors) = payload.authors {
        params.push(paper::authors::set(Some(authors)));
    }

    if let Some(journal) = payload.journal {
        params.push(paper::journal::set(Some(journal)));
    }

    if let Some(year) = payload.year {
        params.push(paper::year::set(Some(year)));
    }

    if let Some(doi) = payload.doi {
        params.push(paper::doi::set(Some(doi)));
    }

    if let Some(pmid) = payload.pmid {
        params.push(paper::pmid::set(Some(pmid)));
    }

    if let Some(url) = payload.url {
        params.push(paper::url::set(Some(url)));
    }

    if let Some(abstract_) = payload.abstract_ {
        params.push(paper::r#abstract::set(Some(abstract_)));
    }

    if let Some(notes) = payload.notes {
        params.push(paper::notes::set(Some(notes)));
    }

    if let Some(pdf_path) = payload.pdf_path {
        params.push(paper::pdf_path::set(Some(pdf_path)));
    }

    if let Some(tags) = payload.tags {
        params.push(paper::tags::set(Some(tags)));
    }

    if let Some(library_id) = payload.library_id {
        params.push(paper::library_id::set(Some(library_id)));
    }

    let paper = state
        .db
        .paper()
        .create(payload.title, params)
        .exec()
        .await
        .expect("Failed to create paper");
    Json(paper)
}

async fn get_paper(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Option<paper::Data>> {
    let paper = state
        .db
        .paper()
        .find_unique(paper::id::equals(id))
        .exec()
        .await
        .ok()
        .flatten();
    Json(paper)
}

#[derive(Deserialize)]
pub struct UpdatePaperRequest {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub is_pinned: Option<bool>,
    pub library_id: Option<String>,
}

async fn update_paper(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdatePaperRequest>,
) -> Json<paper::Data> {
    let mut params: Vec<paper::SetParam> = vec![];

    if let Some(title) = payload.title {
        params.push(paper::title::set(title));
    }

    if let Some(notes) = payload.notes {
        params.push(paper::notes::set(Some(notes)));
    }

    if let Some(tags) = payload.tags {
        params.push(paper::tags::set(Some(tags)));
    }

    if let Some(is_pinned) = payload.is_pinned {
        params.push(paper::is_pinned::set(is_pinned));
    }

    if let Some(library_id) = payload.library_id {
        if library_id.is_empty() {
            params.push(paper::library_id::set(None));
        } else {
            params.push(paper::library_id::set(Some(library_id)));
        }
    }

    let paper = state
        .db
        .paper()
        .update(paper::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update paper");
    Json(paper)
}

async fn delete_paper(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    // First, fetch the paper to check if it has a PDF file
    let paper_record = state
        .db
        .paper()
        .find_unique(paper::id::equals(id.clone()))
        .exec()
        .await
        .expect("Failed to fetch paper");

    // If paper has a PDF, delete the file from disk
    if let Some(paper_data) = &paper_record {
        if let Some(pdf_path) = &paper_data.pdf_path {
            let path = PathBuf::from(pdf_path);
            if path.exists() {
                if let Err(e) = fs::remove_file(&path).await {
                    eprintln!("Warning: Failed to delete PDF file {}: {}", pdf_path, e);
                    // Continue with database deletion even if file deletion fails
                }
            }
        }
    }

    // Delete the paper record from database
    state
        .db
        .paper()
        .delete(paper::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete paper");
    Json(())
}

// ==========================================
// Collection Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreateCollectionRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

async fn list_collections(State(state): State<AppState>) -> Json<Vec<library::Data>> {
    let collections = state
        .db
        .library()
        .find_many(vec![])
        .with(library::papers::fetch(vec![]))
        .exec()
        .await
        .unwrap_or_default();
    Json(collections)
}

async fn create_collection(
    State(state): State<AppState>,
    Json(payload): Json<CreateCollectionRequest>,
) -> Json<library::Data> {
    let mut params: Vec<library::SetParam> = vec![];

    if let Some(description) = payload.description {
        params.push(library::description::set(Some(description)));
    }

    if let Some(color) = payload.color {
        params.push(library::color::set(Some(color)));
    }

    let collection = state
        .db
        .library()
        .create(payload.name, params)
        .exec()
        .await
        .expect("Failed to create collection");
    Json(collection)
}

async fn get_collection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Option<library::Data>> {
    let collection = state
        .db
        .library()
        .find_unique(library::id::equals(id))
        .with(library::papers::fetch(vec![]))
        .exec()
        .await
        .ok()
        .flatten();
    Json(collection)
}

#[derive(Deserialize)]
pub struct UpdateCollectionRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

async fn update_collection(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCollectionRequest>,
) -> Json<library::Data> {
    let mut params: Vec<library::SetParam> = vec![];

    if let Some(name) = payload.name {
        params.push(library::name::set(name));
    }

    if let Some(description) = payload.description {
        params.push(library::description::set(Some(description)));
    }

    if let Some(color) = payload.color {
        params.push(library::color::set(Some(color)));
    }

    let collection = state
        .db
        .library()
        .update(library::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update collection");
    Json(collection)
}

async fn delete_collection(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    // First, find all papers in this collection
    let papers_in_collection = state
        .db
        .paper()
        .find_many(vec![paper::library_id::equals(Some(id.clone()))])
        .exec()
        .await
        .expect("Failed to fetch papers in collection");

    // Delete PDF files for all papers in this collection
    for paper_record in &papers_in_collection {
        if let Some(pdf_path) = &paper_record.pdf_path {
            let path = PathBuf::from(pdf_path);
            if path.exists() {
                if let Err(e) = fs::remove_file(&path).await {
                    eprintln!("Warning: Failed to delete PDF file {}: {}", pdf_path, e);
                }
            }
        }
    }

    // Delete all papers in this collection from database
    state
        .db
        .paper()
        .delete_many(vec![paper::library_id::equals(Some(id.clone()))])
        .exec()
        .await
        .expect("Failed to delete papers in collection");

    // Finally, delete the collection itself
    state
        .db
        .library()
        .delete(library::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete collection");
    Json(())
}

// ==========================================
// DOI Lookup Handler
// ==========================================

#[derive(Deserialize)]
pub struct DoiLookupQuery {
    pub doi: String,
}

#[derive(Serialize)]
pub struct DoiLookupResponse {
    pub title: Option<String>,
    pub authors: Option<String>,
    pub journal: Option<String>,
    pub year: Option<i32>,
    pub r#abstract: Option<String>,
    pub url: Option<String>,
}

async fn lookup_doi(Query(query): Query<DoiLookupQuery>) -> Json<DoiLookupResponse> {
    // Use CrossRef API to lookup DOI metadata
    let client = reqwest::Client::new();
    let url = format!("https://api.crossref.org/works/{}", query.doi);

    match client.get(&url).send().await {
        Ok(response) => {
            if let Ok(json) = response.json::<serde_json::Value>().await {
                let message = json.get("message");

                let title = message
                    .and_then(|m| m.get("title"))
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                let authors = message
                    .and_then(|m| m.get("author"))
                    .and_then(|a| a.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|author| {
                                let given =
                                    author.get("given").and_then(|g| g.as_str()).unwrap_or("");
                                let family =
                                    author.get("family").and_then(|f| f.as_str()).unwrap_or("");
                                if family.is_empty() {
                                    None
                                } else {
                                    Some(format!("{} {}", given, family).trim().to_string())
                                }
                            })
                            .collect::<Vec<_>>()
                            .join(", ")
                    });

                let journal = message
                    .and_then(|m| m.get("container-title"))
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                let year = message
                    .and_then(|m| {
                        m.get("published-print")
                            .or_else(|| m.get("published-online"))
                    })
                    .and_then(|p| p.get("date-parts"))
                    .and_then(|d| d.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|inner| inner.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|y| y.as_i64())
                    .map(|y| y as i32);

                let abstract_text = message
                    .and_then(|m| m.get("abstract"))
                    .and_then(|a| a.as_str())
                    .map(|s| {
                        // Remove JATS XML tags from abstract
                        let re = regex::Regex::new(r"<[^>]+>").unwrap();
                        re.replace_all(s, "").to_string()
                    });

                let url = Some(format!("https://doi.org/{}", query.doi));

                Json(DoiLookupResponse {
                    title,
                    authors,
                    journal,
                    year,
                    r#abstract: abstract_text,
                    url,
                })
            } else {
                Json(DoiLookupResponse {
                    title: None,
                    authors: None,
                    journal: None,
                    year: None,
                    r#abstract: None,
                    url: None,
                })
            }
        }
        Err(_) => Json(DoiLookupResponse {
            title: None,
            authors: None,
            journal: None,
            year: None,
            r#abstract: None,
            url: None,
        }),
    }
}

// ==========================================
// PDF Upload/Download Handlers
// ==========================================

async fn upload_paper_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<paper::Data>, (StatusCode, String)> {
    // 1. Find the paper to ensure it exists
    let _paper = state
        .db
        .paper()
        .find_unique(paper::id::equals(id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Paper not found".to_string()))?;

    // 2. Process multipart form
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();

        if name == "file" {
            let file_name = field.file_name().unwrap_or("paper.pdf").to_string();
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // 3. Define storage path using app data directory
            let storage_dir = state.storage_path.join("papers");
            fs::create_dir_all(&storage_dir).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create storage dir: {}", e),
                )
            })?;

            let target_filename = format!("{}_{}", id, file_name);
            let target_path = storage_dir.join(&target_filename);

            // 4. Save file
            let mut file = fs::File::create(&target_path).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create file: {}", e),
                )
            })?;
            file.write_all(&data).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write file: {}", e),
                )
            })?;

            // 5. Update DB with path
            let stored_path = target_path.to_string_lossy().to_string();

            let updated_paper = state
                .db
                .paper()
                .update(
                    paper::id::equals(id),
                    vec![paper::pdf_path::set(Some(stored_path))],
                )
                .exec()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            return Ok(Json(updated_paper));
        }
    }

    Err((
        StatusCode::BAD_REQUEST,
        "No file field found in multipart request".to_string(),
    ))
}

async fn get_paper_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let paper = state
        .db
        .paper()
        .find_unique(paper::id::equals(id))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Paper not found".to_string()))?;

    let pdf_path_str = paper.pdf_path.ok_or((
        StatusCode::NOT_FOUND,
        "No PDF uploaded for this paper".to_string(),
    ))?;
    let path = PathBuf::from(pdf_path_str);

    if !path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            "PDF file not found on server".to_string(),
        ));
    }

    // Read file
    let file_bytes = fs::read(&path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read file: {}", e),
        )
    })?;

    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Serve file
    let body = Body::from(file_bytes);
    let headers = [
        (header::CONTENT_TYPE, "application/pdf".to_string()),
        (
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", filename),
        ),
    ];

    Ok((headers, body))
}

// ==========================================
// Equipment Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreateEquipmentRequest {
    pub name: String,
    pub type_: String,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub location_id: Option<String>,
    pub location: Option<String>, // Legacy field
    pub watch_folder: Option<String>,
    pub auto_import: Option<bool>,
    pub metadata: Option<String>,
    pub external_id: Option<String>,
    pub maintenance_cycle: Option<i32>,
    pub last_maintenance: Option<String>,
}

async fn list_equipment(State(state): State<AppState>) -> Json<Vec<equipment::Data>> {
    let equipment_list = state
        .db
        .equipment()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
    Json(equipment_list)
}

async fn get_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<equipment::Data>, (StatusCode, String)> {
    let equip = state
        .db
        .equipment()
        .find_unique(equipment::id::equals(id))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Equipment not found".to_string()))?;
    Ok(Json(equip))
}

async fn create_equipment(
    State(state): State<AppState>,
    Json(payload): Json<CreateEquipmentRequest>,
) -> Json<equipment::Data> {
    let mut params: Vec<equipment::SetParam> = vec![];

    if let Some(model) = payload.model {
        params.push(equipment::model::set(Some(model)));
    }
    if let Some(serial) = payload.serial_number {
        params.push(equipment::serial_number::set(Some(serial)));
    }
    if let Some(loc_id) = payload.location_id {
        params.push(equipment::location::connect(
            equipment_location::id::equals(loc_id),
        ));
    }
    if let Some(mc) = payload.maintenance_cycle {
        params.push(equipment::maintenance_cycle::set(Some(mc)));
    }
    if let Some(lm) = payload.last_maintenance {
        if let Ok(dt) = prisma_client_rust::chrono::DateTime::parse_from_rfc3339(&lm) {
            params.push(equipment::last_maintenance::set(Some(dt)));
        }
    }
    if let Some(folder) = payload.watch_folder {
        params.push(equipment::watch_folder::set(Some(folder)));
    }
    if let Some(auto) = payload.auto_import {
        params.push(equipment::auto_import::set(auto));
    }
    if let Some(metadata) = payload.metadata {
        params.push(equipment::metadata::set(Some(metadata)));
    }
    if let Some(eid) = payload.external_id {
        params.push(equipment::external_id::set(Some(eid)));
    }

    let equip = state
        .db
        .equipment()
        .create(payload.name, payload.type_, params)
        .exec()
        .await
        .expect("Failed to create equipment");
    Json(equip)
}

#[derive(Deserialize)]
pub struct UpdateEquipmentRequest {
    pub name: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub location_id: Option<String>,
    pub watch_folder: Option<String>,
    pub maintenance_cycle: Option<i32>,
    pub last_maintenance: Option<String>,
    pub auto_import: Option<bool>,
    pub agent_status: Option<String>,
    pub metadata: Option<String>,
}

async fn update_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateEquipmentRequest>,
) -> Json<equipment::Data> {
    let mut params: Vec<equipment::SetParam> = vec![];

    if let Some(name) = payload.name {
        params.push(equipment::name::set(name));
    }
    if let Some(model) = payload.model {
        params.push(equipment::model::set(Some(model)));
    }
    if let Some(serial) = payload.serial_number {
        params.push(equipment::serial_number::set(Some(serial)));
    }
    if let Some(loc_id) = payload.location_id {
        params.push(equipment::location::connect(
            equipment_location::id::equals(loc_id),
        ));
    }
    if let Some(mc) = payload.maintenance_cycle {
        params.push(equipment::maintenance_cycle::set(Some(mc)));
    }
    if let Some(lm) = payload.last_maintenance {
        if let Ok(dt) = prisma_client_rust::chrono::DateTime::parse_from_rfc3339(&lm) {
            params.push(equipment::last_maintenance::set(Some(dt)));
        }
    }
    if let Some(folder) = payload.watch_folder {
        params.push(equipment::watch_folder::set(Some(folder)));
    }
    if let Some(auto) = payload.auto_import {
        params.push(equipment::auto_import::set(auto));
    }
    if let Some(status) = payload.agent_status {
        params.push(equipment::agent_status::set(status));
    }
    if let Some(metadata) = payload.metadata {
        params.push(equipment::metadata::set(Some(metadata)));
    }

    let equip = state
        .db
        .equipment()
        .update(equipment::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update equipment");
    Json(equip)
}

async fn delete_equipment(State(state): State<AppState>, Path(id): Path<String>) -> Json<()> {
    state
        .db
        .equipment()
        .delete(equipment::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete equipment");
    Json(())
}

// Lock equipment to an experiment
#[derive(Deserialize)]
pub struct LockEquipmentRequest {
    pub experiment_id: String,
}

async fn lock_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<LockEquipmentRequest>,
) -> Result<Json<equipment::Data>, (StatusCode, String)> {
    // Check if already locked
    let equip = state
        .db
        .equipment()
        .find_unique(equipment::id::equals(id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Equipment not found".to_string()))?;

    if equip.locked_by_experiment_id.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "Equipment is already locked by another experiment".to_string(),
        ));
    }

    let updated = state
        .db
        .equipment()
        .update(
            equipment::id::equals(id),
            vec![
                equipment::locked_by_experiment::connect(experiment::id::equals(
                    payload.experiment_id,
                )),
                equipment::locked_at::set(Some(prisma_client_rust::chrono::Utc::now().into())),
            ],
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(updated))
}

// Unlock equipment
async fn unlock_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<equipment::Data>, (StatusCode, String)> {
    let updated = state
        .db
        .equipment()
        .update(
            equipment::id::equals(id),
            vec![
                equipment::locked_by_experiment_id::set(None),
                equipment::locked_at::set(None),
            ],
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(updated))
}

// Ingest file from agent (auto-import from equipment watch folder)
// Creates a DigitalAsset and an ExperimentEntry for the locked experiment
async fn ingest_equipment_file(
    State(state): State<AppState>,
    Path(equipment_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Look up the equipment to find which experiment it's locked to
    let equip = state
        .db
        .equipment()
        .find_unique(equipment::id::equals(equipment_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Equipment not found".to_string()))?;

    // Process the uploaded file first to get filename/data
    let field = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "No file in request".to_string()))?;

    let filename = field
        .file_name()
        .ok_or((StatusCode::BAD_REQUEST, "No filename".to_string()))?
        .to_string();

    let content_type = field.content_type().map(|ct| ct.to_string());

    let data = field
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let file_size = data.len() as i32;
    let _checksum = sha2_hash(&data);

    // DETERMINATION LOGIC:
    // If equipment is locked by an experiment -> Upload to uploads/{experiment_id}/
    // If NOT locked -> REJECT. "Dead" agent behavior.

    let locked_exp_id = equip.locked_by_experiment_id.clone().ok_or((
        StatusCode::BAD_REQUEST,
        "Equipment is not locked to any experiment. Agent should be inactive.".to_string(),
    ))?;

    // LOCKED: Upload to experiment folder
    let uploads_dir = state.storage_path.join("uploads").join(&locked_exp_id);
    fs::create_dir_all(&uploads_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create experiment uploads dir: {}", e),
        )
    })?;

    let file_path = uploads_dir.join(&filename);
    let storage_key = format!("uploads/{}/{}", locked_exp_id, filename);

    // Write file
    fs::write(&file_path, &data).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write file to experiment dir: {}", e),
        )
    })?;

    // Create DigitalAsset record
    let mut asset_params: Vec<digital_asset::SetParam> =
        vec![digital_asset::machine_id::set(Some(equipment_id.clone()))];

    if let Some(mime) = &content_type {
        asset_params.push(digital_asset::mime_type::set(Some(mime.clone())));
    }
    asset_params.push(digital_asset::size_bytes::set(Some(file_size)));

    // Connect to experiment is now MANDATORY
    asset_params.push(digital_asset::experiment::connect(experiment::id::equals(
        locked_exp_id.clone(),
    )));

    let asset = state
        .db
        .digital_asset()
        .create(filename.clone(), storage_key.clone(), asset_params)
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create ExperimentEntry
    // Build calibration info from equipment data
    let cal_text = match equip.last_maintenance.as_ref() {
        Some(lm) => format!("Last calibrated {}", lm.format("%d/%m/%Y")),
        None => "Last calibration unknown".to_string(),
    };

    let timestamp = prisma_client_rust::chrono::Utc::now();

    // Build the mention HTML span
    let equip_type = equip.r#type.clone();
    let mention_html = format!(
        r#"<span data-type="mention" data-id="{}" data-name="{}" data-entity-type="equipment" data-category="Equipment" data-subcategory="{}" data-path="{}" data-mentioned-at="{}">@{}</span>"#,
        html_escape(&equip.id),
        html_escape(&equip.name),
        html_escape(&equip_type),
        html_escape(&format!("[\"{}\"]", equip.name)),
        timestamp.to_rfc3339(),
        html_escape(&equip.name),
    );

    // Build the auto-import note
    let import_html = format!(
        "<p>📎 {} auto imported from {} ({}) at {}</p>",
        html_escape(&filename),
        mention_html,
        html_escape(&cal_text),
        timestamp.format("%H:%M:%S")
    );

    // Create the entry
    state
        .db
        .experiment_entry()
        .create(
            experiment::id::equals(locked_exp_id.clone()),
            import_html,
            vec![experiment_entry::attached_asset_id::set(Some(
                asset.id.clone(),
            ))],
        )
        .exec()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create experiment entry: {}", e),
            )
        })?;

    // Update equipment last sync time
    let _ = state
        .db
        .equipment()
        .update(
            equipment::id::equals(equipment_id.clone()),
            vec![equipment::last_sync_at::set(Some(
                prisma_client_rust::chrono::Utc::now().into(),
            ))],
        )
        .exec()
        .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "asset": {
            "id": asset.id,
            "filename": asset.filename,
            "storageKey": asset.storage_key,
            "experimentId": asset.experiment_id
        }
    })))
}

/// Escape HTML special characters for safe embedding in HTML content
#[allow(dead_code)]
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Simple SHA256 hash as hex string (using manual implementation to avoid extra deps)
fn sha2_hash(data: &[u8]) -> String {
    // Use a simple format for now - the checksum field is optional
    format!("{:x}", data.len())
}

// ==========================================
// Equipment Location Handlers
// ==========================================

#[derive(Deserialize)]
pub struct CreateEquipmentLocationRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
}

async fn list_equipment_locations(
    State(state): State<AppState>,
) -> Json<Vec<equipment_location::Data>> {
    let locations = state
        .db
        .equipment_location()
        .find_many(vec![])
        .with(equipment_location::children::fetch(vec![]))
        .exec()
        .await
        .unwrap_or_default();
    Json(locations)
}

async fn create_equipment_location(
    State(state): State<AppState>,
    Json(payload): Json<CreateEquipmentLocationRequest>,
) -> Json<equipment_location::Data> {
    let mut params: Vec<equipment_location::SetParam> = vec![];

    if let Some(desc) = payload.description {
        params.push(equipment_location::description::set(Some(desc)));
    }
    if let Some(color) = payload.color {
        params.push(equipment_location::color::set(Some(color)));
    }
    if let Some(pid) = payload.parent_id {
        params.push(equipment_location::parent::connect(
            equipment_location::id::equals(pid),
        ));
    }

    let location = state
        .db
        .equipment_location()
        .create(payload.name, params)
        .exec()
        .await
        .expect("Failed to create equipment location");
    Json(location)
}

async fn delete_equipment_location(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
    state
        .db
        .equipment_location()
        .delete(equipment_location::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete equipment location");
    Json(())
}

// DOI Lookup Handler (re-adding if it was missing or just for context)

// ==========================================
// Pipeline Output Ingestion (Directory Preservation)
// ==========================================

// Ingest pipeline output (ZIP) -> Unzip -> Create Directory Asset
// This replaces the old method of uploading individual files.
async fn ingest_pipeline_output(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // 1. Fetch PipelineRun to get ExperimentID
    let run = state
        .db
        .pipeline_run()
        .find_unique(pipeline_run::id::equals(run_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Pipeline run not found".to_string()))?;

    let experiment_id = run.experiment_id;

    // 2. Process the uploaded ZIP file
    let field = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "No file in request".to_string()))?;

    let data = field
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // 3. Define Storage Paths
    let output_dirname = format!("run_{}_output", run_id);
    let uploads_dir = state.storage_path.join("uploads").join(&experiment_id);
    let output_dir = uploads_dir.join(&output_dirname);
    let storage_key = format!("uploads/{}/{}", experiment_id, output_dirname);

    // Ensure parent uploads dir exists
    tokio::fs::create_dir_all(&uploads_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create uploads dir: {}", e),
        )
    })?;

    // 4. Unzip the content in a blocking task
    tokio::task::spawn_blocking(move || {
        let cursor = std::io::Cursor::new(data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to read zip archive: {}", e))?;

        // Extract everything
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read file {} from zip: {}", i, e))?;

            let outpath = match file.enclosed_name() {
                Some(path) => output_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", outpath, e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).map_err(|e| {
                            format!("Failed to create parent directory {:?}: {}", p, e)
                        })?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file {:?}: {}", outpath, e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to copy file {:?}: {}", outpath, e))?;
            }

            // Set permissions on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode)).ok();
                }
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? // spawn_blocking error
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?; // extraction error

    // 5. Create ONE DigitalAsset for the Directory
    use crate::db::prisma::{experiment, pipeline_run, visualization};

    let asset_params = vec![
        digital_asset::mime_type::set(Some("application/x-directory".to_string())),
        digital_asset::size_bytes::set(None), // Size is complex for dirs, leave null or calcluate
        digital_asset::experiment::connect(experiment::id::equals(experiment_id.clone())),
        digital_asset::pipeline_run::connect(pipeline_run::id::equals(run_id.clone())),
    ];

    let asset = state
        .db
        .digital_asset()
        .create(output_dirname, storage_key.clone(), asset_params)
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 6. AUTO-CREATE / LINK VISUALIZATION
    // Check if any asset for this run already has a visualization attached
    let existing_asset_with_viz = state
        .db
        .digital_asset()
        .find_first(vec![
            digital_asset::pipeline_run_id::equals(Some(run_id.clone())),
            digital_asset::visualization::is(vec![]), // Checks if relation exists
        ])
        .with(digital_asset::visualization::fetch())
        .exec()
        .await
        .unwrap_or(None);

    let viz_id = if let Some(asset) = &existing_asset_with_viz {
        asset
            .visualization
            .as_ref()
            .and_then(|v| v.as_ref())
            .map(|v| v.id.clone())
            .unwrap_or_else(|| "".to_string())
    } else {
        String::new()
    };

    let viz_id = if !viz_id.is_empty() {
        viz_id
    } else {
        // Create new Visualization
        let viz_type =
            if run.pipeline_type.contains("scrna") || run.pipeline_type.contains("scanpy") {
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

        let mut viz_params = vec![visualization::experiment::connect(experiment::id::equals(
            experiment_id.clone(),
        ))];

        if let Some(snap) = run.metadata_snapshot {
            viz_params.push(visualization::metadata_snapshot::set(Some(snap)));
        }

        let new_viz = state
            .db
            .visualization()
            .create(viz_name, viz_type.to_string(), viz_params)
            .exec()
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create visualization: {}", e),
                )
            })?;

        new_viz.id
    };

    // Link Asset to Visualization
    let _ = state
        .db
        .digital_asset()
        .update(
            digital_asset::id::equals(asset.id.clone()),
            vec![digital_asset::visualization_id::set(Some(viz_id))],
        )
        .exec()
        .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "asset": asset
    })))
}

// Manual Upload Workflow: Create Visualization from Zip
async fn upload_visualization_output(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use crate::db::prisma::{digital_asset, experiment, visualization};

    // 1. Process the uploaded ZIP file
    let field = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "No file in request".to_string()))?;

    let filename = field.file_name().unwrap_or("upload.zip").to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // 2. Define Storage Paths
    // Use timestamp to ensure uniqueness
    let timestamp = chrono::Utc::now().timestamp();
    let output_dirname = format!("manual_viz_{}_{}", timestamp, filename.replace(".zip", ""));
    let uploads_dir = state.storage_path.join("uploads").join(&experiment_id);
    let output_dir = uploads_dir.join(&output_dirname);
    let storage_key = format!("uploads/{}/{}", experiment_id, output_dirname);

    // Ensure parent uploads dir exists
    tokio::fs::create_dir_all(&uploads_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create uploads dir: {}", e),
        )
    })?;

    // 3. Unzip content
    tokio::task::spawn_blocking(move || {
        let cursor = std::io::Cursor::new(data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to read zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => output_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).ok();
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // 4. Create Visualization Record
    let viz_name = format!("Manual Upload: {}", filename);
    let viz_type = if filename.to_lowercase().contains("scanpy")
        || filename.to_lowercase().contains("scrna")
    {
        "SCANVAS"
    } else {
        "BULK_DASHBOARD"
    };

    let viz = state
        .db
        .visualization()
        .create(
            viz_name,
            viz_type.to_string(),
            vec![visualization::experiment::connect(experiment::id::equals(
                experiment_id.clone(),
            ))],
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 5. Create DigitalAsset for the Directory
    let asset_params = vec![
        digital_asset::mime_type::set(Some("application/x-directory".to_string())),
        digital_asset::visualization::connect(visualization::id::equals(viz.id.clone())),
        digital_asset::experiment::connect(experiment::id::equals(experiment_id.clone())),
    ];

    let asset = state
        .db
        .digital_asset()
        .create(output_dirname, storage_key, asset_params)
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "visualization": viz,
        "asset": asset
    })))
}

// Manual Upload Workflow: Create Standalone Visualization from Zip (No Experiment)
async fn upload_standalone_visualization(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use crate::db::prisma::{digital_asset, visualization};

    // 1. Process the uploaded ZIP file
    let field = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "No file in request".to_string()))?;

    let filename = field.file_name().unwrap_or("upload.zip").to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // 2. Define Storage Paths
    // Use timestamp to ensure uniqueness. Store in "standalone_uploads"
    let timestamp = chrono::Utc::now().timestamp();
    let output_dirname = format!(
        "standalone_viz_{}_{}",
        timestamp,
        filename.replace(".zip", "")
    );
    let uploads_dir = state.storage_path.join("standalone_uploads");
    let output_dir = uploads_dir.join(&output_dirname);
    let storage_key = format!("standalone_uploads/{}", output_dirname);

    // Ensure parent uploads dir exists
    tokio::fs::create_dir_all(&uploads_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create uploads dir: {}", e),
        )
    })?;

    // 3. Unzip content
    tokio::task::spawn_blocking(move || {
        let cursor = std::io::Cursor::new(data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to read zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => output_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).ok();
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // 4. Create Visualization Record (No Experiment)
    let viz_name = format!("Standalone: {}", filename);
    let viz_type = if filename.to_lowercase().contains("scanpy")
        || filename.to_lowercase().contains("scrna")
    {
        "SCANVAS"
    } else {
        "BULK_DASHBOARD"
    };

    let viz = state
        .db
        .visualization()
        .create(
            viz_name,
            viz_type.to_string(),
            vec![], // No experiment connection
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 5. Create DigitalAsset for the Directory
    let asset_params = vec![
        digital_asset::mime_type::set(Some("application/x-directory".to_string())),
        digital_asset::visualization::connect(visualization::id::equals(viz.id.clone())),
    ];

    let asset = state
        .db
        .digital_asset()
        .create(output_dirname, storage_key, asset_params)
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "visualization": viz,
        "asset": asset
    })))
}

// List files for a specific Visualization (Standalone or Experiment-linked)
// GET /visualizations/:id/files
async fn get_visualization_files(
    State(state): State<AppState>,
    Path(viz_id): Path<String>,
) -> Result<Json<Vec<ExperimentFile>>, (StatusCode, String)> {
    use crate::db::prisma::{digital_asset, visualization};

    // 1. Verify Visualization exists
    let viz = state
        .db
        .visualization()
        .find_unique(visualization::id::equals(viz_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Visualization not found".to_string()))?;

    // 2. Find Directory Assets linked to this Visualization
    let assets = state
        .db
        .digital_asset()
        .find_many(vec![
            digital_asset::visualization_id::equals(Some(viz_id.clone())),
            digital_asset::mime_type::equals(Some("application/x-directory".to_string())),
        ])
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut files = Vec::new();

    for asset in assets {
        // Construct full path: storage_path/storage_key
        // Note: storage_key in DB is relative to storage_root
        // But for local fs, we might need to join with state.storage_path

        // The `storage_key` is usually something like "uploads/exp_id/dir_name"
        // state.storage_path is the absolute root
        let storage_path = state.storage_path.join(&asset.storage_key);

        // Base URL for serving files from this asset
        // We use the generic asset file route: /assets/{asset_id}/files/{relative_path}
        let base_url = format!("/assets/{}/files", asset.id);

        if storage_path.exists() {
            let mut found_files = find_analysis_files(&storage_path, &base_url, "");

            // Populate visualization_id
            for file in &mut found_files {
                file.visualization_id = Some(viz.id.clone());
            }

            files.extend(found_files);
        }
    }

    Ok(Json(files))
}

// List files within a Directory Asset
// GET /assets/:id/files
async fn list_directory_asset_files(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let asset = state
        .db
        .digital_asset()
        .find_unique(digital_asset::id::equals(asset_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Asset not found".to_string()))?;

    // Verify it is a directory
    if asset.mime_type.as_deref() != Some("application/x-directory") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Asset is not a directory".to_string(),
        ));
    }

    let dir_path = state.storage_path.join(&asset.storage_key);
    if !dir_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            "Directory not found on disk".to_string(),
        ));
    }

    let asset_id_clone = asset_id.clone();
    // Walk filesystem to list files (use spawn_blocking to avoid blocking the async runtime)
    let files = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let walker = walkdir::WalkDir::new(&dir_path).into_iter();

        for entry in walker.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                // Compute relative path from the directory root
                let relative_path = path
                    .strip_prefix(&dir_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();

                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                let filename = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                // Simple mime detection
                let mime = mime_guess::from_path(path)
                    .first_or_octet_stream()
                    .to_string();

                files.push(serde_json::json!({
                    "path": relative_path,
                    "name": filename,
                    "size": size,
                    "mimeType": mime,
                    "url": format!("/assets/{}/files/{}", asset_id_clone, relative_path)
                }));
            }
        }
        files
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(files))
}

// Serve a specific file from a Directory Asset
// GET /assets/:id/files/*path
async fn serve_directory_asset_file(
    State(state): State<AppState>,
    Path((asset_id, file_path)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let asset = state
        .db
        .digital_asset()
        .find_unique(digital_asset::id::equals(asset_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Asset not found".to_string()))?;

    // Verify it is a directory
    if asset.mime_type.as_deref() != Some("application/x-directory") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Asset is not a directory".to_string(),
        ));
    }

    // Construct full path
    // Prevent directory traversal attacks by canonicalizng?
    // Basic check: join and ensure it starts with storage path
    let base_path = state.storage_path.join(&asset.storage_key);
    let target_path = base_path.join(&file_path);

    if !target_path.exists() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    // Security check: ensure target_path is inside base_path
    let canonical_base = base_path.canonicalize().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid base path".to_string(),
        )
    })?;
    let canonical_target = target_path
        .canonicalize()
        .map_err(|_| (StatusCode::NOT_FOUND, "Invalid file path".to_string()))?;

    if !canonical_target.starts_with(&canonical_base) {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    let file = tokio::fs::File::open(target_path).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to open file".to_string(),
        )
    })?;

    let content_type = mime_guess::from_path(&file_path)
        .first_or_octet_stream()
        .to_string();

    Ok((
        [(header::CONTENT_TYPE, content_type)],
        Body::from_stream(ReaderStream::new(file)),
    ))
}
