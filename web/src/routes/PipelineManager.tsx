// Pipeline Management - List and manage multiple pipeline runs

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PipelineSetupWizard } from '../components/PipelineSetupWizard';
import { NewPipelineRunDialog } from '../components/NewPipelineRunDialog';
// import { useNavigation } from '../App';
import { Plus, X, Terminal, Trash2, HeartPulse } from 'lucide-react';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { ReportViewer } from '../components/ReportViewer';

interface PipelineRun {
  id: string;
  experimentId: string;
  experimentName: string;
  pipelineType: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export function PipelineManager() {
  // const { navigateTo } = useNavigation();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  // null = still checking, true = needs setup, false = ready
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [showNewRunDialog, setShowNewRunDialog] = useState(false);
  const [selectedRunForLogs, setSelectedRunForLogs] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [showReportForExperimentId, setShowReportForExperimentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        console.log('[PipelineManager] checking pipeline environment...');
        const initialized = await invoke<boolean>('check_pipeline_environment');
        console.log('[PipelineManager] check result:', initialized);
        if (!cancelled) {
          setNeedsSetup(!initialized);
          if (initialized) setIsLoading(false);
        }
      } catch (e) {
        console.error('[PipelineManager] check failed:', e);
        if (!cancelled) setNeedsSetup(true);
      }
    };

    check();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (needsSetup !== false) return;

    loadPipelineRuns();
    const interval = setInterval(loadPipelineRuns, 5000);
    return () => clearInterval(interval);
  }, [needsSetup]);

  const handleSetupComplete = () => {
    setNeedsSetup(false);
    setIsLoading(false);
    loadPipelineRuns();
  };

  const loadPipelineRuns = async () => {
    try {
      const data = await invoke<PipelineRun[]>('list_pipeline_runs');
      setRuns(data);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load pipeline runs:', error);
      setIsLoading(false);
    }
  };

  const cancelRun = async (runId: string) => {
    try {
      await invoke('cancel_pipeline', { runId });
      await loadPipelineRuns();
    } catch (error) {
      console.error('Failed to cancel pipeline:', error);
    }
  };

  const viewLogs = (runId: string) => {
    setSelectedRunForLogs(runId);
  };

  const viewResults = (experimentId: string) => {
    setShowReportForExperimentId(experimentId);
  };

  const handleDeleteRun = async (id: string) => {
    try {
      await invoke('delete_pipeline_run', { runId: id });
      setRuns(runs.filter(r => r.id !== id));
      setDeletingRunId(null);
    } catch (err) {
      console.error('Failed to delete run:', err);
      alert('Failed to delete pipeline run: ' + err);
    }
  };

  const filteredRuns = runs.filter(run => {
    if (filter === 'all') return true;
    return run.status === filter.toUpperCase();
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING': return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'COMPLETED': return 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20';
      case 'FAILED': return 'bg-red-500/10 text-red-400 border border-red-500/20';
      case 'CANCELLED': return 'bg-white/5 text-white/60 border border-white/10';
      default: return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
    }
  };

  // Still checking if setup is needed
  if (needsSetup === null) {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
          <p className="text-white/60">Checking pipeline environment...</p>
        </div>
      </div>
    );
  }

  // Show setup wizard if needed
  if (needsSetup) {
    return <PipelineSetupWizard onComplete={handleSetupComplete} />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
          <p className="text-white/60">Loading pipeline runs...</p>
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
            <p className="text-sm text-white/60 my-auto">Manage and monitor bioinformatics pipelines</p>
          </div>
          <button
            onClick={() => setShowNewRunDialog(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            <Plus size={16} />
            New Pipeline Run
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {['all', 'running', 'completed', 'failed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === status
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-white/60 hover:bg-white/5 border border-transparent'
                }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {status === 'all' && ` (${runs.length})`}
              {status !== 'all' && ` (${runs.filter(r => r.status === status.toUpperCase()).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline Runs List */}
      <div className="flex-1 overflow-auto p-6">
        {filteredRuns.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-white/20 mb-4">
              <svg className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-1">No pipeline runs yet</h3>
            <p className="text-white/50 mb-4">
              {filter === 'all'
                ? 'Start your first bioinformatics pipeline from an experiment'
                : `No ${filter} pipeline runs`
              }
            </p>
            {/* <button
              onClick={() => setShowNewRunDialog(true)}
              className="px-4 py-2 bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-all"
            >
              Start New Pipeline
            </button> */}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRuns.map((run) => (
              <div
                key={run.id}
                className="bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-white">
                        {run.experimentName}
                      </h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(run.status)}`}>
                        {run.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-white/50">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {run.pipelineType}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {run.startedAt && !isNaN(new Date(run.startedAt).getTime())
                          ? new Date(run.startedAt).toLocaleString()
                          : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {run.status === 'RUNNING' && (
                      <button
                        onClick={() => cancelRun(run.id)}
                        className="px-3 py-1.5 text-sm border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 transition-all font-medium"
                      >
                        Cancel
                      </button>
                    )}

                    {run.status === 'COMPLETED' && (
                      <button
                        onClick={() => viewResults(run.experimentId)}
                        className="px-3 py-1.5 text-sm bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-lg hover:bg-brand-primary/20 transition-all font-semibold flex items-center gap-2"
                      >
                        <HeartPulse size={16} />
                        View Health
                      </button>
                    )}

                    <div className="flex items-center gap-1 border-l border-white/5 pl-2 ml-1">
                      <button
                        onClick={() => viewLogs(run.id)}
                        className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                        title="View Logs"
                      >
                        <Terminal size={18} />
                      </button>
                      <button
                        onClick={() => setDeletingRunId(run.id)}
                        className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        title="Delete Run"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                {run.status === 'RUNNING' && run.progress !== undefined && (
                  <div className="mt-4">
                    <div className="flex justify-between text-sm text-white/60 mb-1">
                      <span>Progress</span>
                      <span>{Math.round(run.progress * 100)}%</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div
                        className="bg-brand-primary h-2 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(23,185,120,0.3)]"
                        style={{ width: `${run.progress * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {run.status === 'FAILED' && run.error && (
                  <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    <strong>Error:</strong> {run.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Pipeline Run Dialog */}
      {showNewRunDialog && (
        <NewPipelineRunDialog
          onClose={() => setShowNewRunDialog(false)}
          onSuccess={() => {
            setShowNewRunDialog(false);
            loadPipelineRuns();
          }}
        />
      )}

      {/* Pipeline Logs Modal */}
      {selectedRunForLogs && (
        <PipelineLogsModal
          runId={selectedRunForLogs}
          onClose={() => setSelectedRunForLogs(null)}
        />
      )}

      {deletingRunId && (
        <DeleteConfirmDialog
          title="Delete Pipeline Run"
          message="Are you sure you want to delete this pipeline run? This will permanently remove the record and all output data from disk."
          onConfirm={() => handleDeleteRun(deletingRunId)}
          onClose={() => setDeletingRunId(null)}
        />
      )}

      {showReportForExperimentId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 w-full max-w-6xl h-full max-h-[90vh] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col relative scale-[1.02] animate-in zoom-in-95 duration-200">
            <ReportViewer
              experimentId={showReportForExperimentId}
              onClose={() => setShowReportForExperimentId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Pipeline Logs Modal Component
function PipelineLogsModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<string>('Loading logs...');
  const [isLive] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchLogs = async () => {
      try {
        const logText = await invoke<string>('get_pipeline_logs', { runId });
        setLogs(logText || 'No logs available yet...');
      } catch (err) {
        console.error('Failed to fetch logs:', err);
        setLogs(`Error fetching logs: ${err}`);
      }
    };

    fetchLogs();
    if (isLive) {
      interval = setInterval(fetchLogs, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [runId, isLive]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-white/10 rounded-xl shadow-2xl w-[90vw] h-[80vh] max-w-5xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <Terminal size={20} className="text-brand-primary" />
            <h3 className="text-lg font-bold text-white">Pipeline Logs</h3>
            <span className="text-xs text-white/40 font-mono">{runId.slice(0, 8)}...</span>
          </div>
          <div className="flex items-center gap-3">
            {/* <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={isLive}
                onChange={(e) => setIsLive(e.target.checked)}
                className="rounded border-white/20"
              />
              Live Updates
            </label> */}
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Logs Content */}
        <div className="flex-1 overflow-auto p-4 bg-black/50">
          <pre className="font-mono text-xs text-white/80 whitespace-pre-wrap">
            {logs}
            <div ref={logsEndRef} />
          </pre>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-white/10 text-white/80 rounded-lg hover:bg-white/5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
