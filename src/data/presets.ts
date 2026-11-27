// Hazır stat ağırlığı şablonları. `label` i18n anahtarıdır; stat adları AVAILABLE_STATS içinden gelir.
export interface WeightPreset {
  id: string;
  label: string;
  weights: { stat: string; weight: number }[];
}

export const WEIGHT_PRESETS: WeightPreset[] = [
  {
    id: 'crit-spell',
    label: 'Kritik Büyücü',
    weights: [
      { stat: 'Spell Damage', weight: 40 },
      { stat: 'Critical', weight: 35 },
      { stat: 'Cast Speed', weight: 15 },
      { stat: 'Energy Shield', weight: 10 },
    ],
  },
  {
    id: 'lightning',
    label: 'Lightning Büyücü',
    weights: [
      { stat: 'Lightning Damage', weight: 55 },
      { stat: 'Critical', weight: 25 },
      { stat: 'Energy Shield', weight: 20 },
    ],
  },
  {
    id: 'fire-cold',
    label: 'Fire / Cold Büyücü',
    weights: [
      { stat: 'Fire Damage', weight: 35 },
      { stat: 'Cold Damage', weight: 35 },
      { stat: 'Cast Speed', weight: 15 },
      { stat: 'Energy Shield', weight: 15 },
    ],
  },
  {
    id: 'attack-speed',
    label: 'Hızlı Saldırgan',
    weights: [
      { stat: 'Attack Speed', weight: 40 },
      { stat: 'Physical Damage', weight: 30 },
      { stat: 'Critical', weight: 20 },
      { stat: 'Maximum Life', weight: 10 },
    ],
  },
  {
    id: 'evasion-attacker',
    label: 'Evasion Saldırgan',
    weights: [
      { stat: 'Evasion', weight: 35 },
      { stat: 'Attack Speed', weight: 30 },
      { stat: 'Critical', weight: 20 },
      { stat: 'Physical Damage', weight: 15 },
    ],
  },
  {
    id: 'minion',
    label: 'Minion',
    weights: [
      { stat: 'Minion', weight: 70 },
      { stat: 'Spirit', weight: 15 },
      { stat: 'Maximum Life', weight: 15 },
    ],
  },
  {
    id: 'tank',
    label: 'Tank (Life / Armour)',
    weights: [
      { stat: 'Maximum Life', weight: 50 },
      { stat: 'Armour', weight: 35 },
      { stat: 'Physical Damage', weight: 15 },
    ],
  },
  {
    id: 'es-stack',
    label: 'Energy Shield Odaklı',
    weights: [
      { stat: 'Energy Shield', weight: 55 },
      { stat: 'Spell Damage', weight: 25 },
      { stat: 'Spirit', weight: 20 },
    ],
  },
];
