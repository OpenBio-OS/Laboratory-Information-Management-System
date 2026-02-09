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
use std::fs;
use std::io::Write;
use std::path::PathBuf;
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
}

fn pipeline_routes() -> Router<AppState> {
    Router::new()
        .route("/run", post(start_pipeline_run))
        .route("/runs", get(list_pipeline_runs))
        .route("/runs/{id}", get(get_pipeline_run_status))
        .route("/runs/{id}/status", patch(update_pipeline_status))
        .route("/runs/{id}", delete(delete_pipeline_run))
        .route("/runs/{id}/cancel", post(cancel_pipeline_run))
        .route("/runs/{id}/assets", post(upload_pipeline_asset))
}

fn visualization_routes() -> Router<AppState> {
    Router::new()
        .route("/", post(register_visualization))
        .route("/{id}", delete(delete_visualization))
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

    // Create visualization
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
                    let _ = fs::create_dir_all(parent);
                }

                if let Err(e) = fs::copy(&file_path, &target_path) {
                    tracing::error!("Failed to copy file {}: {}", file_path.display(), e);
                    continue;
                }

                let file_size = fs::metadata(&target_path)
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
                        let _ = fs::remove_file(path);
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
    let _run = state
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
            fs::create_dir_all(&run_dir).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create storage dir: {}", e),
                )
            })?;

            let target_path = run_dir.join(&filename);
            let mut file = fs::File::create(&target_path).map_err(|e| {
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

            file.write_all(&data).map_err(|e| {
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
        let asset = state
            .db
            .digital_asset()
            .create(
                saved_filename.clone(),
                storage_key,
                vec![
                    digital_asset::pipeline_run::connect(
                        crate::db::prisma::pipeline_run::id::equals(id.clone()),
                    ),
                    digital_asset::size_bytes::set(Some(saved_size)),
                    digital_asset::mime_type::set(saved_content_type),
                    digital_asset::asset_type::set(asset_type.clone()),
                ],
            )
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
    let experiments = state
        .db
        .experiment()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
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
) -> Json<Option<experiment::Data>> {
    let experiment = state
        .db
        .experiment()
        .find_unique(experiment::id::equals(id))
        .with(experiment::mentions::fetch(vec![]))
        .with(experiment::entries::fetch(vec![]))
        .with(experiment::samples::fetch(vec![]))
        .with(experiment::pipeline_runs::fetch(vec![]))
        .exec()
        .await
        .ok()
        .flatten();
    Json(experiment)
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
        fs::create_dir_all(&uploads_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
        let mut file =
            fs::File::create(&file_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        file.write_all(&data)
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

    // Delete the file from disk
    let file_path = std::path::Path::new(&asset.storage_key);
    if file_path.exists() {
        fs::remove_file(file_path).ok(); // Ignore errors if file doesn't exist
    }

    // Also remove from experiment's upload folder if it exists there
    let experiment_file_path = state
        .storage_path
        .join("uploads")
        .join(&experiment_id)
        .join(&asset.filename);
    if experiment_file_path.exists() {
        fs::remove_file(&experiment_file_path).ok();
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

    let path = std::path::Path::new(&asset.storage_key);
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
                if let Err(e) = fs::remove_file(&path) {
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
                if let Err(e) = fs::remove_file(&path) {
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
            fs::create_dir_all(&storage_dir).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create storage dir: {}", e),
                )
            })?;

            let target_filename = format!("{}_{}", id, file_name);
            let target_path = storage_dir.join(&target_filename);

            // 4. Save file
            let mut file = fs::File::create(&target_path).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create file: {}", e),
                )
            })?;
            file.write_all(&data).map_err(|e| {
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
    let file_bytes = fs::read(&path).map_err(|e| {
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

    let experiment_id = equip.locked_by_experiment_id.clone().ok_or((
        StatusCode::BAD_REQUEST,
        "Equipment is not locked to any experiment. Attach equipment to an experiment first."
            .to_string(),
    ))?;

    // Process the uploaded file
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

    // Compute SHA256 checksum (simple size-based placeholder)
    let _checksum = sha2_hash(&data);

    // Save file to storage: storage/equipment/{equipment_id}/{filename}
    let equip_storage_dir = state.storage_path.join("equipment").join(&equipment_id);

    fs::create_dir_all(&equip_storage_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create storage dir: {}", e),
        )
    })?;

    let storage_key = format!("equipment/{}/{}", equipment_id, filename);
    let file_path = state.storage_path.join(&storage_key);

    let mut file = fs::File::create(&file_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create file: {}", e),
        )
    })?;
    file.write_all(&data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write file: {}", e),
        )
    })?;

    // Replace existing files in experiment uploads dir (1 file per experiment)
    let experiment_uploads_dir = state.storage_path.join("uploads").join(&experiment_id);
    if experiment_uploads_dir.exists() {
        fs::remove_dir_all(&experiment_uploads_dir).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to clean experiment uploads dir: {}", e),
            )
        })?;
    }
    fs::create_dir_all(&experiment_uploads_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create experiment uploads dir: {}", e),
        )
    })?;
    let experiment_file_path = experiment_uploads_dir.join(&filename);
    fs::copy(&file_path, &experiment_file_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to copy to experiment dir: {}", e),
        )
    })?;

    // NOTE: We no longer delete old assets - experiments can have multiple files

    // Create DigitalAsset record
    let mut asset_params: Vec<digital_asset::SetParam> =
        vec![digital_asset::machine_id::set(Some(equipment_id.clone()))];
    if let Some(mime) = &content_type {
        asset_params.push(digital_asset::mime_type::set(Some(mime.clone())));
    }
    asset_params.push(digital_asset::size_bytes::set(Some(file_size)));
    asset_params.push(digital_asset::experiment::connect(experiment::id::equals(
        experiment_id.clone(),
    )));

    let asset = state
        .db
        .digital_asset()
        .create(filename.clone(), storage_key.clone(), asset_params)
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Build calibration info from equipment data
    let cal_text = match equip.last_maintenance.as_ref() {
        Some(lm) => format!("Last calibrated {}", lm.format("%d/%m/%Y")),
        None => "Last calibration unknown".to_string(),
    };

    let timestamp = prisma_client_rust::chrono::Utc::now();
    let ts_str = timestamp.format("%d/%m/%Y %H:%M:%S").to_string();

    // Build the mention HTML span (same format the TipTap RichMention extension parses)
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

    // Build the auto-import note as HTML paragraph and append to experiment content
    let import_html = format!(
        "<p>📎 {} auto imported from {} ({}) at {}</p>",
        html_escape(&filename),
        mention_html,
        html_escape(&cal_text),
        html_escape(&ts_str),
    );

    let exp = state
        .db
        .experiment()
        .find_unique(experiment::id::equals(experiment_id.clone()))
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Experiment not found".to_string()))?;

    let mut new_content = exp.content.clone();
    new_content.push_str(&import_html);

    state
        .db
        .experiment()
        .update(
            experiment::id::equals(experiment_id.clone()),
            vec![experiment::content::set(new_content)],
        )
        .exec()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
        "status": "ok",
        "asset_id": asset.id,
        "filename": filename,
        "experiment_id": experiment_id,
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
