//! Standalone server binary for Docker deployment

use std::net::SocketAddr;

use openbio_server::{run_server, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let addr: SocketAddr = "0.0.0.0:3000".parse()?;
    
    // Use .dev directory for development database (ignored by git)
    std::fs::create_dir_all(".dev").ok();
    let state = AppState::new("file:./.dev/openbio.db".to_string(), true).await?;
    
    run_server(addr, state).await
}
