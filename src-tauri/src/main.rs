#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod optimizer;
mod updater;

use optimizer::gem_solver::{
    get_active_skills, recommend_supports, GemListResponse, SupportRecommendation,
};
use optimizer::tree_solver::TreeOptimizer;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use updater::models::{GameDatabase, PassiveTree};
use updater::DataUpdater;

struct AppState {
    db: Mutex<Option<GameDatabase>>,
    updater: DataUpdater,
}

#[tauri::command]
async fn trigger_patch_update(
    force: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let db = state
        .updater
        .sync_game_data(force)
        .await
        .map_err(|e| format!("Güncelleme hatası: {:#}", e))?;

    let msg = format!(
        "Güncelleme tamamlandı: {} düğüm, {} sınıf, {} gem.",
        db.tree.nodes.len(),
        db.tree.classes.len(),
        db.gems.len()
    );

    *state.db.lock().unwrap() = Some(db);
    let _ = app.emit("game-data-updated", &msg);
    Ok(msg)
}

#[tauri::command]
fn get_passive_tree(state: State<'_, AppState>) -> Result<PassiveTree, String> {
    let guard = state.db.lock().unwrap();
    match &*guard {
        Some(db) => Ok(db.tree.clone()),
        None => Err("Veritabanı henüz yüklenmedi. Lütfen Patch Güncelle (Ctrl+U) yapın.".into()),
    }
}

#[tauri::command]
fn optimize_passive_tree(
    start_node_id: u32,
    max_points: usize,
    weights: HashMap<String, f32>,
    state: State<'_, AppState>,
) -> Result<Vec<u32>, String> {
    let guard = state.db.lock().unwrap();
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı yüklü değil.".to_string())?;

    let solver = TreeOptimizer::new(&db.tree);
    Ok(solver.solve_optimal_tree(&db.tree, start_node_id, max_points, &weights))
}

#[tauri::command]
fn list_active_gems(state: State<'_, AppState>) -> Result<GemListResponse, String> {
    let guard = state.db.lock().unwrap();
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı yüklü değil.".to_string())?;

    let active_skills = get_active_skills(&db.gems);
    Ok(GemListResponse {
        active_skills,
        total_gems: db.gems.len(),
    })
}

#[tauri::command]
fn recommend_support_gems(
    active_skill_id: String,
    allocated_ids: Vec<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SupportRecommendation>, String> {
    let guard = state.db.lock().unwrap();
    let db = guard
        .as_ref()
        .ok_or_else(|| "Veritabanı yüklü değil.".to_string())?;

    Ok(recommend_supports(
        &db.gems,
        &db.tree,
        &allocated_ids,
        &active_skill_id,
    ))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("App data dizini alınamadı");

            let updater = DataUpdater::new(app_data_dir.clone());
            let bin_path = app_data_dir.join("game_data.bin");

            let initial_db = std::fs::read(&bin_path)
                .ok()
                .and_then(|bytes| bincode::deserialize::<GameDatabase>(&bytes).ok());

            app.manage(AppState {
                db: Mutex::new(initial_db),
                updater,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            trigger_patch_update,
            get_passive_tree,
            optimize_passive_tree,
            list_active_gems,
            recommend_support_gems
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılırken hata oluştu");
}