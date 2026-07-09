import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import type { MemoryGraphLink, MemoryGraphNode } from "@geistr/core";
import * as THREE from "three";

import {
  MEMORY_TYPE_LABELS,
  buildAdjacency,
  linkWidth,
  neighborhoodIds,
  nodeRadius,
  previewText,
} from "./memory-graph-model";
import { readMemoryGraphTheme, type MemoryGraphTheme } from "./memory-theme";

type GraphNode = MemoryGraphNode & { id: string; name: string; x?: number; y?: number; z?: number };
type GraphLink = { source: string; target: string; strength: number; linkType: string };
type MemoryMote = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  previousId: string;
  currentId: string;
  nextId: string;
  progress: number;
  speed: number;
};

function linkKey(link: GraphLink): string {
  const src = typeof link.source === "object" ? (link.source as GraphNode).id : String(link.source);
  const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : String(link.target);
  return `${src}:${tgt}:${link.linkType}`;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function pickConnectedNode(currentId: string, neighbors: Map<string, string[]>, seed: string, avoidId?: string): string | null {
  const choices = neighbors.get(currentId)?.filter((id) => id !== avoidId);
  const fallback = neighbors.get(currentId);
  const pool = choices?.length ? choices : fallback;
  if (!pool?.length) return null;
  return pool[Math.floor(stableUnit(seed) * pool.length)] ?? pool[0] ?? null;
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function nodePosition(node: GraphNode): THREE.Vector3 {
  return new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
}

let glowTexture: THREE.Texture | null = null;

function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(48, 48, 3, 48, 48, 46);
    gradient.addColorStop(0, "rgba(255,255,255,0.92)");
    gradient.addColorStop(0.22, "rgba(255,255,255,0.36)");
    gradient.addColorStop(0.58, "rgba(255,255,255,0.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

export function MemoryGalaxyGraph({
  nodes,
  links,
  selectedId,
  onSelect,
}: {
  nodes: MemoryGraphNode[];
  links: MemoryGraphLink[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const [hover, setHover] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [theme, setTheme] = useState<MemoryGraphTheme>(() => readMemoryGraphTheme());

  useEffect(() => {
    const refresh = () => setTheme(readMemoryGraphTheme(containerRef.current ?? undefined));
    refresh();
    const root = document.documentElement;
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ["data-geistr-theme-mode"] });
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onMq = () => refresh();
    mq.addEventListener("change", onMq);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const hood = useMemo(() => neighborhoodIds(selectedId, links), [selectedId, links]);
  const adj = useMemo(() => buildAdjacency(links), [links]);

  const graphData = useMemo(() => {
    const gNodes: GraphNode[] = nodes.map((n) => ({ ...n, id: n.id, name: previewText(n.content, 40) }));
    const gLinks: GraphLink[] = links.map((l) => ({
      source: l.source,
      target: l.target,
      strength: l.strength,
      linkType: l.linkType,
    }));
    return { nodes: gNodes, links: gLinks };
  }, [nodes, links]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.max(200, rect.width), h: Math.max(200, rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeThreeObject = useCallback(
    (node: GraphNode) => {
      const isSelected = node.id === selectedId;
      const inHood = hood ? hood.has(node.id) : true;
      const dim = selectedId && !inHood;
      const color = new THREE.Color(theme.typeColors[node.memoryType] ?? theme.typeColors.fact);
      const radius = nodeRadius(node);
      const group = new THREE.Group();

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color,
        transparent: true,
        opacity: dim ? 0.04 : isSelected ? 0.54 : 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      const haloSize = radius * (isSelected ? 5.4 : 4.35);
      halo.scale.set(haloSize, haloSize, 1);
      group.add(halo);

      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: color.clone().lerp(new THREE.Color("#ffffff"), 0.08),
        transparent: true,
        opacity: dim ? 0.06 : isSelected ? 0.72 : 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      const bloomSize = radius * (isSelected ? 2.75 : 2.15);
      bloom.scale.set(bloomSize, bloomSize, 1);
      group.add(bloom);

      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(1.05, radius * 0.16), 12, 12),
        new THREE.MeshBasicMaterial({
          color: color.clone().lerp(new THREE.Color("#ffffff"), 0.18),
          transparent: true,
          opacity: dim ? 0.24 : isSelected ? 0.92 : 0.78,
          depthWrite: false,
        }),
      );
      group.add(spark);

      return group;
    },
    [selectedId, hood, theme],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      const src = typeof link.source === "object" ? (link.source as GraphNode).id : String(link.source);
      const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : String(link.target);
      if (!selectedId) return theme.linkDefault;
      const touches = src === selectedId || tgt === selectedId;
      const bothIn = hood?.has(src) && hood?.has(tgt);
      if (touches || bothIn) return theme.linkHighlight;
      return theme.linkDim;
    },
    [selectedId, hood, theme],
  );

  const linkWidthFn = useCallback((link: GraphLink) => {
    const base = linkWidth(link.strength);
    if (!selectedId) return base;
    const src = typeof link.source === "object" ? (link.source as GraphNode).id : String(link.source);
    const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : String(link.target);
    if (src === selectedId || tgt === selectedId) return base * 2.2;
    return base * 0.5;
  }, [selectedId]);

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    let raf = 0;
    const group = new THREE.Group();
    const motes: MemoryMote[] = [];

    const start = () => {
      if (disposed) return;
      const graph = graphRef.current;
      const scene = graph?.scene();
      if (!graph || !scene) {
        raf = requestAnimationFrame(start);
        return;
      }

      const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
      const neighbors = new Map<string, string[]>();
      for (const link of graphData.links) {
        const src = typeof link.source === "object" ? (link.source as GraphNode).id : String(link.source);
        const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : String(link.target);
        if (!nodeById.has(src) || !nodeById.has(tgt)) continue;
        neighbors.set(src, [...(neighbors.get(src) ?? []), tgt]);
        neighbors.set(tgt, [...(neighbors.get(tgt) ?? []), src]);
      }
      const travelNodes = graphData.nodes.filter((node) => (neighbors.get(node.id)?.length ?? 0) > 0);
      if (travelNodes.length === 0) return;

      scene.add(group);
      const moteCount = Math.min(72, Math.max(18, graphData.links.length * 2));
      for (let i = 0; i < moteCount; i += 1) {
        const startNode = travelNodes[Math.floor(stableUnit(`mote:${i}:node:${graphData.nodes.length}`) * travelNodes.length)] ?? travelNodes[0];
        if (!startNode) continue;
        const previousId = pickConnectedNode(startNode.id, neighbors, `mote:${i}:prev:${graphData.links.length}`) ?? startNode.id;
        const nextId = pickConnectedNode(startNode.id, neighbors, `mote:${i}:next:${graphData.links.length}`, previousId) ?? previousId;
        const color = theme.typeColors[startNode.memoryType] ?? theme.typeColors.fact;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.34 + stableUnit(`mote:${i}:size`) * 0.14, 8, 8),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.86, depthTest: false }),
        );
        group.add(mesh);
        motes.push({
          mesh,
          previousId,
          currentId: startNode.id,
          nextId,
          progress: stableUnit(`mote:${i}:progress`),
          speed: 0.004 + stableUnit(`mote:${i}:speed`) * 0.004,
        });
      }

      const animate = () => {
        if (disposed) return;
        frame += 1;
        for (let i = 0; i < motes.length; i += 1) {
          const mote = motes[i]!;
          const previous = nodeById.get(mote.previousId);
          const current = nodeById.get(mote.currentId);
          const next = nodeById.get(mote.nextId);
          if (!previous || !current || !next || current.x == null || current.y == null || next.x == null || next.y == null) continue;
          mote.progress += mote.speed;
          if (mote.progress >= 1) {
            mote.previousId = mote.currentId;
            mote.currentId = mote.nextId;
            mote.nextId = pickConnectedNode(mote.currentId, neighbors, `mote:${i}:hop:${frame}`, mote.previousId) ?? mote.previousId;
            mote.progress = 0;
          }

          const from = nodePosition(nodeById.get(mote.currentId) ?? current);
          const to = nodePosition(nodeById.get(mote.nextId) ?? next);
          const prev = nodePosition(nodeById.get(mote.previousId) ?? previous);
          const t = mote.progress;
          const linear = from.clone().lerp(to, smoothStep(t));

          const turnRadius = Math.max(2, nodeRadius(current) * 0.62);
          const incoming = from.clone().sub(prev).normalize();
          const outgoing = to.clone().sub(from).normalize();
          const inNode = t < 0.2;
          if (inNode) {
            const turnT = smoothStep(1 - t / 0.2);
            const inside = from.clone().add(incoming.clone().lerp(outgoing, turnT).multiplyScalar(turnRadius * (0.55 - Math.abs(0.5 - turnT) * 0.5)));
            linear.lerp(inside, 1 - t / 0.2);
          }

          mote.mesh.position.copy(linear);
        }
        raf = requestAnimationFrame(animate);
      };
      animate();
    };

    raf = requestAnimationFrame(start);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      group.removeFromParent();
      for (const mote of motes) {
        mote.mesh.geometry.dispose();
        mote.mesh.material.dispose();
      }
    };
  }, [graphData, theme]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onSelect(selectedId === node.id ? null : node.id);
      if (graphRef.current && adj.get(node.id)?.size && node.x != null && node.y != null) {
        const dist = 120;
        const lookAt = { x: node.x, y: node.y, z: node.z ?? 0 };
        graphRef.current.cameraPosition(
          { x: node.x * 1.2, y: node.y * 1.2, z: lookAt.z + dist },
          lookAt,
          800,
        );
      }
    },
    [onSelect, selectedId, adj],
  );

  return (
    <div className="memoryGalaxyCanvas" ref={containerRef}>
      <div className="memoryStarfield" aria-hidden="true" />
      <ForceGraph3D
        ref={graphRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0, 0, 0, 0)"
        nodeId="id"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={linkWidthFn}
        linkOpacity={0.6}
        linkDirectionalParticles={0}
        onNodeClick={handleNodeClick}
        onNodeHover={(node) => {
          if (!node) {
            setHover(null);
            return;
          }
          const rect = containerRef.current?.getBoundingClientRect();
          setHover({
            node: node as GraphNode,
            x: rect ? rect.width / 2 : 0,
            y: 32,
          });
        }}
        showNavInfo={false}
      />
      {hover ? (
        <div className="memoryHoverCard" style={{ left: hover.x, top: hover.y }}>
          <strong>{MEMORY_TYPE_LABELS[hover.node.memoryType] ?? "Memory"}</strong>
          <span>{previewText(hover.node.content)}</span>
        </div>
      ) : null}
    </div>
  );
}