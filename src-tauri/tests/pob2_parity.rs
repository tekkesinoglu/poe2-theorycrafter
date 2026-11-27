//! Path of Building 2 ile karşılaştırmada (tools/pob2-compare) bulunan hataların regresyon testleri.
//! Taban değerler: Life 1150, ES 450, Armour 1800, Evasion 1800 (varsayılan ekipman varsayımı).

use poe2_theorycrafter::engine::stat_parser::{evaluate_build_snapshot, BuildEvaluationRequest};
use poe2_theorycrafter::updater::models::PassiveNode;
use std::collections::HashMap;

fn eval(stats: &[&str]) -> poe2_theorycrafter::engine::stat_parser::BuildEvaluationResult {
    let mut nodes = HashMap::new();
    for (i, s) in stats.iter().enumerate() {
        let id = i as u32 + 1;
        nodes.insert(
            id,
            PassiveNode {
                id,
                name: format!("n{id}"),
                stats: vec![s.to_string()],
                is_keystone: false,
                is_notable: false,
                is_attribute_choice: false,
                x: 0.0,
                y: 0.0,
                neighbors: vec![],
                icon: None,
            },
        );
    }
    let req = BuildEvaluationRequest {
        allocated_ids: nodes.keys().copied().collect(),
        selected_skill_id: None,
        weapon_base_dps: 500.0,
        base_gem_level: 20,
        bonus_skill_levels: 0,
        gear_spirit: 0,
        active_spirit_buffs: vec![],
        active_ascendancy_nodes: vec![],
        supports: vec![],
    };
    evaluate_build_snapshot(&req, &nodes, &HashMap::new())
}

/// "increased Armour and Evasion Rating" yalnızca Armour'a sayılıyordu (PoB2: ikisine de).
#[test]
fn hybrid_armour_and_evasion_line_counts_for_both() {
    let r = eval(&["20% increased Armour and Evasion Rating"]);
    assert_eq!(r.total_armour, 2160);
    assert_eq!(r.total_evasion, 2160);
}

/// Koşullu satırlar PoB2'de varsayılan aktif değil.
#[test]
fn conditional_lines_are_ignored() {
    let r = eval(&[
        "40% increased Evasion Rating if you have been Hit Recently",
        "40% increased Armour and Evasion Rating while Leeching",
        "25% increased Armour, Evasion and Energy Shield from Equipped Shield",
    ]);
    assert_eq!((r.total_armour, r.total_evasion, r.total_es), (1800, 1800, 450));
}

/// Negatif artışlar 0'a kırpılıyordu; PoB2 uygular (1800 -> 1350).
#[test]
fn reduced_defences_apply_once_to_all_three() {
    let r = eval(&["25% reduced Armour, Evasion and Energy Shield"]);
    assert_eq!(r.total_armour, 1350);
    assert_eq!(r.total_evasion, 1350);
    assert_eq!(r.total_es, 338); // 450 * 0.75 = 337.5
}

/// PoB2: 1 Strength = +2 Life. Açık Strength satırları sayılmıyordu.
#[test]
fn explicit_strength_adds_life() {
    assert_eq!(eval(&["+10 to Strength"]).total_life, 1170);
    assert_eq!(eval(&["+5 to Strength and Dexterity"]).total_life, 1160);
}

/// "any Attribute" seçim düğümlerinde dağılım bilinmediği için Strength payı 1/3 varsayılır.
#[test]
fn any_attribute_counts_one_third_for_life() {
    assert_eq!(eval(&["+6 to any Attribute"]).total_life, 1154);
    assert_eq!(eval(&["+5 to all Attributes"]).total_life, 1160);
}
