import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

export function ConfirmDialog({ 
  onClose, 
  onConfirm, 
  title, 
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning'
}: ConfirmDialogProps) {
  const isDanger = variant === 'danger';
  
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
      <div className={`w-full max-w-md bg-neutral-900 border rounded-2xl shadow-xl overflow-hidden ${
        isDanger ? 'border-red-500/20' : 'border-yellow-500/20'
      }`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b border-white/5 flex items-center justify-between ${
          isDanger ? 'bg-red-500/10' : 'bg-yellow-500/10'
        }`}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className={isDanger ? 'text-red-400' : 'text-yellow-400'} />
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className={`rounded-lg p-4 ${
            isDanger ? 'bg-red-500/10 border border-red-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'
          }`}>
            <p className={`text-sm ${isDanger ? 'text-red-200' : 'text-yellow-200'}`}>
              {message}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-white text-sm font-bold rounded-lg transition-colors ${
              isDanger 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-yellow-500 hover:bg-yellow-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
