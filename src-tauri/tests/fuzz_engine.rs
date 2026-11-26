use poe2_theorycrafter::engine::stat_parser::{
    evaluate_build_snapshot, AscendancyNodeBonus, BuildEvaluationRequest, SpiritBuffInput,
    SupportInput,
};
use poe2_theorycrafter::optimizer::gem_solver::{get_active_skills, recommend_supports};
use poe2_theorycrafter::optimizer::tree_solver::optimize_tree;
use poe2_theorycrafter::updater::models::{ClassStart, GemData, PassiveNode, PassiveTree};
use std::collections::HashMap;

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
        self.0
    }
    fn range(&mut self, max: usize) -> usize {
        if max == 0 { 0 } else { (self.next_u64() as usize) % max }
    }
    fn f32_weird(&mut self) -> f32 {
        match self.range(10) {
            0 => 0.0,
            1 => -100.0,
            2 => 1e6,
            3 => f32::NAN,
            4 => f32::INFINITY,
            5 => f32::NEG_INFINITY,
            _ => (self.range(200) as f32 - 50.0) / 10.0,
        }
    }
}

fn generate_fuzzed_tree(rng: &mut Rng, node_count: usize) -> PassiveTree {
    let stat_pool = [
        "+12% increased Lightning Damage",
        "+15% increased Maximum Life",
        "+20% increased Critical Hit Chance",
        "10% more Cast Speed",
        "+25% to Fire Resistance",
        "+30 to Spirit",
        "Gain 15% of Damage as Extra Cold Damage",
        "",
        "??? invalid stat string 999999999%",
    ];

    let mut nodes = HashMap::new();
    for i in 1..=node_count as u32 {
        let neighbors = (0..rng.range(5))
            .map(|_| rng.range(node_count + 5) as u32)
            .collect();
        let stats = (0..rng.range(4))
            .map(|_| stat_pool[rng.range(stat_pool.len())].to_string())
            .collect();

        nodes.insert(
            i,
            PassiveNode {
                id: i,
                name: format!("Node_{}", i),
                stats,
                is_keystone: rng.range(10) == 0,
                is_notable: rng.range(4) == 0,
                is_attribute_choice: rng.range(5) == 0,
                x: rng.f32_weird(),
                y: rng.f32_weird(),
                neighbors,
                icon: None,
            },
        );
    }

    PassiveTree {
        nodes,
        classes: vec![ClassStart {
            name: "FuzzClass".to_string(),
            start_node_id: 1,
        }],
        sprite_sheets: HashMap::new(),
    }
}

fn generate_fuzzed_gems(rng: &mut Rng, count: usize) -> HashMap<String, GemData> {
    let tag_pool = [
        "spell", "attack", "lightning", "fire", "cold", "chaos", "minion",
        "curse", "mark", "meta", "persistent", "warcry", "totem", "travel", "",
    ];
    let mut gems = HashMap::new();
    for i in 0..count {
        let id = format!("gem_{}", i);
        let tags = (0..rng.range(5))
            .map(|_| tag_pool[rng.range(tag_pool.len())].to_string())
            .collect();
        gems.insert(
            id.clone(),
            GemData {
                id,
                name: if rng.range(8) == 0 { String::new() } else { format!("Skill {}", i) },
                is_support: rng.range(4) == 0,
                tags,
                spirit_cost: rng.range(100) as u32,
                str_req_weight: rng.f32_weird(),
                dex_req_weight: rng.f32_weird(),
                int_req_weight: rng.f32_weird(),
            },
        );
    }
    gems
}

#[test]
fn fuzz_optimizer_and_solvers_never_panic() {
    let mut rng = Rng(0x5EED_2026);
    let weight_keys = ["dps", "life", "es", "crit", "speed", "minion", "unknown_key"];

    for iteration in 0..500 {
        let tree_size = rng.range(80);
        let tree = generate_fuzzed_tree(&mut rng, tree_size);
        let gem_count = rng.range(30);
        let gems = generate_fuzzed_gems(&mut rng, gem_count);

        let mut weights = HashMap::new();
        for k in &weight_keys {
            if rng.range(2) == 0 {
                weights.insert((*k).to_string(), rng.f32_weird());
            }
        }

        let start_id = rng.range(tree_size + 5) as u32;
        let max_points = if iteration % 25 == 0 { usize::MAX } else { rng.range(200) };

        let allocated = optimize_tree(&tree, start_id, max_points, &weights);

        let actives = get_active_skills(&gems);
        if let Some(first_active) = actives.first() {
            let recs = recommend_supports(&gems, &tree, &allocated, &first_active.id);
            assert!(!recs.is_empty(), "İterasyon {}: support önerisi boş döndü", iteration);
        }

        let req = BuildEvaluationRequest {
            allocated_ids: allocated,
            selected_skill_id: actives.first().map(|g| g.id.clone()),
            weapon_base_dps: rng.f32_weird() as f64,
            base_gem_level: (rng.range(40) as i32) - 5,
            bonus_skill_levels: (rng.range(30) as i32) - 5,
            gear_spirit: (rng.range(700) as i32) - 50,
            active_spirit_buffs: vec![SpiritBuffInput {
                id: "archmage".to_string(),
                name: "Archmage".to_string(),
                cost: 100,
                more_dps_pct: 35.0,
                required_tag: Some("spell".to_string()),
                inc_crit_chance: 0.0,
                inc_evasion_pct: 0.0,
                inc_es_pct: 0.0,
            }],
            active_ascendancy_nodes: vec![AscendancyNodeBonus {
                id: "asc_1".to_string(),
                name: "Test Asc".to_string(),
                more_dps_pct: 20.0,
                inc_crit_chance: 15.0,
                crit_damage_bonus: 25.0,
                inc_life_pct: 10.0,
                inc_es_pct: 10.0,
                inc_armour_pct: 0.0,
                inc_evasion_pct: 0.0,
                bonus_spirit: 30.0,
            }],
            supports: vec![SupportInput {
                name: "Considered Casting".to_string(),
                multiplier_pct: 35.0,
            }],
        };

        let eval = evaluate_build_snapshot(&req, &tree.nodes, &gems);
        assert!(!eval.effective_crit.is_nan(), "İterasyon {}: crit NaN döndü", iteration);
        assert!(eval.est_dps >= 0, "İterasyon {}: negatif DPS ({})", iteration, eval.est_dps);
        assert!(eval.effective_hp > 0, "İterasyon {}: geçersiz EHP ({})", iteration, eval.effective_hp);
    }
}