//! Application state for the API server

use crate::db::prisma::PrismaClient;
use std::sync::Arc;

use crate::pipeline::PipelineManager;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<PrismaClient>,
    pub storage_path: std::path::PathBuf,
    pub pipeline_manager: Arc<PipelineManager>,
}

impl AppState {
    pub async fn new(
        database_url: String,
        storage_path: std::path::PathBuf,
        apply_migrations: bool,
    ) -> anyhow::Result<Self> {
        // Initialize Prisma client with runtime database URL
        let db: PrismaClient = PrismaClient::_builder()
            .with_url(database_url.clone())
            .build()
            .await?;

        // Apply all pending Prisma migrations (only in local/hub mode)
        // Migrations are embedded at compile-time from database/migrations/
        if apply_migrations {
            crate::db::migrations::apply_migrations(&db, &database_url).await?;
        }

        // Ensure storage directory exists
        std::fs::create_dir_all(&storage_path)?;

        let db_arc = Arc::new(db);
        let pipeline_manager = Arc::new(PipelineManager::new(db_arc.clone()));

        Ok(Self {
            db: db_arc,
            storage_path,
            pipeline_manager,
        })
    }
}
