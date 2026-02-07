//! OpenBio Agent Binary
//! 
//! Standalone executable that runs the agent server.

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// OpenBio Agent CLI
#[derive(Parser, Debug)]
#[command(name = "openbio-agent")]
#[command(about = "Agent for automated file ingestion from lab instruments")]
struct Args {
    /// Port to listen on for configuration API
    #[arg(long, default_value = "8080")]
    port: u16,

    /// Equipment ID (optional - can be set via API)
    #[arg(long)]
    equipment_id: Option<String>,
    
    /// Agent name for mDNS discovery (e.g. "Microscope Room 301")
    #[arg(long)]
    agent_name: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    
    openbio_agent::run_agent_server(args.port, args.equipment_id, args.agent_name).await
}
