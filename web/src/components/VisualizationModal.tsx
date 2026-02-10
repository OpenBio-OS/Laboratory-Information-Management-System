import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { X, Play, Search, FlaskConical, Clock, Loader2, Upload, FileText, BarChart2, Folder, ChevronDown } from 'lucide-react';
import { useNavigation } from '../App';

interface PipelineRun {
  id: string;
  experimentId: string;
  experimentName: string;
  pipelineType: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  completedAt?: string;
}

interface Experiment {
  id: string;
  name: string;
}

interface VisualizationModalProps {
  onClose: () => void;
}

export function VisualizationModal({ onClose }: VisualizationModalProps) {
  const { navigateTo } = useNavigation();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'manual'>('pipeline');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Manual Form State
  const [manualName, setManualName] = useState('');
  const [manualType, setManualType] = useState('scRNA-seq');
  const [manualPath, setManualPath] = useState('');
  const [manualExperimentId, setManualExperimentId] = useState<string>('');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    loadPipelineRuns();
    loadExperiments();

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const loadExperiments = async () => {
    try {
      const data = await invoke<Experiment[]>('list_experiments');
      setExperiments(data);
    } catch (error) {
      console.error('Failed to load experiments:', error);
    }
  };

  const loadPipelineRuns = async () => {
    try {
      const data = await invoke<PipelineRun[]>('list_pipeline_runs');
      // Only show completed runs
      setRuns(data.filter(r => r.status === 'COMPLETED'));
    } catch (error) {
      console.error('Failed to load completed runs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (run: PipelineRun) => {
    navigateTo({ tab: 'insight', itemId: run.experimentId });
    onClose();
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Data Folder'
      });
      if (selected) {
        setManualPath(selected as string);
      }
    } catch (err) {
      console.error('Failed to open folder selector:', err);
    }
  };

  const handleManualRegister = async () => {
    if (!manualName || !manualPath) return;

    setIsRegistering(true);
    try {
      await invoke('register_visualization', {
        name: manualName,
        type: manualType,
        path: manualPath,
        experiment_id: manualExperimentId || undefined
      });
      onClose();
      // Trigger gallery reload
      window.dispatchEvent(new CustomEvent('refresh-insights'));
    } catch (err) {
      console.error('Failed to register visualization:', err);
      alert('Failed: ' + err);
    } finally {
      setIsRegistering(false);
    }
  };

  const filteredRuns = runs.filter(run =>
    run.experimentName.toLowerCase().includes(search.toLowerCase()) ||
    run.pipelineType.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-white/10 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div>
            <h2 className="text-xl text-white">Visualization</h2>
            <p className="text-xs text-white/40">Register or create a data visualization</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 bg-black/20">
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`flex-1 py-3 text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'pipeline'
              ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5 font-medium'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            <Clock size={16} />
            From Pipeline
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-3 text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'manual'
              ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5 font-medium'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            <Upload size={16} />
            Manual Register
          </button>
        </div>

        {activeTab === 'pipeline' ? (
          <>
            {/* Search */}
            <div className="px-6 py-4 border-b border-white/5 bg-black/10">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-brand-primary transition-colors" size={16} />
                <input
                  type="text"
                  placeholder="Filter by experiment or pipeline..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 transition-all text-sm"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[300px]">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <Loader2 className="animate-spin text-brand-primary" size={24} />
                  <p className="text-white/40 text-[10px] uppercase tracking-[0.2em]">Synchronizing Results</p>
                </div>
              ) : filteredRuns.length === 0 ? (
                <div className="text-center py-20">
                  <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/5">
                    <Search className="text-white/10" size={32} />
                  </div>
                  <h3 className="text-white mb-1">No completed runs found</h3>
                  <p className="text-white/30 text-xs max-w-[240px] mx-auto">
                    Complete a pipeline run to see it here, or use Manual Register to upload existing data.
                  </p>
                </div>
              ) : (
                filteredRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => handleSelect(run)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-transparent hover:border-brand-primary/30 hover:bg-brand-primary/10 transition-all text-left group"
                  >
                    <div className="w-12 h-12 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary border border-brand-primary/20">
                      <Play size={20} fill="currentColor" className="ml-0.5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white truncate">{run.experimentName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded uppercase tracking-wider">
                          {run.pipelineType.split('/').pop()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-white/40">
                        <span className="flex items-center gap-1.5">
                          <FlaskConical size={12} />
                          {run.experimentId.slice(0, 12)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock size={12} />
                          {new Date(run.completedAt || run.startedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="p-8 space-y-6 flex-1 overflow-y-auto">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-white/60 mb-1.5">Visualization Name</label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="e.g. My SC Analysis"
                  className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-white/60 mb-1.5">Analysis Type</label>
                  <div className="relative">
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all appearance-none text-sm pr-10"
                    >
                      <option value="scRNA-seq">scRNA-seq</option>
                      <option value="ATAC-seq">ATAC-seq</option>
                      <option value="Spatial">Spatial</option>
                      <option value="Bulk RNA-seq">Bulk RNA-seq</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-white/60 mb-1.5">Associate Experiment</label>
                  <div className="relative">
                    <select
                      value={manualExperimentId}
                      onChange={(e) => setManualExperimentId(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all appearance-none text-sm pr-10"
                    >
                      <option value="">None (Standalone)</option>
                      {experiments.map(exp => (
                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-medium text-white/60 mb-1.5">Local Data Path</label>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white/60 text-sm overflow-hidden truncate">
                    {manualPath || <span className="text-white/20">No folder selected</span>}
                  </div>
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all flex items-center gap-2 group"
                  >
                    <Folder size={18} className="text-brand-primary group-hover:scale-110 transition-transform" />
                    <span className="text-sm">Select</span>
                  </button>
                </div>
                <p className="text-[10px] text-white/30 italic">Must contain valid matrix files or reports</p>
              </div>
            </div>

            {/* <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-xl p-4 flex gap-4 mt-auto">
              <div className="p-2 bg-brand-primary/10 rounded-lg h-fit text-brand-primary">
                <FileText size={20} />
              </div>
              <div>
                <h4 className="text-sm text-white">Direct Registration</h4>
                <p className="text-xs text-white/40 mt-1 leading-relaxed">
                  This will register the selected folder as a permanent visualization entry.
                  Unlike pipeline outputs, this data won't be moved or modified.
                </p>
              </div>
            </div> */}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 bg-white/5 border-t border-white/10 flex justify-between items-center mt-auto">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-lg"
          >
            Cancel
          </button>

          {activeTab === 'manual' && (
            <button
              onClick={handleManualRegister}
              disabled={!manualName || !manualPath || isRegistering}
              className="px-6 py-2 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary transition-all disabled:opacity-50 flex items-center gap-2 shadow-[0_0_20px_rgba(23,185,120,0.2)]"
            >
              {isRegistering ? <Loader2 className="animate-spin" size={16} /> : <BarChart2 size={16} />}
              Register Visualization
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
