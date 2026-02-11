import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { X, Loader2, Folder, ChevronDown, UploadCloud, FileArchive } from 'lucide-react';

interface Experiment {
  id: string;
  name: string;
}

interface VisualizationModalProps {
  onClose: () => void;
}

type Mode = 'upload_folder' | 'upload_zip';

export function VisualizationModal({ onClose }: VisualizationModalProps) {
  const [mode, setMode] = useState<Mode>('upload_folder');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [manualPath, setManualPath] = useState(''); // Used for folder path or zip file path
  const [manualExperimentId, setManualExperimentId] = useState<string>('');

  useEffect(() => {
    loadExperiments();

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRegistering) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, isRegistering]);

  const loadExperiments = async () => {
    try {
      const data = await invoke<Experiment[]>('list_experiments');
      setExperiments(data);
    } catch (error) {
      console.error('Failed to load experiments:', error);
    }
  };

  const handleSelectPath = async () => {
    try {
      if (mode === 'upload_folder') {
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Select Data Folder'
        });
        if (selected) setManualPath(selected as string);
      } else {
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
          title: 'Select Analysis Zip'
        });
        if (selected) setManualPath(selected as string);
      }
      setError(null);
    } catch (err) {
      console.error('Failed to open selector:', err);
    }
  };

  const handleSubmit = async () => {
    if (!manualPath) return;

    setIsRegistering(true);
    setError(null);

    try {
      if (mode === 'upload_folder') {
        await invoke('upload_visualization_folder', {
          path: manualPath,
          experimentId: manualExperimentId || null
        });
      } else {
        await invoke('upload_visualization_zip', {
          path: manualPath,
          experimentId: manualExperimentId || null
        });
      }

      onClose();
      window.dispatchEvent(new CustomEvent('refresh-insights'));
    } catch (err) {
      console.error('Failed to upload:', err);
      setError(String(err));
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
            <h2 className="text-xl font-bold text-white tracking-tight">Add Analysis</h2>
            <p className="text-xs text-white/40">Upload a local folder or zip archive to the server</p>
          </div>
          {!isRegistering && (
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-all">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setMode('upload_folder')}
            className={`flex-1 py-3 text-sm font-semibold transition-all ${mode === 'upload_folder'
              ? 'bg-white/[0.03] text-brand-primary border-b-2 border-brand-primary'
              : 'text-white/40 hover:text-white hover:bg-white/[0.02]'
              }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Folder size={16} />
              Upload Folder
            </div>
          </button>
          <button
            onClick={() => setMode('upload_zip')}
            className={`flex-1 py-3 text-sm font-semibold transition-all ${mode === 'upload_zip'
              ? 'bg-white/[0.03] text-brand-primary border-b-2 border-brand-primary'
              : 'text-white/40 hover:text-white hover:bg-white/[0.02]'
              }`}
          >
            <div className="flex items-center justify-center gap-2">
              <UploadCloud size={16} />
              Upload .zip
            </div>
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-4">
            {/* Note: In both upload modes, Backend infers name and type from files/folder name */}

            {/* Experiment Selection (Both Modes) */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">Associate Experiment (Optional)</label>
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

            {/* Path Selection */}
            <div className="space-y-2 pt-2">
              <label className="block text-sm font-semibold text-white/70">
                {mode === 'upload_folder' ? 'Local Data Folder' : 'Analysis Zip File'}
              </label>

              <div
                onClick={handleSelectPath}
                className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer group ${manualPath
                  ? 'border-brand-primary/50 bg-brand-primary/5'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
                  } ${isRegistering ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {manualPath ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                      {mode === 'upload_folder' ? <Folder size={24} /> : <FileArchive size={24} />}
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white break-all max-w-[300px]">
                        {manualPath.split(/[/\\]/).pop()}
                      </p>
                      <p className="text-xs text-white/40 mt-1">Ready to upload</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/40 group-hover:text-white group-hover:scale-110 transition-all">
                      {mode === 'upload_folder' ? <Folder size={24} /> : <UploadCloud size={24} />}
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white/70">
                        Click to select {mode === 'upload_folder' ? 'folder' : 'ZIP file'}
                      </p>
                      <p className="text-xs text-white/30 mt-1">
                        {mode === 'upload_folder' ? 'Will be compressed and uploaded' : 'Supports .zip archives'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            disabled={isRegistering}
            className="px-5 py-2.5 text-sm font-semibold text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-xl disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={!manualPath || isRegistering}
            className="px-6 py-2.5 bg-brand-primary text-black text-sm font-semibold rounded-xl hover:bg-brand-secondary transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-brand-primary/20"
          >
            {isRegistering ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Uploading...
              </>
            ) : (
              <>
                <UploadCloud size={18} />
                Upload Analysis
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
