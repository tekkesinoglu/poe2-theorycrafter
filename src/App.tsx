import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PassiveNode, SkillTreeCanvas } from './components/SkillTreeCanvas';

interface ClassStart {
  name: string;
  start_node_id: number;
}

interface GemData {
  id: string;
  name: string;
  is_support: boolean;
  tags: string[];
  spirit_cost: number;
}

interface SupportRecommendation {
  id: string;
  name: string;
  multiplier_pct: number;
  match_score_pct: number;
  matched_tags: string[];
  reason: string;
}

interface StatWeightItem {
  stat: string;
  weight: number;
}

interface SpiritBuffDef {
  id: string;
  name: string;
  cost: number;
  category: 'Herald' | 'Meta' | 'Aura / Buff';
  effectLabel: string;
  moreDpsPct?: number;
  requiredTag?: string;
  incCritChance?: number;
  incEvasionPct?: number;
  incEsPct?: number;
}

interface AscendancyNodeDef {
  id: string;
  name: string;
  desc: string;
  moreDpsPct?: number;
  incCritChance?: number;
  critDamageBonus?: number;
  incLifePct?: number;
  incEsPct?: number;
  incArmourPct?: number;
  incEvasionPct?: number;
  bonusSpirit?: number;
}

interface AscendancyDef {
  id: string;
  name: string;
  baseClass: string;
  nodes: AscendancyNodeDef[];
}

interface SavedBuild {
  id: string;
  name: string;
  createdAt: string;
  startNodeId: number;
  allocatedIds: number[];
  targetStat: string;
  statWeights?: StatWeightItem[];
  maxPoints: number;
  selectedSkillId: string;
  weaponBaseDps: number;
  baseGemLevel: number;
  bonusSkillLevels: number;
  gearSpirit?: number;
  activeSpiritIds?: string[];
  ascendancyId?: string;
  ascendancyNodeIds?: string[];
}

const STORAGE_KEY = 'poe2_theorycrafter_saved_builds_v1';

const LIMITS = {
  maxPoints: { min: 1, max: 128 },
  weaponBaseDps: { min: 1, max: 25000 },
  baseGemLevel: { min: 1, max: 21 },
  bonusSkillLevels: { min: 0, max: 15 },
  gearSpirit: { min: 0, max: 500 },
  maxAscendancyNodes: 4,
} as const;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

const ASCENDANCIES: AscendancyDef[] = [
  // MERCENARY
  {
    id: 'witchhunter',
    name: 'Witchhunter',
    baseClass: 'Mercenary',
    nodes: [
      { id: 'wh_pitiless', name: 'Pitiless Killer (Culling Strike)', desc: '+18% More DPS & Culling Strike', moreDpsPct: 18 },
      { id: 'wh_judge', name: 'Judge, Jury and Executioner', desc: '+22% More Hasar (Decimating Strike)', moreDpsPct: 22 },
      { id: 'wh_zealous', name: 'Zealous Inquisition', desc: '+15% More Alan/Patlama DPS', moreDpsPct: 15 },
      { id: 'wh_sorcery', name: 'Sorcery Ward', desc: '+35% Armour & Evasion (Elemental Kalkan)', incArmourPct: 35, incEvasionPct: 35 },
      { id: 'wh_obsessive', name: 'Obsessive Rituals', desc: '+25% Energy Shield & +20 Spirit', incEsPct: 25, bonusSpirit: 20 },
      { id: 'wh_weapon_master', name: 'Weapon Master', desc: '+25% Crit Şansı & +30% Crit Hasarı', incCritChance: 25, critDamageBonus: 30 },
    ],
  },
  {
    id: 'gemling',
    name: 'Gemling Legionnaire',
    baseClass: 'Mercenary',
    nodes: [
      { id: 'gl_cryst', name: 'Crystalline Potential', desc: '+16% More Gem Kalite Çarpanı', moreDpsPct: 16 },
      { id: 'gl_implanted', name: 'Implanted Gems (+1 All Skills)', desc: '+15% More Yetenek Hasarı', moreDpsPct: 15 },
      { id: 'gl_thaum', name: 'Thaumaturgical Infusion', desc: '+20% Maximum Life & +20% ES', incLifePct: 20, incEsPct: 20 },
      { id: 'gl_adaptive', name: 'Adaptive Capability', desc: '+30% Armour & +30% Evasion', incArmourPct: 30, incEvasionPct: 30 },
      { id: 'gl_enhanced', name: 'Enhanced Effectiveness', desc: '+35% Crit Şansı', incCritChance: 35 },
      { id: 'gl_integrated', name: 'Integrated Efficiency', desc: '+14% More DPS & +25 Spirit', moreDpsPct: 14, bonusSpirit: 25 },
    ],
  },
  // MONK
  {
    id: 'invoker',
    name: 'Invoker',
    baseClass: 'Monk',
    nodes: [
      { id: 'inv_grace', name: 'Lead me through Grace...', desc: 'Evasion/ES üzerinden +60 Bonus Spirit', bonusSpirit: 60 },
      { id: 'inv_expression', name: '...and Protect me from Harm', desc: '+45% Armour & +35% Evasion', incArmourPct: 45, incEvasionPct: 35 },
      { id: 'inv_unbound', name: 'Unbound Avatar', desc: '+28% More Elemental DPS', moreDpsPct: 28 },
      { id: 'inv_sunder', name: 'Sunder my Enemies...', desc: 'Crit ile Direnç Yoksayma (+30% Crit Şansı)', incCritChance: 30 },
      { id: 'inv_scatter', name: '...and Scatter Them to the Winds', desc: '+18% More Elemental Tetikleme DPS', moreDpsPct: 18 },
      { id: 'inv_faith', name: 'Faith is a Choice', desc: '+35% Maximum Energy Shield', incEsPct: 35 },
    ],
  },
  {
    id: 'acolyte_chayula',
    name: 'Acolyte of Chayula',
    baseClass: 'Monk',
    nodes: [
      { id: 'ac_reality', name: 'Reality Rending', desc: '+25% More Extra Chaos Hasarı', moreDpsPct: 25 },
      { id: 'ac_embrace', name: 'Embrace the Darkness', desc: '+40% Maximum Energy Shield & +20% Life', incEsPct: 40, incLifePct: 20 },
      { id: 'ac_grasp', name: 'Grasp of the Void', desc: '+20% More Chaos DPS', moreDpsPct: 20 },
      { id: 'ac_cons', name: 'Consuming Questions', desc: '+30% Energy Shield & +30% Evasion', incEsPct: 30, incEvasionPct: 30 },
      { id: 'ac_waking', name: 'Waking Dream', desc: '+40% Crit Hasarı & +20% Crit Şansı', critDamageBonus: 40, incCritChance: 20 },
      { id: 'ac_lucidity', name: 'Lucidity', desc: '+30 Spirit & +25% Evasion', bonusSpirit: 30, incEvasionPct: 25 },
    ],
  },
  // SORCERESS
  {
    id: 'stormweaver',
    name: 'Stormweaver',
    baseClass: 'Sorceress',
    nodes: [
      { id: 'sw_scouring', name: 'Scouring Winds', desc: '+20% More Elemental Exposure DPS', moreDpsPct: 20 },
      { id: 'sw_tempest', name: 'Tempest Caller', desc: '+24% More Elemental Storm DPS', moreDpsPct: 24 },
      { id: 'sw_strike_twice', name: 'Strike Twice (Double Shock)', desc: '+22% More Shock Hasar Çarpanı', moreDpsPct: 22 },
      { id: 'sw_force_will', name: 'Force of Will', desc: '+40% Maximum Energy Shield', incEsPct: 40 },
      { id: 'sw_constant_gale', name: 'Constant Gale', desc: '+15% More Cast/Arcane Surge DPS', moreDpsPct: 15 },
      { id: 'sw_heart_storm', name: 'Heart of the Storm', desc: '+30% Energy Shield & +25 Spirit', incEsPct: 30, bonusSpirit: 25 },
    ],
  },
  {
    id: 'chronomancer',
    name: 'Chronomancer',
    baseClass: 'Sorceress',
    nodes: [
      { id: 'ch_time_snap', name: 'Time Snap', desc: '+22% More Cooldown Reset DPS', moreDpsPct: 22 },
      { id: 'ch_unleash', name: 'Unleash', desc: '+25% More Tekrarlanan Büyü DPS', moreDpsPct: 25 },
      { id: 'ch_apex', name: 'Apex of the Moment', desc: '+35% Evasion & Yavaşlatma Savunması', incEvasionPct: 35 },
      { id: 'ch_quicksand', name: 'Quicksand Hourglass', desc: '+35% Crit Şansı & +35% Crit Hasarı', incCritChance: 35, critDamageBonus: 35 },
      { id: 'ch_ultimate', name: 'Ultimate Command', desc: '+30% Energy Shield & +15% Life', incEsPct: 30, incLifePct: 15 },
      { id: 'ch_footprints', name: 'Footprints in the Sand', desc: '+30 Spirit & +20% ES', bonusSpirit: 30, incEsPct: 20 },
    ],
  },
  // RANGER
  {
    id: 'deadeye',
    name: 'Deadeye',
    baseClass: 'Ranger',
    nodes: [
      { id: 'de_gathering', name: 'Gathering Winds (Tailwind)', desc: '+20% More Hız & +35% Evasion', moreDpsPct: 20, incEvasionPct: 35 },
      { id: 'de_endless', name: 'Endless Munitions (+1 Projectile)', desc: '+25% More Projectile DPS', moreDpsPct: 25 },
      { id: 'de_far_shot', name: 'Far Shot / Point Blank', desc: '+20% More Mesafe Hasarı', moreDpsPct: 20 },
      { id: 'de_bulls_eye', name: 'Called Shots', desc: '+40% Crit Şansı & +30% Crit Hasarı', incCritChance: 40, critDamageBonus: 30 },
      { id: 'de_wind_ward', name: 'Wind Ward', desc: '+45% Increased Evasion', incEvasionPct: 45 },
      { id: 'de_avidity', name: 'Avidity (Frenzy)', desc: '+16% More DPS & +20 Spirit', moreDpsPct: 16, bonusSpirit: 20 },
    ],
  },
  {
    id: 'pathfinder',
    name: 'Pathfinder',
    baseClass: 'Ranger',
    nodes: [
      { id: 'pf_contagious', name: 'Contagious Contamination', desc: '+24% More Poison/Ailment DPS', moreDpsPct: 24 },
      { id: 'pf_overwhelming', name: 'Overwhelming Toxicity', desc: '+22% More Çift Zehir DPS', moreDpsPct: 22 },
      { id: 'pf_enduring', name: 'Enduring Elixirs', desc: '+25% Maximum Life & +30% Evasion', incLifePct: 25, incEvasionPct: 30 },
      { id: 'pf_running', name: 'Running Assault', desc: '+18% More Hareketli Saldırı DPS', moreDpsPct: 18 },
      { id: 'pf_relentless', name: 'Relentless Pursuit', desc: '+40% Increased Evasion', incEvasionPct: 40 },
      { id: 'pf_connected', name: 'Connected Chemistry', desc: '+25 Spirit & +20% Life', bonusSpirit: 25, incLifePct: 20 },
    ],
  },
  // WARRIOR
  {
    id: 'titan',
    name: 'Titan',
    baseClass: 'Warrior',
    nodes: [
      { id: 'ti_hulking', name: 'Hulking Form (+50% Small Passives)', desc: '+24% More Ağaç Güçlendirmesi & +25% Life', moreDpsPct: 24, incLifePct: 25 },
      { id: 'ti_crushing', name: 'Crushing Impacts', desc: '+20% More Heavy Stun DPS', moreDpsPct: 20 },
      { id: 'ti_earthbreaker', name: 'Earthbreaker (Aftershocks)', desc: '+22% More Slam DPS', moreDpsPct: 22 },
      { id: 'ti_stone_skin', name: 'Stone Skin', desc: '+50% Increased Armour', incArmourPct: 50 },
      { id: 'ti_mysterious', name: 'Mysterious Lineage', desc: '+25% Maximum Life', incLifePct: 25 },
      { id: 'ti_colossal', name: 'Colossal Capacity', desc: '+30% Armour & +20 Spirit', incArmourPct: 30, bonusSpirit: 20 },
    ],
  },
  {
    id: 'warbringer',
    name: 'Warbringer',
    baseClass: 'Warrior',
    nodes: [
      { id: 'wb_anvil', name: "Anvil's Weight (Armour Break)", desc: '+22% More Fiziksel/Kırılma DPS', moreDpsPct: 22 },
      { id: 'wb_jade', name: 'Jade Heritage', desc: '+35% Armour & +20% Life', incArmourPct: 35, incLifePct: 20 },
      { id: 'wb_answered', name: 'Answered Call (Ancestral Spirits)', desc: '+24% More Totem/Spirit DPS', moreDpsPct: 24 },
      { id: 'wb_renly', name: "Renly's Training", desc: '+45% Increased Armour', incArmourPct: 45 },
      { id: 'wb_warcallers', name: "Warcaller's Bellow", desc: '+18% More Warcry DPS', moreDpsPct: 18 },
      { id: 'wb_turtle', name: 'Turtle Charm', desc: '+35% Armour & +25 Spirit', incArmourPct: 35, bonusSpirit: 25 },
    ],
  },
  // WITCH
  {
    id: 'infernalist',
    name: 'Infernalist',
    baseClass: 'Witch',
    nodes: [
      { id: 'inf_beidat_will', name: "Beidat's Will (Life -> Spirit)", desc: '+75 Bonus Spirit', bonusSpirit: 75 },
      { id: 'inf_beidat_hand', name: "Beidat's Hand (Life -> ES)", desc: '+45% Maximum Energy Shield', incEsPct: 45 },
      { id: 'inf_bringer', name: 'Bringer of Flame', desc: '+24% More Fire / Ignite DPS', moreDpsPct: 24 },
      { id: 'inf_pyromantic', name: 'Pyromantic Pact', desc: '+22% More Infernal DPS', moreDpsPct: 22 },
      { id: 'inf_loyal', name: 'Loyal Hellhound', desc: '+20% Life & +25% Energy Shield', incLifePct: 20, incEsPct: 25 },
      { id: 'inf_grinning', name: 'Grinning Immolation', desc: '+45% Crit Hasarı & +25% Crit Şansı', critDamageBonus: 45, incCritChance: 25 },
    ],
  },
  {
    id: 'blood_mage',
    name: 'Blood Mage',
    baseClass: 'Witch',
    nodes: [
      { id: 'bm_gore', name: 'Gore Spike (Life -> Crit Damage)', desc: '+55% Critical Damage Bonus', critDamageBonus: 55 },
      { id: 'bm_sunder', name: 'Sunder the Flesh (Base Crit %15)', desc: '+45% Increased Critical Hit Chance', incCritChance: 45 },
      { id: 'bm_crimson', name: 'Crimson Power', desc: '+35% Maximum Life & +25% ES', incLifePct: 35, incEsPct: 25 },
      { id: 'bm_vitality', name: 'Vitality Siphon', desc: '+20% More Spell Leech DPS', moreDpsPct: 20 },
      { id: 'bm_blood_barbs', name: 'Blood Barbs', desc: '+22% More Bleed / Elemental DPS', moreDpsPct: 22 },
      { id: 'bm_grasping', name: 'Grasping Wounds', desc: '+30% Maximum Life', incLifePct: 30 },
    ],
  },
];

const AVAILABLE_STATS = [
  'Lightning Damage',
  'Fire Damage',
  'Cold Damage',
  'Physical Damage',
  'Spell Damage',
  'Critical',
  'Attack Speed',
  'Cast Speed',
  'Minion',
  'Maximum Life',
  'Energy Shield',
  'Armour',
  'Evasion',
  'Spirit',
];

const CORE_SPIRIT_BUFFS: SpiritBuffDef[] = [
  {
    id: 'herald_of_thunder',
    name: 'Herald of Thunder',
    cost: 30,
    category: 'Herald',
    effectLabel: '+18% More Lightning / Shock DPS',
    moreDpsPct: 18,
    requiredTag: 'lightning',
  },
  {
    id: 'herald_of_ash',
    name: 'Herald of Ash',
    cost: 30,
    category: 'Herald',
    effectLabel: '+18% More Fire / Overkill DPS',
    moreDpsPct: 18,
    requiredTag: 'fire',
  },
  {
    id: 'herald_of_ice',
    name: 'Herald of Ice',
    cost: 30,
    category: 'Herald',
    effectLabel: '+16% More Cold DPS, +15% Crit',
    moreDpsPct: 16,
    requiredTag: 'cold',
    incCritChance: 15,
  },
  {
    id: 'archmage',
    name: 'Archmage',
    cost: 100,
    category: 'Aura / Buff',
    effectLabel: '+38% More Spell Lightning Hasarı',
    moreDpsPct: 38,
    requiredTag: 'spell',
  },
  {
    id: 'cast_on_shock',
    name: 'Cast on Shock',
    cost: 60,
    category: 'Meta',
    effectLabel: '+28% More Meta Tetikleyici DPS',
    moreDpsPct: 28,
  },
  {
    id: 'cast_on_freeze',
    name: 'Cast on Freeze',
    cost: 60,
    category: 'Meta',
    effectLabel: '+26% More Meta Tetikleyici DPS',
    moreDpsPct: 26,
  },
  {
    id: 'wind_dancer',
    name: 'Wind Dancer',
    cost: 30,
    category: 'Aura / Buff',
    effectLabel: '+35% Increased Evasion (EHP)',
    incEvasionPct: 35,
  },
  {
    id: 'grim_feast',
    name: 'Grim Feast',
    cost: 30,
    category: 'Aura / Buff',
    effectLabel: '+30% Increased Energy Shield (EHP)',
    incEsPct: 30,
  },
  {
    id: 'charge_infusion',
    name: 'Charge Infusion',
    cost: 30,
    category: 'Aura / Buff',
    effectLabel: '+25% Increased Critical Hit Chance',
    incCritChance: 25,
  },
  {
    id: 'berserk',
    name: 'Berserk',
    cost: 30,
    category: 'Aura / Buff',
    effectLabel: '+22% More Attack Hasarı',
    moreDpsPct: 22,
    requiredTag: 'attack',
  },
];

function normalizeToHundred(items: StatWeightItem[]): StatWeightItem[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], weight: 100 }];

  const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
  if (total === 0) {
    const base = Math.floor(100 / items.length);
    const rem = 100 - base * items.length;
    return items.map((item, idx) => ({
      ...item,
      weight: base + (idx === 0 ? rem : 0),
    }));
  }

  const raw = items.map((item) => (Math.max(0, item.weight) / total) * 100);
  const floored = raw.map((v) => Math.floor(v));
  let remainder = 100 - floored.reduce((s, v) => s + v, 0);

  const order = raw
    .map((v, idx) => ({ idx, frac: v - floored[idx] }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i++) {
    floored[order[i % order.length].idx] += 1;
  }

  return items.map((item, idx) => ({
    ...item,
    weight: floored[idx],
  }));
}

function rebalanceWeights(
  items: StatWeightItem[],
  changedStat: string,
  requestedValue: number
): StatWeightItem[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], weight: 100 }];

  const clampedVal = Math.max(0, Math.min(100, Math.round(requestedValue)));
  const remaining = 100 - clampedVal;
  const others = items.filter((i) => i.stat !== changedStat);
  const othersTotal = others.reduce((sum, i) => sum + i.weight, 0);

  const otherAllocations = new Map<string, number>();

  if (remaining === 0) {
    others.forEach((o) => otherAllocations.set(o.stat, 0));
  } else if (othersTotal === 0) {
    const base = Math.floor(remaining / others.length);
    let rem = remaining - base * others.length;
    others.forEach((o, idx) => {
      otherAllocations.set(o.stat, base + (idx < rem ? 1 : 0));
    });
  } else {
    const raw = others.map((o) => (o.weight / othersTotal) * remaining);
    const floored = raw.map((v) => Math.floor(v));
    let rem = remaining - floored.reduce((s, v) => s + v, 0);

    const order = raw
      .map((v, idx) => ({ idx, frac: v - floored[idx] }))
      .sort((a, b) => b.frac - a.frac);

    for (let i = 0; i < rem; i++) {
      floored[order[i % order.length].idx] += 1;
    }

    others.forEach((o, idx) => {
      otherAllocations.set(o.stat, floored[idx]);
    });
  }

  return items.map((item) =>
    item.stat === changedStat
      ? { ...item, weight: clampedVal }
      : { ...item, weight: otherAllocations.get(item.stat) ?? 0 }
  );
}

// Herhangi bir build konfigürasyonunun özet metriklerini hesaplayan saf yardımcı
function evaluateBuildSnapshot(
  b: {
    allocatedIds: number[];
    weaponBaseDps: number;
    baseGemLevel: number;
    bonusSkillLevels: number;
    gearSpirit?: number;
    activeSpiritIds?: string[];
    ascendancyId?: string;
    ascendancyNodeIds?: string[];
  },
  nodes: Record<number, PassiveNode>
) {
  let incLife = 0;
  let flatLife = 0;
  let incEs = 0;
  let flatEs = 0;
  let incArmour = 0;
  let incEvasion = 0;
  let incCritChance = 0;
  let critDamageBonus = 0;
  let allAttr = 0;
  let treeSpirit = 0;
  let incDamage = 0;
  let incSpeed = 0;

  for (const id of b.allocatedIds || []) {
    const node = nodes[id];
    if (!node) continue;
    for (const line of node.stats) {
      const match = line.match(/([+-]?\d+(?:\.\d+)?)\s*(%?)\s*(.*)/);
      if (!match) continue;
      const val = parseFloat(match[1]);
      const pct = match[2];
      const l = `${pct} ${match[3]}`.trim().toLowerCase();

      if (l.includes('to any attribute')) allAttr += val;
      if (l.includes('to maximum life') && !l.startsWith('%')) flatLife += val;
      if (l.includes('increased maximum life')) incLife += val;
      if (l.includes('to maximum energy shield') && !l.startsWith('%')) flatEs += val;
      if (l.includes('increased maximum energy shield') || l.includes('increased energy shield'))
        incEs += val;
      if (l.includes('increased armour')) incArmour += val;
      if (l.includes('increased evasion')) incEvasion += val;
      if (l.includes('critical hit chance')) incCritChance += val;
      if (l.includes('critical damage bonus')) critDamageBonus += val;
      if (l.includes('to maximum spirit') || l === 'to spirit') treeSpirit += val;
      if (l.startsWith('%') && l.includes('speed')) incSpeed += val;
      if (l.startsWith('%') && l.includes('damage') && !l.includes('taken') && !l.includes('bonus'))
        incDamage += val;
    }
  }

  const asc = ASCENDANCIES.find((a) => a.id === b.ascendancyId);
  const ascNodes = asc
    ? asc.nodes.filter((n) => (b.ascendancyNodeIds || []).includes(n.id)).slice(0, 4)
    : [];

  let ascDpsFactor = 1.0;
  let ascSpirit = 0;
  for (const n of ascNodes) {
    if (n.incLifePct) incLife += n.incLifePct;
    if (n.incEsPct) incEs += n.incEsPct;
    if (n.incArmourPct) incArmour += n.incArmourPct;
    if (n.incEvasionPct) incEvasion += n.incEvasionPct;
    if (n.incCritChance) incCritChance += n.incCritChance;
    if (n.critDamageBonus) critDamageBonus += n.critDamageBonus;
    if (n.bonusSpirit) ascSpirit += n.bonusSpirit;
    if (n.moreDpsPct) ascDpsFactor *= 1 + n.moreDpsPct / 100;
  }

  const activeBuffs = CORE_SPIRIT_BUFFS.filter((sb) =>
    (b.activeSpiritIds || []).includes(sb.id)
  );
  let spiritDpsFactor = 1.0;
  for (const sb of activeBuffs) {
    if (sb.incCritChance) incCritChance += sb.incCritChance;
    if (sb.incEvasionPct) incEvasion += sb.incEvasionPct;
    if (sb.incEsPct) incEs += sb.incEsPct;
    if (sb.moreDpsPct) spiritDpsFactor *= 1 + sb.moreDpsPct / 100;
  }

  const totalLife = Math.round((1150 + flatLife + allAttr * 2) * (1 + Math.max(incLife, 0) / 100));
  const totalEs = Math.round((450 + flatEs) * (1 + Math.max(incEs, 0) / 100));
  const totalArmour = Math.round(1800 * (1 + Math.max(incArmour, 0) / 100));
  const totalEvasion = Math.round(1800 * (1 + Math.max(incEvasion, 0) / 100));

  const physMit = totalArmour / (totalArmour + 8000);
  const evadeMit = Math.min(totalEvasion / (totalEvasion + 3500), 0.55);
  const effectiveHp = Math.round(
    (totalLife + totalEs) / Math.max(1 - physMit * 0.6 - evadeMit * 0.45, 0.25)
  );

  const effectiveCrit = Math.min(Math.max(8.0 * (1 + incCritChance / 100), 1.0), 100.0);
  const critMultPct = 100 + critDamageBonus;
  const critFactor = 1 + (effectiveCrit / 100) * (Math.max(critMultPct, 0) / 100);

  const effLevel = (b.baseGemLevel || 20) + (b.bonusSkillLevels || 0);
  const levelFactor = Math.pow(1.115, Math.max(effLevel - 1, 0));
  const treeFactor = (1 + Math.max(incDamage, 0) / 100) * (1 + Math.max(incSpeed, 0) / 100);

  const estDps = Math.round(
    (b.weaponBaseDps || 520) * levelFactor * treeFactor * spiritDpsFactor * ascDpsFactor * critFactor
  );

  const maxSpirit = Math.round(100 + (b.gearSpirit || 0) + treeSpirit + ascSpirit);

  return {
    points: (b.allocatedIds || []).length,
    effectiveHp,
    totalLife,
    totalEs,
    totalArmour,
    totalEvasion,
    effectiveCrit: Number(effectiveCrit.toFixed(1)),
    estDps,
    maxSpirit,
    ascName: asc?.name || '-',
  };
}

export default function App() {
  const [nodes, setNodes] = useState<Record<number, PassiveNode>>({});
  const [classes, setClasses] = useState<ClassStart[]>([]);
  const [spriteSheets, setSpriteSheets] = useState<Record<string, string>>({});
  const [selectedStartId, setSelectedStartId] = useState<number>(0);
  const [allocatedIds, setAllocatedIds] = useState<number[]>([]);
  const [status, setStatus] = useState<string>('Hazır (Veri güncellemek için Ctrl+U)');
  const [maxPoints, setMaxPoints] = useState<number>(80);

  // Ascendancy (Alt Sınıf - 8 Puan) State'leri
  const [selectedAscendancyId, setSelectedAscendancyId] = useState<string>('witchhunter');
  const [selectedAscNodeIds, setSelectedAscNodeIds] = useState<string[]>([
    'wh_pitiless',
    'wh_judge',
    'wh_weapon_master',
    'wh_sorcery',
  ]);
  const [isAscDrawerOpen, setIsAscDrawerOpen] = useState<boolean>(false);

  // Kaydırma çubuklu %100 Dengeli Çoklu Stat Ağırlıkları
  const [statWeights, setStatWeights] = useState<StatWeightItem[]>([
    { stat: 'Lightning Damage', weight: 60 },
    { stat: 'Critical', weight: 25 },
    { stat: 'Energy Shield', weight: 15 },
  ]);
  const [isWeightDrawerOpen, setIsWeightDrawerOpen] = useState<boolean>(false);
  const [newStatName, setNewStatName] = useState<string>('Maximum Life');

  // Ağaç üzerinde düğüm/Keystone arama ve odaklanma
  const [nodeSearchQuery, setNodeSearchQuery] = useState<string>('');
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [focusTrigger, setFocusTrigger] = useState<{ nodeId: number; seq: number } | null>(null);

  // Sağ panel sekmesi, Gem ve Silah/+Skill Level state'leri
  const [rightTab, setRightTab] = useState<'stats' | 'gems' | 'builds'>('stats');
  const [activeGems, setActiveGems] = useState<GemData[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [gemSearch, setGemSearch] = useState<string>('');
  const [recommendedSupports, setRecommendedSupports] = useState<SupportRecommendation[]>([]);

  // Silah & +Skill Level Simülatörü
  const [weaponBaseDps, setWeaponBaseDps] = useState<number>(520);
  const [baseGemLevel, setBaseGemLevel] = useState<number>(20);
  const [bonusSkillLevels, setBonusSkillLevels] = useState<number>(5);

  // Spirit Bütçesi & Aura / Herald Yöneticisi
  const [gearSpirit, setGearSpirit] = useState<number>(60);
  const [activeSpiritIds, setActiveSpiritIds] = useState<string[]>([
    'herald_of_thunder',
    'grim_feast',
    'charge_infusion',
  ]);

  // Build Kaydetme, Kıyaslama & Paylaşım Kodu
  const [buildName, setBuildName] = useState<string>('');
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [shareCodeInput, setShareCodeInput] = useState<string>('');
  const [compareLeftId, setCompareLeftId] = useState<string>('CURRENT');
  const [compareRightId, setCompareRightId] = useState<string>('');

  const persistBuilds = (next: SavedBuild[]) => {
    setSavedBuilds(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Depolama doluysa sessiz geç
    }
  };

  // Seçili sınıfa ait Ascendancy listesi ve aktif Ascendancy objesi
  const selectedBaseClassName = useMemo(() => {
    return classes.find((c) => c.start_node_id === selectedStartId)?.name || 'Mercenary';
  }, [classes, selectedStartId]);

  const availableAscendancies = useMemo(() => {
    const matched = ASCENDANCIES.filter(
      (a) => a.baseClass.toLowerCase() === selectedBaseClassName.toLowerCase()
    );
    return matched.length > 0 ? matched : ASCENDANCIES;
  }, [selectedBaseClassName]);

  const activeAscendancy = useMemo(() => {
    return (
      availableAscendancies.find((a) => a.id === selectedAscendancyId) ||
      availableAscendancies[0]
    );
  }, [availableAscendancies, selectedAscendancyId]);

  const activeAscNodes = useMemo(() => {
    if (!activeAscendancy) return [];
    return activeAscendancy.nodes
      .filter((n) => selectedAscNodeIds.includes(n.id))
      .slice(0, LIMITS.maxAscendancyNodes);
  }, [activeAscendancy, selectedAscNodeIds]);

  const handleClassChange = (newStartId: number) => {
    setSelectedStartId(newStartId);
    setAllocatedIds([newStartId]);
    const clsName = classes.find((c) => c.start_node_id === newStartId)?.name || '';
    const firstAsc = ASCENDANCIES.find(
      (a) => a.baseClass.toLowerCase() === clsName.toLowerCase()
    );
    if (firstAsc) {
      setSelectedAscendancyId(firstAsc.id);
      setSelectedAscNodeIds(firstAsc.nodes.slice(0, 4).map((n) => n.id));
    }
  };

  const handleAscendancyChange = (newAscId: string) => {
    setSelectedAscendancyId(newAscId);
    const found = ASCENDANCIES.find((a) => a.id === newAscId);
    if (found) {
      setSelectedAscNodeIds(found.nodes.slice(0, 4).map((n) => n.id));
    }
  };

  const toggleAscendancyNode = (nodeId: string) => {
    setSelectedAscNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((x) => x !== nodeId);
      }
      if (prev.length >= LIMITS.maxAscendancyNodes) {
        setStatus('Maksimum 8 Ascendancy puanına (4 Major Notable) ulaşıldı.');
        return prev;
      }
      return [...prev, nodeId];
    });
  };

  const totalWeightPct = useMemo(
    () => statWeights.reduce((sum, w) => sum + w.weight, 0),
    [statWeights]
  );

  const activeWeightsSummary = useMemo(() => {
    const active = statWeights.filter((w) => w.weight > 0);
    if (active.length === 0) return 'Stat Seçilmedi';
    return active.map((w) => `${w.stat} %${w.weight}`).join(' • ');
  }, [statWeights]);

  const updateStatWeight = (stat: string, weight: number) => {
    setStatWeights((prev) => rebalanceWeights(prev, stat, weight));
  };

  const addStatWeight = (statToAdd: string) => {
    const clean = statToAdd.trim();
    if (!clean) return;
    if (statWeights.some((s) => s.stat.toLowerCase() === clean.toLowerCase())) return;

    const initialShare =
      statWeights.length === 0 ? 100 : Math.round(100 / (statWeights.length + 1));
    setStatWeights((prev) =>
      normalizeToHundred([...prev, { stat: clean, weight: initialShare }])
    );
  };

  const removeStatWeight = (statToRemove: string) => {
    setStatWeights((prev) =>
      normalizeToHundred(prev.filter((s) => s.stat !== statToRemove))
    );
  };

  const distributeEqually = () => {
    if (statWeights.length === 0) return;
    setStatWeights((prev) =>
      normalizeToHundred(prev.map((item) => ({ ...item, weight: 1 })))
    );
  };

  // Harita üzerinde eşleşen düğümleri bul
  const matchedNodeIds = useMemo(() => {
    const q = nodeSearchQuery.trim().toLowerCase();
    if (q.length < 2) return [];

    const matches: number[] = [];
    for (const node of Object.values(nodes)) {
      const nameMatch = node.name.toLowerCase().includes(q);
      const statMatch = node.stats.some((s) => s.toLowerCase().includes(q));
      if (nameMatch || statMatch) {
        matches.push(node.id);
      }
    }
    matches.sort((a, b) => {
      const na = nodes[a];
      const nb = nodes[b];
      const scoreA = (na?.is_keystone ? 2 : 0) + (na?.is_notable ? 1 : 0);
      const scoreB = (nb?.is_keystone ? 2 : 0) + (nb?.is_notable ? 1 : 0);
      return scoreB - scoreA;
    });
    return matches;
  }, [nodeSearchQuery, nodes]);

  useEffect(() => {
    setFocusIndex(0);
    if (matchedNodeIds.length > 0) {
      setFocusTrigger((prev) => ({
        nodeId: matchedNodeIds[0],
        seq: (prev?.seq || 0) + 1,
      }));
    }
  }, [matchedNodeIds]);

  const focusNextMatch = () => {
    if (matchedNodeIds.length === 0) return;
    const nextIdx = (focusIndex + 1) % matchedNodeIds.length;
    setFocusIndex(nextIdx);
    setFocusTrigger((prev) => ({
      nodeId: matchedNodeIds[nextIdx],
      seq: (prev?.seq || 0) + 1,
    }));
  };

  const loadGemsFromRust = async () => {
    try {
      const res = await invoke<{ active_skills: GemData[]; total_gems: number }>(
        'list_active_gems'
      );
      setActiveGems(res.active_skills || []);
      if (res.active_skills && res.active_skills.length > 0 && !selectedSkillId) {
        setSelectedSkillId(res.active_skills[0].id);
      }
    } catch {
      // Veritabanı henüz yüklenmemişse sessiz geç
    }
  };

  const loadTreeFromRust = async () => {
    try {
      const treeData = await invoke<{
        nodes: Record<number, PassiveNode>;
        classes: ClassStart[];
        sprite_sheets?: Record<string, string>;
      }>('get_passive_tree');

      setNodes(treeData.nodes);
      setClasses(treeData.classes || []);
      setSpriteSheets(treeData.sprite_sheets || {});

      if (treeData.classes && treeData.classes.length > 0) {
        const startId = treeData.classes[0].start_node_id;
        setSelectedStartId(startId);
        const firstAsc = ASCENDANCIES.find(
          (a) => a.baseClass.toLowerCase() === treeData.classes[0].name.toLowerCase()
        );
        if (firstAsc) {
          setSelectedAscendancyId(firstAsc.id);
          setSelectedAscNodeIds(firstAsc.nodes.slice(0, 4).map((n) => n.id));
        }
      } else {
        const keys = Object.keys(treeData.nodes).map(Number);
        if (keys.length > 0) setSelectedStartId(keys[0]);
      }

      setStatus(`Ağaç yüklendi (${Object.keys(treeData.nodes).length} düğüm)`);
      await loadGemsFromRust();
    } catch (err) {
      setStatus(String(err));
    }
  };

  const runUpdate = async () => {
    setStatus('GitHub PoB2 reposundan yama verileri ve gemler çekiliyor...');
    try {
      const msg = await invoke<string>('trigger_patch_update', { force: true });
      setStatus(msg);
      await loadTreeFromRust();
    } catch (err) {
      setStatus(`Hata: ${err}`);
    }
  };

  const runOptimizer = async () => {
    if (!selectedStartId || Object.keys(nodes).length === 0) return;

    const safePoints = clampInt(maxPoints, LIMITS.maxPoints.min, LIMITS.maxPoints.max);
    if (safePoints !== maxPoints) setMaxPoints(safePoints);

    const weights: Record<string, number> = {};
    for (const item of statWeights) {
      if (item.weight > 0 && item.stat.trim()) {
        weights[item.stat.trim().toLowerCase()] = item.weight;
      }
    }

    if (Object.keys(weights).length === 0) {
      setStatus('Lütfen Stat Ağırlıkları panelinden en az bir stat ekleyin.');
      setIsWeightDrawerOpen(true);
      return;
    }

    setIsWeightDrawerOpen(false);
    setIsAscDrawerOpen(false);

    try {
      const resultIds = await invoke<number[]>('optimize_passive_tree', {
        startNodeId: selectedStartId,
        maxPoints: safePoints,
        weights,
      });
      setAllocatedIds(resultIds);
      setStatus(
        `Optimizasyon tamamlandı (${activeAscendancy?.name || selectedBaseClassName}): ${resultIds.length} puan dağıtıldı.`
      );
    } catch (err) {
      setStatus(`Optimizasyon hatası: ${err}`);
    }
  };

  const handleSaveCurrentBuild = () => {
    const ascLabel = activeAscendancy?.name || selectedBaseClassName;
    const finalName = buildName.trim() || `${ascLabel} (${allocatedIds.length}p)`;

    const entry: SavedBuild = {
      id: Date.now().toString(),
      name: finalName,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      startNodeId: selectedStartId,
      allocatedIds: allocatedIds.slice(0, LIMITS.maxPoints.max),
      targetStat: activeWeightsSummary,
      statWeights: [...statWeights],
      maxPoints: clampInt(maxPoints, LIMITS.maxPoints.min, LIMITS.maxPoints.max),
      selectedSkillId,
      weaponBaseDps: clampInt(weaponBaseDps, LIMITS.weaponBaseDps.min, LIMITS.weaponBaseDps.max),
      baseGemLevel: clampInt(baseGemLevel, LIMITS.baseGemLevel.min, LIMITS.baseGemLevel.max),
      bonusSkillLevels: clampInt(
        bonusSkillLevels,
        LIMITS.bonusSkillLevels.min,
        LIMITS.bonusSkillLevels.max
      ),
      gearSpirit: clampInt(gearSpirit, LIMITS.gearSpirit.min, LIMITS.gearSpirit.max),
      activeSpiritIds: [...activeSpiritIds],
      ascendancyId: activeAscendancy?.id,
      ascendancyNodeIds: activeAscNodes.map((n) => n.id),
    };

    const nextList = [entry, ...savedBuilds];
    persistBuilds(nextList);
    if (!compareRightId) {
      setCompareRightId(entry.id);
    }
    setBuildName('');
    setStatus(`Build kaydedildi: "${finalName}"`);
  };

  const applyBuildData = (b: Omit<SavedBuild, 'id' | 'name' | 'createdAt'>, label: string) => {
    setSelectedStartId(b.startNodeId);
    const safeAllocated = (b.allocatedIds || []).slice(0, LIMITS.maxPoints.max);
    setAllocatedIds(safeAllocated);
    if (b.statWeights && b.statWeights.length > 0) {
      setStatWeights(normalizeToHundred(b.statWeights));
    }
    if (typeof b.maxPoints === 'number') {
      setMaxPoints(clampInt(b.maxPoints, LIMITS.maxPoints.min, LIMITS.maxPoints.max));
    }
    if (b.selectedSkillId) setSelectedSkillId(b.selectedSkillId);
    if (typeof b.weaponBaseDps === 'number') {
      setWeaponBaseDps(
        clampInt(b.weaponBaseDps, LIMITS.weaponBaseDps.min, LIMITS.weaponBaseDps.max)
      );
    }
    if (typeof b.baseGemLevel === 'number') {
      setBaseGemLevel(clampInt(b.baseGemLevel, LIMITS.baseGemLevel.min, LIMITS.baseGemLevel.max));
    }
    if (typeof b.bonusSkillLevels === 'number') {
      setBonusSkillLevels(
        clampInt(b.bonusSkillLevels, LIMITS.bonusSkillLevels.min, LIMITS.bonusSkillLevels.max)
      );
    }
    if (typeof b.gearSpirit === 'number') {
      setGearSpirit(clampInt(b.gearSpirit, LIMITS.gearSpirit.min, LIMITS.gearSpirit.max));
    }
    if (Array.isArray(b.activeSpiritIds)) setActiveSpiritIds(b.activeSpiritIds);
    if (b.ascendancyId) {
      setSelectedAscendancyId(b.ascendancyId);
      if (Array.isArray(b.ascendancyNodeIds)) {
        setSelectedAscNodeIds(b.ascendancyNodeIds.slice(0, LIMITS.maxAscendancyNodes));
      }
    }
    setStatus(`Build yüklendi: ${label} (${safeAllocated.length} puan)`);
  };

  const generateShareCode = () => {
    const payload = {
      v: 4,
      s: selectedStartId,
      a: allocatedIds.slice(0, LIMITS.maxPoints.max),
      sw: statWeights,
      m: clampInt(maxPoints, LIMITS.maxPoints.min, LIMITS.maxPoints.max),
      g: selectedSkillId,
      w: clampInt(weaponBaseDps, LIMITS.weaponBaseDps.min, LIMITS.weaponBaseDps.max),
      l: clampInt(baseGemLevel, LIMITS.baseGemLevel.min, LIMITS.baseGemLevel.max),
      b: clampInt(bonusSkillLevels, LIMITS.bonusSkillLevels.min, LIMITS.bonusSkillLevels.max),
      gs: clampInt(gearSpirit, LIMITS.gearSpirit.min, LIMITS.gearSpirit.max),
      sp: activeSpiritIds,
      asc: activeAscendancy?.id,
      ascn: activeAscNodes.map((n) => n.id),
    };
    const encoded = 'POE2TC:' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    setShareCodeInput(encoded);
    navigator.clipboard?.writeText(encoded).catch(() => {});
    setStatus('Paylaşım kodu oluşturuldu ve panoya kopyalandı!');
  };

  const importShareCode = () => {
    const raw = shareCodeInput.trim();
    if (!raw.startsWith('POE2TC:')) {
      setStatus('Geçersiz kod! Kod "POE2TC:" ile başlamalıdır.');
      return;
    }
    try {
      const jsonStr = decodeURIComponent(escape(atob(raw.slice(7))));
      const p = JSON.parse(jsonStr);
      applyBuildData(
        {
          startNodeId: Number(p.s) || selectedStartId,
          allocatedIds: Array.isArray(p.a)
            ? p.a.map(Number).slice(0, LIMITS.maxPoints.max)
            : [],
          targetStat: String(p.t || ''),
          statWeights: Array.isArray(p.sw) ? p.sw : undefined,
          maxPoints: clampInt(Number(p.m) || 80, LIMITS.maxPoints.min, LIMITS.maxPoints.max),
          selectedSkillId: String(p.g || ''),
          weaponBaseDps: clampInt(
            Number(p.w) || 520,
            LIMITS.weaponBaseDps.min,
            LIMITS.weaponBaseDps.max
          ),
          baseGemLevel: clampInt(
            Number(p.l) || 20,
            LIMITS.baseGemLevel.min,
            LIMITS.baseGemLevel.max
          ),
          bonusSkillLevels: clampInt(
            Number(p.b) || 0,
            LIMITS.bonusSkillLevels.min,
            LIMITS.bonusSkillLevels.max
          ),
          gearSpirit: clampInt(
            typeof p.gs === 'number' ? p.gs : 60,
            LIMITS.gearSpirit.min,
            LIMITS.gearSpirit.max
          ),
          activeSpiritIds: Array.isArray(p.sp) ? p.sp : undefined,
          ascendancyId: typeof p.asc === 'string' ? p.asc : undefined,
          ascendancyNodeIds: Array.isArray(p.ascn) ? p.ascn : undefined,
        },
        'Paylaşım Kodu'
      );
    } catch {
      setStatus('Paylaşım kodu çözümlenemedi (bozuk veya eksik kod).');
    }
  };

  useEffect(() => {
    if (!selectedSkillId) return;
    invoke<SupportRecommendation[]>('recommend_support_gems', {
      activeSkillId: selectedSkillId,
      allocatedIds,
    })
      .then((list) => setRecommendedSupports(list))
      .catch(() => setRecommendedSupports([]));
  }, [selectedSkillId, allocatedIds]);

  const handleToggleNode = (id: number) => {
    setAllocatedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= LIMITS.maxPoints.max) {
        setStatus(`Maksimum ${LIMITS.maxPoints.max} pasif puan sınırına ulaşıldı.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const toggleSpiritBuff = (id: string) => {
    setActiveSpiritIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const aggregatedStats = useMemo(() => {
    const totals: Record<string, number> = {};
    const rawLines: string[] = [];

    for (const id of allocatedIds) {
      const node = nodes[id];
      if (!node) continue;

      for (const line of node.stats) {
        const match = line.match(/([+-]?\d+(?:\.\d+)?)\s*(%?)\s*(.*)/);
        if (match) {
          const val = parseFloat(match[1]);
          const pct = match[2];
          const label = `${pct} ${match[3]}`.trim();
          totals[label] = (totals[label] || 0) + val;
        } else {
          rawLines.push(line);
        }
      }
    }

    return { totals, rawLines };
  }, [allocatedIds, nodes]);

  const allSpiritBuffs = useMemo(() => {
    const list: SpiritBuffDef[] = [...CORE_SPIRIT_BUFFS];
    const existingNames = new Set(list.map((b) => b.name.toLowerCase()));

    for (const g of activeGems) {
      if (g.spirit_cost > 0 && !existingNames.has(g.name.toLowerCase())) {
        existingNames.add(g.name.toLowerCase());
        list.push({
          id: g.id,
          name: g.name,
          cost: g.spirit_cost,
          category: 'Aura / Buff',
          effectLabel: '+15% More Sinerji Hasarı',
          moreDpsPct: 15,
        });
      }
    }
    return list;
  }, [activeGems]);

  const spiritSummary = useMemo(() => {
    let treeSpirit = 0;
    for (const [label, val] of Object.entries(aggregatedStats.totals)) {
      const l = label.toLowerCase();
      if (l.includes('to maximum spirit') || l === 'to spirit') {
        treeSpirit += val;
      }
    }

    const ascSpirit = activeAscNodes.reduce((sum, n) => sum + (n.bonusSpirit || 0), 0);
    const campaignSpirit = 100;
    const safeGearSpirit = clampInt(gearSpirit, LIMITS.gearSpirit.min, LIMITS.gearSpirit.max);
    const maxSpirit = Math.round(campaignSpirit + safeGearSpirit + treeSpirit + ascSpirit);

    const activeBuffs = allSpiritBuffs.filter((b) => activeSpiritIds.includes(b.id));
    const usedSpirit = activeBuffs.reduce((sum, b) => sum + b.cost, 0);
    const remainingSpirit = maxSpirit - usedSpirit;

    return {
      maxSpirit,
      usedSpirit,
      remainingSpirit,
      treeSpirit: Math.round(treeSpirit + ascSpirit),
      activeBuffs,
    };
  }, [aggregatedStats, gearSpirit, allSpiritBuffs, activeSpiritIds, activeAscNodes]);

  const combatSummary = useMemo(() => {
    let incLife = 0;
    let flatLife = 0;
    let incEs = 0;
    let flatEs = 0;
    let incArmour = 0;
    let incEvasion = 0;
    let incCritChance = 0;
    let critDamageBonus = 0;
    let allAttr = 0;

    for (const [label, val] of Object.entries(aggregatedStats.totals)) {
      const l = label.toLowerCase();

      if (l.includes('to any attribute')) allAttr += val;
      if (l.includes('to maximum life') && !l.startsWith('%')) flatLife += val;
      if (l.includes('increased maximum life')) incLife += val;

      if (l.includes('to maximum energy shield') && !l.startsWith('%')) flatEs += val;
      if (l.includes('increased maximum energy shield') || l.includes('increased energy shield'))
        incEs += val;

      if (l.includes('increased armour')) incArmour += val;
      if (l.includes('increased evasion')) incEvasion += val;

      if (l.includes('critical hit chance')) incCritChance += val;
      if (l.includes('critical damage bonus')) critDamageBonus += val;
    }

    for (const ascNode of activeAscNodes) {
      if (ascNode.incLifePct) incLife += ascNode.incLifePct;
      if (ascNode.incEsPct) incEs += ascNode.incEsPct;
      if (ascNode.incArmourPct) incArmour += ascNode.incArmourPct;
      if (ascNode.incEvasionPct) incEvasion += ascNode.incEvasionPct;
      if (ascNode.incCritChance) incCritChance += ascNode.incCritChance;
      if (ascNode.critDamageBonus) critDamageBonus += ascNode.critDamageBonus;
    }

    for (const buff of spiritSummary.activeBuffs) {
      if (buff.incCritChance) incCritChance += buff.incCritChance;
      if (buff.incEvasionPct) incEvasion += buff.incEvasionPct;
      if (buff.incEsPct) incEs += buff.incEsPct;
    }

    const hasInevitableCrit = recommendedSupports
      .slice(0, 5)
      .some((s) => s.name.toLowerCase().includes('inevitable critical'));
    const hasSupercritical = recommendedSupports
      .slice(0, 5)
      .some((s) => s.name.toLowerCase().includes('supercritical'));

    if (hasInevitableCrit) incCritChance += 80;
    if (hasSupercritical) critDamageBonus += 45;

    const baseLife = 1150 + flatLife + allAttr * 2;
    const totalLife = Math.round(baseLife * (1 + Math.max(incLife, 0) / 100));

    const baseEs = 450 + flatEs;
    const totalEs = Math.round(baseEs * (1 + Math.max(incEs, 0) / 100));

    const totalArmour = Math.round(1800 * (1 + Math.max(incArmour, 0) / 100));
    const totalEvasion = Math.round(1800 * (1 + Math.max(incEvasion, 0) / 100));

    const physMitigation = totalArmour / (totalArmour + 10 * 800);
    const evadeFactor = Math.min(totalEvasion / (totalEvasion + 3500), 0.55);
    const effectiveHp = Math.round(
      (totalLife + totalEs) / Math.max(1 - physMitigation * 0.6 - evadeFactor * 0.45, 0.25)
    );

    const baseCrit = 8.0;
    const effectiveCritChance = Math.min(
      Math.max(baseCrit * (1 + incCritChance / 100), 1.0),
      100.0
    );
    const totalCritMultPct = 100 + critDamageBonus;
    const critDpsFactor =
      1 + (effectiveCritChance / 100) * (Math.max(totalCritMultPct, 0) / 100);

    return {
      totalLife,
      totalEs,
      totalArmour,
      totalEvasion,
      effectiveHp,
      effectiveCritChance: Number(effectiveCritChance.toFixed(1)),
      totalCritMultPct: Math.round(totalCritMultPct),
      critDpsFactor,
    };
  }, [aggregatedStats, recommendedSupports, spiritSummary.activeBuffs, activeAscNodes]);

  const filteredActiveGems = useMemo(() => {
    const q = gemSearch.trim().toLowerCase();
    if (!q) return activeGems;
    return activeGems.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [activeGems, gemSearch]);

  const selectedSkillObj = useMemo(
    () => activeGems.find((g) => g.id === selectedSkillId),
    [activeGems, selectedSkillId]
  );

  const treeDamageAndSpeedBonus = useMemo(() => {
    let incDamage = 0;
    let incSpeed = 0;
    const skillTags = (selectedSkillObj?.tags || []).map((t) => t.toLowerCase());

    for (const [label, val] of Object.entries(aggregatedStats.totals)) {
      const lower = label.toLowerCase();
      if (!lower.startsWith('%')) continue;

      if (lower.includes('speed')) {
        incSpeed += val;
      } else if (lower.includes('damage') && !lower.includes('taken') && !lower.includes('bonus')) {
        const isGeneric =
          lower === '% increased damage' ||
          lower === '% increased attack damage' ||
          lower === '% increased spell damage';
        const matchesSkillTag = skillTags.some((tag) => lower.includes(tag));
        if (isGeneric || matchesSkillTag) {
          incDamage += val;
        }
      }
    }
    return { incDamage, incSpeed };
  }, [aggregatedStats, selectedSkillObj]);

  const dpsBreakdown = useMemo(() => {
    const topFive = recommendedSupports.slice(0, 5);
    const supportFactor = topFive.reduce((acc, s) => acc * (1 + s.multiplier_pct / 100), 1);
    const supportMorePct = Math.round((supportFactor - 1) * 100);

    const skillTags = (selectedSkillObj?.tags || []).map((t) => t.toLowerCase());
    let spiritDpsFactor = 1.0;
    for (const buff of spiritSummary.activeBuffs) {
      if (!buff.moreDpsPct) continue;
      const tagMatches =
        !buff.requiredTag ||
        skillTags.length === 0 ||
        skillTags.includes(buff.requiredTag);
      const effectivePct = tagMatches ? buff.moreDpsPct : Math.round(buff.moreDpsPct * 0.4);
      spiritDpsFactor *= 1 + effectivePct / 100;
    }
    const spiritMorePct = Math.round((spiritDpsFactor - 1) * 100);

    const ascFactor = activeAscNodes.reduce(
      (acc, n) => acc * (1 + (n.moreDpsPct || 0) / 100),
      1.0
    );
    const ascMorePct = Math.round((ascFactor - 1) * 100);

    const safeGemLvl = clampInt(baseGemLevel, LIMITS.baseGemLevel.min, LIMITS.baseGemLevel.max);
    const safeBonusLvl = clampInt(
      bonusSkillLevels,
      LIMITS.bonusSkillLevels.min,
      LIMITS.bonusSkillLevels.max
    );
    const safeWeaponDps = clampInt(
      weaponBaseDps,
      LIMITS.weaponBaseDps.min,
      LIMITS.weaponBaseDps.max
    );

    const effectiveLevel = safeGemLvl + safeBonusLvl;
    const levelFactor = Math.pow(1.115, Math.max(effectiveLevel - 1, 0));
    const bonusLevelGainPct = Math.round((Math.pow(1.115, safeBonusLvl) - 1) * 100);

    const treeFactor =
      (1 + Math.max(treeDamageAndSpeedBonus.incDamage, 0) / 100) *
      (1 + Math.max(treeDamageAndSpeedBonus.incSpeed, 0) / 100);

    const finalDps = Math.round(
      safeWeaponDps *
        levelFactor *
        treeFactor *
        supportFactor *
        spiritDpsFactor *
        ascFactor *
        combatSummary.critDpsFactor
    );

    return {
      supportMorePct,
      spiritMorePct,
      ascMorePct,
      effectiveLevel,
      bonusLevelGainPct,
      finalDps,
    };
  }, [
    recommendedSupports,
    selectedSkillObj,
    spiritSummary.activeBuffs,
    activeAscNodes,
    weaponBaseDps,
    baseGemLevel,
    bonusSkillLevels,
    treeDamageAndSpeedBonus,
    combatSummary.critDpsFactor,
  ]);

  // İki Build Kıyaslama (Diff) Hesaplaması
  const comparisonData = useMemo(() => {
    const currentSnapshot = {
      id: 'CURRENT',
      name: `Aktif Build (${activeAscendancy?.name || selectedBaseClassName})`,
      allocatedIds,
      weaponBaseDps,
      baseGemLevel,
      bonusSkillLevels,
      gearSpirit,
      activeSpiritIds,
      ascendancyId: activeAscendancy?.id,
      ascendancyNodeIds: activeAscNodes.map((n) => n.id),
    };

    const resolveBuild = (id: string) => {
      if (id === 'CURRENT') return currentSnapshot;
      return savedBuilds.find((b) => b.id === id) || null;
    };

    const leftBuild = resolveBuild(compareLeftId) || currentSnapshot;
    const rightBuild =
      resolveBuild(compareRightId) ||
      savedBuilds.find((b) => b.id !== leftBuild.id) ||
      null;

    if (!rightBuild) return null;

    const leftEval = evaluateBuildSnapshot(leftBuild, nodes);
    const rightEval = evaluateBuildSnapshot(rightBuild, nodes);

    const setLeft = new Set(leftBuild.allocatedIds || []);
    const setRight = new Set(rightBuild.allocatedIds || []);
    let sharedNodes = 0;
    for (const nid of setLeft) {
      if (setRight.has(nid)) sharedNodes++;
    }

    return {
      leftName: leftBuild.name,
      rightName: rightBuild.name,
      left: leftEval,
      right: rightEval,
      sharedNodes,
      onlyLeftNodes: setLeft.size - sharedNodes,
      onlyRightNodes: setRight.size - sharedNodes,
    };
  }, [
    compareLeftId,
    compareRightId,
    savedBuilds,
    nodes,
    allocatedIds,
    weaponBaseDps,
    baseGemLevel,
    bonusSkillLevels,
    gearSpirit,
    activeSpiritIds,
    activeAscendancy,
    selectedBaseClassName,
    activeAscNodes,
  ]);

  useEffect(() => {
    loadTreeFromRust();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        runUpdate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const unlisten = listen<string>('game-data-updated', () => loadTreeFromRust());

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlisten.then((fn) => fn());
    };
  }, []);

  const spiritUsageRatio = Math.min(
    (spiritSummary.usedSpirit / Math.max(spiritSummary.maxSpirit, 1)) * 100,
    100
  );

  const renderDiffBadge = (diffVal: number, suffix = '') => {
    if (diffVal === 0) {
      return <span style={{ color: '#64748b', fontSize: 11 }}>0{suffix}</span>;
    }
    const positive = diffVal > 0;
    return (
      <span
        style={{
          color: positive ? '#4ade80' : '#f87171',
          fontWeight: 'bold',
          fontSize: 11,
        }}
      >
        {positive ? `+${diffVal.toLocaleString()}` : diffVal.toLocaleString()}
        {suffix}
      </span>
    );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Yatay Kaydırmalı Üst Kontrol Çubuğu */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '10px 16px',
          background: '#131722',
          borderBottom: '1px solid #262b36',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          zIndex: 20,
        }}
      >
        <strong style={{ color: '#f59e0b', flexShrink: 0 }}>PoE 2 Theorycrafter</strong>

        <select
          value={selectedStartId}
          onChange={(e) => handleClassChange(Number(e.target.value))}
          style={{
            background: '#1e2430',
            border: '1px solid #334155',
            color: '#fff',
            padding: '6px 9px',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {classes.length > 0 ? (
            classes.map((c) => (
              <option key={c.start_node_id} value={c.start_node_id}>
                {c.name}
              </option>
            ))
          ) : (
            <option value={selectedStartId}>Başlangıç Düğümü</option>
          )}
        </select>

        {/* Ascendancy (Alt Sınıf - 8 Puan) Açılır Butonu */}
        <button
          onClick={() => {
            setIsAscDrawerOpen((prev) => !prev);
            setIsWeightDrawerOpen(false);
          }}
          style={{
            background: isAscDrawerOpen ? '#4c1d95' : '#1e2430',
            border: isAscDrawerOpen ? '1px solid #c084fc' : '1px solid #6b21a8',
            color: '#f3e8ff',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#c084fc', fontWeight: 'bold', fontSize: 12 }}>
            {activeAscendancy?.name || 'Ascendancy'}
          </span>
          <span
            style={{
              fontSize: 11,
              background: '#2e1065',
              color: '#e9d5ff',
              padding: '1px 5px',
              borderRadius: 4,
            }}
          >
            {activeAscNodes.length * 2}/8p
          </span>
          <span style={{ fontSize: 10, color: '#c084fc' }}>{isAscDrawerOpen ? '▲' : '▼'}</span>
        </button>

        {/* %100 Dengeli Stat Ağırlıkları Açılır Butonu */}
        <button
          onClick={() => {
            setIsWeightDrawerOpen((prev) => !prev);
            setIsAscDrawerOpen(false);
          }}
          title={activeWeightsSummary}
          style={{
            background: isWeightDrawerOpen ? '#1e3a8a' : '#1e2430',
            border: isWeightDrawerOpen ? '1px solid #38bdf8' : '1px solid #334155',
            color: '#e2e8f0',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 270,
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: 12 }}>
            Dağılım:
          </span>
          <span
            style={{
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeWeightsSummary}
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {isWeightDrawerOpen ? '▲' : '▼'}
          </span>
        </button>

        {/* Pasif Puan Bütçesi (Sınır: 1 - 128) */}
        <input
          type="number"
          min={LIMITS.maxPoints.min}
          max={LIMITS.maxPoints.max}
          title={`Pasif Puan Sınırı: ${LIMITS.maxPoints.min} - ${LIMITS.maxPoints.max}`}
          value={maxPoints}
          onChange={(e) =>
            setMaxPoints(clampInt(Number(e.target.value), LIMITS.maxPoints.min, LIMITS.maxPoints.max))
          }
          style={{
            width: 54,
            background: '#1e2430',
            border: '1px solid #334155',
            color: '#fff',
            padding: '6px 7px',
            borderRadius: 4,
            flexShrink: 0,
          }}
        />

        <button
          onClick={runOptimizer}
          style={{
            background: '#f59e0b',
            color: '#000',
            fontWeight: 'bold',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          En İyi Build'i Çiz
        </button>

        <button
          onClick={() => setAllocatedIds([])}
          style={{
            background: '#1e2430',
            color: '#cbd5e1',
            border: '1px solid #334155',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Sıfırla
        </button>

        <button
          onClick={runUpdate}
          style={{
            background: '#334155',
            color: '#fff',
            border: 'none',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Patch Güncelle (Ctrl+U)
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
          {status}
        </span>
      </div>

      {/* Ana Alan: Sol Canvas + Sağ Sekmeli Panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          {/* Ascendancy (Alt Sınıf - 8 Puan) Seçim Çekmecesi */}
          {isAscDrawerOpen && activeAscendancy && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 16,
                zIndex: 30,
                width: 410,
                maxHeight: '76vh',
                overflowY: 'auto',
                background: 'rgba(15, 23, 42, 0.97)',
                border: '1px solid #a855f7',
                borderRadius: 8,
                padding: 14,
                boxShadow: '0 10px 25px rgba(0,0,0,0.65)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13, color: '#c084fc' }}>
                    {selectedBaseClassName} Ascendancy
                  </strong>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 'bold',
                      background: '#2e1065',
                      color: '#e9d5ff',
                      border: '1px solid #7e22ce',
                      padding: '1px 7px',
                      borderRadius: 10,
                    }}
                  >
                    {activeAscNodes.length * 2} / 8 Puan
                  </span>
                </div>
                <button
                  onClick={() => setIsAscDrawerOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {availableAscendancies.map((asc) => {
                  const isSelected = asc.id === activeAscendancy.id;
                  return (
                    <button
                      key={asc.id}
                      onClick={() => handleAscendancyChange(asc.id)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 5,
                        fontSize: 12,
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        background: isSelected ? '#6b21a8' : '#1e293b',
                        color: isSelected ? '#fff' : '#cbd5e1',
                        border: isSelected ? '1px solid #c084fc' : '1px solid #334155',
                      }}
                    >
                      {asc.name}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Maksimum <b>4 Major Ascendancy Notable</b> (8 Puan) seçebilirsin:
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeAscendancy.nodes.map((node) => {
                  const active = selectedAscNodeIds.includes(node.id);
                  return (
                    <div
                      key={node.id}
                      onClick={() => toggleAscendancyNode(node.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: active ? '#2e1065' : '#161b26',
                        border: active ? '1px solid #c084fc' : '1px solid #1e293b',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <strong style={{ fontSize: 12, color: active ? '#f3e8ff' : '#f8fafc' }}>
                          {active ? '★ ' : ''}{node.name}
                        </strong>
                        <span style={{ fontSize: 11, color: active ? '#d8b4fe' : '#94a3b8' }}>
                          {node.desc}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 'bold',
                          color: active ? '#e9d5ff' : '#64748b',
                          background: '#0f172a',
                          padding: '2px 6px',
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      >
                        2 Puan
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* %100 Otomatik Dengelenen Kaydırmalı (Slider) Stat Ağırlık Ayar Paneli */}
          {isWeightDrawerOpen && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 16,
                zIndex: 30,
                width: 400,
                maxHeight: '75vh',
                overflowY: 'auto',
                background: 'rgba(15, 23, 42, 0.97)',
                border: '1px solid #38bdf8',
                borderRadius: 8,
                padding: 14,
                boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13, color: '#38bdf8' }}>
                    Stat Paylaşımı
                  </strong>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 'bold',
                      background: '#052e16',
                      color: '#4ade80',
                      border: '1px solid #166534',
                      padding: '1px 7px',
                      borderRadius: 10,
                    }}
                  >
                    Toplam: %{totalWeightPct}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statWeights.length > 1 && (
                    <button
                      onClick={distributeEqually}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        borderRadius: 4,
                        padding: '2px 7px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Eşit Dağıt
                    </button>
                  )}
                  <button
                    onClick={() => setIsWeightDrawerOpen(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[
                  {
                    label: '⚡ Lightning + Crit',
                    items: [
                      { stat: 'Lightning Damage', weight: 60 },
                      { stat: 'Critical', weight: 25 },
                      { stat: 'Energy Shield', weight: 15 },
                    ],
                  },
                  {
                    label: '🔥 Fire + Armour + Life',
                    items: [
                      { stat: 'Fire Damage', weight: 55 },
                      { stat: 'Armour', weight: 25 },
                      { stat: 'Maximum Life', weight: 20 },
                    ],
                  },
                  {
                    label: '❄ Cold + Cast Speed',
                    items: [
                      { stat: 'Cold Damage', weight: 55 },
                      { stat: 'Critical', weight: 25 },
                      { stat: 'Cast Speed', weight: 20 },
                    ],
                  },
                  {
                    label: '💀 Minion + ES',
                    items: [
                      { stat: 'Minion', weight: 65 },
                      { stat: 'Energy Shield', weight: 20 },
                      { stat: 'Maximum Life', weight: 15 },
                    ],
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setStatWeights(normalizeToHundred(preset.items))}
                    style={{
                      background: '#1e293b',
                      color: '#cbd5e1',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      padding: '3px 7px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statWeights.map((item) => (
                  <div
                    key={item.stat}
                    style={{
                      background: '#161b26',
                      padding: '8px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 'bold', color: '#f8fafc' }}>
                        {item.stat}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 12, color: '#f59e0b', width: 38, textAlign: 'right' }}>
                          %{item.weight}
                        </strong>
                        <button
                          onClick={() => removeStatWeight(item.stat)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#f87171',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={item.weight}
                      onChange={(e) => updateStatWeight(item.stat, Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <select
                  value={newStatName}
                  onChange={(e) => setNewStatName(e.target.value)}
                  style={{
                    flex: 1,
                    background: '#1e2430',
                    border: '1px solid #334155',
                    color: '#fff',
                    padding: '5px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {AVAILABLE_STATS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => addStatWeight(newStatName)}
                  style={{
                    background: '#38bdf8',
                    color: '#000',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: 4,
                    padding: '5px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  + Ekle
                </button>
              </div>

              <button
                onClick={runOptimizer}
                style={{
                  background: '#f59e0b',
                  color: '#000',
                  fontWeight: 'bold',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Bu Dağılımla Build'i Çiz (%100)
              </button>
            </div>
          )}

          {/* Harita Üzerinde Yüzen Düğüm / Keystone Arama Çubuğu */}
          <div
            style={{
              position: 'absolute',
              top: 14,
              right: 16,
              zIndex: 15,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid #334155',
              padding: '6px 10px',
              borderRadius: 6,
              backdropFilter: 'blur(4px)',
            }}
          >
            <input
              value={nodeSearchQuery}
              onChange={(e) => setNodeSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusNextMatch();
                }
              }}
              placeholder="Ağaçta düğüm / Keystone ara (ör: Chaos, Spirit)..."
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f8fafc',
                fontSize: 12,
                width: 245,
              }}
            />
            {nodeSearchQuery.trim().length >= 2 && (
              <>
                <span style={{ fontSize: 11, color: '#00f5d4', fontWeight: 'bold' }}>
                  {matchedNodeIds.length > 0
                    ? `${focusIndex + 1}/${matchedNodeIds.length}`
                    : '0 sonuç'}
                </span>
                {matchedNodeIds.length > 0 && (
                  <button
                    onClick={focusNextMatch}
                    style={{
                      background: '#00f5d4',
                      color: '#042f2e',
                      fontWeight: 'bold',
                      border: 'none',
                      borderRadius: 4,
                      padding: '2px 7px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Odaklan
                  </button>
                )}
                <button
                  onClick={() => setNodeSearchQuery('')}
                  style={{
                    background: 'transparent',
                    color: '#94a3b8',
                    border: 'none',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>

          <SkillTreeCanvas
            nodes={nodes}
            spriteSheets={spriteSheets}
            allocatedIds={allocatedIds}
            highlightedIds={matchedNodeIds}
            focusTrigger={focusTrigger}
            selectedClass={selectedBaseClassName}
            selectedAscendancy={activeAscendancy?.name || ''}
            onToggleNode={handleToggleNode}
            onSetAllocatedIds={setAllocatedIds}
          />
        </div>

        {/* Sağ Panel */}
        <div
          style={{
            width: 395,
            background: '#0f131c',
            borderLeft: '1px solid #262b36',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 3 Sekme Başlığı */}
          <div style={{ display: 'flex', borderBottom: '1px solid #262b36' }}>
            <button
              onClick={() => setRightTab('stats')}
              style={{
                flex: 1,
                padding: '10px 6px',
                fontSize: 12,
                background: rightTab === 'stats' ? '#161b26' : 'transparent',
                color: rightTab === 'stats' ? '#f59e0b' : '#94a3b8',
                fontWeight: 'bold',
                border: 'none',
                borderBottom: rightTab === 'stats' ? '2px solid #f59e0b' : 'none',
                cursor: 'pointer',
              }}
            >
              Build & EHP ({allocatedIds.length})
            </button>
            <button
              onClick={() => setRightTab('gems')}
              style={{
                flex: 1,
                padding: '10px 6px',
                fontSize: 12,
                background: rightTab === 'gems' ? '#161b26' : 'transparent',
                color: rightTab === 'gems' ? '#38bdf8' : '#94a3b8',
                fontWeight: 'bold',
                border: 'none',
                borderBottom: rightTab === 'gems' ? '2px solid #38bdf8' : 'none',
                cursor: 'pointer',
              }}
            >
              Skill & Spirit
            </button>
            <button
              onClick={() => setRightTab('builds')}
              style={{
                flex: 1,
                padding: '10px 6px',
                fontSize: 12,
                background: rightTab === 'builds' ? '#161b26' : 'transparent',
                color: rightTab === 'builds' ? '#22c55e' : '#94a3b8',
                fontWeight: 'bold',
                border: 'none',
                borderBottom: rightTab === 'builds' ? '2px solid #22c55e' : 'none',
                cursor: 'pointer',
              }}
            >
              Kayıt & Kıyas ({savedBuilds.length})
            </button>
          </div>

          {/* Sekme İçeriği */}
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {rightTab === 'stats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeAscendancy && (
                  <div
                    onClick={() => setIsAscDrawerOpen(true)}
                    style={{
                      background: '#1e1035',
                      border: '1px solid #6b21a8',
                      borderRadius: 6,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 12, color: '#c084fc' }}>
                        Ascendancy: {activeAscendancy.name} ({activeAscNodes.length * 2}/8 Puan)
                      </strong>
                      <span style={{ fontSize: 11, color: '#a855f7' }}>Düzenle</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#d8b4fe' }}>
                      {activeAscNodes.length > 0
                        ? activeAscNodes.map((n) => n.name).join(' • ')
                        : 'Ascendancy düğümü seçilmedi'}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    background: '#131824',
                    border: '1px solid #1e293b',
                    borderRadius: 6,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: '#94a3b8' }}>
                      Savunma (Effective HP)
                    </span>
                    <strong style={{ fontSize: 16, color: '#22c55e' }}>
                      {combatSummary.effectiveHp.toLocaleString()} EHP
                    </strong>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Life: </span>
                      <strong style={{ color: '#f87171' }}>{combatSummary.totalLife}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>ES: </span>
                      <strong style={{ color: '#38bdf8' }}>{combatSummary.totalEs}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Armour: </span>
                      <strong style={{ color: '#fbbf24' }}>{combatSummary.totalArmour}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Evasion: </span>
                      <strong style={{ color: '#4ade80' }}>{combatSummary.totalEvasion}</strong>
                    </div>
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid #1e293b',
                      paddingTop: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#cbd5e1' }}>
                      Crit Şansı: <strong style={{ color: '#facc15' }}>%{combatSummary.effectiveCritChance}</strong>
                    </span>
                    <span style={{ color: '#cbd5e1' }}>
                      Crit Hasarı: <strong style={{ color: '#facc15' }}>+%{combatSummary.totalCritMultPct}</strong>
                    </span>
                  </div>
                </div>

                {Object.keys(aggregatedStats.totals).length === 0 &&
                aggregatedStats.rawLines.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    Sınıf seçip <b>En İyi Build'i Çiz</b> butonuna basın veya düğümlere tıklayarak puan verin.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(aggregatedStats.totals)
                      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                      .map(([label, val]) => (
                        <div
                          key={label}
                          style={{
                            fontSize: 13,
                            color: '#e2e8f0',
                            background: '#161b26',
                            padding: '6px 8px',
                            borderRadius: 4,
                          }}
                        >
                          <strong style={{ color: '#38bdf8' }}>
                            {val > 0 ? `+${Number(val.toFixed(1))}` : Number(val.toFixed(1))}
                          </strong>{' '}
                          {label}
                        </div>
                      ))}

                    {aggregatedStats.rawLines.map((line, i) => (
                      <div
                        key={`raw-${i}`}
                        style={{
                          fontSize: 12,
                          color: '#a78bfa',
                          background: '#161b26',
                          padding: '6px 8px',
                          borderRadius: 4,
                        }}
                      >
                        ★ {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'gems' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
                    Aktif Skill Gem ({activeGems.length} yetenek)
                  </div>
                  <input
                    value={gemSearch}
                    onChange={(e) => setGemSearch(e.target.value)}
                    placeholder="Örn: Tempest Flurry, Spark, Lightning Arrow..."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: '#1e2430',
                      border: '1px solid #334155',
                      color: '#fff',
                      padding: '6px 10px',
                      borderRadius: 4,
                      marginBottom: 6,
                    }}
                  />
                  <select
                    value={selectedSkillId}
                    onChange={(e) => setSelectedSkillId(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#1e2430',
                      border: '1px solid #334155',
                      color: '#fff',
                      padding: '7px 10px',
                      borderRadius: 4,
                    }}
                  >
                    {filteredActiveGems.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedSkillObj && selectedSkillObj.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {selectedSkillObj.tags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 11,
                          background: '#1e293b',
                          color: '#38bdf8',
                          padding: '2px 7px',
                          borderRadius: 10,
                          textTransform: 'capitalize',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    background: '#131824',
                    border: '1px solid #1e293b',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f59e0b' }}>
                    Silah & Ekipman Çarpanları
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                        Silah Baz DPS (Max {LIMITS.weaponBaseDps.max.toLocaleString()})
                      </label>
                      <input
                        type="number"
                        min={LIMITS.weaponBaseDps.min}
                        max={LIMITS.weaponBaseDps.max}
                        value={weaponBaseDps}
                        onChange={(e) =>
                          setWeaponBaseDps(
                            clampInt(
                              Number(e.target.value),
                              LIMITS.weaponBaseDps.min,
                              LIMITS.weaponBaseDps.max
                            )
                          )
                        }
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: '#1e2430',
                          border: '1px solid #334155',
                          color: '#fff',
                          padding: '5px 8px',
                          borderRadius: 4,
                        }}
                      />
                    </div>

                    <div style={{ width: 66 }}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                        Gem (1-{LIMITS.baseGemLevel.max})
                      </label>
                      <input
                        type="number"
                        min={LIMITS.baseGemLevel.min}
                        max={LIMITS.baseGemLevel.max}
                        value={baseGemLevel}
                        onChange={(e) =>
                          setBaseGemLevel(
                            clampInt(
                              Number(e.target.value),
                              LIMITS.baseGemLevel.min,
                              LIMITS.baseGemLevel.max
                            )
                          )
                        }
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: '#1e2430',
                          border: '1px solid #334155',
                          color: '#fff',
                          padding: '5px 8px',
                          borderRadius: 4,
                        }}
                      />
                    </div>

                    <div style={{ width: 76 }}>
                      <label style={{ fontSize: 11, color: '#38bdf8', display: 'block', marginBottom: 2 }}>
                        +Lvl (0-{LIMITS.bonusSkillLevels.max})
                      </label>
                      <input
                        type="number"
                        min={LIMITS.bonusSkillLevels.min}
                        max={LIMITS.bonusSkillLevels.max}
                        value={bonusSkillLevels}
                        onChange={(e) =>
                          setBonusSkillLevels(
                            clampInt(
                              Number(e.target.value),
                              LIMITS.bonusSkillLevels.min,
                              LIMITS.bonusSkillLevels.max
                            )
                          )
                        }
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: '#1e2430',
                          border: '1px solid #38bdf8',
                          color: '#fff',
                          padding: '5px 8px',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Etkin Seviye: <strong style={{ color: '#fff' }}>Lv.{dpsBreakdown.effectiveLevel}</strong></span>
                    <span style={{ color: '#38bdf8' }}>+{dpsBreakdown.bonusLevelGainPct}% Taban Hasar</span>
                  </div>
                </div>

                {/* Spirit Bütçesi & Herald / Aura / Meta Gem Yöneticisi */}
                <div
                  style={{
                    background: '#131824',
                    border:
                      spiritSummary.remainingSpirit < 0
                        ? '1px solid #ef4444'
                        : '1px solid #1e293b',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: '#c084fc' }}>
                      Spirit Bütçesi & Aura / Herald
                    </span>
                    <strong
                      style={{
                        fontSize: 12,
                        color: spiritSummary.remainingSpirit < 0 ? '#f87171' : '#c084fc',
                      }}
                    >
                      {spiritSummary.usedSpirit} / {spiritSummary.maxSpirit} Spirit
                    </strong>
                  </div>

                  <div
                    style={{
                      width: '100%',
                      height: 6,
                      background: '#1e293b',
                      borderRadius: 4,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${spiritUsageRatio}%`,
                        height: '100%',
                        background:
                          spiritSummary.remainingSpirit < 0 ? '#ef4444' : '#a855f7',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                    <span style={{ color: '#94a3b8' }}>
                      100 Görev + {spiritSummary.treeSpirit} Ağaç/Asc + Ekipman:
                    </span>
                    <input
                      type="number"
                      min={LIMITS.gearSpirit.min}
                      max={LIMITS.gearSpirit.max}
                      value={gearSpirit}
                      onChange={(e) =>
                        setGearSpirit(
                          clampInt(
                            Number(e.target.value),
                            LIMITS.gearSpirit.min,
                            LIMITS.gearSpirit.max
                          )
                        )
                      }
                      style={{
                        width: 64,
                        background: '#1e2430',
                        border: '1px solid #334155',
                        color: '#fff',
                        padding: '3px 6px',
                        borderRadius: 4,
                        fontSize: 11,
                      }}
                    />
                  </div>

                  {spiritSummary.remainingSpirit < 0 && (
                    <div style={{ fontSize: 11, color: '#f87171', fontWeight: 'bold' }}>
                      ⚠ Spirit kapasitesi {Math.abs(spiritSummary.remainingSpirit)} puan aşıldı!
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      maxHeight: 155,
                      overflowY: 'auto',
                      paddingRight: 2,
                    }}
                  >
                    {allSpiritBuffs.map((buff) => {
                      const active = activeSpiritIds.includes(buff.id);
                      return (
                        <div
                          key={buff.id}
                          onClick={() => toggleSpiritBuff(buff.id)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '5px 8px',
                            borderRadius: 4,
                            background: active ? '#2e1065' : '#161b26',
                            border: active ? '1px solid #a855f7' : '1px solid #1e293b',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 12, fontWeight: 'bold', color: active ? '#f3e8ff' : '#cbd5e1' }}>
                              {active ? '✓ ' : ''}{buff.name}
                            </span>
                            <span style={{ fontSize: 10, color: active ? '#d8b4fe' : '#64748b' }}>
                              {buff.effectLabel}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 'bold',
                              color: active ? '#e9d5ff' : '#94a3b8',
                              background: '#0f172a',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {buff.cost} Sp
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Crit & Support & Spirit & Ascendancy Dahil Toplam DPS Özeti */}
                <div
                  style={{
                    background: 'linear-gradient(135deg, #161b26 0%, #1e293b 100%)',
                    border: '1px solid #f59e0b',
                    padding: '10px 12px',
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#cbd5e1' }}>Toplam DPS:</span>
                    <strong style={{ color: '#f59e0b', fontSize: 18 }}>
                      {dpsBreakdown.finalDps.toLocaleString()} DPS
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>
                      Crit: %{combatSummary.effectiveCritChance}
                    </span>
                    <span style={{ color: '#22c55e' }}>6-Link: +{dpsBreakdown.supportMorePct}%</span>
                    <span style={{ color: '#c084fc' }}>Spirit: +{dpsBreakdown.spiritMorePct}%</span>
                    <span style={{ color: '#f472b6' }}>Asc: +{dpsBreakdown.ascMorePct}%</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f8fafc' }}>
                  Önerilen Support Gem'ler (Uyum & DPS):
                </div>

                {recommendedSupports.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Bu yetenek için uyumlu Support Gem bulunamadı.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recommendedSupports.map((sup, idx) => (
                      <div
                        key={sup.id}
                        style={{
                          background: '#161b26',
                          borderLeft: idx < 5 ? '3px solid #22c55e' : '3px solid #64748b',
                          padding: '8px 10px',
                          borderRadius: 4,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 4,
                            gap: 6,
                          }}
                        >
                          <strong style={{ fontSize: 13, color: '#f8fafc' }}>
                            {idx + 1}. {sup.name}
                          </strong>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 'bold',
                                background: sup.match_score_pct >= 85 ? '#1e3a8a' : '#1e293b',
                                color: sup.match_score_pct >= 85 ? '#60a5fa' : '#94a3b8',
                                padding: '2px 6px',
                                borderRadius: 4,
                              }}
                            >
                              %{sup.match_score_pct} Öneri
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 'bold',
                                color: '#22c55e',
                              }}
                            >
                              +{sup.multiplier_pct}%
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{sup.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'builds' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* İki Build Arası Kıyaslama (Compare / Diff) Paneli */}
                {savedBuilds.length >= 1 && (
                  <div
                    style={{
                      background: '#131824',
                      border: '1px solid #f59e0b',
                      padding: 10,
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f59e0b' }}>
                      İki Build Kıyaslama (Compare / Diff)
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        value={compareLeftId}
                        onChange={(e) => setCompareLeftId(e.target.value)}
                        style={{
                          flex: 1,
                          background: '#1e2430',
                          border: '1px solid #334155',
                          color: '#fff',
                          padding: '4px 6px',
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        <option value="CURRENT">Aktif Build ({allocatedIds.length}p)</option>
                        {savedBuilds.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={compareRightId}
                        onChange={(e) => setCompareRightId(e.target.value)}
                        style={{
                          flex: 1,
                          background: '#1e2430',
                          border: '1px solid #334155',
                          color: '#fff',
                          padding: '4px 6px',
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        {savedBuilds.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                        <option value="CURRENT">Aktif Build ({allocatedIds.length}p)</option>
                      </select>
                    </div>

                    {comparisonData && (
                      <>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.1fr 1fr 1fr 0.9fr',
                            gap: 4,
                            fontSize: 11,
                            background: '#161b26',
                            padding: '6px 8px',
                            borderRadius: 4,
                          }}
                        >
                          <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>Metrik</span>
                          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>Build A</span>
                          <span style={{ color: '#c084fc', fontWeight: 'bold' }}>Build B</span>
                          <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>Fark (A-B)</span>

                          <span style={{ color: '#cbd5e1' }}>Tahmini DPS</span>
                          <span style={{ color: '#fff' }}>{comparisonData.left.estDps.toLocaleString()}</span>
                          <span style={{ color: '#fff' }}>{comparisonData.right.estDps.toLocaleString()}</span>
                          {renderDiffBadge(comparisonData.left.estDps - comparisonData.right.estDps)}

                          <span style={{ color: '#cbd5e1' }}>EHP</span>
                          <span style={{ color: '#fff' }}>{comparisonData.left.effectiveHp.toLocaleString()}</span>
                          <span style={{ color: '#fff' }}>{comparisonData.right.effectiveHp.toLocaleString()}</span>
                          {renderDiffBadge(comparisonData.left.effectiveHp - comparisonData.right.effectiveHp)}

                          <span style={{ color: '#cbd5e1' }}>Life</span>
                          <span style={{ color: '#fff' }}>{comparisonData.left.totalLife}</span>
                          <span style={{ color: '#fff' }}>{comparisonData.right.totalLife}</span>
                          {renderDiffBadge(comparisonData.left.totalLife - comparisonData.right.totalLife)}

                          <span style={{ color: '#cbd5e1' }}>Energy Shield</span>
                          <span style={{ color: '#fff' }}>{comparisonData.left.totalEs}</span>
                          <span style={{ color: '#fff' }}>{comparisonData.right.totalEs}</span>
                          {renderDiffBadge(comparisonData.left.totalEs - comparisonData.right.totalEs)}

                          <span style={{ color: '#cbd5e1' }}>Crit Şansı</span>
                          <span style={{ color: '#fff' }}>%{comparisonData.left.effectiveCrit}</span>
                          <span style={{ color: '#fff' }}>%{comparisonData.right.effectiveCrit}</span>
                          {renderDiffBadge(
                            Number((comparisonData.left.effectiveCrit - comparisonData.right.effectiveCrit).toFixed(1)),
                            '%'
                          )}

                          <span style={{ color: '#cbd5e1' }}>Spirit Kap.</span>
                          <span style={{ color: '#fff' }}>{comparisonData.left.maxSpirit}</span>
                          <span style={{ color: '#fff' }}>{comparisonData.right.maxSpirit}</span>
                          {renderDiffBadge(comparisonData.left.maxSpirit - comparisonData.right.maxSpirit)}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 11,
                            color: '#94a3b8',
                            paddingTop: 2,
                          }}
                        >
                          <span>Ortak Düğüm: <strong style={{ color: '#22c55e' }}>{comparisonData.sharedNodes}</strong></span>
                          <span>Sadece A: <strong style={{ color: '#38bdf8' }}>{comparisonData.onlyLeftNodes}</strong></span>
                          <span>Sadece B: <strong style={{ color: '#c084fc' }}>{comparisonData.onlyRightNodes}</strong></span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div
                  style={{
                    background: '#131824',
                    border: '1px solid #1e293b',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: '#22c55e' }}>
                    Mevcut Build'i Kaydet
                  </div>
                  <input
                    value={buildName}
                    onChange={(e) => setBuildName(e.target.value)}
                    maxLength={60}
                    placeholder="Build adı (ör. Invoker Crit vs ES)..."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: '#1e2430',
                      border: '1px solid #334155',
                      color: '#fff',
                      padding: '6px 10px',
                      borderRadius: 4,
                    }}
                  />
                  <button
                    onClick={handleSaveCurrentBuild}
                    style={{
                      background: '#22c55e',
                      color: '#000',
                      fontWeight: 'bold',
                      border: 'none',
                      padding: '7px 12px',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Kaydet ({allocatedIds.length} Puan)
                  </button>
                </div>

                <div
                  style={{
                    background: '#131824',
                    border: '1px solid #1e293b',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: '#38bdf8' }}>
                    Build Paylaşım Kodu (Export / Import)
                  </div>
                  <textarea
                    rows={3}
                    value={shareCodeInput}
                    onChange={(e) => setShareCodeInput(e.target.value)}
                    placeholder="Kodu dışa aktarmak için aşağıya tıklayın veya POE2TC:... kodunu buraya yapıştırın"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: '#1e2430',
                      border: '1px solid #334155',
                      color: '#cbd5e1',
                      fontSize: 11,
                      padding: '6px 8px',
                      borderRadius: 4,
                      resize: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={generateShareCode}
                      style={{
                        flex: 1,
                        background: '#38bdf8',
                        color: '#000',
                        fontWeight: 'bold',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Kodu Oluştur & Kopyala
                    </button>
                    <button
                      onClick={importShareCode}
                      style={{
                        flex: 1,
                        background: '#334155',
                        color: '#fff',
                        fontWeight: 'bold',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Kodu Yükle
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f8fafc' }}>
                  Kayıtlı Build'ler ({savedBuilds.length})
                </div>

                {savedBuilds.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Henüz kaydedilmiş bir build yok. Build kaydettiğinde yukarıda otomatik kıyaslama tablosu açılır.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {savedBuilds.map((b) => (
                      <div
                        key={b.id}
                        style={{
                          background: '#161b26',
                          border: '1px solid #1e293b',
                          padding: '8px 10px',
                          borderRadius: 4,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: 13, color: '#f8fafc' }}>{b.name}</strong>
                          <span style={{ fontSize: 11, color: '#64748b' }}>{b.createdAt}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          Hedef: {b.targetStat} • {b.allocatedIds.length} Puan
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => applyBuildData(b, b.name)}
                            style={{
                              flex: 1,
                              background: '#f59e0b',
                              color: '#000',
                              fontWeight: 'bold',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            Yükle
                          </button>
                          <button
                            onClick={() =>
                              persistBuilds(savedBuilds.filter((item) => item.id !== b.id))
                            }
                            style={{
                              background: '#1e293b',
                              color: '#f87171',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}