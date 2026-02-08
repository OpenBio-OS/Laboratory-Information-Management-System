// Insight Gallery - Browse and open multiple single-cell visualizations

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigation } from '../App';
import { Plus } from 'lucide-react';

interface InsightInstance {
  id: string;
  experimentId: string;
  experimentName: string;
  createdAt: string;
  dataType: string;
  cellCount?: number;
  geneCount?: number;
  status: 'READY' | 'PROCESSING' | 'ERROR';
  thumbnailUrl?: string;
}

export function InsightGallery() {
  const { navigateTo } = useNavigation();
  const [instances, setInstances] = useState<InsightInstance[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadInsightInstances();
  }, []);

  const loadInsightInstances = async () => {
    try {
      const data = await invoke<InsightInstance[]>('list_insight_instances');
      setInstances(data);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load insight instances:', error);
      setIsLoading(false);
    }
  };

  const openInsight = (experimentId: string) => {
    navigateTo({ tab: 'insight', itemId: experimentId });
  };

  const deleteInsight = async (id: string) => {
    if (!confirm('Are you sure you want to delete this analysis?')) return;
    
    try {
      await invoke('delete_insight_instance', { id });
      await loadInsightInstances();
    } catch (error) {
      console.error('Failed to delete insight instance:', error);
    }
  };

  const filteredInstances = instances.filter(instance => {
    if (filter === 'all') return true;
    return instance.dataType === filter;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
          <p className="text-white/60">Loading visualizations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-main">
      {/* Header */}
      <div className="bg-surface/30 backdrop-blur-md border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-white/60 my-auto">
              Interactive single-cell data visualizations
            </p>
          </div>
          <button
            onClick={() => navigateTo({ tab: 'experiments' })}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            <Plus size={16} />
            Create New Visualization
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'all'
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-white/60 hover:bg-white/5 border border-transparent'
            }`}
          >
            All ({instances.length})
          </button>
          <button
            onClick={() => setFilter('scRNA-seq')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'scRNA-seq'
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-white/60 hover:bg-white/5 border border-transparent'
            }`}
          >
            scRNA-seq
          </button>
          <button
            onClick={() => setFilter('ATAC-seq')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'ATAC-seq'
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-white/60 hover:bg-white/5 border border-transparent'
            }`}
          >
            ATAC-seq
          </button>
          <button
            onClick={() => setFilter('Spatial')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'Spatial'
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-white/60 hover:bg-white/5 border border-transparent'
            }`}
          >
            Spatial
          </button>
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="flex-1 overflow-auto p-6">
        {filteredInstances.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-white/20 mb-4">
              <svg className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-1">
              No visualizations yet
            </h3>
            <p className="text-white/50 mb-4">
              Create your first single-cell visualization from a completed pipeline run
            </p>
            <button
              onClick={() => navigateTo({ tab: 'pipelines' })}
              className="px-4 py-2 bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-all"
            >
              View Pipeline Runs
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredInstances.map((instance) => (
              <div
                key={instance.id}
                className="bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all cursor-pointer group"
                onClick={() => openInsight(instance.experimentId)}
              >
                {/* Thumbnail */}
                <div className="h-48 bg-gradient-to-br from-brand-primary/10 to-purple-500/10 flex items-center justify-center relative">
                  {instance.thumbnailUrl ? (
                    <img
                      src={instance.thumbnailUrl}
                      alt={instance.experimentName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <svg className="mx-auto h-16 w-16 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  )}
                  {instance.status === 'PROCESSING' && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="p-4">
                  <h3 className="font-semibold text-white mb-1 truncate group-hover:text-brand-primary transition-colors">
                    {instance.experimentName}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
                    <span className="px-2 py-0.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded text-xs font-medium">
                      {instance.dataType}
                    </span>
                    <span className="text-xs">
                      {new Date(instance.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {instance.status === 'READY' && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-white/50 mb-3">
                      {instance.cellCount && (
                        <div>
                          <span className="font-medium text-white/70">Cells:</span> {instance.cellCount.toLocaleString()}
                        </div>
                      )}
                      {instance.geneCount && (
                        <div>
                          <span className="font-medium text-white/70">Genes:</span> {instance.geneCount.toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openInsight(instance.experimentId);
                      }}
                      className="flex-1 px-3 py-1.5 bg-brand-primary text-black font-medium rounded-lg text-sm hover:bg-brand-secondary transition-all"
                    >
                      Open
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteInsight(instance.id);
                      }}
                      className="px-3 py-1.5 border border-white/10 text-white/80 rounded-lg text-sm hover:bg-white/5 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
