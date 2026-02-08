// WebSocket handler for streaming pipeline logs in real-time

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
};
use tokio::sync::mpsc;
use std::sync::Arc;

/// WebSocket upgrade handler for pipeline log streaming
pub async fn pipeline_log_handler(
    ws: WebSocketUpgrade,
    Path(run_id): Path<String>,
    State(state): State<Arc<crate::state::AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, run_id, state))
}

/// Handle WebSocket connection for log streaming
async fn handle_socket(
    mut socket: WebSocket,
    run_id: String,
    state: Arc<crate::state::AppState>,
) {
    // Create channel for log messages
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // TODO: Register this channel with the pipeline manager
    // so it receives log updates

    // Send logs to client as they arrive
    let send_task = tokio::spawn(async move {
        while let Some(log_line) = rx.recv().await {
            if socket
                .send(Message::Text(log_line.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Wait for task completion
    let _ = send_task.await;
}

/// Broadcast message to all WebSocket clients
pub struct PipelineWebSocket {
    senders: Vec<mpsc::UnboundedSender<String>>,
}

impl PipelineWebSocket {
    pub fn new() -> Self {
        Self {
            senders: Vec::new(),
        }
    }

    pub fn add_client(&mut self, sender: mpsc::UnboundedSender<String>) {
        self.senders.push(sender);
    }

    pub fn broadcast(&mut self, message: String) {
        self.senders.retain(|sender| {
            sender.send(message.clone()).is_ok()
        });
    }
}

impl Default for PipelineWebSocket {
    fn default() -> Self {
        Self::new()
    }
}
