//! PR #1 düzeltmelerinin (bir kez yanlışlıkla geri alındı) sessizce kaybolmasını önleyen testler.

use poe2_theorycrafter::engine::stat_parser::{
    evaluate_build_snapshot, BuildEvaluationRequest, SpiritBuffInput,
};
use poe2_theorycrafter::optimizer::tree_solver::optimize_tree;
use poe2_theorycrafter::updater::models::{PassiveNode, PassiveTree};
use std::collections::HashMap;

fn node(id: u32, stats: &[&str], x: f32, y: f32, nbrs: &[u32]) -> PassiveNode {
    PassiveNode {
        id,
        name: format!("n{id}"),
        stats: stats.iter().map(|s| s.to_string()).collect(),
        is_keystone: false,
        is_notable: false,
        is_attribute_choice: false,
        x,
        y,
        neighbors: nbrs.to_vec(),
        icon: None,
    }
}

fn empty_req() -> BuildEvaluationRequest {
    BuildEvaluationRequest {
        allocated_ids: vec![],
        selected_skill_id: None,
        weapon_base_dps: 500.0,
        base_gem_level: 20,
        bonus_skill_levels: 0,
        gear_spirit: 0,
        active_spirit_buffs: vec![],
        active_ascendancy_nodes: vec![],
        supports: vec![],
    }
}

fn buff(id: &str, cost: i32) -> SpiritBuffInput {
    SpiritBuffInput {
        id: id.into(),
        name: id.into(),
        cost,
        more_dps_pct: 0.0,
        required_tag: None,
        inc_crit_chance: 0.0,
        inc_evasion_pct: 0.0,
        inc_es_pct: 0.0,
    }
}

/// i32 toplamı debug'da panikliyor, release'de negatife sarıyordu.
#[test]
fn spirit_cost_overflow_saturates() {
    let mut req = empty_req();
    req.active_spirit_buffs = vec![buff("a", i32::MAX), buff("b", i32::MAX)];
    let r = evaluate_build_snapshot(&req, &HashMap::new(), &HashMap::new());
    assert_eq!(r.used_spirit, i32::MAX);
    assert!(r.remaining_spirit <= 0);
}

#[test]
fn absurd_tree_spirit_is_clamped() {
    let mut nodes = HashMap::new();
    nodes.insert(1, node(1, &["+99999999999 to maximum Spirit"], 0.0, 0.0, &[]));
    let mut req = empty_req();
    req.allocated_ids = vec![1];
    let r = evaluate_build_snapshot(&req, &nodes, &HashMap::new());
    assert!(r.max_spirit > 0 && r.max_spirit <= 100 + 500 + 10_000, "max_spirit={}", r.max_spirit);
}

/// Eskiden 900 birimden uzun kenarlar yok sayılıyor, gerçek ağacın ~%47'si erişilemiyordu.
#[test]
fn optimizer_traverses_long_edges() {
    let mut nodes = HashMap::new();
    nodes.insert(0, node(0, &[], 0.0, 0.0, &[1]));
    nodes.insert(1, node(1, &["12% increased Damage"], 5000.0, 0.0, &[0, 2]));
    nodes.insert(2, node(2, &["12% increased Damage"], 10000.0, 0.0, &[1]));
    let tree = PassiveTree { nodes, classes: vec![], sprite_sheets: HashMap::new() };
    let mut w = HashMap::new();
    w.insert("damage".to_string(), 100.0f32);

    let out = optimize_tree(&tree, 0, 3, &w);
    assert!(out.contains(&2), "uzak düğüme ulaşılamadı: {out:?}");
}
