import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { X, Loader2, BarChart2, Folder, ChevronDown } from 'lucide-react';

interface Experiment {
  id: string;
  name: string;
}

interface VisualizationModalProps {
  onClose: () => void;
}

export function VisualizationModal({ onClose }: VisualizationModalProps) {
  // Manual Form State
  const [manualName, setManualName] = useState('');
  const [manualType, setManualType] = useState('scRNA-seq');
  const [manualPath, setManualPath] = useState('');
  const [manualExperimentId, setManualExperimentId] = useState<string>('');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
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

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Manual Register</h2>
            <p className="text-xs text-white/40">Connect external analysis results to an experiment</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">Visualization Name</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="e.g. My SC Analysis"
                className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all text-sm shadow-inner"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-white/70">Analysis Type</label>
                <div className="relative">
                  <select
                    value={manualType}
                    onChange={(e) => setManualType(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all appearance-none text-sm pr-10 shadow-inner"
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
                <label className="block text-sm font-semibold text-white/70">Associate Experiment</label>
                <div className="relative">
                  <select
                    value={manualExperimentId}
                    onChange={(e) => setManualExperimentId(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all appearance-none text-sm pr-10 shadow-inner"
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

            <div className="space-y-2 pt-2">
              <label className="block text-sm font-semibold text-white/70">Local Data Path</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-white/60 text-sm overflow-hidden truncate shadow-inner">
                  {manualPath || <span className="text-white/20">No folder selected...</span>}
                </div>
                <button
                  onClick={handleSelectFolder}
                  className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all flex items-center gap-3 group"
                >
                  <Folder size={20} className="text-brand-primary group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-semibold">Select</span>
                </button>
              </div>
              <p className="text-[10px] text-white/30 italic px-1">Must contain valid matrix files or reports</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-xl"
          >
            Cancel
          </button>

          <button
            onClick={handleManualRegister}
            disabled={!manualName || !manualPath || isRegistering}
            className="px-6 py-2.5 bg-brand-primary text-black text-sm font-semibold rounded-xl hover:bg-brand-secondary transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-brand-primary/20"
          >
            {isRegistering ? <Loader2 className="animate-spin" size={18} /> : <BarChart2 size={18} />}
            Register Results
          </button>
        </div>
      </div>
    </div>
  );
}
