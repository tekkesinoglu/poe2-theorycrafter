#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod optimizer;
mod updater;

use crate::engine::stat_parser::{
    evaluate_build_snapshot, BuildEvaluationRequest, BuildEvaluationResult,
};
use crate::optimizer::gem_solver::{recommend_supports, SupportRecommendation};
use crate::optimizer::tree_solver::optimize_tree;
use crate::updater::models::{ClassStart, GameDatabase, GemData, PassiveNode};
use crate::updater::DataUpdater;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub db: Mutex<Option<GameDatabase>>,
    pub data_dir: PathBuf,
}

#[derive(Serialize)]
struct PassiveTreeResponse {
    nodes: HashMap<u32, PassiveNode>,
    classes: Vec<ClassStart>,
    sprite_sheets: HashMap<String, String>,
}

#[derive(Serialize)]
struct ActiveGemsResponse {
    active_skills: Vec<GemData>,
    total_gems: usize,
}

#[tauri::command]
fn get_passive_tree(state: State<'_, AppState>) -> Result<PassiveTreeResponse, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    Ok(PassiveTreeResponse {
        nodes: db.tree.nodes.clone(),
        classes: db.tree.classes.clone(),
        sprite_sheets: db.tree.sprite_sheets.clone(),
    })
}

#[tauri::command]
fn list_active_gems(state: State<'_, AppState>) -> Result<ActiveGemsResponse, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    let mut active_skills: Vec<GemData> = db
        .gems
        .values()
        .filter(|g| !g.is_support)
        .cloned()
        .collect();
    active_skills.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(ActiveGemsResponse {
        total_gems: db.gems.len(),
        active_skills,
    })
}

#[tauri::command]
async fn trigger_patch_update(
    force: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let data_dir = state.data_dir.clone();
    let updater = DataUpdater::new(data_dir);
    let new_db = updater
        .sync_game_data(force)
        .await
        .map_err(|e| e.to_string())?;

    let node_count = new_db.tree.nodes.len();
    let gem_count = new_db.gems.len();

    {
        let mut guard = state
            .db
            .lock()
            .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
        *guard = Some(new_db);
    }

    let _ = app.emit("game-data-updated", "ok");
    Ok(format!(
        "Güncelleme tamamlandı ({} düğüm, {} gem)",
        node_count, gem_count
    ))
}

#[tauri::command]
fn optimize_passive_tree(
    start_node_id: u32,
    max_points: usize,
    weights: HashMap<String, f32>,
    state: State<'_, AppState>,
) -> Result<Vec<u32>, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    Ok(optimize_tree(&db.tree, start_node_id, max_points, &weights))
}

#[tauri::command]
fn recommend_support_gems(
    active_skill_id: String,
    allocated_ids: Vec<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SupportRecommendation>, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    Ok(recommend_supports(
        &db.gems,
        &db.tree,
        &allocated_ids,
        &active_skill_id,
    ))
}

#[tauri::command]
fn evaluate_build(
    req: BuildEvaluationRequest,
    state: State<'_, AppState>,
) -> Result<BuildEvaluationResult, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    Ok(evaluate_build_snapshot(&req, &db.tree.nodes, &db.gems))
}

#[tauri::command]
fn evaluate_builds_batch(
    requests: Vec<BuildEvaluationRequest>,
    state: State<'_, AppState>,
) -> Result<Vec<BuildEvaluationResult>, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı".to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı henüz yüklenmedi".to_string())?;

    Ok(requests
        .iter()
        .map(|req| evaluate_build_snapshot(req, &db.tree.nodes, &db.gems))
        .collect())
}

fn load_cached_db(data_dir: &PathBuf) -> Option<GameDatabase> {
    let bin_path = data_dir.join("game_data.bin");
    let bytes = std::fs::read(bin_path).ok()?;
    bincode::deserialize::<GameDatabase>(&bytes).ok()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./poe2_data"));
            let _ = std::fs::create_dir_all(&data_dir);

            let initial_db = load_cached_db(&data_dir);
            app.manage(AppState {
                db: Mutex::new(initial_db),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_passive_tree,
            list_active_gems,
            trigger_patch_update,
            optimize_passive_tree,
            recommend_support_gems,
            evaluate_build,
            evaluate_builds_batch,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılırken hata oluştu");
}