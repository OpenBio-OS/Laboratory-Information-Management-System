import { useState, useEffect } from 'react';
import { ArrowLeft, FileText, Download, BarChart2, Database } from 'lucide-react';
import { useNavigation } from '../App';
import { invoke } from '@tauri-apps/api/core';
import { ExperimentMetadataView } from './ExperimentMetadataView';

interface BulkDashboardProps {
  experimentId: string;
}

interface Asset {
  id: string;
  name: string;
  path: string;
  assetType: string;
  createdAt: string;
  sizeBytes?: string;
}

export function BulkDashboard({ experimentId }: BulkDashboardProps) {
  const { navigateTo } = useNavigation();
  const [activeTab, setActiveTab] = useState<'overview' | 'pca' | 'heatmap' | 'de' | 'metadata'>('overview');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssets();
  }, [experimentId]);

  const loadAssets = async () => {
    setIsLoading(true);
    try {
      const data = await invoke<Asset[]>('get_experiment_assets', { experimentId });
      setAssets(data);
    } catch (err) {
      console.error('Failed to load assets:', err);
      setError('Failed to load analysis results.');
    } finally {
      setIsLoading(false);
    }
  };

  const getAssetsByType = (type: string) => assets.filter(a => a?.assetType === type);
  const getAssetsByName = (pattern: string) => assets.filter(a => a?.name && a.name.toLowerCase().includes(pattern.toLowerCase()));

  const openAsset = async (asset: Asset) => {
    if (!asset || !asset.id) return;

    // For reports, we might want to open in browser
    if (asset.assetType === 'REPORT' || (asset.name && asset.name.endsWith('.html'))) {
      const apiBase = "http://localhost:3000"; // TODO: Fetch from config
      const url = `${apiBase}/files/${asset.id}/view`;
      window.open(url, '_blank');
    } else {
      // Download or view raw
      const apiBase = "http://localhost:3000";
      const url = `${apiBase}/files/${asset.id}/download`;
      window.open(url, '_blank');
    }
  };

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
              <span className={`w-2 h-2 rounded-full animate-pulse ${isLoading ? 'bg-yellow-500' : 'bg-green-500'}`} />
              Experiment: {experimentId}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'overview'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('pca')}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'pca'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            PCA
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
            Diff. Expr.
          </button>
          <button
            onClick={() => setActiveTab('metadata')}
            className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'metadata'
              ? 'bg-white/10 text-white shadow-lg border border-white/10'
              : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
          >
            <Database size={14} />
            Metadata
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4" />
              <p className="text-white/40 font-medium">Loading analysis results...</p>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-red-400">
            {error}
          </div>
        ) : (
          <div className="h-full bg-surface/30 flex flex-col overflow-hidden">

            {/* Scrollable Content Inside Card */}
            <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {activeTab === 'overview' && (
                <div className="space-y-8">
                  {/* Reports Section */}
                  {getAssetsByType('REPORT').length > 0 && (
                    <div>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Reports
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {getAssetsByType('REPORT').map(asset => (
                          <AssetCard key={asset.id} asset={asset} onClick={() => openAsset(asset)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Plots Section */}
                  {getAssetsByType('IMAGE').length > 0 && (
                    <div>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Plots & Figures
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {getAssetsByType('IMAGE').map(asset => (
                          <div key={asset.id} onClick={() => openAsset(asset)} className="group relative aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/5 hover:border-brand-primary/50 transition-all cursor-pointer">
                            <div className="absolute inset-0 flex items-center justify-center text-white/20 group-hover:text-brand-primary transition-colors">
                              <BarChart2 size={32} />
                            </div>
                            {/* Ideally we would show a thumbnail here, but we don't have one yet. 
                                            We could use the view URL if it's an image, but auth might be tricky. 
                                            For now, a nice placeholder. */}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                              <p className="text-xs text-white truncate font-medium">{asset.name}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Data Section */}
                  {(getAssetsByType('DATA').length > 0 || getAssetsByType('COUNTS').length > 0) && (
                    <div>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Data Files
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[...getAssetsByType('DATA'), ...getAssetsByType('COUNTS'), ...getAssetsByType('MATRIX')].map(asset => (
                          <AssetCard key={asset.id} asset={asset} onClick={() => openAsset(asset)} compact />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All other assets if not caught above (fallback) */}
                  {assets.filter(a => !['REPORT', 'IMAGE', 'DATA', 'COUNTS', 'MATRIX'].includes(a.assetType)).length > 0 && (
                    <div>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Other Files
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {assets.filter(a => !['REPORT', 'IMAGE', 'DATA', 'COUNTS', 'MATRIX'].includes(a.assetType)).map(asset => (
                          <AssetCard key={asset.id} asset={asset} onClick={() => openAsset(asset)} compact />
                        ))}
                      </div>
                    </div>
                  )}

                  {assets.length === 0 && (
                    <p className="text-white/40 py-8 text-center">
                      No analysis files found.
                    </p>
                  )}
                </div>
              )}

              {activeTab === 'pca' && (
                <div className="h-full flex flex-col">
                  {/* <h3 className="text-lg text-white font-medium mb-4 px-1">PCA Analysis</h3> */}
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {getAssetsByName('pca').length > 0 ? (
                      getAssetsByName('pca').map(a => (
                        <AssetCard key={a.id} asset={a} onClick={() => openAsset(a)} />
                      ))
                    ) : (
                      <p className="text-white/40 py-8 text-center">No PCA files found.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'heatmap' && (
                <div className="h-full flex flex-col">
                  {/* <h3 className="text-lg text-white font-medium mb-4 px-1">Heatmaps & Expression</h3> */}
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {getAssetsByName('heatmap').concat(getAssetsByName('counts')).concat(getAssetsByName('tpm')).length > 0 ? (
                      getAssetsByName('heatmap').concat(getAssetsByName('counts')).concat(getAssetsByName('tpm')).map(a => (
                        <AssetCard key={a.id} asset={a} onClick={() => openAsset(a)} />
                      ))
                    ) : (
                      <p className="text-white/40 py-8 text-center">No heatmap or expression data found.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'de' && (
                <div className="h-full flex flex-col">
                  {/* <h3 className="text-lg text-white font-medium mb-4 px-1">Differential Expression</h3> */}
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {getAssetsByName('deseq').concat(getAssetsByName('diff')).length > 0 ? (
                      getAssetsByName('deseq').concat(getAssetsByName('diff')).map(a => (
                        <AssetCard key={a.id} asset={a} onClick={() => openAsset(a)} />
                      ))
                    ) : (
                      <p className="text-white/40 py-8 text-center">No Differential Expression results found.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="h-full flex flex-col">
                  <ExperimentMetadataView experimentId={experimentId} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-component for consistent file display
function AssetCard({ asset, onClick, compact }: { asset: Asset, onClick: () => void, compact?: boolean }) {
  return (
    <div onClick={onClick} className={`bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 hover:border-white/10 transition-all group ${compact ? 'p-3 flex items-center justify-between' : 'p-4'}`}>
      <div className="flex items-center gap-3 overflow-hidden">
        <div className={`shrink-0 flex items-center justify-center rounded-lg ${compact ? 'w-8 h-8 bg-white/5' : 'w-10 h-10 bg-white/5'}`}>
          {asset.assetType === 'REPORT' ? <FileText className="text-blue-400" size={compact ? 16 : 20} /> :
            asset.assetType === 'IMAGE' ? <BarChart2 className="text-purple-400" size={compact ? 16 : 20} /> :
              <Download className="text-green-400" size={compact ? 16 : 20} />}
        </div>
        <div className="min-w-0">
          <h3 className={`text-white font-medium truncate ${compact ? 'text-sm' : 'text-base'}`} title={asset.name}>
            {asset.name || 'Unnamed Asset'}
          </h3>
          {!compact && (
            <p className="text-xs text-white/40 mt-0.5">{asset.assetType}</p>
          )}
        </div>
      </div>
      {compact && <span className="text-xs text-white/20 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-wider font-medium ml-4">View</span>}
      {!compact && (
        <div className="mt-3 flex justify-between items-center text-xs border-t border-white/5 pt-3">
          <span className="text-white/30">
            {(parseInt(asset.sizeBytes || '0') / 1024).toFixed(1)} KB
          </span>
          <span className="text-brand-primary opacity-0 group-hover:opacity-100 transition-opacity font-medium">Click to view</span>
        </div>
      )}
    </div>
  );
}
