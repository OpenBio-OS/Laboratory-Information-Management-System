//! Application state for the API server

use crate::db::prisma::PrismaClient;
use std::sync::Arc;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<PrismaClient>,
}

impl AppState {
    pub async fn new(database_url: String, apply_migrations: bool) -> anyhow::Result<Self> {
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

        Ok(Self { db: Arc::new(db) })
    }
}
