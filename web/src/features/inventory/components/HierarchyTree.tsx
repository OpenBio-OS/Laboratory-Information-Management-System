import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Box, Folder, Trash2 } from 'lucide-react';
import { Container } from '../../../lib/api';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface HierarchyTreeProps {
  containers: Container[];
  selectedId: string | null;
  onSelect: (container: Container) => void;
  onCreateConfirm: (parentId: string | null) => void;
  onDelete: (id: string) => void;
}

interface TreeNodeProps {
  container: Container;
  allContainers: Container[];
  level: number;
  selectedId: string | null;
  onSelect: (container: Container) => void;
  onCreateConfirm: (parentId: string | null) => void;
  onDelete: (id: string) => void;
}

function TreeNode({ container, allContainers, level, selectedId, onSelect, onCreateConfirm, onDelete }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [deleteItem, setDeleteItem] = useState<Container | null>(null);
  const children = allContainers.filter(c => c.parentId === container.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === container.id;

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div>
      {deleteItem && (
        <DeleteConfirmModal
          onClose={() => setDeleteItem(null)}
          onConfirm={() => onDelete(deleteItem.id)}
          itemName={deleteItem.name}
          itemType={deleteItem.type}
        />
      )}

      <div
        className={`
          group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors select-none
          ${isSelected ? 'bg-brand-primary/20 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(container)}
      >
        <button
          onClick={handleExpand}
          className={`p-0.5 rounded hover:bg-white/10 transition-opacity ${hasChildren ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <Box size={14} className={isSelected ? 'text-brand-primary' : 'text-white/50'} />
        <span className="text-sm truncate flex-1">{container.name}</span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onCreateConfirm(container.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-brand-primary transition-all rounded"
          title="Add Child"
        >
          <Plus size={12} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteItem(container);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-all rounded"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {isExpanded && children.map(child => (
        <TreeNode
          key={child.id}
          container={child}
          allContainers={allContainers}
          level={level + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateConfirm={onCreateConfirm}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function HierarchyTree({ containers, selectedId, onSelect, onCreateConfirm, onDelete }: HierarchyTreeProps) {
  const rootContainers = containers.filter(c => !c.parentId);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 mb-2">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Storage</h3>
        <button
          onClick={() => onCreateConfirm(null)}
          className="p-1 text-white/40 hover:text-brand-primary transition-colors"
          title="Add Freezer"
        >
          <Plus size={16} />
        </button>
      </div>

      {rootContainers.length === 0 ? (
        <div className="text-sm text-white/30 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
          No freezers yet.
          <br />
          <button
            onClick={() => onCreateConfirm(null)}
            className="text-brand-primary hover:underline mt-1"
          >
            Add Freezer
          </button>
        </div>
      ) : (
        rootContainers.map(container => (
          <TreeNode
            key={container.id}
            container={container}
            allContainers={containers}
            selectedId={selectedId}
            onSelect={onSelect}
            level={0}
            onCreateConfirm={onCreateConfirm}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}
