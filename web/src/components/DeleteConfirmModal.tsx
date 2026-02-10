import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface DeleteConfirmModalProps {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmWord?: string;
}

export function DeleteConfirmModal({
  onClose,
  onConfirm,
  title,
  message,
  confirmWord = 'DELETE'
}: DeleteConfirmModalProps) {
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
      <div className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200 leading-relaxed">
              {message}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-white/40 uppercase tracking-widest">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">{confirmWord}</span> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 transition-all font-medium"
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-6 py-2 bg-red-500 text-black text-sm font-semibold rounded-lg transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)] disabled:opacity-50 disabled:shadow-none"
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div >
  );
}
