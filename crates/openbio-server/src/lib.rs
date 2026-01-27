//! OpenBio Server
//!
//! Axum HTTP API server that can run embedded in Tauri or as a standalone Docker container.

use std::net::SocketAddr;

use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub mod db;
pub mod routes;
pub mod state;

pub use state::AppState;

/// Start the API server (blocking - call from async context)
pub async fn run_server(addr: SocketAddr, state: AppState) -> anyhow::Result<()> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(routes::health))
        .nest("/api", routes::api_routes())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!("Starting OpenBio server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Start the API server in a new tokio runtime on a background thread
/// Returns immediately, server runs until process exits
/// 
/// apply_migrations: Set to true for local/hub mode (SQLite with migrations),
///                   false for spoke/enterprise mode (remote database)
pub fn spawn_embedded_server(port: u16, database_url: String, apply_migrations: bool) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

        rt.block_on(async {
            let addr: SocketAddr = format!("127.0.0.1:{}", port)
                .parse()
                .expect("Invalid address");

            let state = AppState::new(database_url, apply_migrations)
                .await
                .expect("Failed to create app state");

            if let Err(e) = run_server(addr, state).await {
                tracing::error!("Server error: {}", e);
            }
        });
    });
}
