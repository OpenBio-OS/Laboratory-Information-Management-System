// Insight Viewer - Single-cell data visualization and analysis
// Combines WebGL rendering with WASM computation

import { useState, useEffect } from 'react';
import { useWasmWorker } from '../hooks/useWasmWorker';
import { ScatterPlot } from '../components/ScatterPlot';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigation } from '../App';
import { dataCache } from '../utils/DataCache';

interface SingleCellCanvasProps {
  experimentId: string;
}

export function SingleCellCanvas({ experimentId }: SingleCellCanvasProps) {
  const { navigateTo } = useNavigation();
  const {
    isInitialized,
    isLoading,
    error,
    createSharedBuffer,
    loadData,
    setCoordinates,
    applyGate,
    analyzeSelection,
    coordsBuffer,
    selectionBuffer,
  } = useWasmWorker();

  const [pointsCount, setPointsCount] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');

  // Step A: Initialize SharedArrayBuffer
  useEffect(() => {
    if (isInitialized && experimentId) {
      loadExperimentData();
    }
  }, [isInitialized, experimentId]);

  const loadExperimentData = async () => {
    try {
      setLoadingStatus('Fetching file paths...');

      const response = await invoke<{ matrixPath: string | null; coordsPath: string | null }>(
        'get_experiment_files',
        { experimentId }
      );

      const { matrixPath, coordsPath } = response;

      if (!matrixPath) {
        throw new Error("No matrix file found (matrix.mtx). Please ensure pipeline completed successfully.");
      }

      // Create SharedArrayBuffer for data
      const bufferSize = 100 * 1024 * 1024; // 100MB initial size
      createSharedBuffer(bufferSize);

      setLoadingStatus('Loading matrix data...');

      // Use matrixPath as assetId for caching
      await streamMatrixData(matrixPath, matrixPath);

      if (coordsPath) {
        setLoadingStatus('Loading coordinates...');
        await loadCoordinatesData(coordsPath);
      }

      setLoadingStatus('Ready');
    } catch (err) {
      console.error('Failed to load experiment data:', err);
      setLoadingStatus(`Error: ${err}`);
    }
  };

  const streamMatrixData = async (url: string, assetId: string) => {
    // Check cache first
    const cachedBlob = await dataCache.get(assetId);
    if (cachedBlob) {
      setLoadingStatus('Loading from local cache...');
      const buffer = await cachedBlob.arrayBuffer();
      const chunk = new Uint8Array(buffer);
      loadData(chunk, 0, true);
      return;
    }

    // Use Tauri command to fetch and stream file
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    let offset = 0;
    let complete = false;
    const collectedChunks: Uint8Array[] = [];

    while (!complete) {
      const result = await invoke<{ chunk: number[]; complete: boolean }>(
        'stream_file_chunk',
        { url, offset, chunkSize: CHUNK_SIZE }
      );

      const chunk = new Uint8Array(result.chunk);
      loadData(chunk, offset, result.complete);
      collectedChunks.push(chunk);

      offset += chunk.length;
      complete = result.complete;

      setLoadingStatus(`Downloading matrix: ${(offset / 1024 / 1024).toFixed(1)} MB`);
    }

    // Save to cache after complete download
    const finalBlob = new Blob(collectedChunks.map(c => new Uint8Array(c)));
    await dataCache.put(assetId, finalBlob);
  };

  const loadCoordinatesData = async (url: string) => {
    // Load coordinates (much smaller file)
    const coords = await invoke<number[]>('load_coordinates', { url });
    const floatCoords = new Float32Array(coords);
    setCoordinates(floatCoords);
    setPointsCount(floatCoords.length / 2);
  };

  const handleLassoComplete = (polygon: Float32Array) => {
    // Zone C Step 1: React sends lasso coordinates to Worker
    applyGate(polygon, (count, _mask) => {
      setSelectedCount(count);
      console.log('Selected cells:', count);
    });
  };

  const handleAnalyze = () => {
    analyzeSelection((result) => {
      setAnalysisResult(result);
    });
  };

  return (
    <div className="h-screen flex flex-col bg-main">
      {/* Header */}
      <div className="bg-surface/30 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center gap-6">
        <button
          onClick={() => navigateTo({ tab: 'insight', itemId: undefined })}
          className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
          title="Back to Gallery"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="text-2xl text-white">
            Single Cell Canvas
          </h1>
          <p className="text-sm text-white/40">
            Experiment: {experimentId}
          </p>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-main p-12 z-20">
            <div className="bg-surface/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 max-w-lg text-center shadow-2xl">
              <div className="w-16 h-16 bg-red-400/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-400/20">
                <ArrowLeft className="text-red-400 rotate-90" size={32} />
              </div>
              <h2 className="text-xl text-white mb-2">Load Error</h2>
              <p className="text-white/60 mb-4">{error}</p>
              <p className="text-xs text-white/30 mb-6 font-medium uppercase tracking-wider">
                Note: SharedArrayBuffer requires specific isolation headers.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-all font-medium"
              >
                Retry Load
              </button>
            </div>
          </div>
        ) : (!isInitialized || isLoading) ? (
          <div className="absolute inset-0 flex items-center justify-center bg-main z-20">
            <div className="text-center">
              <div className="relative mb-6">
                <Loader2 size={64} className="animate-spin text-brand-primary mx-auto" />
                <div className="absolute inset-0 animate-pulse rounded-full h-16 w-16 border border-brand-primary/20 mx-auto" />
              </div>
              <p className="text-white font-semibold tracking-tight text-lg mb-1">
                {loadingStatus || "Initializing WASM engine..."}
              </p>
              <p className="text-white/40 text-sm font-medium">Processing high-dimensional genomics data</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-row">
            {/* Visualization Panel */}
            <div className="flex-1 p-6 overflow-hidden">
              <div className="bg-surface/30 backdrop-blur-sm rounded-2xl border border-white/10 p-4 h-full relative">
                <ScatterPlot
                  width={800}
                  height={600}
                  pointsCount={pointsCount}
                  coordsBuffer={coordsBuffer}
                  selectionBuffer={selectionBuffer}
                  onLassoComplete={handleLassoComplete}
                />
              </div>
            </div>

            {/* Side Panel */}
            <div className="w-96 bg-white/5 backdrop-blur-md border-l border-white/5 p-6 space-y-4 overflow-y-auto">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="font-medium text-white mb-2">Selection</h3>
                <p className="text-3xl font-semibold text-brand-primary">
                  {selectedCount.toLocaleString()}
                </p>
                <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">cells selected</p>
              </div>

              <button
                onClick={handleAnalyze}
                disabled={selectedCount === 0}
                className="w-full px-4 py-2 bg-brand-primary text-black font-semibold rounded-xl hover:bg-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Analyze Selection
              </button>

              {analysisResult && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="font-medium text-white mb-2">Analysis Results</h3>
                  <pre className="text-xs bg-black/40 p-3 rounded-lg overflow-auto text-white/80 border border-white/5">
                    {analysisResult}
                  </pre>
                </div>
              )}

              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="font-medium text-white mb-2">Tools</h3>
                <div className="space-y-2">
                  <button className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg hover:bg-white/5 text-white/70 hover:text-white transition-all">
                    Export Selection
                  </button>
                  <button className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg hover:bg-white/5 text-white/70 hover:text-white transition-all">
                    Save Gate
                  </button>
                  <button className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg hover:bg-white/5 text-white/70 hover:text-white transition-all">
                    Gene Expression Heatmap
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
