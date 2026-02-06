import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../../../lib/api';
import { X, Building2, Box, Warehouse, Thermometer, Layers } from 'lucide-react';

interface CreateContainerModalProps {
  onClose: () => void;
  parentId?: string | null;
  parentName?: string;
}

// Hierarchy: Facility -> Room -> Freezer -> Shelf -> Box
// Box is the smallest unit - no containers allowed inside
const CONTAINER_TYPES = [
  { id: 'facility', label: 'Facility', icon: Building2 },
  { id: 'room', label: 'Room', icon: Warehouse },
  { id: 'freezer', label: 'Freezer', icon: Thermometer },
  { id: 'shelf', label: 'Shelf', icon: Layers },
  { id: 'box', label: 'Box', icon: Box },
];

// Define what child types are allowed for each parent type
const ALLOWED_CHILDREN: Record<string, string[]> = {
  'facility': ['room'],
  'room': ['freezer'],
  'freezer': ['shelf'],
  'shelf': ['box'],
  'box': [], // Box cannot have children
};

// When creating at root level (no parent), only allow facility
const ROOT_ALLOWED = ['facility'];

export function CreateContainerModal({ onClose, parentId, parentName }: CreateContainerModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [rows, setRows] = useState(9);
  const [cols, setCols] = useState(9);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Fetch containers to determine parent type
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: inventoryApi.listContainers
  });

  // Find parent container and determine allowed types
  const parentContainer = parentId ? containers.find(c => c.id === parentId) : null;
  const allowedTypes = parentContainer
    ? ALLOWED_CHILDREN[parentContainer.type] || []
    : ROOT_ALLOWED;

  const availableTypes = CONTAINER_TYPES.filter(t => allowedTypes.includes(t.id));

  // Set default type when available types change
  useEffect(() => {
    if (availableTypes.length > 0 && !allowedTypes.includes(type)) {
      setType(availableTypes[0].id);
    }
  }, [allowedTypes, availableTypes, type]);

  const createMutation = useMutation({
    mutationFn: async () => {
      return inventoryApi.createContainer({
        name,
        type: type,
        parentId: parentId || undefined,
        layoutConfig: type === 'box' ? { rows, cols } : undefined
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      onClose();
    },
    onError: (error) => {
      console.error('Failed to create container:', error);
      alert(`Failed to create container: ${error}`);
    }
  });

  // Get the next expected type label for context
  const getNextTypeLabel = () => {
    if (!parentContainer) return 'Facility';
    const allowed = ALLOWED_CHILDREN[parentContainer.type];
    if (allowed.length === 1) {
      const typeInfo = CONTAINER_TYPES.find(t => t.id === allowed[0]);
      return typeInfo?.label || 'Container';
    }
    return 'Container';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h3 className="text-lg font-semibold text-white">
            {parentContainer ? `Add ${getNextTypeLabel()}` : 'Create Facility'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {parentName && (
            <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 p-2 rounded-lg">
              <span className="text-brand-primary">↳</span>
              Adding inside: <span className="text-white font-medium">{parentName}</span>
            </div>
          )}

          {/* Only show type selector if more than one option */}
          {availableTypes.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/60">Container Type</label>
              <div className={`grid grid-cols-${availableTypes.length} gap-2`}>
                {availableTypes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${type === t.id
                      ? 'bg-brand-primary/20 border-brand-primary text-brand-primary'
                      : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10'
                      }`}
                  >
                    <t.icon size={20} />
                    <span className="text-xs font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Show single type indicator when only one option */}
          {availableTypes.length === 1 && (
            <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
              {(() => {
                const TypeIcon = availableTypes[0].icon;
                return (
                  <>
                    <TypeIcon size={20} className="text-brand-primary" />
                    <span className="text-sm text-white/70">Creating a <span className="text-white font-medium">{availableTypes[0].label}</span></span>
                  </>
                );
              })()}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g., ${type === 'facility' ? 'Main Building' : type === 'room' ? 'Lab 101' : type === 'freezer' ? 'Freezer A' : type === 'shelf' ? 'Shelf 1' : 'Box A1'}`}
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>

          {type === 'box' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/60">Rows</label>
                <input
                  type="number"
                  min="1"
                  max="26"
                  value={rows}
                  onChange={(e) => setRows(parseInt(e.target.value) || 9)}
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/60">Columns</label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={cols}
                  onChange={(e) => setCols(parseInt(e.target.value) || 9)}
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name || !type || createMutation.isPending}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? 'Creating...' : `Create ${availableTypes.find(t => t.id === type)?.label || 'Container'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
