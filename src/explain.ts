// Optimizer sonucunu açıklar: hangi düğümler neden seçildi.
// score_node (src-tauri/src/optimizer/tree_solver.rs) ile aynı eşleştirme mantığını kullanır.
import type { PassiveNode } from './components/SkillTreeCanvas';

export interface AllocationExplanation {
  totalNodes: number;
  /** Ağırlıklı her stat için o stata katkı veren düğüm sayısı (en çok olandan başlayarak) */
  perStat: { stat: string; nodes: number }[];
  /** Hedefe katkı sağlayan Keystone / Notable düğümleri (ad + eşleşen satırlar) */
  highlights: { name: string; kind: 'keystone' | 'notable'; lines: string[] }[];
  /** Hiçbir hedef statına katkısı olmayan düğümler (yol / bağlantı maliyeti) */
  travelNodes: number;
}

function lineMatches(lower: string, key: string): boolean {
  return lower.includes(key.toLowerCase());
}

export function explainAllocation(
  nodes: Record<number, PassiveNode>,
  allocatedIds: number[],
  weights: Record<string, number>
): AllocationExplanation {
  const keys = Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([k]) => k.toLowerCase());
  const perStat = new Map<string, number>(keys.map((k) => [k, 0]));
  const highlights: AllocationExplanation['highlights'] = [];
  let travel = 0;
  let total = 0;

  for (const id of allocatedIds) {
    const node = nodes[id];
    if (!node) continue;
    total++;
    const matchedKeys = new Set<string>();
    const matchedLines: string[] = [];
    for (const line of node.stats) {
      const lower = line.toLowerCase();
      if (lower.includes('reduced') || lower.includes('less')) continue;
      let hit = false;
      for (const k of keys) {
        if (lineMatches(lower, k)) {
          matchedKeys.add(k);
          hit = true;
        }
      }
      if (hit) matchedLines.push(line);
    }
    if (matchedKeys.size === 0) {
      travel++;
      continue;
    }
    for (const k of matchedKeys) perStat.set(k, (perStat.get(k) || 0) + 1);
    if (node.is_keystone || node.is_notable) {
      highlights.push({
        name: node.name || `#${node.id}`,
        kind: node.is_keystone ? 'keystone' : 'notable',
        lines: matchedLines.slice(0, 2),
      });
    }
  }

  highlights.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'keystone' ? -1 : 1));
  return {
    totalNodes: total,
    perStat: [...perStat.entries()]
      .map(([stat, nodes]) => ({ stat, nodes }))
      .sort((a, b) => b.nodes - a.nodes),
    highlights,
    travelNodes: travel,
  };
}
