//! API route handlers

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::db::prisma::{container, experiment, experiment_entry, experiment_mention, sample, paper};
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
        // Experiments routes (experiments ARE the notebooks)
        .nest("/experiments", experiment_routes())
        // Library routes (papers)
        .nest("/library", library_routes())
}

fn inventory_routes() -> Router<AppState> {
    Router::new()
        .route("/samples", get(list_samples).post(create_sample))
        .route("/samples/{id}", axum::routing::delete(delete_sample).patch(update_sample))
        .route("/containers", get(list_containers).post(create_container))
        .route("/containers/{id}", axum::routing::delete(delete_container))
}

fn experiment_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_experiments).post(create_experiment))
        .route("/{id}", get(get_experiment).patch(update_experiment).delete(delete_experiment))
        .route("/{id}/entries", get(list_experiment_entries).post(create_experiment_entry))
        .route("/{id}/mentions", get(list_experiment_mentions).post(create_experiment_mention))
        .route("/search-entities", get(search_entities))
}

fn library_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_papers).post(create_paper))
        .route("/{id}", get(get_paper).patch(update_paper).delete(delete_paper))
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
// Experiment Handlers (Experiments ARE notebooks)
// ==========================================

#[derive(Deserialize)]
pub struct CreateExperimentRequest {
    pub name: String,
    pub description: Option<String>,
    pub content: Option<String>,
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
    
    if let Some(content) = payload.content {
        params.push(experiment::content::set(content));
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

async fn delete_experiment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
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
        .find_many(vec![experiment_mention::experiment_id::equals(experiment_id)])
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

    let paper = state
        .db
        .paper()
        .update(paper::id::equals(id), params)
        .exec()
        .await
        .expect("Failed to update paper");
    Json(paper)
}

async fn delete_paper(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<()> {
    state
        .db
        .paper()
        .delete(paper::id::equals(id))
        .exec()
        .await
        .expect("Failed to delete paper");
    Json(())
}
