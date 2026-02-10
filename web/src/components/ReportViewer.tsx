import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, ExternalLink, ArrowLeft, HeartPulse } from 'lucide-react';
import { useNavigation } from '../App';

interface ReportViewerProps {
  experimentId: string;
  onClose?: () => void;
}

export function ReportViewer({ experimentId, onClose }: ReportViewerProps) {
  const { navigateTo } = useNavigation();
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReport();

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onClose) {
          onClose();
        } else {
          navigateTo({ tab: 'insight', itemId: undefined });
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [experimentId, onClose, navigateTo]);

  const loadReport = async () => {
    try {
      // TODO: Implement get_experiment_report_url backend command
      // For now, allow the frontend to construct the URL if we know the server content logic
      // OR fetch from API. 
      // Assuming a new command:
      const url = await invoke<string>('get_experiment_report_url', { experimentId });
      setReportUrl(url);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load report:', err);
      // Fallback: indicate no report found
      setError("No report available.");
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full w-full bg-main flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex justify-between items-center z-10 w-full">
        <div className="flex items-center gap-4">
          {!onClose && (
            <button
              onClick={() => navigateTo({ tab: 'insight', itemId: undefined })}
              className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
              title="Back to Gallery"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="flex items-center gap-3">
            <HeartPulse size={20} className="text-brand-primary mr-2" />
            <div>
              <h2 className="text-lg text-white tracking-tight">MultiQC Report</h2>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Pipeline Analytics</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {reportUrl && (
            <a
              href={reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95"
            >
              <ExternalLink size={14} className="text-brand-primary" />
              Open in New Tab
            </a>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 w-full h-full relative border-t border-white/5">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-main z-20">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary" />
              <p className="text-white/40 text-sm font-medium animate-pulse">Loading Report...</p>
            </div>
          </div>
        ) : (error || !reportUrl) ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-main text-white/40 text-center px-6 z-20">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
              <X className="text-white/10" size={32} />
            </div>
            <h3 className="text-white font-medium mb-1">Report Error</h3>
            <p className="max-w-xs">{error || "Report not found"}</p>
          </div>
        ) : (
          <iframe
            src={reportUrl}
            className="w-full h-full border-0 absolute inset-0 grayscale-[0.1] contrast-[1.05]"
            title="Pipeline Report"
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
