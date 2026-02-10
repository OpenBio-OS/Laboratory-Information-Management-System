import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigation } from '../App';

interface BulkDashboardProps {
  experimentId: string;
}

export function BulkDashboard({ experimentId }: BulkDashboardProps) {
  const { navigateTo } = useNavigation();
  const [activeTab, setActiveTab] = useState<'pca' | 'heatmap' | 'de'>('pca');
  const [isLoading] = useState(false);

  // TODO: Add data fetching using get_experiment_files or specialized command

  return (
    <div className="h-full flex flex-col bg-main overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/5 px-8 py-6 flex justify-between items-center bg-surface/30 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigateTo({ tab: 'insight', itemId: undefined })}
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
            title="Back to Gallery"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl text-white tracking-tight">
              Bulk RNA-seq Dashboard
            </h1>
            <p className="text-sm text-white/40 flex items-center gap-2 mt-1 font-medium">
              <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
              Experiment: {experimentId}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('pca')}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'pca'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            PCA Plot
          </button>
          <button
            onClick={() => setActiveTab('heatmap')}
            className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'heatmap'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            Heatmap
          </button>
          <button
            onClick={() => setActiveTab('de')}
            className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'de'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            Differential Expression
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-8 overflow-auto scrollbar-hide">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
              <p className="text-white/40 font-medium">Analysis in progress...</p>
            </div>
          </div>
        ) : (
          <div className="h-full bg-surface/30 backdrop-blur-md rounded-2xl border border-white/10 p-10 flex flex-col items-center justify-center text-center">
            {activeTab === 'pca' && (
              <>
                <div className="w-20 h-20 bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-6 text-brand-primary">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl text-white mb-2 tracking-tight">Principal Component Analysis</h3>
                <p className="text-white/40 max-w-sm font-medium leading-relaxed">
                  Preparing the high-dimensional projection. Requires processing of <code className="text-brand-primary bg-brand-primary/5 px-1.5 py-0.5 rounded border border-brand-primary/20 text-xs">counts.tsv</code>.
                </p>
              </>
            )}

            {activeTab === 'heatmap' && (
              <>
                <div className="w-20 h-20 bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-6 text-brand-primary">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7-9l-5.6 5.6" />
                    <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 4v16M15 4v16" />
                  </svg>
                </div>
                <h3 className="text-xl text-white mb-2 tracking-tight">Expression Heatmap</h3>
                <p className="text-white/40 max-w-sm font-medium leading-relaxed">
                  Generating the gene expression matrix visualization. Analyzing clusters and hierarchical relationships.
                </p>
              </>
            )}

            {activeTab === 'de' && (
              <>
                <div className="w-20 h-20 bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-6 text-brand-primary">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl text-white mb-2 tracking-tight">Differential Expression</h3>
                <p className="text-white/40 max-w-sm font-medium leading-relaxed">
                  Compiling the significant gene regulation table. Calculating fold-changes and adjusted p-values.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
