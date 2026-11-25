import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';

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
  is_attribute_choice: boolean;
  x: number;
  y: number;
  neighbors: number[];
  icon?: SpriteRect;
}

export interface SkillTreeCanvasProps {
  nodes: Record<number, PassiveNode>;
  spriteSheets?: Record<string, string>;
  startNodeId?: number;
  maxPoints?: number;
  allocatedIds: number[];
  highlightedIds?: number[];
  focusTrigger?: { nodeId: number; seq: number } | null;
  selectedClass?: string;
  selectedAscendancy?: string;
  onToggleNode: (id: number) => void;
  onSetAllocatedIds?: (ids: number[]) => void;
  onBudgetExceeded?: (needed: number, max: number) => void;
}

export const SkillTreeCanvas: React.FC<SkillTreeCanvasProps> = ({
  nodes,
  spriteSheets = {},
  startNodeId = 0,
  maxPoints = 128,
  allocatedIds,
  highlightedIds = [],
  focusTrigger = null,
  selectedClass = '',
  selectedAscendancy = '',
  onToggleNode,
  onSetAllocatedIds,
  onBudgetExceeded,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewport, setViewport] = useState({ width: 1280, height: 800, dpr: 1 });
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 0.14 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0, moved: false });

  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [loadedSheets, setLoadedSheets] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    let cancelled = false;
    for (const [filename, dataUrl] of Object.entries(spriteSheets)) {
      if (!dataUrl || loadedSheets[filename]) continue;
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        if (!cancelled) {
          setLoadedSheets((prev) => ({ ...prev, [filename]: img }));
        }
      };
    }
    return () => {
      cancelled = true;
    };
  }, [spriteSheets, loadedSheets]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      setViewport({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
        dpr,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    if (startNodeId && nodes[startNodeId]) {
      const sn = nodes[startNodeId];
      setCamera((prev) => ({ ...prev, x: sn.x, y: sn.y }));
    }
  }, [startNodeId, nodes]);

  useEffect(() => {
    if (!focusTrigger) return;
    const target = nodes[focusTrigger.nodeId];
    if (target) {
      setCamera((prev) => ({
        x: target.x,
        y: target.y,
        zoom: Math.max(prev.zoom, 0.28),
      }));
    }
  }, [focusTrigger, nodes]);

  const effectiveRootId = useMemo(() => {
    if (startNodeId && nodes[startNodeId]) return startNodeId;
    if (allocatedIds.length > 0 && nodes[allocatedIds[0]]) return allocatedIds[0];
    const keys = Object.keys(nodes);
    return keys.length > 0 ? Number(keys[0]) : 0;
  }, [startNodeId, nodes, allocatedIds]);

  const allocatedSet = useMemo(() => {
    const set = new Set<number>(allocatedIds);
    if (effectiveRootId && nodes[effectiveRootId]) {
      set.add(effectiveRootId);
    }
    return set;
  }, [allocatedIds, effectiveRootId, nodes]);

  const highlightedSet = useMemo(() => new Set<number>(highlightedIds), [highlightedIds]);

  const findShortestPath = useCallback(
    (targetId: number): number[] => {
      if (!nodes[targetId] || allocatedSet.has(targetId)) return [];

      const roots =
        allocatedSet.size > 0
          ? Array.from(allocatedSet)
          : effectiveRootId && nodes[effectiveRootId]
          ? [effectiveRootId]
          : [];

      if (roots.length === 0) return [];

      const queue: number[] = [...roots];
      const visited = new Set<number>(roots);
      const parent = new Map<number, number>();

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === targetId) {
          const path: number[] = [];
          let step: number | undefined = targetId;
          while (step !== undefined && !allocatedSet.has(step)) {
            path.unshift(step);
            step = parent.get(step);
          }
          return path;
        }

        const currNode = nodes[curr];
        if (!currNode) continue;
        for (const nbr of currNode.neighbors) {
          if (nodes[nbr] && !visited.has(nbr)) {
            visited.add(nbr);
            parent.set(nbr, curr);
            queue.push(nbr);
          }
        }
      }
      return [];
    },
    [nodes, allocatedSet, effectiveRootId]
  );

  const findNodesToRemove = useCallback(
    (removeId: number): number[] => {
      if (removeId === effectiveRootId) return [];
      const remaining = new Set<number>(allocatedSet);
      remaining.delete(removeId);

      if (!effectiveRootId || !remaining.has(effectiveRootId)) {
        return Array.from(allocatedSet).filter((id) => id !== effectiveRootId);
      }

      const reachable = new Set<number>([effectiveRootId]);
      const queue: number[] = [effectiveRootId];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const currNode = nodes[curr];
        if (!currNode) continue;
        for (const nbr of currNode.neighbors) {
          if (nodes[nbr] && remaining.has(nbr) && !reachable.has(nbr)) {
            reachable.add(nbr);
            queue.push(nbr);
          }
        }
      }

      const toRemove: number[] = [removeId];
      for (const id of remaining) {
        if (!reachable.has(id) && id !== effectiveRootId) {
          toRemove.push(id);
        }
      }
      return toRemove;
    },
    [allocatedSet, effectiveRootId, nodes]
  );

  const hoverPreview = useMemo(() => {
    if (hoveredNodeId === null || !nodes[hoveredNodeId]) {
      return { addPath: [] as number[], removeList: [] as number[], overBudget: false };
    }

    if (allocatedSet.has(hoveredNodeId)) {
      if (hoveredNodeId === effectiveRootId) {
        return { addPath: [], removeList: [], overBudget: false };
      }
      return {
        addPath: [],
        removeList: findNodesToRemove(hoveredNodeId),
        overBudget: false,
      };
    }

    const addPath = findShortestPath(hoveredNodeId);
    const currentCount = allocatedSet.size;
    const overBudget = addPath.length === 0 || currentCount + addPath.length > maxPoints;

    return { addPath, removeList: [], overBudget };
  }, [
    hoveredNodeId,
    nodes,
    allocatedSet,
    effectiveRootId,
    findNodesToRemove,
    findShortestPath,
    maxPoints,
  ]);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - viewport.width / 2) / camera.zoom + camera.x,
      y: (sy - viewport.height / 2) / camera.zoom + camera.y,
    }),
    [viewport.width, viewport.height, camera]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = viewport;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, width, height);

    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const previewAddSet = new Set(hoverPreview.addPath);
    const previewRemoveSet = new Set(hoverPreview.removeList);

    const drawnEdges = new Set<string>();
    for (const nodeA of Object.values(nodes)) {
      for (const nbrId of nodeA.neighbors) {
        const nodeB = nodes[nbrId];
        if (!nodeB) continue;

        const key = nodeA.id < nbrId ? `${nodeA.id}:${nbrId}` : `${nbrId}:${nodeA.id}`;
        if (drawnEdges.has(key)) continue;
        drawnEdges.add(key);

        const bothAlloc = allocatedSet.has(nodeA.id) && allocatedSet.has(nbrId);
        const isAddEdge =
          (allocatedSet.has(nodeA.id) || previewAddSet.has(nodeA.id)) &&
          (allocatedSet.has(nbrId) || previewAddSet.has(nbrId)) &&
          (previewAddSet.has(nodeA.id) || previewAddSet.has(nbrId));
        const isRemEdge =
          bothAlloc && (previewRemoveSet.has(nodeA.id) || previewRemoveSet.has(nbrId));

        if (isRemEdge) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3.0;
        } else if (bothAlloc) {
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 3.2;
        } else if (isAddEdge) {
          ctx.strokeStyle = hoverPreview.overBudget ? '#f97316' : '#38bdf8';
          ctx.lineWidth = 2.8;
        } else {
          ctx.strokeStyle = '#262c3a';
          ctx.lineWidth = 1.8;
        }

        ctx.beginPath();
        ctx.moveTo(nodeA.x, nodeA.y);
        ctx.lineTo(nodeB.x, nodeB.y);
        ctx.stroke();
      }
    }

    const rootNode = nodes[effectiveRootId];
    if (rootNode) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(rootNode.x, rootNode.y, 76, 0, Math.PI * 2);
      ctx.fillStyle = '#111622';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#d97706';
      ctx.stroke();

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((selectedClass || 'START').toUpperCase(), rootNode.x, rootNode.y - 6);

      if (selectedAscendancy) {
        ctx.fillStyle = '#c084fc';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(selectedAscendancy, rootNode.x, rootNode.y + 14);
      }
      ctx.restore();
    }

    for (const node of Object.values(nodes)) {
      if (node.id === effectiveRootId) continue;

      const isAlloc = allocatedSet.has(node.id);
      const isAdd = previewAddSet.has(node.id);
      const isRem = previewRemoveSet.has(node.id);
      const isMatch = highlightedSet.has(node.id);

      const radius = node.is_keystone ? 32 : node.is_notable ? 23 : 14;

      if (isMatch) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 12, 0, Math.PI * 2);
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      let drewIcon = false;
      if (node.icon && loadedSheets[node.icon.filename]) {
        const img = loadedSheets[node.icon.filename];
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(
          img,
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
        drewIcon = true;
      }

      if (!drewIcon) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isAlloc
          ? '#2a210f'
          : node.is_attribute_choice
          ? '#172033'
          : '#121620';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = node.is_keystone || node.is_notable ? 2.8 : 1.8;

      if (isRem) {
        ctx.strokeStyle = '#ef4444';
      } else if (isAlloc) {
        ctx.strokeStyle = '#f59e0b';
      } else if (isAdd) {
        ctx.strokeStyle = hoverPreview.overBudget ? '#f97316' : '#38bdf8';
      } else {
        ctx.strokeStyle = node.is_keystone || node.is_notable ? '#64748b' : '#334155';
      }
      ctx.stroke();
    }

    ctx.restore();
  }, [
    viewport,
    camera,
    nodes,
    allocatedSet,
    highlightedSet,
    effectiveRootId,
    selectedClass,
    selectedAscendancy,
    hoverPreview,
    loadedSheets,
  ]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      camX: camera.x,
      camY: camera.y,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    if (isDragging) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        dragStartRef.current.moved = true;
      }
      setCamera((prev) => ({
        ...prev,
        x: dragStartRef.current.camX - dx / prev.zoom,
        y: dragStartRef.current.camY - dy / prev.zoom,
      }));
      return;
    }

    const world = screenToWorld(sx, sy);
    let found: number | null = null;
    let bestDist = Infinity;

    for (const node of Object.values(nodes)) {
      if (node.id === effectiveRootId) continue;
      const hitR = node.is_keystone ? 36 : node.is_notable ? 26 : 18;
      const d = Math.hypot(world.x - node.x, world.y - node.y);
      if (d <= hitR && d < bestDist) {
        bestDist = d;
        found = node.id;
      }
    }
    setHoveredNodeId(found);
  };

  const handleMouseUp = () => {
    const wasMoved = dragStartRef.current.moved;
    setIsDragging(false);

    if (wasMoved || hoveredNodeId === null) return;

    if (onSetAllocatedIds) {
      if (hoverPreview.removeList.length > 0) {
        const remSet = new Set(hoverPreview.removeList);
        const next = Array.from(allocatedSet).filter((id) => !remSet.has(id));
        onSetAllocatedIds(next);
      } else if (hoverPreview.addPath.length > 0) {
        if (hoverPreview.overBudget) {
          onBudgetExceeded?.(allocatedSet.size + hoverPreview.addPath.length, maxPoints);
          return;
        }
        const next = Array.from(new Set([...allocatedSet, ...hoverPreview.addPath]));
        onSetAllocatedIds(next);
      }
    } else {
      onToggleNode(hoveredNodeId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setCamera((prev) => ({
      ...prev,
      zoom: Math.min(1.5, Math.max(0.05, prev.zoom * factor)),
    }));
  };

  const hoveredNode = hoveredNodeId !== null ? nodes[hoveredNodeId] : null;

  const tooltipWidth = 280;
  const tooltipLeft =
    mousePos.x + tooltipWidth + 24 > viewport.width
      ? Math.max(12, mousePos.x - tooltipWidth - 16)
      : mousePos.x + 16;
  const tooltipTop = Math.min(Math.max(12, mousePos.y + 12), Math.max(12, viewport.height - 180));

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsDragging(false);
          setHoveredNodeId(null);
        }}
        onWheel={handleWheel}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: isDragging ? 'grabbing' : hoveredNode ? 'pointer' : 'grab',
        }}
      />

      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            left: tooltipLeft,
            top: tooltipTop,
            width: tooltipWidth,
            background: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '9px 12px',
            pointerEvents: 'none',
            boxShadow: '0 8px 24px rgba(0,0,0,0.65)',
            zIndex: 25,
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#f8fafc', marginBottom: 4 }}>
            {hoveredNode.name || `Düğüm #${hoveredNode.id}`}
          </div>
          {hoveredNode.stats.map((st, idx) => (
            <div key={idx} style={{ fontSize: 12, color: '#93c5fd', lineHeight: 1.4 }}>
              {st}
            </div>
          ))}
          <div style={{ marginTop: 7, fontSize: 11, fontWeight: 'bold' }}>
            {hoverPreview.removeList.length > 0 ? (
              <span style={{ color: '#f87171' }}>
                Kaldırılacak: {hoverPreview.removeList.length} puan
              </span>
            ) : hoverPreview.overBudget ? (
              <span style={{ color: '#fb923c' }}>
                +{hoverPreview.addPath.length} puan (Bütçe sınırı {maxPoints} aşılıyor)
              </span>
            ) : hoverPreview.addPath.length > 0 ? (
              <span style={{ color: '#38bdf8' }}>+{hoverPreview.addPath.length} puan bağla</span>
            ) : (
              <span style={{ color: '#64748b' }}>Ana ağaca doğrudan bağlı değil</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};