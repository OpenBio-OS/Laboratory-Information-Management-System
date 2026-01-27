import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, Sample } from '../../../lib/api';
import { X, Beaker } from 'lucide-react';

interface CreateSampleModalProps {
    onClose: () => void;
    containerId: string;
    containerName: string;
    prefilledSlot?: string;
    editSample?: Sample; // If provided, we're editing instead of creating
}

export function CreateSampleModal({ onClose, containerId, containerName, prefilledSlot, editSample }: CreateSampleModalProps) {
    const queryClient = useQueryClient();
    const [name, setName] = useState(editSample?.name || '');
    const [metadata, setMetadata] = useState(editSample?.metadata || '');

    const createMutation = useMutation({
        mutationFn: async () => {
            if (editSample) {
                return inventoryApi.updateSample(editSample.id, {
                    name,
                    metadata,
                });
            } else {
                return inventoryApi.createSample({
                    name,
                    type: 'specimen', // Default type
                    metadata,
                    slotPosition: prefilledSlot || undefined,
                    containerId
                });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['samples'] });
            onClose();
        },
        onError: (error) => {
            console.error(`Failed to ${editSample ? 'update' : 'create'} sample:`, error);
            alert(`Failed to ${editSample ? 'update' : 'create'} sample: ${error}`);
        }
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-md bg-surface border border-white/10 rounded-2xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <div className="flex items-center gap-2">
                        <Beaker size={20} className="text-brand-primary" />
                        <h3 className="text-lg font-semibold text-white">{editSample ? 'Edit' : 'Add'} Sample</h3>
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 p-2 rounded-lg">
                        <span className="text-brand-primary">↳</span>
                        Adding to: <span className="text-white font-medium">{containerName}</span>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-white/60">Sample Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., HEK293 Cells, Trypsin, DAPI..."
                            className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-white/60">Notes / Description</label>
                        <textarea
                            value={metadata}
                            onChange={(e) => setMetadata(e.target.value)}
                            placeholder="Cell passage number, concentration, batch number, expiry date, or any other relevant information..."
                            rows={4}
                            className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 resize-none"
                        />
                    </div>

                    {prefilledSlot && (
                        <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-lg p-3">
                            <div className="text-xs text-white/60 mb-1">Position</div>
                            <div className="text-sm font-semibold text-brand-primary">{prefilledSlot}</div>
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
                        {createMutation.isPending ? (editSample ? 'Updating...' : 'Creating...') : (editSample ? 'Update Sample' : 'Add Sample')}
                    </button>
                </div>
            </div>
        </div>
    );
}
