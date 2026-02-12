import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigation } from '../App';
import { InsightGallery } from './InsightGallery';
import { SingleCellCanvas } from './SingleCellCanvas';
import { BulkDashboard } from '../components/BulkDashboard';
import { ReportViewer } from '../components/ReportViewer';
import { ArrowLeft } from 'lucide-react';

interface ExperimentMetadata {
  experiment_id: string;
  name: string;
  pipeline_type: string;
  status: string;
}

export function InsightContainer() {
  const { navigateTo, pendingItemId, pendingView } = useNavigation();
  const [metadata, setMetadata] = useState<ExperimentMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingItemId) {
      loadMetadata(pendingItemId);
    } else {
      setMetadata(null);
    }
  }, [pendingItemId]);

  const loadMetadata = async (experimentId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await invoke<ExperimentMetadata>('get_experiment_metadata', { id: experimentId });
      setMetadata(data);
    } catch (err) {
      console.error('Failed to load experiment metadata:', err);
      setError('Failed to load experiment details.');
    } finally {
      setIsLoading(false);
    }
  };

  // 1. No experiment selected -> Show Gallery
  if (!pendingItemId) {
    return <InsightGallery />;
  }

  // 2. Error State
  if (error) {
    return (
      <div className="h-full flex flex-col bg-main">
        <div className="px-6 py-4 border-b border-white/5 backdrop-blur-md flex items-center gap-6">
          <button
            onClick={() => navigateTo({ tab: 'insight', itemId: undefined })}
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl text-white">Error</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-red-400">
            <p>{error}</p>
            <button
              onClick={() => window.location.reload()} // Simple retry
              className="mt-4 px-4 py-2 bg-white/10 rounded hover:bg-white/20 text-white"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Loading State (Must come after error check)
  if (isLoading || !metadata) {
    return (
      <div className="h-full flex flex-col bg-main">
        <div className="px-6 py-4 border-b border-white/5 bg-surface/30 backdrop-blur-md flex items-center gap-6">
          <button
            onClick={() => navigateTo({ tab: 'insight', itemId: undefined })}
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl text-white">Loading...</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
            <p className="text-white/60">Loading experiment...</p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Force Report View if requested
  if (pendingView === 'report') {
    return <ReportViewer experimentId={pendingItemId} />;
  }

  // 5. Polymorphic Routing based on pipeline_type
  const type_lower = metadata.pipeline_type.toLowerCase().replace(/[\s-]+/g, ''); // normalize: remove spaces AND hyphens

  if (type_lower.includes('scrna')) {
    return <SingleCellCanvas experimentId={pendingItemId} />;
  }

  if (type_lower.includes('rnaseq')) {
    return <BulkDashboard experimentId={pendingItemId} />;
  }

  // Also check for explicit "bulk" for robustness
  if (type_lower.includes('bulk')) {
    return <BulkDashboard experimentId={pendingItemId} />;
  }

  // 5. Default / Fallback -> Report Viewer (MultiQC)
  // Most pipelines (e.g. atacseq, chipseq) produce a MultiQC report at minimum
  return <ReportViewer experimentId={pendingItemId} />;
}
