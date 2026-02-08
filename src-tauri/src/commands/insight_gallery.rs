// Tauri commands for Insight module - listing and managing visualizations

use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::Utc;

#[derive(Debug, Serialize)]
pub struct InsightInstance {
    pub id: String,
    pub experiment_id: String,
    pub experiment_name: String,
    pub created_at: String,
    pub data_type: String,
    pub cell_count: Option<u32>,
    pub gene_count: Option<u32>,
    pub status: String,
    pub thumbnail_url: Option<String>,
}

/// List all insight instances
#[tauri::command]
pub async fn list_insight_instances(
    state: State<'_, crate::AppState>,
) -> Result<Vec<InsightInstance>, String> {
    // TODO: Query database for all insight instances
    // For now, return mock data
    Ok(vec![
        InsightInstance {
            id: "insight-1".to_string(),
            experiment_id: "exp-1".to_string(),
            experiment_name: "Sample Batch A - scRNA-seq".to_string(),
            created_at: Utc::now()
                .checked_sub_signed(chrono::Duration::days(2))
                .unwrap()
                .to_rfc3339(),
            data_type: "scRNA-seq".to_string(),
            cell_count: Some(8432),
            gene_count: Some(20000),
            status: "READY".to_string(),
            thumbnail_url: None,
        },
        InsightInstance {
            id: "insight-2".to_string(),
            experiment_id: "exp-2".to_string(),
            experiment_name: "PBMC Analysis".to_string(),
            created_at: Utc::now()
                .checked_sub_signed(chrono::Duration::hours(6))
                .unwrap()
                .to_rfc3339(),
            data_type: "scRNA-seq".to_string(),
            cell_count: Some(12000),
            gene_count: Some(18500),
            status: "READY".to_string(),
            thumbnail_url: None,
        },
        InsightInstance {
            id: "insight-3".to_string(),
            experiment_id: "exp-3".to_string(),
            experiment_name: "Spatial Transcriptomics Study".to_string(),
            created_at: Utc::now()
                .checked_sub_signed(chrono::Duration::days(5))
                .unwrap()
                .to_rfc3339(),
            data_type: "Spatial".to_string(),
            cell_count: Some(5000),
            gene_count: Some(15000),
            status: "READY".to_string(),
            thumbnail_url: None,
        },
    ])
}

/// Delete an insight instance
#[tauri::command]
pub async fn delete_insight_instance(
    id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // TODO: Delete from database and cleanup files
    println!("Deleting insight instance: {}", id);
    Ok(())
}

/// Create a new insight instance from experiment results
#[tauri::command]
pub async fn create_insight_instance(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<InsightInstance, String> {
    // TODO: Create insight instance from pipeline results
    Ok(InsightInstance {
        id: format!("insight-{}", uuid::Uuid::new_v4()),
        experiment_id: experiment_id.clone(),
        experiment_name: "New Experiment".to_string(),
        created_at: Utc::now().to_rfc3339(),
        data_type: "scRNA-seq".to_string(),
        cell_count: None,
        gene_count: None,
        status: "PROCESSING".to_string(),
        thumbnail_url: None,
    })
}
