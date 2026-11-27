import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Lang, getLang, setLang, t, tReason } from './i18n';
import { PassiveNode, SkillTreeCanvas } from './components/SkillTreeCanvas';
import {
  ASCENDANCIES,
  AVAILABLE_STATS,
  CORE_SPIRIT_BUFFS,
  LIMITS,
  STORAGE_KEY,
  SpiritBuffDef,
  StatWeightItem,
  clampInt,
  normalizeToHundred,
  rebalanceWeights,
} from './data/gameConstants';

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

interface BuildEvaluationResult {
  parsed: {
    totals: Record<string, number>;
    extra_damage_pct: Record<string, number>;
    more_multipliers: number[];
    raw_lines: string[];
  };
  points: number;
  effective_hp: number;
  total_life: number;
  total_es: number;
  total_armour: number;
  total_evasion: number;
  effective_crit: number;
  total_crit_mult_pct: number;
  est_dps: number;
  max_spirit: number;
  used_spirit: number;
  remaining_spirit: number;
  tree_and_asc_spirit: number;
  support_more_pct: number;
  support_count: number;
  spirit_more_pct: number;
  asc_more_pct: number;
  effective_level: number;
  bonus_level_gain_pct: number;
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

const EMPTY_EVAL: BuildEvaluationResult = {
  parsed: { totals: {}, extra_damage_pct: {}, more_multipliers: [], raw_lines: [] },
  points: 0,
  effective_hp: 0,
  total_life: 1150,
  total_es: 450,
  total_armour: 1800,
  total_evasion: 1800,
  effective_crit: 8.0,
  total_crit_mult_pct: 100,
  est_dps: 0,
  max_spirit: 100,
  used_spirit: 0,
  remaining_spirit: 100,
  tree_and_asc_spirit: 0,
  support_more_pct: 0,
  support_count: 0,
  spirit_more_pct: 0,
  asc_more_pct: 0,
  effective_level: 20,
  bonus_level_gain_pct: 0,
};

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  title?: string;
  style?: React.CSSProperties;
}

const NumberField: React.FC<NumberFieldProps> = ({
  value,
  min,
  max,
  onChange,
  title,
  style,
}) => {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      const clamped = clampInt(min, min, max);
      setText(String(clamped));
      onChange(clamped);
      return;
    }
    const parsed = Number(trimmed);
    const clamped = clampInt(Number.isFinite(parsed) ? parsed : min, min, max);
    setText(String(clamped));
    onChange(clamped);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      title={title}
      onChange={(e) => {
        const next = e.target.value;
        if (/^-?\d*$/.test(next)) {
          setText(next);
          if (next !== '' && next !== '-') {
            const num = Number(next);
            if (Number.isFinite(num) && num >= min && num <= max) {
              onChange(Math.round(num));
            }
          }
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      style={style}
    />
  );
};

export default function App() {
  const [nodes, setNodes] = useState<Record<number, PassiveNode>>({});
  const [classes, setClasses] = useState<ClassStart[]>([]);
  const [spriteSheets, setSpriteSheets] = useState<Record<string, string>>({});
  const [selectedStartId, setSelectedStartId] = useState<number>(0);
  const [allocatedIds, setAllocatedIds] = useState<number[]>([]);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [status, setStatus] = useState<string>(t("Hazır"));
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'success' | 'error' } | null>(
    null
  );
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [maxPoints, setMaxPoints] = useState<number>(80);

  const selectedStartIdRef = useRef<number>(selectedStartId);
  selectedStartIdRef.current = selectedStartId;

  const showNotice = (text: string, tone: 'info' | 'success' | 'error' = 'info') => {
    setStatus(text);
    setToast({ text, tone });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Ascendancy
  const [selectedAscendancyId, setSelectedAscendancyId] = useState<string>('');
  const [selectedAscNodeIds, setSelectedAscNodeIds] = useState<string[]>([]);
  const [isAscDrawerOpen, setIsAscDrawerOpen] = useState<boolean>(false);

  // Stat Ağırlıkları
  const [statWeights, setStatWeights] = useState<StatWeightItem[]>([
    { stat: 'Lightning Damage', weight: 60 },
    { stat: 'Critical', weight: 25 },
    { stat: 'Energy Shield', weight: 15 },
  ]);
  const [isWeightDrawerOpen, setIsWeightDrawerOpen] = useState<boolean>(false);
  const [newStatName, setNewStatName] = useState<string>('Maximum Life');

  const drawerContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAscDrawerOpen(false);
        setIsWeightDrawerOpen(false);
      }
    };
    const handleOutsideClick = (e: MouseEvent) => {
      if (!isAscDrawerOpen && !isWeightDrawerOpen) return;
      if (drawerContainerRef.current && !drawerContainerRef.current.contains(e.target as Node)) {
        setIsAscDrawerOpen(false);
        setIsWeightDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('keydown', handleGlobalKey);
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isAscDrawerOpen, isWeightDrawerOpen]);

  // Ağaç Arama
  const [nodeSearchQuery, setNodeSearchQuery] = useState<string>('');
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [focusTrigger, setFocusTrigger] = useState<{ nodeId: number; seq: number } | null>(null);

  // Sağ Panel & Gem / Silah / Spirit
  const [rightTab, setRightTab] = useState<'stats' | 'gems' | 'builds'>('stats');
  const [activeGems, setActiveGems] = useState<GemData[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [gemSearch, setGemSearch] = useState<string>('');
  const [recommendedSupports, setRecommendedSupports] = useState<SupportRecommendation[]>([]);

  const [weaponBaseDps, setWeaponBaseDps] = useState<number>(520);
  const [baseGemLevel, setBaseGemLevel] = useState<number>(20);
  const [bonusSkillLevels, setBonusSkillLevels] = useState<number>(0);

  const [gearSpirit, setGearSpirit] = useState<number>(0);
  const [activeSpiritIds, setActiveSpiritIds] = useState<string[]>([]);

  // Rust Hesaplama Sonuçları
  const [currentEvaluation, setCurrentEvaluation] = useState<BuildEvaluationResult>(EMPTY_EVAL);
  const [comparisonResults, setComparisonResults] = useState<{
    leftName: string;
    rightName: string;
    left: BuildEvaluationResult;
    right: BuildEvaluationResult;
    sharedNodes: number;
    onlyLeftNodes: number;
    onlyRightNodes: number;
  } | null>(null);

  // Build Kayıt & Paylaşım
  const [buildName, setBuildName] = useState<string>('');
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      // Bozuk/elle değiştirilmiş kayıt beyaz ekrana yol açmasın
      return Array.isArray(parsed)
        ? parsed.filter(
            (b) => b && typeof b === 'object' && typeof b.id === 'string' && Array.isArray(b.allocatedIds)
          )
        : [];
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

  const selectedBaseClassName = useMemo(
    () => classes.find((c) => c.start_node_id === selectedStartId)?.name || '',
    [classes, selectedStartId]
  );

  const availableAscendancies = useMemo(() => {
    if (!selectedBaseClassName) return ASCENDANCIES;
    return ASCENDANCIES.filter(
      (a) => a.baseClass.toLowerCase() === selectedBaseClassName.toLowerCase()
    );
  }, [selectedBaseClassName]);

  const activeAscendancy = useMemo(() => {
    if (availableAscendancies.length === 0) return undefined;
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
          effectLabel: "+15% More Sinerji Hasarı",
          moreDpsPct: 15,
        });
      }
    }
    return list;
  }, [activeGems]);

  // Build isteğini Rust formatına dönüştüren yardımcı
  const buildRustRequest = useCallback(
    (
      b: {
        allocatedIds: number[];
        selectedSkillId?: string;
        weaponBaseDps: number;
        baseGemLevel: number;
        bonusSkillLevels: number;
        gearSpirit?: number;
        activeSpiritIds?: string[];
        ascendancyId?: string;
        ascendancyNodeIds?: string[];
      },
      supportsList: SupportRecommendation[] = []
    ) => {
      const asc = ASCENDANCIES.find((a) => a.id === b.ascendancyId);
      const ascNodes = asc
        ? asc.nodes
            .filter((n) => (b.ascendancyNodeIds || []).includes(n.id))
            .slice(0, LIMITS.maxAscendancyNodes)
            .map((n) => ({
              id: n.id,
              name: n.name,
              more_dps_pct: n.moreDpsPct || 0,
              inc_crit_chance: n.incCritChance || 0,
              crit_damage_bonus: n.critDamageBonus || 0,
              inc_life_pct: n.incLifePct || 0,
              inc_es_pct: n.incEsPct || 0,
              inc_armour_pct: n.incArmourPct || 0,
              inc_evasion_pct: n.incEvasionPct || 0,
              bonus_spirit: n.bonusSpirit || 0,
            }))
        : [];

      const spiritBuffs = allSpiritBuffs
        .filter((sb) => (b.activeSpiritIds || []).includes(sb.id))
        .map((sb) => ({
          id: sb.id,
          name: sb.name,
          cost: sb.cost,
          more_dps_pct: sb.moreDpsPct || 0,
          required_tag: sb.requiredTag || null,
          inc_crit_chance: sb.incCritChance || 0,
          inc_evasion_pct: sb.incEvasionPct || 0,
          inc_es_pct: sb.incEsPct || 0,
        }));

      return {
        allocated_ids: b.allocatedIds || [],
        selected_skill_id: b.selectedSkillId || null,
        weapon_base_dps: b.weaponBaseDps || 520,
        base_gem_level: b.baseGemLevel || 20,
        bonus_skill_levels: b.bonusSkillLevels || 0,
        gear_spirit: b.gearSpirit || 0,
        active_spirit_buffs: spiritBuffs,
        active_ascendancy_nodes: ascNodes,
        supports: supportsList.slice(0, 5).map((s) => ({
          name: s.name,
          multiplier_pct: s.multiplier_pct,
        })),
      };
    },
    [allSpiritBuffs]
  );

  // Aktif build hesaplamasını Rust motorunda çalıştır
  useEffect(() => {
    if (Object.keys(nodes).length === 0) return;

    const req = buildRustRequest(
      {
        allocatedIds,
        selectedSkillId,
        weaponBaseDps,
        baseGemLevel,
        bonusSkillLevels,
        gearSpirit,
        activeSpiritIds,
        ascendancyId: activeAscendancy?.id,
        ascendancyNodeIds: activeAscNodes.map((n) => n.id),
      },
      recommendedSupports
    );

    invoke<BuildEvaluationResult>('evaluate_build', { req })
      .then((res) => setCurrentEvaluation(res))
      .catch(() => {});
  }, [
    nodes,
    allocatedIds,
    selectedSkillId,
    weaponBaseDps,
    baseGemLevel,
    bonusSkillLevels,
    gearSpirit,
    activeSpiritIds,
    activeAscendancy,
    activeAscNodes,
    recommendedSupports,
    buildRustRequest,
  ]);

  // İki build kıyaslamasını Rust motorunda toplu çalıştır
  useEffect(() => {
    if (Object.keys(nodes).length === 0 || savedBuilds.length === 0) {
      setComparisonResults(null);
      return;
    }

    const currentSnapshot = {
      id: 'CURRENT',
      name: t('Aktif Build ({name})', { name: activeAscendancy?.name || selectedBaseClassName || t('Mevcut') }),
      allocatedIds,
      selectedSkillId,
      weaponBaseDps,
      baseGemLevel,
      bonusSkillLevels,
      gearSpirit,
      activeSpiritIds,
      ascendancyId: activeAscendancy?.id,
      ascendancyNodeIds: activeAscNodes.map((n) => n.id),
    };

    const resolveBuild = (id: string) =>
      id === 'CURRENT' ? currentSnapshot : savedBuilds.find((b) => b.id === id) || null;

    const leftBuild = resolveBuild(compareLeftId) || currentSnapshot;
    const rightBuild =
      resolveBuild(compareRightId) || savedBuilds.find((b) => b.id !== leftBuild.id) || null;

    if (!rightBuild) {
      setComparisonResults(null);
      return;
    }

    let cancelled = false;
    // Kayıtlı build'ler için de aktif build gibi support önerileri hesaplanır;
    // aksi halde aynı build kıyaslamada "support'suz" görünüp yanlış fark üretir.
    const supportsFor = async (b: typeof leftBuild): Promise<SupportRecommendation[]> => {
      if (b.id === 'CURRENT') return recommendedSupports;
      if (!b.selectedSkillId) return [];
      try {
        return await invoke<SupportRecommendation[]>('recommend_support_gems', {
          activeSkillId: b.selectedSkillId,
          allocatedIds: b.allocatedIds || [],
        });
      } catch {
        return [];
      }
    };

    void (async () => {
      const [leftSup, rightSup] = await Promise.all([supportsFor(leftBuild), supportsFor(rightBuild)]);
      const leftReq = buildRustRequest(leftBuild, leftSup);
      const rightReq = buildRustRequest(rightBuild, rightSup);
      try {
        const [leftRes, rightRes] = await invoke<BuildEvaluationResult[]>('evaluate_builds_batch', {
          requests: [leftReq, rightReq],
        });
        if (cancelled || !leftRes || !rightRes) return;
        const setLeft = new Set(leftBuild.allocatedIds || []);
        const setRight = new Set(rightBuild.allocatedIds || []);
        let sharedNodes = 0;
        for (const nid of setLeft) {
          if (setRight.has(nid)) sharedNodes++;
        }
        setComparisonResults({
          leftName: leftBuild.name,
          rightName: rightBuild.name,
          left: leftRes,
          right: rightRes,
          sharedNodes,
          onlyLeftNodes: setLeft.size - sharedNodes,
          onlyRightNodes: setRight.size - sharedNodes,
        });
      } catch {
        /* değerlendirme başarısız: eski sonuç kalsın */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    nodes,
    savedBuilds,
    compareLeftId,
    compareRightId,
    allocatedIds,
    selectedSkillId,
    weaponBaseDps,
    baseGemLevel,
    bonusSkillLevels,
    gearSpirit,
    activeSpiritIds,
    activeAscendancy,
    selectedBaseClassName,
    activeAscNodes,
    recommendedSupports,
    buildRustRequest,
    lang,
  ]);

  const handleClassChange = (newStartId: number) => {
    setSelectedStartId(newStartId);
    setAllocatedIds([newStartId]);
    const clsName = classes.find((c) => c.start_node_id === newStartId)?.name || '';
    const firstAsc = ASCENDANCIES.find(
      (a) => a.baseClass.toLowerCase() === clsName.toLowerCase()
    );
    setSelectedAscendancyId(firstAsc ? firstAsc.id : '');
    setSelectedAscNodeIds([]);
  };

  const handleAscendancyChange = (newAscId: string) => {
    setSelectedAscendancyId(newAscId);
    setSelectedAscNodeIds([]);
  };

  const toggleAscendancyNode = (nodeId: string) => {
    setSelectedAscNodeIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((x) => x !== nodeId);
      if (prev.length >= LIMITS.maxAscendancyNodes) {
        showNotice(t("Maksimum 8 Ascendancy puanına (4 Major Notable) ulaşıldı."), 'error');
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
    if (active.length === 0) return t("Stat Seçilmedi");
    return active.map((w) => `${w.stat} %${w.weight}`).join(' • ');
  }, [statWeights, lang]);

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
    setStatWeights((prev) => normalizeToHundred(prev.filter((s) => s.stat !== statToRemove)));
  };

  const distributeEqually = () => {
    if (statWeights.length === 0) return;
    setStatWeights((prev) => normalizeToHundred(prev.map((item) => ({ ...item, weight: 1 }))));
  };

  const matchedNodeIds = useMemo(() => {
    const q = nodeSearchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: number[] = [];
    for (const node of Object.values(nodes)) {
      const nameMatch = node.name.toLowerCase().includes(q);
      const statMatch = node.stats.some((s) => s.toLowerCase().includes(q));
      if (nameMatch || statMatch) matches.push(node.id);
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

  const loadTreeFromRust = async (preserveSelection = true) => {
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
        const currentId = selectedStartIdRef.current;
        const stillExists =
          preserveSelection &&
          currentId > 0 &&
          treeData.classes.some((c) => c.start_node_id === currentId);

        if (!stillExists) {
          const startId = treeData.classes[0].start_node_id;
          setSelectedStartId(startId);
          setAllocatedIds([startId]);
          const firstAsc = ASCENDANCIES.find(
            (a) => a.baseClass.toLowerCase() === treeData.classes[0].name.toLowerCase()
          );
          setSelectedAscendancyId(firstAsc ? firstAsc.id : '');
          setSelectedAscNodeIds([]);
        }
      } else {
        const keys = Object.keys(treeData.nodes).map(Number);
        if (keys.length > 0 && !selectedStartIdRef.current) {
          setSelectedStartId(keys[0]);
        }
      }

      setStatus(t('Ağaç yüklendi ({n} düğüm)', { n: Object.keys(treeData.nodes).length }));
      await loadGemsFromRust();
    } catch (err) {
      setStatus(String(err));
    }
  };

  const updatingRef = useRef(false);
  const runUpdate = async (force = false) => {
    // Ref kullanılıyor: Ctrl+U işleyicisi eski state'i görüp eş zamanlı güncelleme başlatmasın
    if (updatingRef.current) return;
    updatingRef.current = true;
    setIsUpdating(true);
    showNotice(t("GitHub PoB2 reposundan yama verileri kontrol ediliyor..."), 'info');
    try {
      const msg = await invoke<string>('trigger_patch_update', { force });
      const done = msg.match(/^Güncelleme tamamlandı \((\d+) düğüm, (\d+) gem\)$/);
      showNotice(
        done ? t('Güncelleme tamamlandı ({n} düğüm, {g} gem)', { n: done[1], g: done[2] }) : msg,
        'success'
      );
    } catch (err) {
      showNotice(t('Güncelleme hatası: {err}', { err: t(String(err)) }), 'error');
    } finally {
      updatingRef.current = false;
      setIsUpdating(false);
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
      showNotice(t("Lütfen Stat Ağırlıkları panelinden en az bir stat ekleyin."), 'error');
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
      showNotice(
        t('Optimizasyon tamamlandı ({name}): {n} puan dağıtıldı.', {
          name: activeAscendancy?.name || selectedBaseClassName,
          n: resultIds.length,
        }),
        'success'
      );
    } catch (err) {
      showNotice(t('Optimizasyon hatası: {err}', { err: t(String(err)) }), 'error');
    }
  };

  const handleSaveCurrentBuild = () => {
    const ascLabel = activeAscendancy?.name || selectedBaseClassName || 'Build';
    const finalName = buildName.trim() || `${ascLabel} (${allocatedIds.length}p)`;

    const now = new Date();
    const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;

    const entry: SavedBuild = {
      id: Date.now().toString(),
      name: finalName,
      createdAt: timestamp,
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
    if (!compareRightId) setCompareRightId(entry.id);
    setBuildName('');
    showNotice(t('Build kaydedildi: "{name}"', { name: finalName }), 'success');
  };

  const applyBuildData = (b: Omit<SavedBuild, 'id' | 'name' | 'createdAt'>, label: string) => {
    const validStart = nodes[b.startNodeId] ? b.startNodeId : selectedStartId;
    setSelectedStartId(validStart);

    const validAllocated = (b.allocatedIds || [])
      .map(Number)
      .filter((id) => Number.isFinite(id) && Boolean(nodes[id]))
      .slice(0, LIMITS.maxPoints.max);
    setAllocatedIds(validAllocated);

    if (b.statWeights && b.statWeights.length > 0) {
      const cleanWeights = b.statWeights
        .filter((w) => w && typeof w.stat === 'string' && Number.isFinite(Number(w.weight)))
        .map((w) => ({ stat: w.stat.slice(0, 40), weight: Math.max(0, Number(w.weight)) }));
      if (cleanWeights.length > 0) setStatWeights(normalizeToHundred(cleanWeights));
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
    if (Array.isArray(b.activeSpiritIds)) {
      const validSpiritIds = new Set(allSpiritBuffs.map((sb) => sb.id));
      setActiveSpiritIds(
        b.activeSpiritIds.filter((id): id is string => typeof id === 'string' && validSpiritIds.has(id))
      );
    }
    if (b.ascendancyId) {
      const ascFound = ASCENDANCIES.find((a) => a.id === b.ascendancyId);
      if (ascFound) {
        setSelectedAscendancyId(ascFound.id);
        if (Array.isArray(b.ascendancyNodeIds)) {
          const validAscNodes = new Set(ascFound.nodes.map((n) => n.id));
          setSelectedAscNodeIds(
            b.ascendancyNodeIds
              .filter((id): id is string => typeof id === 'string' && validAscNodes.has(id))
              .slice(0, LIMITS.maxAscendancyNodes)
          );
        }
      }
    }
    showNotice(t('Build yüklendi: {label} ({n} puan)', { label, n: validAllocated.length }), 'success');
  };

  const generateShareCode = async () => {
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
    try {
      await navigator.clipboard.writeText(encoded);
      showNotice(t("Paylaşım kodu oluşturuldu ve panoya kopyalandı!"), 'success');
    } catch {
      showNotice(t("Paylaşım kodu oluşturuldu (panoya erişim izni yok, kutudan kopyalayın)."), 'info');
    }
  };

  const importPob2Code = async (raw: string) => {
    if (!raw) {
      showNotice(t("Önce bir kod yapıştırın (POE2TC: veya Path of Building 2 kodu)."), 'error');
      return;
    }
    try {
      const r = await invoke<{
        class_name: string;
        ascendancy_name: string;
        level: number;
        spec_title: string;
        node_ids: number[];
      }>('import_pob2_code', { code: raw });

      const cls = classes.find((c) => c.name.toLowerCase() === r.class_name.toLowerCase());
      const asc = ASCENDANCIES.find(
        (a) =>
          a.name.toLowerCase() === r.ascendancy_name.toLowerCase() &&
          (!cls || a.baseClass.toLowerCase() === cls.name.toLowerCase())
      );
      const startId = cls?.start_node_id ?? selectedStartId;
      const known = r.node_ids.filter((id) => Boolean(nodes[id]));
      const ignored = r.node_ids.length - known.length;
      if (known.length === 0) {
        showNotice(t("Koddaki düğümlerin hiçbiri bu ağaç sürümünde bulunamadı."), 'error');
        return;
      }
      applyBuildData(
        {
          startNodeId: startId,
          allocatedIds: known.filter((id) => id !== startId),
          targetStat: '',
          maxPoints: clampInt(known.length, LIMITS.maxPoints.min, LIMITS.maxPoints.max),
          selectedSkillId: '',
          weaponBaseDps: weaponBaseDps,
          baseGemLevel: baseGemLevel,
          bonusSkillLevels: bonusSkillLevels,
          ascendancyId: asc?.id,
        },
        `Path of Building 2${r.spec_title ? ` (${r.spec_title})` : ''}`
      );
      if (ignored > 0) {
        showNotice(
          t("PoB2 build'i yüklendi: {n} düğüm. {ignored} düğüm atlandı (ascendancy/farklı ağaç sürümü).", {
            n: known.length,
            ignored,
          }),
          'info'
        );
      }
    } catch (e) {
      showNotice(
        typeof e === 'string' ? t(e) : t("Kod tanınmadı: POE2TC: veya Path of Building 2 kodu girin."),
        'error'
      );
    }
  };

  const importShareCode = () => {
    const raw = shareCodeInput.trim();
    if (!raw.startsWith('POE2TC:')) {
      void importPob2Code(raw);
      return;
    }
    try {
      const jsonStr = decodeURIComponent(escape(atob(raw.slice(7))));
      const p = JSON.parse(jsonStr);
      if (!p || typeof p !== 'object') throw new Error('Invalid payload');

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
            typeof p.gs === 'number' ? p.gs : 0,
            LIMITS.gearSpirit.min,
            LIMITS.gearSpirit.max
          ),
          activeSpiritIds: Array.isArray(p.sp) ? p.sp : undefined,
          ascendancyId: typeof p.asc === 'string' ? p.asc : undefined,
          ascendancyNodeIds: Array.isArray(p.ascn) ? p.ascn : undefined,
        },
        t('Paylaşım Kodu')
      );
    } catch {
      showNotice(t("Paylaşım kodu çözümlenemedi (bozuk veya eksik kod)."), 'error');
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
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= LIMITS.maxPoints.max) {
        showNotice(t('Maksimum {max} pasif puan sınırına ulaşıldı.', { max: LIMITS.maxPoints.max }), 'error');
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSetAllocatedIds = (nextIds: number[]) => {
    if (nextIds.length > LIMITS.maxPoints.max) {
      showNotice(t('Maksimum {max} pasif puan sınırına ulaşıldı.', { max: LIMITS.maxPoints.max }), 'error');
      setAllocatedIds(nextIds.slice(0, LIMITS.maxPoints.max));
      return;
    }
    setAllocatedIds(nextIds);
  };

  const toggleSpiritBuff = (id: string) => {
    setActiveSpiritIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredActiveGems = useMemo(() => {
    const q = gemSearch.trim().toLowerCase();
    if (!q) return activeGems;
    return activeGems.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || g.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [activeGems, gemSearch]);

  const selectedSkillObj = useMemo(
    () => activeGems.find((g) => g.id === selectedSkillId),
    [activeGems, selectedSkillId]
  );

  useEffect(() => {
    loadTreeFromRust(false);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        runUpdate(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const unlisten = listen<string>('game-data-updated', () => loadTreeFromRust(true));

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlisten.then((fn) => fn());
    };
  }, []);

  const spiritUsageRatio = Math.min(
    (currentEvaluation.used_spirit / Math.max(currentEvaluation.max_spirit, 1)) * 100,
    100
  );

  const hasDatabase = Object.keys(nodes).length > 0;

  const renderDiffBadge = (diffVal: number, suffix = '') => {
    if (diffVal === 0) return <span style={{ color: '#64748b', fontSize: 11 }}>0{suffix}</span>;
    const positive = diffVal > 0;
    return (
      <span style={{ color: positive ? '#4ade80' : '#f87171', fontWeight: 'bold', fontSize: 11 }}>
        {positive ? `+${diffVal.toLocaleString()}` : diffVal.toLocaleString()}
        {suffix}
      </span>
    );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Üst Kontrol Çubuğu */}
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
            aria-label={t('Dil')}
            title={t('Dil')}
            value={lang}
            onChange={(e) => {
              const next = e.target.value === 'tr' ? 'tr' : 'en';
              setLang(next);
              setLangState(next);
            }}
            style={{
              background: '#1e2430',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 4,
              fontSize: 11,
              padding: '2px 4px',
              flexShrink: 0,
            }}
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>

        <select
          aria-label={t("Sınıf Seçimi")}
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
            <option value={selectedStartId}>{t("Başlangıç Düğümü")}</option>
          )}
        </select>

        <button
          aria-expanded={isAscDrawerOpen}
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

        <button
          aria-expanded={isWeightDrawerOpen}
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
          <span style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: 12 }}>{t("Dağılım:")}</span>
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

        <NumberField
          value={maxPoints}
          min={LIMITS.maxPoints.min}
          max={LIMITS.maxPoints.max}
          title={t('Pasif Puan Sınırı: {min} - {max}', { min: LIMITS.maxPoints.min, max: LIMITS.maxPoints.max })}
          onChange={setMaxPoints}
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
          disabled={!hasDatabase}
          style={{
            background: hasDatabase ? '#f59e0b' : '#475569',
            color: '#000',
            fontWeight: 'bold',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: hasDatabase ? 'pointer' : 'not-allowed',
            flexShrink: 0,
          }}
        >
          
          {t("En İyi Build'i Çiz")}
        </button>

        <button
          onClick={() => {
            if (allocatedIds.length <= 1) return;
            if (window.confirm(t("Seçili tüm pasif düğümler sıfırlansın mı?"))) {
              setAllocatedIds(selectedStartId ? [selectedStartId] : []);
              showNotice(t("Pasif ağaç sıfırlandı."), 'info');
            }
          }}
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
          
          {t("Sıfırla")}
        </button>

        <button
          onClick={() => runUpdate(false)}
          disabled={isUpdating}
          style={{
            background: '#334155',
            color: '#fff',
            border: 'none',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: isUpdating ? 'wait' : 'pointer',
            flexShrink: 0,
          }}
        >
          {isUpdating ? t("Güncelleniyor...") : t("Patch Güncelle (Ctrl+U)")}
        </button>

        <span
          aria-live="polite"
          style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', flexShrink: 0 }}
        >
          {status}
        </span>
      </div>

      {/* Ana Alan */}
      <div
        ref={drawerContainerRef}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          {!hasDatabase && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 18,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(7, 9, 14, 0.92)',
                gap: 12,
                padding: 24,
                textAlign: 'center',
              }}
            >
              <strong style={{ fontSize: 18, color: '#f8fafc' }}>
                
                {t("Yetenek Ağacı Veritabanı Bulunamadı")}
              </strong>
              <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 420, margin: 0 }}>
                
                {t("Path of Building PoE 2 verilerini ve yetenek ağacı görsellerini indirerek planlamaya başlayabilirsiniz.")}
              </p>
              <button
                onClick={() => runUpdate(false)}
                disabled={isUpdating}
                style={{
                  background: '#f59e0b',
                  color: '#000',
                  fontWeight: 'bold',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 18px',
                  fontSize: 13,
                  cursor: isUpdating ? 'wait' : 'pointer',
                }}
              >
                {isUpdating ? t("Veriler İndiriliyor...") : t("Verileri İndir")}
              </button>
            </div>
          )}

          {/* Ascendancy Çekmecesi */}
          {isAscDrawerOpen && activeAscendancy && (
            <div
              role="dialog"
              aria-label={t("Ascendancy Seçimi")}
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
                    {activeAscNodes.length * 2}  {t("/ 8 Puan")}
                  </span>
                </div>
                <button
                  aria-label={t("Kapat")}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeAscendancy.nodes.map((node) => {
                  const active = selectedAscNodeIds.includes(node.id);
                  return (
                    <div
                      key={node.id}
                      role="checkbox"
                      aria-checked={active}
                      tabIndex={0}
                      onClick={() => toggleAscendancyNode(node.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleAscendancyNode(node.id);
                        }
                      }}
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
                          {active ? '★ ' : ''}
                          {node.name}
                        </strong>
                        <span style={{ fontSize: 11, color: active ? '#d8b4fe' : '#94a3b8' }}>
                          {t(node.desc)}
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
                        
                        {t("2 Puan")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stat Paylaşımı Çekmecesi */}
          {isWeightDrawerOpen && (
            <div
              role="dialog"
              aria-label={t("Stat Paylaşımı")}
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
                  <strong style={{ fontSize: 13, color: '#38bdf8' }}>{t("Stat Paylaşımı")}</strong>
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
                    
                    {t("Toplam: %")}{totalWeightPct}
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
                      
                      {t("Eşit Dağıt")}
                    </button>
                  )}
                  <button
                    aria-label={t("Kapat")}
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
                          aria-label={t('{stat} kaldır', { stat: item.stat })}
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
                  
                  {t("+ Ekle")}
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
                
                {t("Bu Dağılımla Build'i Çiz (%100)")}
              </button>
            </div>
          )}

          {/* Harita Üzerinde Arama Çubuğu */}
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
              aria-label={t("Ağaçta düğüm ara")}
              value={nodeSearchQuery}
              onChange={(e) => setNodeSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (matchedNodeIds.length > 0) {
                    setFocusTrigger((prev) => ({
                      nodeId: matchedNodeIds[focusIndex],
                      seq: (prev?.seq || 0) + 1,
                    }));
                    setFocusIndex((prev) => (prev + 1) % matchedNodeIds.length);
                  }
                }
              }}
              placeholder={t("Ağaçta düğüm / Keystone ara (Enter ile odaklan)...")}
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
                    : t('0 sonuç')}
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
                    
                    {t("Odaklan")}
                  </button>
                )}
                <button
                  aria-label={t("Aramayı temizle")}
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
            startNodeId={selectedStartId}
            maxPoints={LIMITS.maxPoints.max}
            allocatedIds={allocatedIds}
            highlightedIds={matchedNodeIds}
            focusTrigger={focusTrigger}
            selectedClass={selectedBaseClassName}
            selectedAscendancy={activeAscendancy?.name || ''}
            onToggleNode={handleToggleNode}
            onSetAllocatedIds={handleSetAllocatedIds}
            onBudgetExceeded={(_, max) =>
              showNotice(t('Maksimum {max} pasif puan sınırına ulaşıldı.', { max }), 'error')
            }
          />

          {toast && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                zIndex: 40,
                background:
                  toast.tone === 'error'
                    ? '#450a0a'
                    : toast.tone === 'success'
                    ? '#052e16'
                    : '#0f172a',
                border:
                  toast.tone === 'error'
                    ? '1px solid #ef4444'
                    : toast.tone === 'success'
                    ? '1px solid #22c55e'
                    : '1px solid #38bdf8',
                color: '#f8fafc',
                padding: '9px 14px',
                borderRadius: 6,
                fontSize: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.65)',
                maxWidth: 360,
              }}
            >
              {toast.text}
            </div>
          )}
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
              
              {t("Build & EHP (")}{allocatedIds.length})
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
              
              {t("Kayıt & Kıyas (")}{savedBuilds.length})
            </button>
          </div>

          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {rightTab === 'stats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeAscendancy && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setIsAscDrawerOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsAscDrawerOpen(true);
                      }
                    }}
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
                        Ascendancy: {activeAscendancy.name} ({activeAscNodes.length * 2}{t("/8 Puan)")}
                      </strong>
                      <span style={{ fontSize: 11, color: '#a855f7' }}>{t("Düzenle")}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#d8b4fe' }}>
                      {activeAscNodes.length > 0
                        ? activeAscNodes.map((n) => n.name).join(' • ')
                        : t("Ascendancy düğümü seçilmedi")}
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
                      
                      {t("Savunma (Effective HP)")}
                    </span>
                    <strong style={{ fontSize: 16, color: '#22c55e' }}>
                      {currentEvaluation.effective_hp.toLocaleString()} EHP
                    </strong>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Life: </span>
                      <strong style={{ color: '#f87171' }}>{currentEvaluation.total_life}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>ES: </span>
                      <strong style={{ color: '#38bdf8' }}>{currentEvaluation.total_es}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Armour: </span>
                      <strong style={{ color: '#fbbf24' }}>{currentEvaluation.total_armour}</strong>
                    </div>
                    <div style={{ background: '#161b26', padding: '5px 8px', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>Evasion: </span>
                      <strong style={{ color: '#4ade80' }}>{currentEvaluation.total_evasion}</strong>
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
                      
                      {t("Crit Şansı:")}{' '}
                      <strong style={{ color: '#facc15' }}>%{currentEvaluation.effective_crit}</strong>
                    </span>
                    <span style={{ color: '#cbd5e1' }}>
                      
                      {t("Crit Hasarı:")}{' '}
                      <strong style={{ color: '#facc15' }}>
                        +%{currentEvaluation.total_crit_mult_pct}
                      </strong>
                    </span>
                  </div>
                </div>

                {Object.keys(currentEvaluation.parsed.totals).length === 0 &&
                currentEvaluation.parsed.raw_lines.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    
                    {t("Sınıf seçip")} <b>{t("En İyi Build'i Çiz")}</b>  {t("butonuna basın veya düğümlere tıklayarak puan verin.")}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(currentEvaluation.parsed.totals)
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
                          <strong style={{ color: val >= 0 ? '#38bdf8' : '#f87171' }}>
                            {val > 0 ? `+${Number(val.toFixed(1))}` : Number(val.toFixed(1))}
                          </strong>{' '}
                          {label}
                        </div>
                      ))}

                    {currentEvaluation.parsed.raw_lines.map((line, i) => (
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
                    
                    {t("Aktif Skill Gem (")}{activeGems.length}  {t("yetenek)")}
                  </div>
                  <input
                    value={gemSearch}
                    onChange={(e) => setGemSearch(e.target.value)}
                    placeholder={t("Örn: Tempest Flurry, Spark, Lightning Arrow...")}
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
                    
                    {t("Silah & Ekipman Çarpanları")}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                        
                        {t("Silah Baz DPS (Max")} {LIMITS.weaponBaseDps.max.toLocaleString()})
                      </label>
                      <NumberField
                        min={LIMITS.weaponBaseDps.min}
                        max={LIMITS.weaponBaseDps.max}
                        value={weaponBaseDps}
                        onChange={setWeaponBaseDps}
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
                      <NumberField
                        min={LIMITS.baseGemLevel.min}
                        max={LIMITS.baseGemLevel.max}
                        value={baseGemLevel}
                        onChange={setBaseGemLevel}
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
                      <NumberField
                        min={LIMITS.bonusSkillLevels.min}
                        max={LIMITS.bonusSkillLevels.max}
                        value={bonusSkillLevels}
                        onChange={setBonusSkillLevels}
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
                    <span>
                      
                      {t("Etkin Seviye:")}{' '}
                      <strong style={{ color: '#fff' }}>Lv.{currentEvaluation.effective_level}</strong>
                    </span>
                    <span style={{ color: '#38bdf8' }}>
                      +{currentEvaluation.bonus_level_gain_pct}{t("% Taban Hasar")}
                    </span>
                  </div>
                </div>

                {/* Spirit Bütçesi */}
                <div
                  style={{
                    background: '#131824',
                    border:
                      currentEvaluation.remaining_spirit < 0
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
                      
                      {t("Spirit Bütçesi & Aura / Herald")}
                    </span>
                    <strong
                      style={{
                        fontSize: 12,
                        color: currentEvaluation.remaining_spirit < 0 ? '#f87171' : '#c084fc',
                      }}
                    >
                      {currentEvaluation.used_spirit} / {currentEvaluation.max_spirit} Spirit
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
                          currentEvaluation.remaining_spirit < 0 ? '#ef4444' : '#a855f7',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                    <span style={{ color: '#94a3b8' }}>
                      
                      {t("100 Görev +")} {currentEvaluation.tree_and_asc_spirit}  {t("Ağaç/Asc + Ekipman:")}
                    </span>
                    <NumberField
                      min={LIMITS.gearSpirit.min}
                      max={LIMITS.gearSpirit.max}
                      value={gearSpirit}
                      onChange={setGearSpirit}
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

                  {currentEvaluation.remaining_spirit < 0 && (
                    <div style={{ fontSize: 11, color: '#f87171', fontWeight: 'bold' }}>
                      
                      {t("⚠ Spirit kapasitesi")} {Math.abs(currentEvaluation.remaining_spirit)}  {t("puan aşıldı!")}
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
                          role="checkbox"
                          aria-checked={active}
                          tabIndex={0}
                          onClick={() => toggleSpiritBuff(buff.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleSpiritBuff(buff.id);
                            }
                          }}
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
                              {active ? '✓ ' : ''}
                              {buff.name}
                            </span>
                            <span style={{ fontSize: 10, color: active ? '#d8b4fe' : '#64748b' }}>
                              {t(buff.effectLabel)}
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

                {/* Toplam DPS Özeti */}
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
                    <span style={{ fontSize: 12, color: '#cbd5e1' }}>{t("Toplam DPS:")}</span>
                    <strong style={{ color: '#f59e0b', fontSize: 18 }}>
                      {currentEvaluation.est_dps.toLocaleString()} DPS
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Crit: %{currentEvaluation.effective_crit}</span>
                    <span style={{ color: '#22c55e' }}>
                      {currentEvaluation.support_count} Support: +{currentEvaluation.support_more_pct}%
                    </span>
                    <span style={{ color: '#c084fc' }}>
                      Spirit: +{currentEvaluation.spirit_more_pct}%
                    </span>
                    <span style={{ color: '#f472b6' }}>
                      Asc: +{currentEvaluation.asc_more_pct}%
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f8fafc' }}>
                  
                  {t("Önerilen Support Gem'ler (Uyum & DPS):")}
                </div>

                {recommendedSupports.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    
                    {t("Bu yetenek için uyumlu Support Gem bulunamadı.")}
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
                              %{sup.match_score_pct}  {t("Öneri")}
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
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{tReason(sup.reason)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'builds' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                      
                      {t("İki Build Kıyaslama (Compare / Diff)")}
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
                        <option value="CURRENT">{t("Aktif Build (")}{allocatedIds.length}p)</option>
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
                        <option value="CURRENT">{t("Aktif Build (")}{allocatedIds.length}p)</option>
                      </select>
                    </div>

                    {comparisonResults && (
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
                          <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>{t("Metrik")}</span>
                          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>Build A</span>
                          <span style={{ color: '#c084fc', fontWeight: 'bold' }}>Build B</span>
                          <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{t("Fark (A-B)")}</span>

                          <span style={{ color: '#cbd5e1' }}>{t("Tahmini DPS")}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.left.est_dps.toLocaleString()}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.right.est_dps.toLocaleString()}</span>
                          {renderDiffBadge(comparisonResults.left.est_dps - comparisonResults.right.est_dps)}

                          <span style={{ color: '#cbd5e1' }}>EHP</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.left.effective_hp.toLocaleString()}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.right.effective_hp.toLocaleString()}</span>
                          {renderDiffBadge(comparisonResults.left.effective_hp - comparisonResults.right.effective_hp)}

                          <span style={{ color: '#cbd5e1' }}>Life</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.left.total_life}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.right.total_life}</span>
                          {renderDiffBadge(comparisonResults.left.total_life - comparisonResults.right.total_life)}

                          <span style={{ color: '#cbd5e1' }}>Energy Shield</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.left.total_es}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.right.total_es}</span>
                          {renderDiffBadge(comparisonResults.left.total_es - comparisonResults.right.total_es)}

                          <span style={{ color: '#cbd5e1' }}>{t("Crit Şansı")}</span>
                          <span style={{ color: '#fff' }}>%{comparisonResults.left.effective_crit}</span>
                          <span style={{ color: '#fff' }}>%{comparisonResults.right.effective_crit}</span>
                          {renderDiffBadge(
                            Number((comparisonResults.left.effective_crit - comparisonResults.right.effective_crit).toFixed(1)),
                            '%'
                          )}

                          <span style={{ color: '#cbd5e1' }}>{t("Spirit Kap.")}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.left.max_spirit}</span>
                          <span style={{ color: '#fff' }}>{comparisonResults.right.max_spirit}</span>
                          {renderDiffBadge(comparisonResults.left.max_spirit - comparisonResults.right.max_spirit)}
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
                          <span>{t("Ortak Düğüm:")} <strong style={{ color: '#22c55e' }}>{comparisonResults.sharedNodes}</strong></span>
                          <span>{t("Sadece A:")} <strong style={{ color: '#38bdf8' }}>{comparisonResults.onlyLeftNodes}</strong></span>
                          <span>{t("Sadece B:")} <strong style={{ color: '#c084fc' }}>{comparisonResults.onlyRightNodes}</strong></span>
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
                    
                    {t("Mevcut Build'i Kaydet")}
                  </div>
                  <input
                    value={buildName}
                    onChange={(e) => setBuildName(e.target.value)}
                    maxLength={60}
                    placeholder={t("Build adı (ör. Invoker Crit vs ES)...")}
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
                    
                    {t("Kaydet (")}{allocatedIds.length}  {t("Puan)")}
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
                    
                    {t("Build Paylaşım Kodu (Export / Import)")}
                  </div>
                  <textarea
                    rows={3}
                    value={shareCodeInput}
                    onChange={(e) => setShareCodeInput(e.target.value)}
                    placeholder={t("Kodu dışa aktarmak için aşağıya tıklayın veya POE2TC:... / Path of Building 2 kodunu buraya yapıştırın")}
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
                      
                      {t("Kodu Oluştur & Kopyala")}
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
                      
                      {t("Kodu Yükle")}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#f8fafc' }}>
                  
                  {t("Kayıtlı Build'ler (")}{savedBuilds.length})
                </div>

                {savedBuilds.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    
                    {t("Henüz kaydedilmiş bir build yok. Build kaydettiğinde yukarıda otomatik kıyaslama tablosu açılır.")}
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
                          
                          {t("Hedef:")} {b.targetStat} • {b.allocatedIds.length}  {t("Puan")}
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
                            
                            {t("Yükle")}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(t('"{name}" build\'i silinsin mi?', { name: b.name }))) {
                                persistBuilds(savedBuilds.filter((item) => item.id !== b.id));
                                showNotice(t('"{name}" silindi.', { name: b.name }), 'info');
                              }
                            }}
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
                            
                            {t("Sil")}
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