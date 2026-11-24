import React, { useEffect, useRef, useState } from 'react';

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
  onToggleNode?: (id: number) => void;
}

export const SkillTreeCanvas: React.FC<Props> = ({
  nodes,
  spriteSheets = {},
  allocatedIds,
  highlightedIds = [],
  focusTrigger = null,
  onToggleNode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [transform, setTransform] = useState({ x: 640, y: 400, scale: 0.08 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<PassiveNode | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

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
    const nodeList = Object.values(nodes);
    if (nodeList.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of nodeList) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const scale = Math.min(1200 / width, 720 / height) * 0.9;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setTransform({
      x: 640 - centerX * scale,
      y: 400 - centerY * scale,
      scale,
    });
  }, [nodes]);

  // Seçilen/aranan düğüme kamerayı odakla
  useEffect(() => {
    if (!focusTrigger) return;
    const target = nodes[focusTrigger.nodeId];
    if (!target) return;

    const targetScale = Math.max(transform.scale, 0.24);
    setTransform({
      x: 640 - target.x * targetScale,
      y: 400 - target.y * targetScale,
      scale: targetScale,
    });
    setHoveredNode(target);
  }, [focusTrigger]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const allocatedSet = new Set(allocatedIds);
    const highlightSet = new Set(highlightedIds);
    const hasSearchActive = highlightSet.size > 0;
    const nodeList = Object.values(nodes);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // 1. Bağlantı çizgileri
    ctx.lineCap = 'round';
    for (const node of nodeList) {
      const isNodeAlloc = allocatedSet.has(node.id);
      for (const nbrId of node.neighbors) {
        if (nbrId < node.id) continue;
        const nbr = nodes[nbrId];
        if (!nbr) continue;

        const dx = node.x - nbr.x;
        const dy = node.y - nbr.y;
        if (dx * dx + dy * dy > 1500 * 1500) continue;

        const bothAlloc = isNodeAlloc && allocatedSet.has(nbrId);
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(nbr.x, nbr.y);
        ctx.strokeStyle = bothAlloc ? '#f59e0b' : '#334155';
        ctx.lineWidth = bothAlloc ? 18 : 8;
        ctx.stroke();
      }
    }

    // 2. Düğümler, İkonlar ve Arama Vurgusu
    const showIcons = transform.scale > 0.06;

    for (const node of nodeList) {
      const isAlloc = allocatedSet.has(node.id);
      const isMatch = highlightSet.has(node.id);
      const isHovered = hoveredNode?.id === node.id;
      const baseRadius = node.is_keystone ? 44 : node.is_notable ? 30 : 18;
      const radius = isHovered ? baseRadius * 1.25 : isMatch ? baseRadius * 1.15 : baseRadius;

      // Arama eşleşmesi varsa dışına parlak turkuaz halo çiz
      if (isMatch) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 245, 212, 0.28)';
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#00f5d4';
        ctx.stroke();
      }

      const sheetImg =
        showIcons && node.icon ? loadedImages[node.icon.filename] : undefined;

      if (sheetImg && node.icon) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (!isAlloc && !isHovered && !isMatch) {
          ctx.filter = hasSearchActive
            ? 'brightness(0.35) grayscale(0.7)'
            : 'brightness(0.65) grayscale(0.35)';
        }

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
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isMatch
          ? '#042f2e'
          : isAlloc
          ? '#451a03'
          : node.is_keystone
          ? '#1e1b4b'
          : node.is_notable
          ? '#0c4a6e'
          : '#0f172a';
        ctx.fill();

        if (showIcons) {
          const joinedStats = node.stats.join(' ').toLowerCase();
          let glyph = '•';
          let glyphColor = isAlloc ? '#fbbf24' : '#94a3b8';

          if (joinedStats.includes('lightning') || joinedStats.includes('shock')) {
            glyph = '⚡';
            glyphColor = '#38bdf8';
          } else if (joinedStats.includes('fire') || joinedStats.includes('ignite')) {
            glyph = '🔥';
            glyphColor = '#f97316';
          } else if (joinedStats.includes('cold') || joinedStats.includes('freeze')) {
            glyph = '❄';
            glyphColor = '#67e8f9';
          } else if (joinedStats.includes('life') || joinedStats.includes('armour')) {
            glyph = '🛡';
            glyphColor = '#f87171';
          } else if (joinedStats.includes('energy shield') || joinedStats.includes('spell')) {
            glyph = '✦';
            glyphColor = '#60a5fa';
          } else if (joinedStats.includes('critical') || joinedStats.includes('attack')) {
            glyph = '⚔';
            glyphColor = '#facc15';
          } else if (joinedStats.includes('minion')) {
            glyph = '💀';
            glyphColor = '#a78bfa';
          } else if (joinedStats.includes('strength')) {
            glyph = 'S';
            glyphColor = '#ef4444';
          } else if (joinedStats.includes('dexterity')) {
            glyph = 'D';
            glyphColor = '#22c55e';
          } else if (joinedStats.includes('intelligence')) {
            glyph = 'I';
            glyphColor = '#3b82f6';
          }

          ctx.fillStyle = glyphColor;
          ctx.font = `bold ${Math.round(radius * 1.15)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(glyph, node.x, node.y + 1);
        }
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = isHovered ? 7 : isMatch ? 6 : node.is_keystone ? 6 : 4;
      ctx.strokeStyle = isHovered
        ? '#ffffff'
        : isMatch
        ? '#00f5d4'
        : isAlloc
        ? '#f59e0b'
        : node.is_keystone
        ? '#a855f7'
        : node.is_notable
        ? '#38bdf8'
        : '#475569';
      ctx.stroke();
    }

    ctx.restore();
  }, [nodes, allocatedIds, highlightedIds, transform, hoveredNode, loadedImages]);

  const handleWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scaleX = (canvasRef.current?.width || 1280) / rect.width;
    const scaleY = (canvasRef.current?.height || 800) / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;
    setTransform((prev) => {
      const nextScale = Math.min(Math.max(prev.scale * zoomFactor, 0.02), 2.5);
      const ratio = nextScale / prev.scale;
      return {
        x: mouseX - (mouseX - prev.x) * ratio,
        y: mouseY - (mouseY - prev.y) * ratio,
        scale: nextScale,
      };
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      dragMovedRef.current = true;
      setTransform((prev) => ({
        ...prev,
        x: prev.x + (e.clientX - dragStart.x),
        y: prev.y + (e.clientY - dragStart.y),
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = (canvasRef.current?.width || 1280) / rect.width;
    const scaleY = (canvasRef.current?.height || 800) / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const worldX = (canvasX - transform.x) / transform.scale;
    const worldY = (canvasY - transform.y) / transform.scale;

    let found: PassiveNode | null = null;
    let bestDistSq = 45 * 45;
    for (const node of Object.values(nodes)) {
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        found = node;
      }
    }
    setHoveredNode(found);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        width={1280}
        height={800}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          setIsDragging(true);
          dragMovedRef.current = false;
          setDragStart({ x: e.clientX, y: e.clientY });
        }}
        onMouseUp={() => {
          if (!dragMovedRef.current && hoveredNode && onToggleNode) {
            onToggleNode(hoveredNode.id);
          }
          setIsDragging(false);
        }}
        onMouseLeave={() => setIsDragging(false)}
        onMouseMove={handleMouseMove}
        style={{
          width: '100%',
          height: '100%',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      />

      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #f59e0b',
            padding: '12px 16px',
            borderRadius: 8,
            maxWidth: 360,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 'bold', color: '#fbbf24', marginBottom: 6 }}>
            {hoveredNode.name || `Node #${hoveredNode.id}`}
          </div>
          {hoveredNode.stats.length > 0 ? (
            hoveredNode.stats.map((s, idx) => (
              <div key={idx} style={{ fontSize: 13, color: '#cbd5e1' }}>
                • {s}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Bağlantı / Başlangıç Düğümü
            </div>
          )}
        </div>
      )}
    </div>
  );
};