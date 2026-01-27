//! OpenBio Ingest Agent
//! 
//! Watches directories for new files and uploads them to the OpenBio API.

use std::path::PathBuf;
use std::sync::mpsc::channel;

use anyhow::Result;
use clap::Parser;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// OpenBio Ingest Agent CLI
#[derive(Parser, Debug)]
#[command(name = "openbio-agent")]
#[command(about = "Ingest agent for automated file ingestion from lab instruments")]
struct Args {
    /// Machine ID for this instrument
    #[arg(long)]
    machine_id: String,

    /// API URL to connect to
    #[arg(long, default_value = "http://localhost:3000")]
    api_url: String,

    /// Directory to watch for new files
    #[arg(long)]
    watch_dir: PathBuf,

    /// API key for authentication (Enterprise mode)
    #[arg(long, env = "OPENBIO_API_KEY")]
    api_key: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    info!(
        "Starting OpenBio Agent for machine '{}' watching '{}'",
        args.machine_id,
        args.watch_dir.display()
    );

    // Set up file watcher
    let (tx, rx) = channel();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&args.watch_dir, RecursiveMode::Recursive)?;

    info!("Watching for file changes...");

    // Process events
    for res in rx {
        match res {
            Ok(event) => {
                if event.kind.is_create() {
                    for path in event.paths {
                        info!("New file detected: {}", path.display());
                        // TODO: Implement handshake and upload
                        // 1. POST /api/agent/handshake { machine_id, timestamp }
                        // 2. Get experiment_id from response
                        // 3. Upload file to storage
                        // 4. Link to experiment via API
                    }
                }
            }
            Err(e) => warn!("Watch error: {:?}", e),
        }
    }

    Ok(())
}
