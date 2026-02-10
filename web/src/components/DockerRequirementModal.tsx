import { X, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

interface DockerRequirementModalProps {
  onClose: () => void;
  onRecheck: () => void;
  isChecking?: boolean;
}

export function DockerRequirementModal({ onClose, onRecheck, isChecking }: DockerRequirementModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div
        className="relative w-full max-w-md bg-neutral-900/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-full transition-all"
        >
          <X size={20} />
        </button>

        {/* Header with Docker Logo */}
        <div className="pt-10 pb-6 px-8 flex flex-col items-center text-center">
          <div className="relative mb-6 group">
            <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full group-hover:bg-blue-500/30 transition-all duration-500" />
            <img
              src="/docker-branding/docker-logo-blue.svg"
              alt="Docker Logo"
              className="relative w-32 h-auto drop-shadow-2xl"
            />
          </div>

          <h2 className="text-2xl text-white mb-2">Docker Required</h2>
          <p className="text-white/60 text-sm leading-relaxed">
            To run analysis pipelines, OpenBio requires Docker to be installed and running on your system.
          </p>
        </div>

        {/* Instructions/Content */}
        <div className="px-8 pb-8 space-y-4">
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="text-blue-400 shrink-0 mt-0.5" size={18} />
            <div className="text-xs text-white/70 leading-relaxed">
              Docker allows us to run bioinformatics tools in clean environments – think of it like a laminar flow hood for your software.
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => openUrl('https://www.docker.com/products/docker-desktop/')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl hover:bg-neutral-200 transition-all active:scale-[0.98] font-semibold"
            >
              <ExternalLink size={18} />
              Get Docker Desktop
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onRecheck}
                disabled={isChecking}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl hover:bg-white/10 transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                <RefreshCw size={16} className={isChecking ? 'animate-spin' : ''} />
                {isChecking ? 'Checking...' : 'Recheck'}
              </button>

              <button
                onClick={onClose}
                className="flex items-center justify-center px-4 py-2.5 bg-white/5 border border-white/10 text-white/60 rounded-xl hover:bg-white/10 hover:text-white transition-all active:scale-[0.98]"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="px-8 py-4 bg-white/5 border-t border-white/10 text-center text-[10px] text-white/30 uppercase tracking-widest">
          OpenBio Pipeline Engine • Containerized Analysis
        </div>
      </div>
    </div>
  );
}
