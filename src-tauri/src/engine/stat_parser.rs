use crate::updater::models::{GemData, PassiveNode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SupportInput {
    pub name: String,
    pub multiplier_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AscendancyNodeBonus {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub more_dps_pct: f64,
    #[serde(default)]
    pub inc_crit_chance: f64,
    #[serde(default)]
    pub crit_damage_bonus: f64,
    #[serde(default)]
    pub inc_life_pct: f64,
    #[serde(default)]
    pub inc_es_pct: f64,
    #[serde(default)]
    pub inc_armour_pct: f64,
    #[serde(default)]
    pub inc_evasion_pct: f64,
    #[serde(default)]
    pub bonus_spirit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiritBuffInput {
    pub id: String,
    pub name: String,
    pub cost: i32,
    #[serde(default)]
    pub more_dps_pct: f64,
    pub required_tag: Option<String>,
    #[serde(default)]
    pub inc_crit_chance: f64,
    #[serde(default)]
    pub inc_evasion_pct: f64,
    #[serde(default)]
    pub inc_es_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildEvaluationRequest {
    pub allocated_ids: Vec<u32>,
    pub selected_skill_id: Option<String>,
    pub weapon_base_dps: f64,
    pub base_gem_level: i32,
    pub bonus_skill_levels: i32,
    pub gear_spirit: i32,
    pub active_spirit_buffs: Vec<SpiritBuffInput>,
    pub active_ascendancy_nodes: Vec<AscendancyNodeBonus>,
    pub supports: Vec<SupportInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedStatsSummary {
    pub totals: HashMap<String, f64>,
    pub extra_damage_pct: HashMap<String, f64>,
    pub more_multipliers: Vec<f64>,
    pub raw_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildEvaluationResult {
    pub parsed: ParsedStatsSummary,
    pub points: usize,
    pub effective_hp: i64,
    pub total_life: i64,
    pub total_es: i64,
    pub total_armour: i64,
    pub total_evasion: i64,
    pub effective_crit: f64,
    pub total_crit_mult_pct: i64,
    pub est_dps: i64,
    pub max_spirit: i32,
    pub used_spirit: i32,
    pub remaining_spirit: i32,
    pub tree_and_asc_spirit: i32,
    pub support_more_pct: i64,
    pub support_count: usize,
    pub spirit_more_pct: i64,
    pub asc_more_pct: i64,
    pub effective_level: i32,
    pub bonus_level_gain_pct: i64,
}

pub fn parse_stat_lines(
    allocated_ids: &[u32],
    nodes: &HashMap<u32, PassiveNode>,
) -> ParsedStatsSummary {
    let mut summary = ParsedStatsSummary::default();

    for id in allocated_ids {
        let Some(node) = nodes.get(id) else {
            continue;
        };

        for raw_line in &node.stats {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }

            // 1. "Gain X% of ... as Extra Y Damage"
            if let Some((pct, elem)) = parse_extra_damage_line(line) {
                let elem_lower = elem.to_lowercase();
                *summary.extra_damage_pct.entry(elem_lower).or_insert(0.0) += pct;
                let label = format!("% of Damage as Extra {} Damage", elem);
                *summary.totals.entry(label).or_insert(0.0) += pct;
                continue;
            }

            // 2. Satır başı sayısal statlar (+X / X% increased / reduced / more / less)
            if let Some((val, is_pct, rest)) = parse_leading_stat(line) {
                let rest_lower = rest.to_lowercase();

                if is_pct && (rest_lower.contains(" more ") || rest_lower.ends_with(" more")) {
                    summary.more_multipliers.push(1.0 + val / 100.0);
                    summary.raw_lines.push(line.to_string());
                    continue;
                }

                if is_pct && (rest_lower.contains(" less ") || rest_lower.ends_with(" less")) {
                    summary.more_multipliers.push((1.0 - val / 100.0).max(0.0));
                    summary.raw_lines.push(line.to_string());
                    continue;
                }

                if is_pct && (rest_lower.contains("reduced") || rest_lower.contains("less")) {
                    let normalized = replace_reduced_case_insensitive(rest);
                    let label = format!("% {}", normalized);
                    *summary.totals.entry(label).or_insert(0.0) -= val.abs();
                } else {
                    let label = if is_pct {
                        format!("% {}", rest)
                    } else {
                        rest.to_string()
                    };
                    *summary.totals.entry(label).or_insert(0.0) += val;
                }
            } else {
                summary.raw_lines.push(line.to_string());
            }
        }
    }

    summary
}

pub fn evaluate_build_snapshot(
    req: &BuildEvaluationRequest,
    nodes: &HashMap<u32, PassiveNode>,
    gems: &HashMap<String, GemData>,
) -> BuildEvaluationResult {
    let parsed = parse_stat_lines(&req.allocated_ids, nodes);

    let skill_tags: Vec<String> = req
        .selected_skill_id
        .as_ref()
        .and_then(|sid| gems.get(sid))
        .map(|g| g.tags.iter().map(|t| t.to_lowercase()).collect())
        .unwrap_or_default();

    let mut inc_life = 0.0;
    let mut flat_life = 0.0;
    let mut inc_es = 0.0;
    let mut flat_es = 0.0;
    let mut inc_armour = 0.0;
    let mut inc_evasion = 0.0;
    let mut inc_crit_chance = 0.0;
    let mut crit_damage_bonus = 0.0;
    let mut all_attr = 0.0;
    let mut tree_spirit = 0.0;
    let mut inc_damage = 0.0;
    let mut inc_speed = 0.0;

    for (label, &val) in &parsed.totals {
        let l = label.to_lowercase();

        if l.contains("to any attribute") || l.contains("to all attributes") {
            all_attr += val;
        }
        if l.contains("to maximum life") && !l.starts_with('%') {
            flat_life += val;
        }
        if l.contains("increased maximum life") {
            inc_life += val;
        }
        if l.contains("to maximum energy shield") && !l.starts_with('%') {
            flat_es += val;
        }
        if l.contains("increased maximum energy shield") || l.contains("increased energy shield") {
            inc_es += val;
        }
        if l.contains("increased armour") {
            inc_armour += val;
        }
        if l.contains("increased evasion") {
            inc_evasion += val;
        }
        if l.contains("critical hit chance") {
            inc_crit_chance += val;
        }
        if l.contains("critical damage bonus") {
            crit_damage_bonus += val;
        }
        if l.contains("to maximum spirit") || l == "to spirit" {
            tree_spirit += val;
        }

        if l.starts_with('%') {
            if l.contains("speed") {
                inc_speed += val;
            } else if l.contains("damage")
                && !l.contains("taken")
                && !l.contains("bonus")
                && !l.contains("as extra")
            {
                let is_generic = l == "% increased damage"
                    || l == "% increased attack damage"
                    || l == "% increased spell damage";
                let matches_tag = skill_tags.iter().any(|tag| l.contains(tag));
                if is_generic || matches_tag {
                    inc_damage += val;
                }
            }
        }
    }

    let total_extra_pct: f64 = parsed.extra_damage_pct.values().sum();
    let extra_damage_factor = 1.0 + total_extra_pct.max(0.0) / 100.0;
    let tree_more_factor: f64 = parsed.more_multipliers.iter().product();

    // Ascendancy (maksimum 4 major notable)
    let mut asc_dps_factor = 1.0;
    let mut asc_spirit = 0.0;
    for node in req.active_ascendancy_nodes.iter().take(4) {
        inc_life += node.inc_life_pct;
        inc_es += node.inc_es_pct;
        inc_armour += node.inc_armour_pct;
        inc_evasion += node.inc_evasion_pct;
        inc_crit_chance += node.inc_crit_chance;
        crit_damage_bonus += node.crit_damage_bonus;
        asc_spirit += node.bonus_spirit;
        if node.more_dps_pct != 0.0 {
            asc_dps_factor *= 1.0 + node.more_dps_pct / 100.0;
        }
    }

    // Spirit Buff / Herald / Aura
    let mut spirit_dps_factor = 1.0;
    let mut used_spirit = 0;
    for sb in &req.active_spirit_buffs {
        used_spirit += sb.cost;
        inc_crit_chance += sb.inc_crit_chance;
        inc_evasion += sb.inc_evasion_pct;
        inc_es += sb.inc_es_pct;
        if sb.more_dps_pct != 0.0 {
            let tag_matches = match &sb.required_tag {
                None => true,
                Some(req_tag) => {
                    skill_tags.is_empty() || skill_tags.iter().any(|t| t == &req_tag.to_lowercase())
                }
            };
            let effective_pct = if tag_matches {
                sb.more_dps_pct
            } else {
                (sb.more_dps_pct * 0.4).round()
            };
            spirit_dps_factor *= 1.0 + effective_pct / 100.0;
        }
    }

    // İlk 5 Support Gem
    let top_five: Vec<&SupportInput> = req.supports.iter().take(5).collect();
    let support_factor: f64 = top_five
        .iter()
        .map(|s| 1.0 + s.multiplier_pct / 100.0)
        .product();

    for sup in &top_five {
        let lower_name = sup.name.to_lowercase();
        if lower_name.contains("inevitable critical") {
            inc_crit_chance += 80.0;
        }
        if lower_name.contains("supercritical") {
            crit_damage_bonus += 45.0;
        }
    }

    let total_life = ((1150.0 + flat_life + all_attr * 2.0) * (1.0 + inc_life.max(0.0) / 100.0)).round() as i64;
    let total_es = ((450.0 + flat_es) * (1.0 + inc_es.max(0.0) / 100.0)).round() as i64;
    let total_armour = (1800.0 * (1.0 + inc_armour.max(0.0) / 100.0)).round() as i64;
    let total_evasion = (1800.0 * (1.0 + inc_evasion.max(0.0) / 100.0)).round() as i64;

    let phys_mit = (total_armour as f64) / ((total_armour as f64) + 8000.0);
    let evade_mit = ((total_evasion as f64) / ((total_evasion as f64) + 3500.0)).min(0.55);
    let effective_hp = (((total_life + total_es) as f64)
        / (1.0 - phys_mit * 0.6 - evade_mit * 0.45).max(0.25))
        .round() as i64;

    let effective_crit = (8.0 * (1.0 + inc_crit_chance / 100.0)).clamp(1.0, 100.0);
    let crit_mult_pct = 100.0 + crit_damage_bonus;
    let crit_factor = 1.0 + (effective_crit / 100.0) * (crit_mult_pct.max(0.0) / 100.0);

    let safe_gem_lvl = req.base_gem_level.clamp(1, 21);
    let safe_bonus_lvl = req.bonus_skill_levels.clamp(0, 15);
    let safe_weapon_dps = req.weapon_base_dps.clamp(1.0, 25000.0);

    let eff_level = safe_gem_lvl + safe_bonus_lvl;
    let level_factor = 1.115_f64.powi((eff_level - 1).max(0));
    let bonus_level_gain_pct = ((1.115_f64.powi(safe_bonus_lvl) - 1.0) * 100.0).round() as i64;

    let tree_factor = (1.0 + inc_damage.max(0.0) / 100.0)
        * (1.0 + inc_speed.max(0.0) / 100.0)
        * extra_damage_factor
        * tree_more_factor;

    let est_dps = (safe_weapon_dps
        * level_factor
        * tree_factor
        * support_factor
        * spirit_dps_factor
        * asc_dps_factor
        * crit_factor)
        .round() as i64;

    let tree_and_asc_spirit = (tree_spirit + asc_spirit).round() as i32;
    let max_spirit = 100 + req.gear_spirit.clamp(0, 500) + tree_and_asc_spirit;

    BuildEvaluationResult {
        parsed,
        points: req.allocated_ids.len(),
        effective_hp,
        total_life,
        total_es,
        total_armour,
        total_evasion,
        effective_crit: (effective_crit * 10.0).round() / 10.0,
        total_crit_mult_pct: crit_mult_pct.round() as i64,
        est_dps,
        max_spirit,
        used_spirit,
        remaining_spirit: max_spirit - used_spirit,
        tree_and_asc_spirit,
        support_more_pct: ((support_factor - 1.0) * 100.0).round() as i64,
        support_count: top_five.len(),
        spirit_more_pct: ((spirit_dps_factor - 1.0) * 100.0).round() as i64,
        asc_more_pct: ((asc_dps_factor - 1.0) * 100.0).round() as i64,
        effective_level: eff_level,
        bonus_level_gain_pct,
    }
}

fn parse_leading_stat(line: &str) -> Option<(f64, bool, &str)> {
    let bytes = line.as_bytes();
    let mut idx = 0;

    if idx < bytes.len() && (bytes[idx] == b'+' || bytes[idx] == b'-') {
        idx += 1;
    }

    let num_start = 0;
    let mut has_digit = false;
    let mut has_dot = false;

    while idx < bytes.len() {
        let b = bytes[idx];
        if b.is_ascii_digit() {
            has_digit = true;
            idx += 1;
        } else if b == b'.' && !has_dot {
            has_dot = true;
            idx += 1;
        } else {
            break;
        }
    }

    if !has_digit {
        return None;
    }

    let val: f64 = line[num_start..idx].parse().ok()?;
    let mut rest = &line[idx..];
    let is_pct = if let Some(stripped) = rest.strip_prefix('%') {
        rest = stripped;
        true
    } else {
        false
    };

    let rest_trimmed = rest.trim();
    if rest_trimmed.is_empty() {
        return None;
    }

    Some((val, is_pct, rest_trimmed))
}

fn parse_extra_damage_line(line: &str) -> Option<(f64, String)> {
    let rest = line.strip_prefix("Gain ")?;
    let pct_pos = rest.find('%')?;
    let pct: f64 = rest[..pct_pos].trim().parse().ok()?;
    let after_pct = &rest[pct_pos + 1..];
    let marker = " as Extra ";
    let extra_pos = after_pct.find(marker)?;
    let after_extra = &after_pct[extra_pos + marker.len()..];
    let dmg_pos = after_extra.find(" Damage")?;
    let elem = after_extra[..dmg_pos].trim();
    if elem.is_empty() {
        return None;
    }
    Some((pct, elem.to_string()))
}

fn replace_reduced_case_insensitive(text: &str) -> String {
    text.split_whitespace()
        .map(|w| {
            if w.eq_ignore_ascii_case("reduced") {
                "increased"
            } else {
                w
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}