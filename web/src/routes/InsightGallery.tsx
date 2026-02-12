import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigation } from '../App';
import { Plus, Search, FlaskConical, BarChart2, Trash2, Clock, CheckCircle2, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import { VisualizationModal } from '../components/VisualizationModal';
import { dataCache } from '../utils/DataCache';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

interface InsightItem {
  id: string; // runId or vizId
  experimentId: string;
  experimentName: string;
  createdAt: string;
  dataType: string;
  status: 'READY' | 'PROCESSING' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  cellCount?: number;
  isManual?: boolean;
  type: 'run' | 'viz';
}

const SquircleIcon = ({ children, color = 'brand-primary', size = '10' }: { children: React.ReactNode, color?: string, size?: string }) => (
  <div className="relative flex items-center justify-center shrink-0" style={{ width: size === '10' ? '40px' : '32px', height: size === '10' ? '40px' : '32px' }}>
    <svg viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full fill-${color}/10 stroke-${color}/20`} strokeWidth="4">
      <path d="M 0,50 C 0,5 5,0 50,0 C 95,0 100,5 100,50 C 100,95 95,100 50,100 C 5,100 0,95 0,50" />
    </svg>
    <div className={`relative z-10 text-${color} scale-90`}>
      {children}
    </div>
  </div>
);

export function InsightGallery() {
  const { navigateTo } = useNavigation();
  const [items, setItems] = useState<InsightItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<InsightItem | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadAllResults();

    const handleRefresh = () => loadAllResults();
    window.addEventListener('refresh-insights', handleRefresh);
    return () => window.removeEventListener('refresh-insights', handleRefresh);
  }, []);

  const loadAllResults = async () => {
    try {
      // Fetch both sources with individual error handling
      const pipelineRunsPromise = invoke<any[]>('list_pipeline_runs').catch(err => {
        console.error('Failed to load pipeline runs:', err);
        return [];
      });
      const visualizationsPromise = invoke<any[]>('list_insight_instances').catch(err => {
        console.error('Failed to load insight instances:', err);
        return [];
      });

      const [pipelineRuns, visualizations] = await Promise.all([
        pipelineRunsPromise,
        visualizationsPromise
      ]);

      const merged: InsightItem[] = [];

      // 1. Add Visualizations (The persistent source of truth for "Ready" insights)
      visualizations.forEach(viz => {
        merged.push({
          id: viz.id,
          experimentId: viz.experimentId,
          experimentName: viz.experimentName,
          createdAt: viz.createdAt,
          dataType: viz.dataType || 'Analysis',
          status: 'READY',
          isManual: viz.experimentId === 'standalone',
          type: 'viz'
        });
      });

      // 2. Add Pipeline Runs (only if they are NOT COMPLETED or if they don't have a Viz yet)
      pipelineRuns.forEach(run => {
        // Skip completed runs if we have a viz naming after it (heuristic: same experiment)
        // Actually, we want to see COMPLETED runs too IF they aren't somehow matched?
        // But the requirement says "isolated and detectable".
        // Let's show non-completed runs to show PROGRESS.
        if (run.status === 'COMPLETED') return;

        const pipelineType = run.pipelineType || 'unknown';
        const dataType = pipelineType.includes('scrnaseq') ? 'scRNA-seq' :
          pipelineType.includes('atac') ? 'ATAC-seq' :
            pipelineType.includes('spatial') ? 'Spatial' : 'Analysis';

        merged.push({
          id: run.id,
          experimentId: run.experimentId,
          experimentName: run.experimentName,
          createdAt: run.completedAt || run.startedAt,
          dataType,
          status: (run.status === 'RUNNING' || run.status === 'PENDING' || run.status === 'UPLOADING') ? 'PROCESSING' :
            run.status === 'FAILED' ? 'FAILED' : 'CANCELLED',
          isManual: false,
          type: 'run'
        });
      });

      // Sort by date desc
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setItems(merged);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load results:', error);
      setIsLoading(false);
    }
  };

  const openItem = (item: InsightItem) => {
    if (item.status === 'FAILED' || item.status === 'CANCELLED') return;
    // item.id is vizId if type is 'viz', else item.experimentId if type is 'run'
    navigateTo({ tab: 'insight', itemId: item.type === 'viz' ? item.id : item.experimentId });
  };

  const deleteItem = async (item: InsightItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setItemToDelete(item);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      if (itemToDelete.type === 'viz') {
        await invoke('delete_insight_instance', { id: itemToDelete.id });
        await dataCache.delete(itemToDelete.id);
      } else {
        // Deleting a pipeline run reference from here
        // The user said: "pipelines are isolated and delectable, then the insights are isolated and delectable"
        // This means deleting the run here should call delete_pipeline_run
        await invoke('delete_pipeline_run', { runId: itemToDelete.id });
      }
      await loadAllResults();
    } catch (error) {
      console.error('Failed to delete item:', error);
    } finally {
      setItemToDelete(null);
    }
  };

  const filteredItems = items.filter(item =>
    item.experimentName.toLowerCase().includes(search.toLowerCase()) ||
    item.dataType.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'READY': return <CheckCircle2 size={12} className="text-green-400" />;
      case 'PROCESSING': return <Clock size={12} className="text-brand-primary animate-spin-slow" />;
      case 'FAILED': return <XCircle size={12} className="text-red-400" />;
      case 'CANCELLED': return <AlertCircle size={12} className="text-white/20" />;
      default: return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0a0a]">
        <div className="text-center animate-in fade-in duration-500">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary mx-auto mb-4" />
          <p className="text-white/40 text-xs font-semibold tracking-widest uppercase">Fetching Results</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0d0d0d]">
      {/* Header - Matching PipelinManager/Inventory pattern */}
      <div className="bg-[#121212] border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <p className="text-sm text-white/60 my-auto">Explore analysis outputs and pipeline results</p>
          </div>
          <button
            onClick={() => setShowNewDialog(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            <Plus size={16} strokeWidth={3} />
            Manual Upload
          </button>
        </div>

        {/* Search Bar - Matching Dialog style */}
        <div className="relative group max-w-2xl">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-brand-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by experiment, type, or date..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 transition-all text-sm shadow-inner"
          />
        </div>
      </div>

      {/* Results List - Professional Density */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="text-center py-10 rounded-2xl text-white/30">

              <div className="w-16 h-16 mb-4 flex justify-center rounded-xl bg-white/5 items-center mx-auto">
                <BarChart2 size={40} />

              </div>
              <h3 className="font-medium text-lg">No results found</h3>
              <p className="text-sm">Check back once your pipelines are finished, or upload manually</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => openItem(item)}
                className="group flex items-center gap-4 p-3 rounded-xl bg-white/[0.025] border-white/[0.025] hover:bg-white/[0.04] border hover:border-white/5 transition-all cursor-pointer"
              >
                <SquircleIcon color={item.status === 'FAILED' ? 'red-400' : 'brand-primary'} size="10">
                  <BarChart2 size={16} />
                </SquircleIcon>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[15px] font-semibold text-white/90 group-hover:text-brand-primary transition-colors truncate">
                      {item.experimentName}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 bg-white/5 text-white/40 border border-white/10 rounded-md font-bold uppercase tracking-wider">
                      {item.dataType}
                    </span>
                    {item.isManual && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-md font-bold uppercase tracking-wider">
                        Manual
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-white/30 font-medium">
                    <span className="flex items-center gap-1.5">
                      <FlaskConical size={12} className="opacity-50" />
                      {item.experimentId.slice(0, 8)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} className="opacity-50" />
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <span className={`flex items-center gap-1.5 font-bold ${item.status === 'READY' ? 'text-green-500/70' :
                      item.status === 'FAILED' ? 'text-red-500/70' :
                        item.status === 'PROCESSING' ? 'text-brand-primary/70' : 'text-white/20'}`}>
                      {getStatusIcon(item.status)}
                      {item.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 pr-1">
                  <button
                    onClick={(e) => deleteItem(item, e)}
                    className="p-2 text-white/5 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    title="Archive"
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={16} className="text-white/10 group-hover:text-white/40 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {showNewDialog && (
        <VisualizationModal onClose={() => setShowNewDialog(false)} />
      )}

      {itemToDelete && (
        <DeleteConfirmModal
          onClose={() => setItemToDelete(null)}
          onConfirm={confirmDelete}
          title="Delete Analysis"
          message={`Are you sure you want to delete "${itemToDelete.experimentName}"? This will permanently remove the analysis result. Raw data in the experiment will be preserved.`}
          confirmWord="DELETE"
        />
      )}
    </div>
  );
}
