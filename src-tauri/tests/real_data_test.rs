use poe2_theorycrafter::engine::stat_parser::{evaluate_build_snapshot, BuildEvaluationRequest};
use poe2_theorycrafter::optimizer::gem_solver::recommend_supports;
use poe2_theorycrafter::optimizer::tree_solver::optimize_tree;
use poe2_theorycrafter::updater::models::GameDatabase;
use std::collections::HashMap;
use std::path::PathBuf;

fn find_cached_db() -> Option<GameDatabase> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("poe2_data")
            .join("game_data.bin"),
    ];

    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(
            PathBuf::from(&appdata)
                .join("com.poe2.theorycrafter")
                .join("game_data.bin"),
        );
        candidates.push(
            PathBuf::from(&appdata)
                .join("poe2-theorycrafter")
                .join("game_data.bin"),
        );
    }

    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(db) = bincode::deserialize::<GameDatabase>(&bytes) {
                return Some(db);
            }
        }
    }
    None
}

#[test]
fn validate_real_game_data_pipeline() {
    let Some(db) = find_cached_db() else {
        eprintln!("Bilgi: game_data.bin bulunamadı, gerçek veri testi atlanıyor.");
        return;
    };

    assert!(!db.tree.nodes.is_empty(), "Pasif ağaç düğümleri boş olmamalı");
    assert!(!db.gems.is_empty(), "Gem veritabanı boş olmamalı");

    // Ön yüzdeki list_active_gems ile birebir aynı küme (!g.is_support)
    let all_actives: Vec<_> = db.gems.values().filter(|g| !g.is_support).collect();
    assert!(!all_actives.is_empty(), "En az bir aktif yetenek bulunmalı");

    let mut empty_skills = Vec::new();
    for skill in &all_actives {
        let recs = recommend_supports(&db.gems, &db.tree, &[], &skill.id);
        if recs.is_empty() {
            empty_skills.push(format!("{} ({:?})", skill.name, skill.tags));
        }
    }
    assert!(
        empty_skills.is_empty(),
        "{} gem için öneri boş döndü: {:?}",
        empty_skills.len(),
        empty_skills
    );

    let mut weights = HashMap::new();
    weights.insert("dps".to_string(), 0.6);
    weights.insert("life".to_string(), 0.4);

    for class_start in &db.tree.classes {
        let path = optimize_tree(&db.tree, class_start.start_node_id, 60, &weights);
        assert!(
            !path.is_empty(),
            "{} sınıfı için optimizer boş ağaç döndürdü",
            class_start.name
        );

        let eval = evaluate_build_snapshot(
            &BuildEvaluationRequest {
                allocated_ids: path,
                selected_skill_id: all_actives.first().map(|g| g.id.clone()),
                weapon_base_dps: 500.0,
                base_gem_level: 20,
                bonus_skill_levels: 0,
                gear_spirit: 50,
                active_spirit_buffs: vec![],
                active_ascendancy_nodes: vec![],
                supports: vec![],
            },
            &db.tree.nodes,
            &db.gems,
        );
        assert!(eval.est_dps > 0, "{} için DPS 0 döndü", class_start.name);
        assert!(eval.effective_hp > 0, "{} için EHP 0 döndü", class_start.name);
    }
}