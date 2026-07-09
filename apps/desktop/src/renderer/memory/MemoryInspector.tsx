import type { MemoryGraphLink, MemoryGraphNode } from "@geistr/core";

import { MEMORY_TYPE_LABELS, formatTimestamp, previewText } from "./memory-graph-model";
import { memoryTypeClassName } from "./memory-theme";

export function MemoryInspector({
  node,
  nodesById,
  links,
  onSelectNode,
  onClose,
}: {
  node: MemoryGraphNode;
  nodesById: Map<string, MemoryGraphNode>;
  links: MemoryGraphLink[];
  onSelectNode: (id: string) => void;
  onClose: () => void;
}) {

  const connected = links
    .filter((l) => l.source === node.id || l.target === node.id)
    .map((l) => {
      const otherId = l.source === node.id ? l.target : l.source;
      const other = nodesById.get(otherId);
      return { link: l, otherId, other };
    })
    .filter((e) => e.other);

  return (
    <aside className="memoryInspector" aria-label="Memory inspector">
      <header className="memoryInspectorHeader">
        <div className="memoryInspectorPills">
          <span className={memoryTypeClassName(node.memoryType)}>
            {MEMORY_TYPE_LABELS[node.memoryType]}
          </span>
          <span className={`memoryStatusPill status-${node.status}`}>{node.status}</span>
        </div>
        <button type="button" className="memoryInspectorClose" onClick={onClose} aria-label="Hide memory details">×</button>
      </header>
      <p className="memoryInspectorContent">{node.content}</p>
      <dl className="memoryInspectorMeta">
        <div><dt>Importance</dt><dd>{node.importance}</dd></div>
        <div><dt>Stability</dt><dd>{node.stability}</dd></div>
        <div><dt>Strength</dt><dd>{node.currentStrength}</dd></div>
        <div><dt>Recalls</dt><dd>{node.recallCount}</dd></div>
        <div><dt>Created</dt><dd>{formatTimestamp(node.createdAt)}</dd></div>
        <div><dt>Updated</dt><dd>{formatTimestamp(node.updatedAt)}</dd></div>
      </dl>
      {node.tags.length > 0 ? (
        <div className="memoryInspectorTags">
          {node.tags.map((tag) => <span key={tag} className="memoryTag">{tag}</span>)}
        </div>
      ) : null}
      <section className="memoryInspectorLinks">
        <h3>Connections ({connected.length})</h3>
        {connected.length === 0 ? <p className="memoryInspectorMuted">No links to other visible memories.</p> : (
          <ul>
            {connected.map(({ link, otherId, other }) => (
              <li key={`${link.id}-${otherId}`}>
                <button type="button" className="memoryLinkButton" onClick={() => onSelectNode(otherId)}>
                  <span className="memoryLinkType">{link.linkType}</span>
                  <span>{previewText(other!.content, 80)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}