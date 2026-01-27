import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../../lib/api';
import { X, Building2, Box, Warehouse, Thermometer, Layers } from 'lucide-react';

interface CreateContainerModalProps {
  onClose: () => void;
  parentId?: string | null;
  parentName?: string;
}

const CONTAINER_TYPES = [
  { id: 'facility', label: 'Facility', icon: Building2 },
  { id: 'room', label: 'Room', icon: Warehouse },
  { id: 'freezer', label: 'Freezer', icon: Thermometer },
  { id: 'shelf', label: 'Shelf', icon: Layers },
  { id: 'box', label: 'Box', icon: Box },
];

export function CreateContainerModal({ onClose, parentId, parentName }: CreateContainerModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState(CONTAINER_TYPES[0].id);
  const [rows, setRows] = useState(9);
  const [cols, setCols] = useState(9);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-surface border border-white/10 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h3 className="text-lg font-semibold text-white">Create New Container</h3>
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

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Container Type</label>
            <div className="grid grid-cols-5 gap-2">
              {CONTAINER_TYPES.map((t) => (
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

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Freezer A, Shelf 1, Box A1..."
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
            disabled={!name || createMutation.isPending}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Container'}
          </button>
        </div>
      </div>
    </div>
  );
}
