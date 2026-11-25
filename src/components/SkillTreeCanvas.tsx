import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SpriteRect {
  filename: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PassiveNode {
  id: number;
  name: string;
  stats: string[];
  is_keystone: boolean;
  is_notable: boolean;
  x: number;
  y: number;
  neighbors: number[];
  icon?: SpriteRect | null;
}

interface Props {
  nodes: Record<number, PassiveNode>;
  spriteSheets?: Record<string, string>;
  allocatedIds: number[];
  highlightedIds?: number[];
  focusTrigger?: { nodeId: number; seq: number } | null;
  selectedClass?: string;
  selectedAscendancy?: string;
  onToggleNode?: (id: number) => void;
  onSetAllocatedIds?: (ids: number[]) => void;
}

// Düğüm stat'ına göre oyun içi ikon sembolü ve renk teması belirle
function getNodeVisualTheme(node: PassiveNode): {
  glyph: string;
  accent: string;
  bg: string;
} {
  const s = (node.name + ' ' + node.stats.join(' ')).toLowerCase();

  if (s.includes('lightning') || s.includes('shock') || s.includes('electrocute')) {
    return { glyph: '⚡', accent: '#38bdf8', bg: '#0c2438' };
  }
  if (s.includes('fire') || s.includes('ignite') || s.includes('burn')) {
    return { glyph: '🔥', accent: '#fb923c', bg: '#2e1509' };
  }
  if (s.includes('cold') || s.includes('freeze') || s.includes('chill')) {
    return { glyph: '❄', accent: '#7dd3fc', bg: '#0b2536' };
  }
  if (s.includes('chaos') || s.includes('poison') || s.includes('wither')) {
    return { glyph: '☣', accent: '#c084fc', bg: '#221036' };
  }
  if (s.includes('minion') || s.includes('totem') || s.includes('ally')) {
    return { glyph: '💀', accent: '#a78bfa', bg: '#1e1633' };
  }
  if (s.includes('projectile') || s.includes('bow') || s.includes('crossbow') || s.includes('arrow')) {
    return { glyph: '🏹', accent: '#4ade80', bg: '#0e2618' };
  }
  if (s.includes('evasion') || s.includes('movement') || s.includes('dexterity')) {
    return { glyph: '🍃', accent: '#4ade80', bg: '#0e2618' };
  }
  if (s.includes('life') || s.includes('armour') || s.includes('strength') || s.includes('stun')) {
    return { glyph: '🛡', accent: '#f87171', bg: '#2b1215' };
  }
  if (s.includes('energy shield') || s.includes('mana') || s.includes('spell') || s.includes('intelligence')) {
    return { glyph: '✦', accent: '#60a5fa', bg: '#0f1f3d' };
  }
  if (s.includes('critical') || s.includes('attack') || s.includes('sword') || s.includes('mace') || s.includes('quarterstaff')) {
    return { glyph: '⚔', accent: '#fbbf24', bg: '#291e0c' };
  }
  if (s.includes('speed') || s.includes('cast') || s.includes('skill')) {
    return { glyph: '✧', accent: '#2dd4bf', bg: '#0c2624' };
  }
  return { glyph: '❖', accent: '#94a3b8', bg: '#131822' };
}

function findShortestPathToTarget(
  nodes: Record<number, PassiveNode>,
  allocatedSet: Set<number>,
  targetId: number,
  fallbackRootId?: number
): number[] {
  if (!nodes[targetId] || allocatedSet.has(targetId)) return [];

  const seeds =
    allocatedSet.size > 0
      ? Array.from(allocatedSet)
      : fallbackRootId !== undefined
      ? [fallbackRootId]
      : [];
  if (seeds.length === 0) return [targetId];

  const queue: number[] = [...seeds];
  const parent = new Map<number, number | null>();
  for (const s of seeds) parent.set(s, null);

  let found = false;
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    if (curr === targetId) {
      found = true;
      break;
    }
    const node = nodes[curr];
    if (!node) continue;
    for (const nbrId of node.neighbors) {
      if (!parent.has(nbrId) && nodes[nbrId]) {
        parent.set(nbrId, curr);
        queue.push(nbrId);
      }
    }
  }

  if (!found) return [targetId];

  const path: number[] = [];
  let cur: number | null | undefined = targetId;
  while (cur !== null && cur !== undefined) {
    if (!allocatedSet.has(cur)) path.push(cur);
    cur = parent.get(cur);
  }
  return path.reverse();
}

function pruneDisconnectedNodes(
  nodes: Record<number, PassiveNode>,
  remainingSet: Set<number>,
  rootId?: number
): number[] {
  if (remainingSet.size === 0) return [];
  const startNode =
    rootId !== undefined && remainingSet.has(rootId)
      ? rootId
      : remainingSet.values().next().value;
  if (startNode === undefined) return [];

  const visited = new Set<number>([startNode]);
  const queue: number[] = [startNode];
  let head = 0;

  while (head < queue.length) {
    const curr = queue[head++];
    const node = nodes[curr];
    if (!node) continue;
    for (const nbrId of node.neighbors) {
      if (remainingSet.has(nbrId) && !visited.has(nbrId)) {
        visited.add(nbrId);
        queue.push(nbrId);
      }
    }
  }

  return Array.from(visited);
}

export const SkillTreeCanvas: React.FC<Props> = ({
  nodes,
  spriteSheets = {},
  allocatedIds,
  highlightedIds = [],
  focusTrigger = null,
  selectedClass = 'Mercenary',
  selectedAscendancy = '',
  onToggleNode,
  onSetAllocatedIds,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef({ x: 640, y: 400, scale: 0.14 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);
  const hoveredNodeRef = useRef<PassiveNode | null>(null);
  const previewPathRef = useRef<Set<number>>(new Set());
  const rafIdRef = useRef<number | null>(null);

  const [hoveredState, setHoveredState] = useState<{
    node: PassiveNode;
    screenX: number;
    screenY: number;
    previewCount: number;
  } | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

  const graphCache = useMemo(() => {
    const nodeList = Object.values(nodes);
    if (nodeList.length === 0) {
      return {
        nodeList: [] as PassiveNode[],
        nodeThemes: new Map<number, { glyph: string; accent: string; bg: string }>(),
        edges: [] as { a: PassiveNode; b: PassiveNode; ctrlX: number; ctrlY: number }[],
        centerX: 0,
        centerY: 0,
        minX: -4500,
        maxX: 4500,
        minY: -4500,
        maxY: 4500,
        rootNodeId: undefined as number | undefined,
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of nodeList) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    let rootNodeId: number | undefined = undefined;
    let bestCenterDist = Infinity;

    const nodeThemes = new Map<number, { glyph: string; accent: string; bg: string }>();
    const edges: { a: PassiveNode; b: PassiveNode; ctrlX: number; ctrlY: number }[] = [];

    for (const node of nodeList) {
      nodeThemes.set(node.id, getNodeVisualTheme(node));

      const cDist = Math.hypot(node.x - centerX, node.y - centerY);
      if (cDist < bestCenterDist && node.neighbors.length > 0) {
        bestCenterDist = cDist;
        rootNodeId = node.id;
      }

      for (const nbrId of node.neighbors) {
        if (nbrId < node.id) continue;
        const nbr = nodes[nbrId];
        if (!nbr) continue;

        const dx = nbr.x - node.x;
        const dy = nbr.y - node.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 1500 * 1500) continue;

        const dist = Math.sqrt(distSq);
        const midX = (node.x + nbr.x) * 0.5;
        const midY = (node.y + nbr.y) * 0.5;
        const vx = midX - centerX;
        const vy = midY - centerY;
        const vLen = Math.hypot(vx, vy) || 1;
        const curveAmount = dist < 420 ? dist * 0.14 : dist * 0.04;

        edges.push({
          a: node,
          b: nbr,
          ctrlX: midX + (vx / vLen) * curveAmount,
          ctrlY: midY + (vy / vLen) * curveAmount,
        });
      }
    }

    return { nodeList, nodeThemes, edges, centerX, centerY, minX, maxX, minY, maxY, rootNodeId };
  }, [nodes]);

  const stateRef = useRef({
    graphCache,
    allocatedIds,
    highlightedIds,
    loadedImages,
    selectedClass,
    selectedAscendancy,
  });
  stateRef.current = {
    graphCache,
    allocatedIds,
    highlightedIds,
    loadedImages,
    selectedClass,
    selectedAscendancy,
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const {
      graphCache: gc,
      allocatedIds: allocList,
      highlightedIds: hlList,
      loadedImages: imgs,
      selectedClass: clsName,
      selectedAscendancy: ascName,
    } = stateRef.current;

    const { x: tx, y: ty, scale } = transformRef.current;
    const allocatedSet = new Set(allocList);
    const previewSet = previewPathRef.current;
    const highlightSet = new Set(hlList);
    const hovered = hoveredNodeRef.current;

    const pad = 350 / Math.max(scale, 0.01);
    const viewLeft = -tx / scale - pad;
    const viewRight = (canvas.width - tx) / scale + pad;
    const viewTop = -ty / scale - pad;
    const viewBottom = (canvas.height - ty) / scale + pad;

    // Derin siyah-obsidyen PoE 2 arka planı
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const { centerX, centerY, nodeList, nodeThemes, edges } = gc;

    // 0. ZARİF TAŞ OYMALI MERKEZ ROZET (Dev renkli top yerine ince Maxroll tarzı kemer)
    if (nodeList.length > 0) {
      const hubR = 230;
      if (
        centerX + hubR >= viewLeft &&
        centerX - hubR <= viewRight &&
        centerY + hubR >= viewTop &&
        centerY - hubR <= viewBottom
      ) {
        // İnce taş dış halka
        ctx.beginPath();
        ctx.arc(centerX, centerY, hubR, 0, Math.PI * 2);
        ctx.fillStyle = '#090b10';
        ctx.fill();
        ctx.lineWidth = 18;
        ctx.strokeStyle = '#29241e';
        ctx.stroke();

        // Altın iç filigre çizgisi
        ctx.beginPath();
        ctx.arc(centerX, centerY, hubR - 14, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#785a32';
        ctx.stroke();

        // 12 küçük taş soket noktası
        for (let s = 0; s < 12; s++) {
          const ang = (s * Math.PI * 2) / 12;
          const sx = centerX + Math.cos(ang) * hubR;
          const sy = centerY + Math.sin(ang) * hubR;
          ctx.beginPath();
          ctx.arc(sx, sy, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#14171f';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#8c6d46';
          ctx.stroke();
        }

        // Zarif küçük sınıf & ascendancy künyesi
        ctx.fillStyle = '#d6c7b2';
        ctx.font = 'bold 28px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clsName.toUpperCase(), centerX, centerY - 14);

        if (ascName) {
          ctx.fillStyle = '#c89d54';
          ctx.font = '18px sans-serif';
          ctx.fillText(ascName, centerX, centerY + 18);
        }
      }
    }

    // 1. NOTABLE & KEYSTONE KÜME ARKASI HAFİF AURA ÇEMBERLERİ (Görseldeki küme süslemeleri)
    if (scale > 0.08) {
      for (let i = 0; i < nodeList.length; i++) {
        const node = nodeList[i];
        if (!node.is_keystone && !node.is_notable) continue;
        if (node.x < viewLeft || node.x > viewRight || node.y < viewTop || node.y > viewBottom) {
          continue;
        }
        const theme = nodeThemes.get(node.id);
        const isAlloc = allocatedSet.has(node.id);
        const ringR = node.is_keystone ? 88 : 56;

        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2);
        ctx.fillStyle = isAlloc
          ? 'rgba(56, 189, 248, 0.12)'
          : 'rgba(148, 163, 184, 0.035)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isAlloc
          ? (theme?.accent || '#38bdf8')
          : 'rgba(120, 90, 50, 0.22)';
        ctx.stroke();
      }
    }

    // 2. KAVİSLİ BAĞLANTI YOLLARI (Pasif Taş Yol + Maxroll Parlayan Mavi/Altın Enerji Akışı)
    ctx.lineCap = 'round';

    // 2a. Pasif yollar
    ctx.beginPath();
    for (let i = 0; i < edges.length; i++) {
      const { a, b, ctrlX, ctrlY } = edges[i];
      if (
        (a.x < viewLeft && b.x < viewLeft) ||
        (a.x > viewRight && b.x > viewRight) ||
        (a.y < viewTop && b.y < viewTop) ||
        (a.y > viewBottom && b.y > viewBottom)
      ) {
        continue;
      }
      const aConn = allocatedSet.has(a.id) || previewSet.has(a.id);
      const bConn = allocatedSet.has(b.id) || previewSet.has(b.id);
      if (aConn && bConn) continue;

      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
    }
    ctx.strokeStyle = '#2b303a';
    ctx.lineWidth = 7;
    ctx.stroke();

    // 2b. Hover hayalet önizleme yolu (Altın-kehribar kesikli enerji)
    if (previewSet.size > 0) {
      ctx.beginPath();
      for (let i = 0; i < edges.length; i++) {
        const { a, b, ctrlX, ctrlY } = edges[i];
        const aIn = allocatedSet.has(a.id) || previewSet.has(a.id);
        const bIn = allocatedSet.has(b.id) || previewSet.has(b.id);
        if (!aIn || !bIn) continue;
        if (allocatedSet.has(a.id) && allocatedSet.has(b.id)) continue;

        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
      }
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 11;
      ctx.stroke();
    }

    // 2c. Aktif (Seçili) yollar — Maxroll'daki gibi parlak cam mavisi dış hale + beyaz-mavi çekirdek
    if (allocatedSet.size > 0) {
      ctx.beginPath();
      for (let i = 0; i < edges.length; i++) {
        const { a, b, ctrlX, ctrlY } = edges[i];
        if (!allocatedSet.has(a.id) || !allocatedSet.has(b.id)) continue;
        if (
          (a.x < viewLeft && b.x < viewLeft) ||
          (a.x > viewRight && b.x > viewRight) ||
          (a.y < viewTop && b.y < viewTop) ||
          (a.y > viewBottom && b.y > viewBottom)
        ) {
          continue;
        }
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 22;
      ctx.stroke();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 10;
      ctx.stroke();
    }

    // 3. OYUN İÇİ DİŞLİ ÇERÇEVELİ VE İKONLU DÜĞÜMLER
    const showIcons = scale > 0.065;
    const showOrnate = scale > 0.085;

    for (let i = 0; i < nodeList.length; i++) {
      const node = nodeList[i];
      if (node.x < viewLeft || node.x > viewRight || node.y < viewTop || node.y > viewBottom) {
        continue;
      }

      const isAlloc = allocatedSet.has(node.id);
      const isPreview = previewSet.has(node.id);
      const isMatch = highlightSet.has(node.id);
      const isHovered = hovered?.id === node.id;
      const baseRadius = node.is_keystone ? 46 : node.is_notable ? 31 : 19;
      const radius = isHovered ? baseRadius * 1.24 : isMatch ? baseRadius * 1.15 : baseRadius;
      const theme = nodeThemes.get(node.id) || { glyph: '❖', accent: '#94a3b8', bg: '#131822' };

      if (isMatch) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 245, 212, 0.25)';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#00f5d4';
        ctx.stroke();
      }

      // Dişli taş/bronz oyma çerçeve (Keystone & Notable)
      if (showOrnate && (node.is_keystone || node.is_notable)) {
        const teeth = node.is_keystone ? 12 : 8;
        const depth = node.is_keystone ? 11 : 6;
        const outerR = radius + 4;
        const steps = teeth * 2;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const ang = (s * Math.PI * 2) / steps;
          const r = s % 2 === 0 ? outerR + depth : outerR - 1;
          const px = node.x + Math.cos(ang) * r;
          const py = node.y + Math.sin(ang) * r;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = isAlloc
          ? '#0284c7'
          : isPreview
          ? '#b45309'
          : node.is_keystone
          ? '#6e5638'
          : '#3f3a34';
        ctx.fill();
      }

      const sheetImg = showIcons && node.icon ? imgs[node.icon.filename] : undefined;

      if (sheetImg && node.icon) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(
          sheetImg,
          node.icon.x,
          node.icon.y,
          node.icon.w,
          node.icon.h,
          node.x - radius,
          node.y - radius,
          radius * 2,
          radius * 2
        );
        ctx.restore();
      } else {
        // Koyu renkli küre gövdesi + içinde net stat ikonu (boş siyah daire yerine)
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isAlloc ? '#0c3559' : isPreview ? '#422006' : theme.bg;
        ctx.fill();

        if (showIcons) {
          ctx.fillStyle = isAlloc ? '#e0f2fe' : theme.accent;
          ctx.font = `bold ${Math.round(radius * 1.05)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(theme.glyph, node.x, node.y + 1);
        }
      }

      // Metalik iç çerçeve halkası
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = isHovered ? 6 : node.is_keystone ? 5 : 3.5;
      ctx.strokeStyle = isHovered
        ? '#ffffff'
        : isMatch
        ? '#00f5d4'
        : isAlloc
        ? '#38bdf8'
        : isPreview
        ? '#fbbf24'
        : node.is_keystone
        ? '#a88454'
        : node.is_notable
        ? '#6b6257'
        : '#3b4252';
      ctx.stroke();
    }

    ctx.restore();
  };

  const scheduleDraw = () => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawCanvas();
    });
  };

  useEffect(() => {
    const entries = Object.entries(spriteSheets);
    if (entries.length === 0) return;

    let cancelled = false;
    const imgs: Record<string, HTMLImageElement> = {};
    let loadedCount = 0;

    for (const [filename, dataUrl] of entries) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        imgs[filename] = img;
        loadedCount += 1;
        if (loadedCount === entries.length) {
          setLoadedImages({ ...imgs });
        }
      };
      img.src = dataUrl;
    }

    return () => {
      cancelled = true;
    };
  }, [spriteSheets]);

  useEffect(() => {
    if (graphCache.nodeList.length === 0) return;
    const width = Math.max(graphCache.maxX - graphCache.minX, 1);
    const height = Math.max(graphCache.maxY - graphCache.minY, 1);
    const fitScale = Math.min(1280 / width, 800 / height) * 1.35;

    transformRef.current = {
      x: 640 - graphCache.centerX * fitScale,
      y: 400 - graphCache.centerY * fitScale,
      scale: fitScale,
    };
    drawCanvas();
  }, [graphCache]);

  useEffect(() => {
    if (!focusTrigger) return;
    const target = nodes[focusTrigger.nodeId];
    if (!target) return;

    const targetScale = Math.max(transformRef.current.scale, 0.25);
    transformRef.current = {
      x: 640 - target.x * targetScale,
      y: 400 - target.y * targetScale,
      scale: targetScale,
    };
    hoveredNodeRef.current = target;
    setHoveredState({
      node: target,
      screenX: 640,
      screenY: 400,
      previewCount: 0,
    });
    drawCanvas();
  }, [focusTrigger]);

  useEffect(() => {
    drawCanvas();
  }, [allocatedIds, highlightedIds, loadedImages, selectedClass, selectedAscendancy]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scaleX = (canvasRef.current?.width || 1280) / rect.width;
    const scaleY = (canvasRef.current?.height || 800) / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;
    const prev = transformRef.current;
    const nextScale = Math.min(Math.max(prev.scale * zoomFactor, 0.02), 2.5);
    const ratio = nextScale / prev.scale;

    transformRef.current = {
      x: mouseX - (mouseX - prev.x) * ratio,
      y: mouseY - (mouseY - prev.y) * ratio,
      scale: nextScale,
    };
    scheduleDraw();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const relX = containerRect ? e.clientX - containerRect.left : e.clientX;
    const relY = containerRect ? e.clientY - containerRect.top : e.clientY;

    if (isDraggingRef.current) {
      dragMovedRef.current = true;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };

      transformRef.current = {
        ...transformRef.current,
        x: transformRef.current.x + dx,
        y: transformRef.current.y + dy,
      };
      if (hoveredState) setHoveredState(null);
      scheduleDraw();
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = (canvasRef.current?.width || 1280) / rect.width;
    const scaleY = (canvasRef.current?.height || 800) / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const { x: tx, y: ty, scale } = transformRef.current;
    const worldX = (canvasX - tx) / scale;
    const worldY = (canvasY - ty) / scale;

    let found: PassiveNode | null = null;
    let bestDistSq = 48 * 48;
    const list = graphCache.nodeList;
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      const dx = node.x - worldX;
      if (dx > 48 || dx < -48) continue;
      const dy = node.y - worldY;
      if (dy > 48 || dy < -48) continue;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        found = node;
      }
    }

    if (hoveredNodeRef.current?.id !== found?.id) {
      hoveredNodeRef.current = found;
      if (found) {
        const allocSet = new Set(allocatedIds);
        const path = findShortestPathToTarget(
          nodes,
          allocSet,
          found.id,
          graphCache.rootNodeId
        );
        previewPathRef.current = new Set(path);
        setHoveredState({
          node: found,
          screenX: relX,
          screenY: relY,
          previewCount: path.length,
        });
      } else {
        previewPathRef.current = new Set();
        setHoveredState(null);
      }
      scheduleDraw();
    } else if (found && hoveredState) {
      setHoveredState((prev) =>
        prev ? { ...prev, screenX: relX, screenY: relY } : null
      );
    }
  };

  const handleNodeClick = () => {
    const clicked = hoveredNodeRef.current;
    if (!clicked) return;

    const allocSet = new Set(allocatedIds);
    if (onSetAllocatedIds) {
      if (allocSet.has(clicked.id)) {
        allocSet.delete(clicked.id);
        const pruned = pruneDisconnectedNodes(nodes, allocSet, graphCache.rootNodeId);
        onSetAllocatedIds(pruned);
      } else {
        const pathToAdd = findShortestPathToTarget(
          nodes,
          allocSet,
          clicked.id,
          graphCache.rootNodeId
        );
        for (const id of pathToAdd) allocSet.add(id);
        onSetAllocatedIds(Array.from(allocSet));
      }
    } else if (onToggleNode) {
      onToggleNode(clicked.id);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        width={1280}
        height={800}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          isDraggingRef.current = true;
          dragMovedRef.current = false;
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }}
        onMouseUp={() => {
          if (!dragMovedRef.current) {
            handleNodeClick();
          }
          isDraggingRef.current = false;
        }}
        onMouseLeave={() => {
          isDraggingRef.current = false;
          hoveredNodeRef.current = null;
          previewPathRef.current = new Set();
          setHoveredState(null);
          scheduleDraw();
        }}
        onMouseMove={handleMouseMove}
        style={{
          width: '100%',
          height: '100%',
          cursor: hoveredState ? 'pointer' : 'grab',
        }}
      />

      {/* POE 2 / MAXROLL TARZI TAŞ ÇERÇEVELİ YÜZEN TOOLTIP */}
      {hoveredState && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hoveredState.screenX + 22, 900),
            top: Math.max(Math.min(hoveredState.screenY - 24, 580), 16),
            width: 320,
            background: 'rgba(8, 10, 15, 0.96)',
            border: '1px solid #5c4938',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.88)',
            pointerEvents: 'none',
            zIndex: 30,
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          <div
            style={{
              background: hoveredState.node.is_keystone
                ? 'linear-gradient(180deg, #452c16 0%, #24160b 100%)'
                : hoveredState.node.is_notable
                ? 'linear-gradient(180deg, #332920 0%, #1b1612 100%)'
                : 'linear-gradient(180deg, #24262b 0%, #141619 100%)',
              borderBottom: '1px solid #785a32',
              padding: '9px 14px',
              textAlign: 'center',
              color: hoveredState.node.is_keystone
                ? '#fcd34d'
                : hoveredState.node.is_notable
                ? '#f3e8d2'
                : '#e2e8f0',
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '0.4px',
            }}
          >
            {hoveredState.node.name || `Passive Node #${hoveredState.node.id}`}
          </div>

          <div style={{ padding: '12px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {hoveredState.node.stats.length > 0 ? (
              hoveredState.node.stats.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    color: '#88aaff',
                    marginBottom: 4,
                  }}
                >
                  {s}
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center' }}>
                Başlangıç / Bağlantı Yuvası
              </div>
            )}

            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid rgba(148, 163, 184, 0.15)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                letterSpacing: '0.5px',
                color: '#94a3b8',
              }}
            >
              <span>
                {allocatedIds.includes(hoveredState.node.id)
                  ? '[TIKLA: DÜĞÜMÜ KALDIR]'
                  : `[TIKLA: +${hoveredState.previewCount} PUAN BAĞLA]`}
              </span>
              <span style={{ color: '#c89d54' }}>
                {hoveredState.node.is_keystone
                  ? 'KEYSTONE'
                  : hoveredState.node.is_notable
                  ? 'NOTABLE'
                  : 'PASSIVE'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};