//! API route handlers
use crate::db::prisma::{
    self, container, experiment, experiment_entry, experiment_folder, experiment_mention, library,
    paper, sample,
};
use crate::AppState;
use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
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
        .route("/search-entities", get(search_entities))
        .route("/folders", get(list_experiment_folders).post(create_experiment_folder))
        .route("/folders/{id}", axum::routing::delete(delete_experiment_folder))
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
    pub category: String,      // Top-level category: "Freezer", "Library", "Equipment"
    pub subcategory: String,   // Second level: container name, library name, equipment type
    pub path: Vec<String>,     // Full path for navigation
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
            let subcategory = container_path.first().cloned().unwrap_or_else(|| container.name.clone());
            
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

    // Search equipment - group by type
    let equipment_list = state
        .db
        .equipment()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
    for equip in equipment_list {
        let equipment_type = equip.r#type.clone();
        results.push(SearchResult {
            entity_type: "equipment".to_string(),
            id: equip.id,
            name: equip.name.clone(),
            category: "Equipment".to_string(),
            subcategory: format_equipment_type(&equipment_type),
            path: vec![format_equipment_type(&equipment_type), equip.name],
            notes: equip.metadata, // Equipment notes/specs
        });
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

// Helper to format equipment type for display
fn format_equipment_type(t: &str) -> String {
    match t {
        "sequencer" => "Sequencers".to_string(),
        "microscope" => "Microscopes".to_string(),
        "centrifuge" => "Centrifuges".to_string(),
        "pcr_machine" => "PCR Machines".to_string(),
        "incubator" => "Incubators".to_string(),
        "freezer" => "Freezers".to_string(),
        _ => t.replace('_', " ").to_string(),
    }
}

// Helper to get full container path
async fn get_container_path(db: &std::sync::Arc<prisma::PrismaClient>, container_id: &str) -> Vec<String> {
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
async fn upload_experiment_file(
    State(state): State<AppState>,
    Path(experiment_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Create uploads directory if it doesn't exist
    let uploads_dir = state.storage_path.join("uploads").join(&experiment_id);
    fs::create_dir_all(&uploads_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut uploaded_files = vec![];

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        let filename = field
            .file_name()
            .ok_or(StatusCode::BAD_REQUEST)?
            .to_string();
        let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;

        let file_path = uploads_dir.join(&filename);
        let mut file = fs::File::create(&file_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        file.write_all(&data)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        uploaded_files.push(serde_json::json!({
            "filename": filename,
            "path": file_path.to_string_lossy().to_string(),
            "size": data.len(),
        }));
    }

    Ok(Json(serde_json::json!({
        "files": uploaded_files
    })))
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
            fs::create_dir_all(&storage_dir)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create storage dir: {}", e)))?;

            let target_filename = format!("{}_{}", id, file_name);
            let target_path = storage_dir.join(&target_filename);

            // 4. Save file
            let mut file = fs::File::create(&target_path)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create file: {}", e)))?;
            file.write_all(&data)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file: {}", e)))?;

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

    Err((StatusCode::BAD_REQUEST, "No file field found in multipart request".to_string()))
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

    let pdf_path_str = paper.pdf_path.ok_or((StatusCode::NOT_FOUND, "No PDF uploaded for this paper".to_string()))?;
    let path = PathBuf::from(pdf_path_str);

    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "PDF file not found on server".to_string()));
    }

    // Read file
    let file_bytes = fs::read(&path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read file: {}", e)))?;

    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    
    // Serve file
    let body = Body::from(file_bytes);
    let headers = [
        (header::CONTENT_TYPE, "application/pdf".to_string()),
        (header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", filename)),
    ];

    Ok((headers, body))
}

// DOI Lookup Handler (re-adding if it was missing or just for context)
