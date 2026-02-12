import { useState, useEffect } from 'react';
import { ArrowLeft, FileText, Download, BarChart2, Database, Table } from 'lucide-react';
import { useNavigation } from '../App';
import { useApi } from '../lib/ApiContext';
import { invoke } from '@tauri-apps/api/core';
import { ExperimentMetadataView } from './ExperimentMetadataView';
import { PCAViewer } from './PCAViewer';
import { TableView } from './TableView';

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
  url?: string; // Derived URL for fetching
  absolutePath?: string; // Absolute disk path (Solo mode)
}

export function BulkDashboard({ experimentId }: BulkDashboardProps) {
  const { navigateTo } = useNavigation();
  const [activeTab, setActiveTab] = useState<'overview' | 'pca' | 'heatmap' | 'de' | 'metadata'>('overview');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { apiUrl: apiBase } = useApi();

  // DE Data state
  const [deData, setDeData] = useState<any[]>([]);
  const [isDeLoading, setIsDeLoading] = useState(false);
  const [selectedDeAsset, setSelectedDeAsset] = useState<Asset | null>(null);

  useEffect(() => {
    loadAssets();
  }, [experimentId]);

  const loadAssets = async () => {
    setIsLoading(true);
    console.log("[ui] loadAssets: starting for experiment", experimentId);
    try {
      // This now returns a flattened list of files from directory assets (PIPE-23)
      const data = await invoke<Asset[]>('get_experiment_assets', { experimentId });
      console.log("[ui] loadAssets: received", data?.length, "assets", data);
      setAssets(data || []);
    } catch (err) {
      console.error('[ui] Failed to load assets:', err);
      setError('Failed to load analysis results. Make sure the pipeline output was uploaded correctly.');
    } finally {
      setIsLoading(false);
    }
  };

  const getAssetsByType = (type: string) => {
    const filtered = assets.filter(a => a?.assetType === type);
    console.log(`[ui] getAssetsByType(${type}): found`, filtered.length);
    return filtered;
  };

  const getAssetsByName = (pattern: string) => {
    const filtered = assets.filter(a => a?.name && a.name.toLowerCase().includes(pattern.toLowerCase()));
    // console.log(`[ui] getAssetsByName(${pattern}): found`, filtered.length, filtered);
    return filtered;
  };

  const getValidDeAssets = () => {
    const validExtensions = ['.csv', '.tsv', '.txt'];
    return getAssetsByName('deseq').concat(getAssetsByName('diff'))
      .filter(a => {
        const name = a.name.toLowerCase();
        return validExtensions.some(ext => name.endsWith(ext)) &&
          !name.includes('.pdf') &&
          !name.includes('pca') &&
          !name.includes('qc') &&
          !name.includes('clustering') &&
          !name.includes('sample_dist');
      });
  };

  // Fetch DE data when tab changes or assets load
  useEffect(() => {
    if (activeTab === 'de' && assets.length > 0) {
      const deAssets = getValidDeAssets();

      if (deAssets.length > 0) {
        // If we haven't selected one yet, or the current selection is invalid/empty, pick the first valid one
        if (!selectedDeAsset || deData.length === 0) {
          const assetToLoad = deAssets[0];
          if (assetToLoad.id !== selectedDeAsset?.id) {
            setSelectedDeAsset(assetToLoad);
            fetchDeData(assetToLoad);
          }
        }
      } else {
        // No direct DE results found, clear the selection if it was a QC/PCA file
        if (selectedDeAsset && (selectedDeAsset.name.toLowerCase().includes('pca') || selectedDeAsset.name.toLowerCase().includes('qc'))) {
          setDeData([]);
          setSelectedDeAsset(null);
        }
      }
    }
  }, [activeTab, assets]);

  const fetchDeData = async (asset: Asset) => {
    if (!asset) return;
    setIsDeLoading(true);
    try {
      // Construct URL if not present (fallback to localhost for dev)
      const fetchUrl = asset.url || `${apiBase}/api/files/${asset.id}/download`;
      console.log("[ui] fetchDeData: fetching from", fetchUrl);

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`Failed to fetch DE data: ${response.statusText}`);

      const text = await response.text();

      // Simple CSV/TSV parser
      const lines = text.trim().split('\n');
      if (lines.length === 0) {
        setDeData([]);
        return;
      }

      // Detect delimiter
      const firstLine = lines[0];
      const delimiter = firstLine.includes('\t') ? '\t' : ',';

      const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));

      const parsed = lines.slice(1).map(line => {
        const values = line.split(delimiter).map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        const row: any = {};
        headers.forEach((header, index) => {
          // Try to convert to number if possible
          const val = values[index];
          if (val && !isNaN(Number(val))) {
            row[header] = Number(val);
          } else {
            row[header] = val;
          }
        });
        return row;
      });

      console.log(`[ui] fetchDeData: parsed ${parsed.length} rows`);
      setDeData(parsed);
      setSelectedDeAsset(asset);
    } catch (err) {
      console.error("[ui] Failed to load DE data:", err);
    } finally {
      setIsDeLoading(false);
    }
  };

  const openAsset = async (asset: Asset) => {
    if (!asset || !asset.id) return;
    console.log("[ui] openAsset BEGIN: asset=", asset);

    // Prefer opening via absolute path if available (Solo mode)
    if (asset.absolutePath) {
      try {
        console.log("[ui] openAsset: invoking 'open_file_locally' with absolutePath:", asset.absolutePath);
        const resolvedPath = await invoke<string>('open_file_locally', { path: asset.absolutePath });
        console.log("[ui] openAsset SUCCESS: backend resolved and opened:", resolvedPath);
        return; // Success, we're done
      } catch (err) {
        console.error('[ui] openAsset: open_file_locally failed with absolutePath:', err);
        // Fall back to URL based opening
      }
    }

    // Fallback or Remote: Use URL based opening
    // If it's a report/HTML, open in browser tab
    if (asset.assetType === 'REPORT' || (asset.name && asset.name.endsWith('.html'))) {
      // Use the provided URL if it exists (it already has /api), otherwise construct it
      const viewUrl = asset.url || `${apiBase}/api/files/${asset.id}/view`;
      console.log("[ui] openAsset: opening report in browser tab:", viewUrl);
      window.open(viewUrl, '_blank');
    } else {
      // For data files, try to open via path (relative to storage) as second fallback
      try {
        console.log("[ui] openAsset: invoking 'open_file_locally' with asset.path:", asset.path);
        const resolvedPath = await invoke<string>('open_file_locally', { path: asset.path });
        console.log("[ui] openAsset SUCCESS: backend resolved and opened:", resolvedPath);
      } catch (err) {
        console.error('[ui] openAsset FAILURE in open_file_locally:', err);
        console.log("[ui] openAsset: falling back to browser download...");
        const downloadUrl = `${apiBase}/api/files/${asset.id}/download`;
        window.open(downloadUrl, '_blank');
      }
    }
    console.log("[ui] openAsset END");
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

            {/* Content Area - Scrolling handled per tab */}
            <div className="flex-1 min-h-0">
              {activeTab === 'overview' && (
                <div className="space-y-8 h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-2">
                  {/* Reports Section */}
                  {getAssetsByType('REPORT').length > 0 && (
                    <div className='mx-4 py-4'>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Reports
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {getAssetsByType('REPORT').map(asset => (
                          <AssetCard key={asset.id} asset={asset} onClick={() => openAsset(asset)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Plots Section */}
                  {getAssetsByType('IMAGE').length > 0 && (
                    <div className='mx-4'>
                      <h3 className="text-lg text-white font-medium mb-4 pb-2 border-b border-white/5">
                        Plots & Figures
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
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
                    <div className='mx-4'>
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
                    <div className='mx-4'>
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
                    <p className="text-white/40 py-8 text-center mx-4">
                      No analysis files found.
                    </p>
                  )}
                </div>
              )}

              {activeTab === 'pca' && (
                <div className="h-full">
                  {getAssetsByName('pca').length > 0 ? (
                    <PCAViewer
                      pcaAsset={
                        getAssetsByName('pca').find(a =>
                          a.name.toLowerCase().endsWith('.txt') ||
                          a.name.toLowerCase().endsWith('.tsv') ||
                          a.name.toLowerCase().endsWith('.csv')
                        ) || getAssetsByName('pca')[0]
                      }
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center bg-black/20 rounded-2xl border border-white/5 p-12 text-center">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                        <BarChart2 className="text-white/20" size={32} />
                      </div>
                      <p className="text-white font-medium mb-1">No PCA results found</p>
                      <p className="text-white/40 text-sm max-w-xs">
                        This experiment doesn't seem to have PCA output. Ensure the pipeline has completed successfully.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'heatmap' && (
                <div className="h-full flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  <div className="flex-1 overflow-y-auto space-y-2 py-4">
                    {getAssetsByName('heatmap').concat(getAssetsByName('counts')).concat(getAssetsByName('tpm')).length > 0 ? (
                      getAssetsByName('heatmap').concat(getAssetsByName('counts')).concat(getAssetsByName('tpm')).map(a => (
                        <div className="mx-4">
                          <AssetCard key={a.id} asset={a} onClick={() => openAsset(a)} />
                        </div>
                      ))
                    ) : (
                      <p className="text-white/40 py-8 text-center">No heatmap or expression data found.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'de' && (
                <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {getValidDeAssets().length > 0 ? (
                    <div className="flex flex-col gap-6 py-4">
                      {/* We'll just show the first one for now as a table, others below it as cards */}
                      <div className="relative">
                        {isDeLoading && (
                          <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
                          </div>
                        )}
                        {selectedDeAsset ? (
                          <TableView
                            title={`Differential Expression Results${selectedDeAsset ? `: ${selectedDeAsset.name}` : ''}`}
                            data={deData}
                            onDownload={() => selectedDeAsset && openAsset(selectedDeAsset)}
                          />
                        ) : (
                          <div className="p-12 flex items-center justify-center bg-black/20 rounded-2xl border border-white/5">
                            <p className="text-white/40 font-medium">Loading analysis results...</p>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-xs text-white/20 uppercase tracking-widest font-bold px-1 mx-4">Alternative Result Sets</h4>
                        {getAssetsByName('deseq').concat(getAssetsByName('diff'))
                          .filter(a => a.id !== selectedDeAsset?.id && !a.name.toLowerCase().endsWith('.pdf'))
                          .map(a => (
                            <div className='mx-4'>
                              <AssetCard
                                key={a.id}
                                asset={a}
                                onClick={() => {
                                  // If it's a data file, load it into table. Otherwise open it.
                                  const isTableData = ['.csv', '.tsv', '.txt'].some(ext => a.name.toLowerCase().endsWith(ext));
                                  if (isTableData && !a.name.toLowerCase().includes('pca') && !a.name.toLowerCase().includes('qc')) {
                                    fetchDeData(a);
                                  } else {
                                    openAsset(a);
                                  }
                                }}
                                compact
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center bg-black/20 rounded-2xl border border-white/5 p-12 text-center">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                        <Table className="text-white/20" size={32} />
                      </div>
                      <p className="text-white font-medium mb-1">No DE results found</p>
                      <p className="text-white/40 text-sm max-w-xs mb-6">
                        Differential expression analysis results (DESeq2/EdgeR) were not detected in current assets.
                      </p>
                      {assets.find(a => a.name.toLowerCase().includes('gene_tpm')) && (
                        <button
                          onClick={() => {
                            const tpmAsset = assets.find(a => a.name.toLowerCase().includes('gene_tpm'));
                            if (tpmAsset) {
                              setSelectedDeAsset(tpmAsset);
                              fetchDeData(tpmAsset);
                            }
                          }}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-colors text-sm font-medium"
                        >
                          View Gene Expression (TPM) instead
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="h-full flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-2">
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
function AssetCard({ asset, onClick, compact }: { asset: Asset, onClick: () => Promise<void> | void, compact?: boolean }) {
  const [isOpening, setIsOpening] = useState(false);

  const handleClick = async () => {
    setIsOpening(true);
    try {
      await onClick();
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div onClick={handleClick} className={`bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 hover:border-white/10 transition-all group ${compact ? 'p-3 flex items-center justify-between' : 'p-4'}`}>
      <div className="flex items-center gap-3 overflow-hidden">
        <div className={`shrink-0 flex items-center justify-center rounded-lg ${compact ? 'w-8 h-8 bg-white/5' : 'w-10 h-10 bg-white/5'}`}>
          {isOpening ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white" /> : (
            asset.assetType === 'REPORT' ? <FileText className="text-blue-400" size={compact ? 16 : 20} /> :
              asset.assetType === 'IMAGE' ? <BarChart2 className="text-purple-400" size={compact ? 16 : 20} /> :
                <Download className="text-green-400" size={compact ? 16 : 20} />
          )}
        </div>
        <div className="min-w-0">
          <h3 className={`text-white font-medium truncate ${compact ? 'text-sm' : 'text-base'}`} title={asset.name}>
            {asset.name || 'Unnamed Asset'}
          </h3>
          {!compact && (
            <p className="text-xs text-white/40 mt-0.5">{isOpening ? 'Opening file...' : asset.assetType}</p>
          )}
        </div>
      </div>
      {compact && (
        <span className="text-xs text-white/20 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-wider font-medium ml-4">
          {isOpening ? 'Opening...' : 'View'}
        </span>
      )}
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
