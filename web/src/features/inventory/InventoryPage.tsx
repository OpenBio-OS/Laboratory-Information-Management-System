import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../lib/api';
import { BoxGrid } from './components/BoxGrid';
import { HierarchyTree } from './components/HierarchyTree';
import { CreateContainerModal } from './components/CreateContainerModal';
import { CreateSampleModal } from './components/CreateSampleModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { Plus, Search, LayoutGrid, X } from 'lucide-react';

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreateSampleModalOpen, setIsCreateSampleModalOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteSampleId, setDeleteSampleId] = useState<string | null>(null);
  const [editSampleId, setEditSampleId] = useState<string | null>(null);

  // Fetch samples
  const { data: samples = [] } = useQuery({
    queryKey: ['samples'],
    queryFn: inventoryApi.listSamples
  });

  // Fetch containers
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: inventoryApi.listContainers
  });

  const selectedContainer = containers.find(c => c.id === selectedContainerId);

  // Reset selected slot when container changes
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedContainerId]);

  // Derived state
  const displayedSamples = selectedContainerId
    ? samples.filter(s => s.containerId === selectedContainerId)
    : samples;

  // Global search across ALL samples (ignores selected container)
  const filteredSamples = searchQuery
    ? samples.filter(s => 
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.metadata && s.metadata.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : displayedSamples;

  // Helper to get full location path for a sample
  const getLocationPath = (sample: typeof samples[0]): string => {
    if (!sample.containerId) return 'Unassigned';
    
    const path: string[] = [];
    let currentId: string | undefined = sample.containerId;
    
    while (currentId) {
      const container = containers.find(c => c.id === currentId);
      if (!container) break;
      path.unshift(container.name);
      currentId = container.parentId || undefined;
    }
    
    return path.join(' → ') + (sample.slotPosition ? ` → ${sample.slotPosition}` : '');
  };

  // const childContainers = selectedContainerId
  //   ? containers.filter(c => c.parentId === selectedContainerId)
  //   : containers.filter(c => !c.parentId);

  const handleCreateRequest = (parentId: string | null) => {
    setCreateParentId(parentId);
    setIsCreateModalOpen(true);
  };

  const deleteSampleMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteSample(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['samples'] });
    }
  });

  const deleteContainerMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteContainer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      if (selectedContainerId === deleteContainerMutation.variables) {
        setSelectedContainerId(null);
      }
    }
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-surface/30 backdrop-blur-md">
        <h2 className="text-lg font-semibold text-white">Freezer Inventory</h2>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 w-4 h-4 group-focus-within:text-brand-primary transition-colors" />
            <input
              type="text"
              placeholder="Search samples..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 w-64 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

{/*           <button
            onClick={() => createSampleMutation.mutate()}
            disabled={!selectedContainerId && containers.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            Add Sample
          </button> */}
        </div>
      </div>

      {isCreateModalOpen && (
        <CreateContainerModal
          onClose={() => setIsCreateModalOpen(false)}
          parentId={createParentId}
          parentName={containers.find(c => c.id === createParentId)?.name}
        />
      )}

      {isCreateSampleModalOpen && selectedContainer && (
        <CreateSampleModal
          onClose={() => setIsCreateSampleModalOpen(false)}
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
          prefilledSlot={selectedSlot || undefined}
        />
      )}

      {editSampleId && (() => {
        const sample = samples.find(s => s.id === editSampleId);
        const container = sample?.containerId ? containers.find(c => c.id === sample.containerId) : null;
        return sample && container ? (
          <CreateSampleModal
            onClose={() => setEditSampleId(null)}
            containerId={container.id}
            containerName={container.name}
            editSample={sample}
          />
        ) : null;
      })()}

      {deleteSampleId && (() => {
        const sample = samples.find(s => s.id === deleteSampleId);
        return sample ? (
          <DeleteConfirmModal
            onClose={() => setDeleteSampleId(null)}
            onConfirm={() => {
              deleteSampleMutation.mutate(deleteSampleId);
              setDeleteSampleId(null);
            }}
            itemName={sample.name}
            itemType="Sample"
          />
        ) : null;
      })()}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex min-h-[calc(95vh-144px)]">
        {/* Sidebar */}
        <div className="w-82 bg-black/20 border-r border-white/5 p-4 overflow-y-auto flex-shrink-0">
          <HierarchyTree
            containers={containers}
            selectedId={selectedContainerId}
            onSelect={(c) => setSelectedContainerId(c.id)}
            onCreateConfirm={handleCreateRequest}
            onDelete={(id) => deleteContainerMutation.mutate(id)}
          />
        </div>

        {/* View Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            {searchQuery ? (
              /* Search Results View */
              <div>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-white">Search Results</h2>
                  <p className="text-white/40 text-sm">{filteredSamples.length} sample{filteredSamples.length !== 1 ? 's' : ''} found</p>
                </div>

                {filteredSamples.length > 0 ? (
                  <div className="space-y-3">
                    {filteredSamples.map(sample => (
                      <div
                        key={sample.id}
                        onClick={() => {
                          if (sample.containerId) {
                            setSelectedContainerId(sample.containerId);
                            setSelectedSlot(sample.slotPosition || null);
                            setSearchQuery(''); // Clear search to show the box view
                          }
                        }}
                        className="bg-surface/50 hover:bg-neutral-900/80 border border-white/10 rounded-xl p-5 hover:border-brand-primary/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-white mb-1">{sample.name}</h3>
                            {sample.metadata && (
                              <p className="text-sm text-white/60 mb-3 line-clamp-2">{sample.metadata}</p>
                            )}
                            <div className="flex items-center gap-2 text-xs text-white/40">
                              <span className="font-mono">{getLocationPath(sample)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-white/40">
                    No samples found matching "{searchQuery}"
                  </div>
                )}
              </div>
            ) : selectedContainer?.type === 'box' ? (
              /* Box View - Show Grid and Sample Management */
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-white">{selectedContainer.name}</h2>
                  <p className="text-white/40 text-sm">Box • {filteredSamples.length} of {displayedSamples.length} samples{searchQuery ? ' (filtered)' : ''}</p>
                </div>

                <div className="flex gap-8 items-start">
                  <div className="flex-1">
                    <BoxGrid 
                      samples={filteredSamples.map(s => ({ ...s, slotPosition: s.slotPosition ?? null }))}
                      rows={selectedContainer.layoutConfig?.rows || 9}
                      cols={selectedContainer.layoutConfig?.cols || 9}
                      selectedSlot={selectedSlot}
                      onSlotClick={(slot) => setSelectedSlot(slot)}
                    />
                  </div>
                  
                  {/* Sample Management Panel */}
                  <div className="w-96 bg-surface/30 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-medium text-white/60">Sample Management</h4>
                    </div>
                    
                    {selectedSlot ? (
                      (() => {
                        const sampleInSlot = filteredSamples.find(s => s.slotPosition === selectedSlot);
                        return sampleInSlot ? (
                          /* Slot occupied - show sample details and actions */
                          <div className="space-y-4">
                            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                              <div className="text-xs text-white/40 mb-1">Position: {selectedSlot}</div>
                              <div className="text-lg font-semibold text-white mb-2">{sampleInSlot.name}</div>
                              {sampleInSlot.metadata && (
                                <div className="text-sm text-white/60 mt-2 whitespace-pre-wrap">{sampleInSlot.metadata}</div>
                              )}
                            </div>
                            
                            <div className="flex gap-2">
                              <button
                                onClick={() => setEditSampleId(sampleInSlot.id)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-primary/20 text-brand-primary border border-brand-primary/30 text-sm font-medium rounded-lg hover:bg-brand-primary/30 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteSampleId(sampleInSlot.id)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors"
                              >
                                <X size={14} />
                                Delete
                              </button>
                            </div>
                            
                            <div className="pt-4 border-t border-white/10">
                              <div className="text-xs text-white/40 mb-2">All Samples ({filteredSamples.length})</div>
                              <div className="space-y-2 h-[300px] overflow-y-auto">
                                {filteredSamples.map(s => (
                                  <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSlot(s.slotPosition || null)}
                                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                                      s.id === sampleInSlot.id
                                        ? 'bg-white/20 border-white/50 text-white'
                                        : 'bg-white/5 border-white/5 hover:border-white/30 text-white/70'
                                    }`}
                                  >
                                    <div className="text-sm font-medium">{s.name}</div>
                                    <div className="text-xs text-white/40">Slot: {s.slotPosition || 'Unassigned'}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Slot empty - show add button */
                          <div className="space-y-4">
                            <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-lg p-4 text-center">
                              <div className="text-sm text-white/80 mb-2">Slot {selectedSlot} is empty</div>
                              <button
                                onClick={() => setIsCreateSampleModalOpen(true)}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary transition-colors w-full"
                              >
                                <Plus size={16} />
                                Add Sample to {selectedSlot}
                              </button>
                            </div>
                            
                            <div className="pt-4 border-t border-white/10">
                              <div className="text-xs text-white/40 mb-2">All Samples ({filteredSamples.length})</div>
                              <div className="space-y-2 h-[300px] overflow-y-auto">
                                {filteredSamples.map(s => (
                                  <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSlot(s.slotPosition || null)}
                                    className="p-2 bg-white/5 rounded-lg border border-white/5 hover:border-brand-primary/30 cursor-pointer transition-colors"
                                  >
                                    <div className="text-sm font-medium text-white/70">{s.name}</div>
                                    <div className="text-xs text-white/40">Slot: {s.slotPosition || 'Unassigned'}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      /* No slot selected */
                      <div className="text-center py-12">
                        <div className="text-white/30 text-sm mb-4">Select a slot in the grid to add or manage samples</div>
                        <div className="pt-4 border-t border-white/10">
                          <div className="text-xs text-white/40 mb-2">All Samples ({filteredSamples.length})</div>
                          <div className="space-y-2 h-[300px] overflow-y-auto">
                            {filteredSamples.map(s => (
                              <div 
                                key={s.id} 
                                onClick={() => setSelectedSlot(s.slotPosition || null)}
                                className="p-2 bg-white/5 rounded-lg border border-white/5 hover:border-brand-primary/30 cursor-pointer transition-colors"
                              >
                                <div className="text-sm font-medium text-white/70">{s.name}</div>
                                <div className="text-xs text-white/40">Slot: {s.slotPosition || 'Unassigned'}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Empty State - Prompt to use the tree */
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                    <LayoutGrid size={40} className="text-white/20" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {containers.length === 0 ? 'No Storage Yet' : 'Select a Box'}
                  </h3>
                  <p className="text-white/40 text-sm">
                    {containers.length === 0 
                      ? 'Use the tree on the left to create your first freezer and organize your inventory.'
                      : selectedContainer
                      ? `Navigate through the tree to find a box, or add one inside ${selectedContainer.name}.`
                      : 'Use the tree on the left to navigate to a box to manage samples.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
