//! API route handlers

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::db::prisma::{container, experiment, notebook, notebook_entry, notebook_mention, sample, equipment, paper};
use crate::AppState;

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
        // Notebook (Module B) routes
        .nest("/notebooks", notebook_routes())
        // Experiments routes
        .nest("/experiments", experiment_routes())
}

fn inventory_routes() -> Router<AppState> {
    Router::new()
        .route("/samples", get(list_samples).post(create_sample))
        .route("/samples/{id}", axum::routing::delete(delete_sample).patch(update_sample))
        .route("/containers", get(list_containers).post(create_container))
        .route("/containers/{id}", axum::routing::delete(delete_container))
}

fn notebook_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_notebooks).post(create_notebook))
        .route("/{id}", get(get_notebook).patch(update_notebook).delete(delete_notebook))
        .route("/{id}/entries", get(list_notebook_entries).post(create_notebook_entry))
        .route("/{id}/mentions", get(list_notebook_mentions).post(create_notebook_mention))
        .route("/search-entities", get(search_entities))
}

fn experiment_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_experiments).post(create_experiment))
        .route("/{id}", get(get_experiment))
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

async fn delete_sample(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
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

async fn delete_container(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
    state
        .db
        .container()
        .delete(container::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete container");
    Json(())
}

// ==========================================
// Placeholder Handlers
// ==========================================

// Notebooks
#[derive(Deserialize)]
pub struct CreateNotebookRequest {
    pub experiment_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

async fn list_notebooks(State(state): State<AppState>) -> Json<Vec<notebook::Data>> {
    let notebooks = state
        .db
        .notebook()
        .find_many(vec![])
        .exec()
        .await
        .unwrap_or_default();
    Json(notebooks)
}

async fn create_notebook(
    State(state): State<AppState>,
    Json(payload): Json<CreateNotebookRequest>,
) -> Json<notebook::Data> {
    let mut params: Vec<notebook::SetParam> = vec![];
    
    if let Some(title) = payload.title {
        params.push(notebook::title::set(title));
    }
    
    if let Some(description) = payload.description {
        params.push(notebook::description::set(Some(description)));
    }

    let notebook = state
        .db
        .notebook()
        .create(
            experiment::id::equals(payload.experiment_id),
            params,
        )
        .exec()
        .await
        .expect("Failed to create notebook");
    Json(notebook)
}

async fn get_notebook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Option<notebook::Data>> {
    let notebook = state
        .db
        .notebook()
        .find_unique(notebook::id::equals(id))
        .with(notebook::mentions::fetch(vec![]))
        .with(notebook::entries::fetch(vec![]))
        .exec()
        .await
        .ok()
        .flatten();
    Json(notebook)
}

#[derive(Deserialize)]
pub struct UpdateNotebookRequest {
    pub content: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
}

async fn update_notebook(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateNotebookRequest>,
) -> Json<notebook::Data> {
    let mut params: Vec<notebook::SetParam> = vec![];
    
    if let Some(content) = payload.content {
        params.push(notebook::content::set(content));
    }
    
    if let Some(title) = payload.title {
        params.push(notebook::title::set(title));
    }
    
    if let Some(description) = payload.description {
        params.push(notebook::description::set(Some(description)));
    }

    let notebook = state
        .db
        .notebook()
        .update(notebook::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update notebook");
    Json(notebook)
}

async fn delete_notebook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
    state
        .db
        .notebook()
        .delete(notebook::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete notebook");
    Json(())
}

// Notebook Entries
#[derive(Deserialize)]
pub struct CreateNotebookEntryRequest {
    pub content: String,
    pub author: Option<String>,
    pub attached_asset_id: Option<String>,
}

async fn list_notebook_entries(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Json<Vec<notebook_entry::Data>> {
    let entries = state
        .db
        .notebook_entry()
        .find_many(vec![notebook_entry::notebook_id::equals(notebook_id)])
        .exec()
        .await
        .unwrap_or_default();
    Json(entries)
}

async fn create_notebook_entry(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(payload): Json<CreateNotebookEntryRequest>,
) -> Json<notebook_entry::Data> {
    let mut params: Vec<notebook_entry::SetParam> = vec![];
    
    if let Some(author) = payload.author {
        params.push(notebook_entry::author::set(Some(author)));
    }
    
    if let Some(asset_id) = payload.attached_asset_id {
        params.push(notebook_entry::attached_asset_id::set(Some(asset_id)));
    }

    let entry = state
        .db
        .notebook_entry()
        .create(
            notebook::id::equals(notebook_id),
            payload.content,
            params,
        )
        .exec()
        .await
        .expect("Failed to create notebook entry");
    Json(entry)
}

// Notebook Mentions
#[derive(Deserialize)]
pub struct CreateNotebookMentionRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub snapshot_data: String,
    pub position: Option<i32>,
}

async fn list_notebook_mentions(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Json<Vec<notebook_mention::Data>> {
    let mentions = state
        .db
        .notebook_mention()
        .find_many(vec![notebook_mention::notebook_id::equals(notebook_id)])
        .exec()
        .await
        .unwrap_or_default();
    Json(mentions)
}

async fn create_notebook_mention(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(payload): Json<CreateNotebookMentionRequest>,
) -> Json<notebook_mention::Data> {
    let mut params: Vec<notebook_mention::SetParam> = vec![];
    
    if let Some(position) = payload.position {
        params.push(notebook_mention::position::set(Some(position)));
    }

    let mention = state
        .db
        .notebook_mention()
        .create(
            notebook::id::equals(notebook_id),
            payload.entity_type,
            payload.entity_id,
            payload.snapshot_data,
            params,
        )
        .exec()
        .await
        .expect("Failed to create notebook mention");
    Json(mention)
}

// Search entities for @mentions
#[derive(Serialize)]
pub struct SearchResult {
    pub entity_type: String,
    pub id: String,
    pub name: String,
    pub metadata: Option<serde_json::Value>,
}

async fn search_entities(
    State(state): State<AppState>,
) -> Json<Vec<SearchResult>> {
    let mut results: Vec<SearchResult> = vec![];
    
    // Search samples
    let samples = state.db.sample().find_many(vec![]).exec().await.unwrap_or_default();
    for sample in samples {
        results.push(SearchResult {
            entity_type: "sample".to_string(),
            id: sample.id,
            name: sample.name,
            metadata: sample.metadata.and_then(|m| serde_json::from_str(&m).ok()),
        });
    }
    
    // Search equipment
    let equipment_list = state.db.equipment().find_many(vec![]).exec().await.unwrap_or_default();
    for equip in equipment_list {
        results.push(SearchResult {
            entity_type: "equipment".to_string(),
            id: equip.id,
            name: equip.name,
            metadata: equip.metadata.and_then(|m| serde_json::from_str(&m).ok()),
        });
    }
    
    // Search papers
    let papers = state.db.paper().find_many(vec![]).exec().await.unwrap_or_default();
    for paper in papers {
        results.push(SearchResult {
            entity_type: "paper".to_string(),
            id: paper.id,
            name: paper.title,
            metadata: Some(serde_json::json!({
                "authors": paper.authors,
                "year": paper.year,
                "doi": paper.doi,
            })),
        });
    }
    
    Json(results)
}

// Experiments
#[derive(Deserialize)]
pub struct CreateExperimentRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
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
    
    if let Some(status) = payload.status {
        params.push(experiment::status::set(status));
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
        .with(experiment::notebook::fetch())
        .with(experiment::samples::fetch(vec![]))
        .exec()
        .await
        .ok()
        .flatten();
    Json(experiment)
}
