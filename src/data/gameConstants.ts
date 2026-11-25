export interface StatWeightItem {
  stat: string;
  weight: number;
}

export interface SpiritBuffDef {
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

export interface AscendancyNodeDef {
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

export interface AscendancyDef {
  id: string;
  name: string;
  baseClass: string;
  nodes: AscendancyNodeDef[];
}

export const STORAGE_KEY = 'poe2_theorycrafter_saved_builds_v1';

export const LIMITS = {
  maxPoints: { min: 1, max: 128 },
  weaponBaseDps: { min: 1, max: 25000 },
  baseGemLevel: { min: 1, max: 21 },
  bonusSkillLevels: { min: 0, max: 15 },
  gearSpirit: { min: 0, max: 500 },
  maxAscendancyNodes: 4,
} as const;

export const ASCENDANCIES: AscendancyDef[] = [
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

export const AVAILABLE_STATS = [
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

export const CORE_SPIRIT_BUFFS: SpiritBuffDef[] = [
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

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function normalizeToHundred(items: StatWeightItem[]): StatWeightItem[] {
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
  const remainder = 100 - floored.reduce((s, v) => s + v, 0);

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

export function rebalanceWeights(
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
    const rem = remaining - base * others.length;
    others.forEach((o, idx) => {
      otherAllocations.set(o.stat, base + (idx < rem ? 1 : 0));
    });
  } else {
    const raw = others.map((o) => (o.weight / othersTotal) * remaining);
    const floored = raw.map((v) => Math.floor(v));
    const rem = remaining - floored.reduce((s, v) => s + v, 0);

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