import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface DeleteConfirmDialogProps {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmWord?: string;
}

export function DeleteConfirmDialog({ 
  onClose, 
  onConfirm, 
  title, 
  message,
  confirmWord = 'DELETE'
}: DeleteConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText === confirmWord;

  const handleConfirm = () => {
    if (isValid) {
      onConfirm();
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-neutral-900 border border-red-500/20 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200">
              {message}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">{confirmWord}</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
              autoFocus
            />
          </div>
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
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete All Data
          </button>
        </div>
      </div>
    </div>
  );
}
