use crate::updater::models::{GemData, PassiveTree};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportRecommendation {
    pub id: String,
    pub name: String,
    pub multiplier_pct: f32,
    pub match_score_pct: u32,
    pub matched_tags: Vec<String>,
    pub reason: String,
}

pub fn get_active_skills(gems: &HashMap<String, GemData>) -> Vec<GemData> {
    let mut actives: Vec<GemData> = gems
        .values()
        .filter(|g| !g.is_support && !g.name.is_empty())
        .filter(|g| {
            let lower = g.name.to_lowercase();
            let has_support_tag = g.tags.iter().any(|t| t.eq_ignore_ascii_case("support"));
            !has_support_tag
                && !g.tags.is_empty()
                && !lower.contains("vaal ")
                && !lower.contains("playtest")
                && !lower.contains("test")
                && !lower.contains("[unused]")
                && !lower.starts_with("default ")
        })
        .cloned()
        .collect();

    if actives.is_empty() {
        let fallback = [
            ("Spark", vec!["spell", "projectile", "lightning"], 0.0, 0.0, 1.0),
            ("Lightning Arrow", vec!["attack", "projectile", "lightning", "bow"], 0.0, 1.0, 0.0),
            ("Arc", vec!["spell", "lightning", "chaining"], 0.0, 0.0, 1.0),
            ("Fireball", vec!["spell", "projectile", "fire", "area"], 0.0, 0.0, 1.0),
            ("Ice Nova", vec!["spell", "cold", "area", "nova"], 0.0, 0.0, 1.0),
            ("Skeletal Sniper", vec!["minion", "projectile", "physical"], 0.0, 0.3, 0.7),
            ("Galvanic Shards", vec!["attack", "projectile", "lightning", "crossbow"], 0.4, 0.6, 0.0),
            ("Tempest Flurry", vec!["attack", "melee", "lightning", "quarterstaff"], 0.0, 0.5, 0.5),
        ];

        for (name, tags, str_w, dex_w, int_w) in fallback {
            actives.push(GemData {
                id: name.to_lowercase().replace(' ', "_"),
                name: name.to_string(),
                is_support: false,
                tags: tags.into_iter().map(String::from).collect(),
                spirit_cost: 0,
                str_req_weight: str_w,
                dex_req_weight: dex_w,
                int_req_weight: int_w,
            });
        }
    }

    actives.sort_by(|a, b| a.name.cmp(&b.name));
    actives.dedup_by(|a, b| a.name == b.name);
    actives
}

pub fn recommend_supports(
    gems: &HashMap<String, GemData>,
    tree: &PassiveTree,
    allocated_ids: &[u32],
    active_skill_id: &str,
) -> Vec<SupportRecommendation> {
    // Ön yüzdeki tüm aktif yetenekleri (etiketi boş olan Ascendancy/özel yetenekler dahil) bul
    let fallback_list;
    let active = if let Some(found) = gems.get(active_skill_id).or_else(|| {
        gems.values()
            .find(|g| !g.is_support && g.name.eq_ignore_ascii_case(active_skill_id))
    }) {
        found
    } else {
        fallback_list = get_active_skills(gems);
        let Some(fb) = fallback_list
            .iter()
            .find(|g| g.id == active_skill_id || g.name.eq_ignore_ascii_case(active_skill_id))
        else {
            return vec![];
        };
        fb
    };

    let active_tags: HashSet<String> = active.tags.iter().map(|t| t.to_lowercase()).collect();

    // Ağaçtaki baskın stat temalarını çıkar
    let mut tree_keywords: HashMap<&str, f32> = HashMap::new();
    for id in allocated_ids {
        if let Some(node) = tree.nodes.get(id) {
            for stat in &node.stats {
                let l = stat.to_lowercase();
                for kw in [
                    "lightning",
                    "fire",
                    "cold",
                    "physical",
                    "chaos",
                    "critical",
                    "shock",
                    "ignite",
                    "minion",
                    "area",
                    "projectile",
                    "speed",
                    "duration",
                    "curse",
                    "warcry",
                    "totem",
                ] {
                    if l.contains(kw) {
                        *tree_keywords.entry(kw).or_insert(0.0) += 1.0;
                    }
                }
            }
        }
    }

    // (İsim, Gerekli Etiketler, Yasaklı Etiket, Taban Çarpan %, Çakışma Grubu, Açıklama)
    let support_catalog: Vec<(&str, Vec<&str>, Option<&str>, f32, Option<&str>, &str)> = vec![
        // Doğrudan Hasar & Saldırı/Büyü Çarpanları
        ("Considered Casting", vec!["spell"], None, 35.0, None, "Spell More Damage çarpanı sağlar"),
        ("Concentrated Effect", vec!["area"], None, 34.0, None, "Alan yeteneklerine yüksek More Area Damage verir"),
        ("Brutality", vec!["physical"], None, 33.0, Some("dmg_type"), "Saf Fiziksel More Damage (Element hasarını kapatır)"),
        ("Lightning Penetration", vec!["lightning"], None, 32.0, None, "Düşman Lightning direncini deler"),
        ("Fire Penetration", vec!["fire"], None, 32.0, None, "Düşman Fire direncini deler"),
        ("Cold Penetration", vec!["cold"], None, 32.0, None, "Düşman Cold direncini deler"),
        ("Elemental Focus", vec!["lightning", "fire", "cold", "elemental"], None, 31.0, Some("dmg_type"), "Saf Elemental More Damage (Ailment uygulamaz)"),
        ("Heavy Swing", vec!["melee"], Some("projectile"), 30.0, None, "Sadece Melee vuruşların fiziksel hasarını artırır"),
        ("Supercritical", vec!["spell", "attack"], None, 30.0, None, "Critical Damage Bonus çarpanını yükseltir"),
        ("Immolate", vec!["fire"], None, 29.0, Some("ailment"), "Ignite olmuş düşmanlara ekstra Fire hasarı ekler"),
        ("Primal Armament", vec!["attack"], None, 28.0, Some("dmg_type"), "Silah Elemental hasarını çarpar"),
        ("Minion Mastery", vec!["minion"], None, 28.0, None, "Minion seviyesi ve toplam hasarını artırır"),
        ("Inevitable Critical", vec!["spell", "attack"], None, 27.0, None, "Critical Hit şansını katlar"),
        ("Scattershot", vec!["projectile"], None, 26.0, None, "Ekstra mermi (Projectile) ile çoklu vuruş sağlar"),
        ("Feeding Frenzy", vec!["minion"], None, 26.0, None, "Minion saldırı hızı ve agresifliğini artırır"),
        ("Arcane Tempo", vec!["spell"], None, 25.0, None, "More Cast Speed ile saniyelik hasarı artırır"),
        ("Martial Tempo", vec!["attack"], None, 25.0, None, "More Attack Speed ile DPS çarpanı sağlar"),
        ("Conduction", vec!["lightning"], None, 24.0, Some("ailment"), "Shock uygulama şansını ve süresini artırır"),
        ("Magnified Effect", vec!["area", "aura", "curse", "warcry"], None, 24.0, None, "Alan (AoE) yarıçapını ve etki menzilini artırır"),
        ("Fork", vec!["projectile"], None, 22.0, None, "Mermilerin çarpınca ikiye ayrılmasını sağlar"),

        // Chaos, Duration, Curse, Mark & Totem Destekleri
        ("Withering Touch", vec!["chaos"], None, 27.0, None, "Chaos vuruşlarında Withered yükü biriktirir"),
        ("Comorbidity", vec!["chaos"], None, 25.0, None, "Chaos ve Poison etkilerinin süresini ve hasarını artırır"),
        ("Persistence", vec!["duration", "curse", "mark", "guard", "totem", "banner"], Some("persistent"), 26.0, Some("duration_mod"), "Yeteneğin aktif kalma süresini uzatır"),
        ("Fast Forward", vec!["duration", "curse", "mark"], Some("persistent"), 24.0, Some("duration_mod"), "Süre bazlı etkilerin daha hızlı tetiklenmesini sağlar"),
        ("Heightened Curse", vec!["curse"], None, 28.0, None, "Curse etkisinin düşman üzerindeki gücünü artırır"),
        ("Ritualistic Curse", vec!["curse"], None, 24.0, None, "Curse alanını ve uygulama hızını iyileştirir"),
        ("Focused Curse", vec!["curse", "mark"], None, 25.0, None, "Curse ve Mark aktivasyon gecikmesini azaltır"),
        ("Overabundance", vec!["totem"], None, 29.0, None, "Maksimum aktif Totem sınırını +1 artırır"),
        ("Ancestral Urgency", vec!["totem"], None, 25.0, None, "Totem yerleştirme hızını ciddi oranda artırır"),

        // Persistent Buff, Aura, Herald & Spirit Destekleri
        ("Cannibalism", vec!["persistent", "buff", "aura", "herald"], None, 24.0, None, "Düşman öldürünce anında Life yenilemesi sağlar"),
        ("Vitality", vec!["persistent", "buff", "aura"], None, 22.0, None, "Saniyelik sabit Life yenilenmesi kazandırır"),
        ("Clarity", vec!["persistent", "buff", "aura"], None, 22.0, None, "Mana yenilenme hızını artırır"),
        ("Precision", vec!["persistent", "buff", "aura"], None, 23.0, None, "Accuracy ve Critical Hit şansını yükseltir"),
        ("Herbalism", vec!["persistent", "buff", "aura"], None, 21.0, None, "Life Flask iyileştirme miktarını artırır"),
        ("Mysticism", vec!["persistent", "buff", "aura"], None, 21.0, None, "Energy Shield ve Mana kapasitesiyle sinerji sağlar"),

        // Meta, Trigger, Warcry, Guard, Channeling & Travel Destekleri
        ("Impetus", vec!["meta", "trigger"], None, 30.0, None, "Meta yeteneklerin Energy kazanım hızını artırır"),
        ("Energy Retention", vec!["meta", "trigger"], None, 27.0, None, "Tetikleme sonrası harcanan Energy'nin bir kısmını korur"),
        ("Boundless Energy", vec!["meta", "trigger"], None, 26.0, None, "Maksimum Energy kapasitesini ve tetikleme sıklığını artırır"),
        ("Raging Cry", vec!["warcry"], None, 28.0, None, "Warcry güçlendirmesini ve hasar bonusunu artırır"),
        ("Corrupting Cry", vec!["warcry"], None, 25.0, None, "Warcry alanındaki düşmanlara fiziksel/kaos zayıflatması uygular"),
        ("Second Wind", vec!["travel", "movement", "warcry", "guard", "banner"], None, 24.0, None, "Cooldown recovery hızını artırır ve ekstra kullanım hakkı verir"),
        ("Momentum", vec!["travel", "movement", "channeling"], None, 24.0, None, "Hareket veya odaklanma sonrası saldırı/büyü hızı verir"),
        ("Unbreakable", vec!["channeling", "guard", "slam"], None, 25.0, None, "Yetenek kullanımı sırasında Stun direncini artırır"),
        ("Inspiration", vec!["spell", "attack", "warcry", "curse", "mark", "totem", "travel"], None, 20.0, None, "Yeteneğin Mana maliyetini düşürür"),
        ("Ingenuity", vec!["duration", "warcry", "guard", "banner", "travel", "movement"], None, 21.0, None, "Bekleme süresi (Cooldown) toparlanma hızını artırır"),
    ];

    let mut candidates: Vec<(SupportRecommendation, Option<&str>)> = Vec::new();

    for (name, req_tags, forbid_tag, base_mult, conflict_group, desc) in &support_catalog {
        if let Some(forbid) = forbid_tag {
            if active_tags.contains(*forbid) {
                continue;
            }
        }

        let matched: Vec<String> = req_tags
            .iter()
            .filter(|&&t| {
                active_tags.contains(t)
                    || (t == "elemental"
                        && (active_tags.contains("lightning")
                            || active_tags.contains("fire")
                            || active_tags.contains("cold")))
            })
            .map(|&s| s.to_string())
            .collect();

        if matched.is_empty() {
            continue;
        }

        let mut mult = *base_mult;
        let mut reason = (*desc).to_string();

        let mut score_pct: f32 = 62.0 + (matched.len() as f32 * 6.0) + ((*base_mult - 20.0) * 0.8);

        let lower_name = name.to_lowercase();
        if lower_name.contains("critical") {
            if let Some(&crit_nodes) = tree_keywords.get("critical") {
                if crit_nodes > 0.0 {
                    mult += (crit_nodes * 0.6).min(8.0);
                    score_pct += (crit_nodes * 2.5).min(18.0);
                    reason = format!("{} (Ağaçtaki Critical build ile yüksek sinerji)", desc);
                }
            }
        }

        for tag in &matched {
            if let Some(&count) = tree_keywords.get(tag.as_str()) {
                if count > 0.0 {
                    mult += (count * 0.5).min(7.0);
                    score_pct += (count * 2.0).min(15.0);
                    if !reason.contains("sinerji") {
                        reason = format!("{} (Ağaçtaki {} düğümleriyle sinerjili)", desc, tag);
                    }
                    break;
                }
            }
        }

        let clamped_score = score_pct.round().clamp(50.0, 99.0) as u32;

        candidates.push((
            SupportRecommendation {
                id: name.to_lowercase().replace(' ', "_"),
                name: format!("{} Support", name),
                multiplier_pct: (mult * 10.0).round() / 10.0,
                match_score_pct: clamped_score,
                matched_tags: matched,
                reason,
            },
            *conflict_group,
        ));
    }

    // Etiketsiz veya özel etiketli aktif yetenekler için boş liste dönmesini önleyen genel fayda yedeği
    if candidates.is_empty() {
        let fallback_tag = active
            .tags
            .first()
            .cloned()
            .unwrap_or_else(|| "utility".to_string());

        candidates.push((
            SupportRecommendation {
                id: "inspiration".to_string(),
                name: "Inspiration Support".to_string(),
                multiplier_pct: 20.0,
                match_score_pct: 64,
                matched_tags: vec![fallback_tag.clone()],
                reason: "Yeteneğin kaynak (Mana/Maliyet) tüketimini azaltır".to_string(),
            },
            None,
        ));
        candidates.push((
            SupportRecommendation {
                id: "ingenuity".to_string(),
                name: "Ingenuity Support".to_string(),
                multiplier_pct: 21.0,
                match_score_pct: 62,
                matched_tags: vec![fallback_tag],
                reason: "Yeteneğin bekleme süresi ve kullanım akıcılığını iyileştirir".to_string(),
            },
            None,
        ));
    }

    candidates.sort_by(|a, b| {
        b.0.match_score_pct
            .cmp(&a.0.match_score_pct)
            .then_with(|| {
                b.0.multiplier_pct
                    .partial_cmp(&a.0.multiplier_pct)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let mut used_groups: HashSet<&str> = HashSet::new();
    let mut final_list: Vec<SupportRecommendation> = Vec::new();

    for (rec, group_opt) in candidates {
        if let Some(grp) = group_opt {
            if used_groups.contains(grp) {
                continue;
            }
            used_groups.insert(grp);
        }
        final_list.push(rec);
        if final_list.len() >= 6 {
            break;
        }
    }

    final_list
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::models::PassiveNode;

    fn make_gem(id: &str, name: &str, tags: &[&str]) -> (String, GemData) {
        (
            id.to_string(),
            GemData {
                id: id.to_string(),
                name: name.to_string(),
                is_support: false,
                tags: tags.iter().map(|s| s.to_string()).collect(),
                spirit_cost: 0,
                str_req_weight: 0.3,
                dex_req_weight: 0.3,
                int_req_weight: 0.4,
            },
        )
    }

    fn dummy_tree() -> PassiveTree {
        let mut nodes = HashMap::new();
        nodes.insert(
            1,
            PassiveNode {
                id: 1,
                name: "Test Node".to_string(),
                stats: vec![
                    "+15% increased Critical Hit Chance".to_string(),
                    "+10% increased Chaos Damage".to_string(),
                    "+12% increased Skill Effect Duration".to_string(),
                ],
                is_keystone: false,
                is_notable: true,
                is_attribute_choice: false,
                x: 0.0,
                y: 0.0,
                neighbors: vec![],
                icon: None,
            },
        );
        PassiveTree {
            nodes,
            classes: vec![],
            sprite_sheets: HashMap::new(),
        }
    }

    #[test]
    fn all_archetypes_and_untagged_skills_return_recommendations() {
        let test_cases = vec![
            make_gem("spark", "Spark", &["spell", "projectile", "lightning"]),
            make_gem("despair", "Despair", &["curse", "chaos", "area", "duration"]),
            make_gem("snipers_mark", "Sniper's Mark", &["mark", "duration"]),
            make_gem("grim_feast", "Grim Feast", &["persistent", "buff"]),
            make_gem("archmage", "Archmage", &["persistent", "buff", "lightning"]),
            make_gem("cast_on_freeze", "Cast on Freeze", &["meta", "trigger", "persistent"]),
            make_gem("infernal_cry", "Infernal Cry", &["warcry", "area", "fire", "duration"]),
            make_gem("blink", "Blink", &["travel", "movement", "duration"]),
            make_gem("shield_wall", "Shield Wall", &["guard", "duration"]),
            make_gem("ancestral_warrior_totem", "Ancestral Warrior Totem", &["totem", "melee", "duration"]),
            make_gem("war_banner", "War Banner", &["banner", "area", "duration"]),
            make_gem("contagion", "Contagion", &["spell", "chaos", "area", "duration"]),
            make_gem("abyssal_apparition", "Abyssal Apparition", &[]),
        ];

        let gems: HashMap<String, GemData> = test_cases.into_iter().collect();
        let tree = dummy_tree();

        for skill in gems.values() {
            let recs = recommend_supports(&gems, &tree, &[1], &skill.id);
            assert!(
                !recs.is_empty(),
                "Aktif yetenek için support önerisi boş döndü: {} (tags: {:?})",
                skill.name,
                skill.tags
            );
            assert!(recs.len() <= 6);
            for r in &recs {
                assert!((50..=99).contains(&r.match_score_pct));
            }
        }
    }

    #[test]
    fn fallback_skills_also_return_recommendations() {
        let empty_gems = HashMap::new();
        let tree = dummy_tree();
        let actives = get_active_skills(&empty_gems);

        for skill in &actives {
            let recs = recommend_supports(&empty_gems, &tree, &[1], &skill.id);
            assert!(
                !recs.is_empty(),
                "Fallback yetenek boş öneri döndürdü: {}",
                skill.name
            );
        }
    }
}