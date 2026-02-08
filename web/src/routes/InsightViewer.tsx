// Insight Viewer - Single-cell data visualization and analysis
// Combines WebGL rendering with WASM computation

import { useState, useEffect } from 'react';
import { useWasmWorker } from '../hooks/useWasmWorker';
import { ScatterPlot } from '../components/ScatterPlot';
import { invoke } from '@tauri-apps/api/core';

interface InsightViewerProps {
  experimentId: string;
}

export function InsightViewer({ experimentId }: InsightViewerProps) {
  const {
    isInitialized,
    isLoading,
    error,
    createSharedBuffer,
    loadData,
    setCoordinates,
    applyGate,
    analyzeSelection,
  } = useWasmWorker();

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

      // Get file URLs from API
      // API returns either:
      // - Solo: Local file path that Tauri can read
      // - Hub: HTTP URL to server
      // - Enterprise: Presigned S3 URL
      const response = await invoke<{ matrixUrl: string; coordsUrl: string }>(
        'get_experiment_files',
        { experimentId }
      );

      const { matrixUrl, coordsUrl } = response;

      // Create SharedArrayBuffer for data
      const bufferSize = 100 * 1024 * 1024; // 100MB initial size
      createSharedBuffer(bufferSize);

      setLoadingStatus('Loading matrix data...');

      // Tauri will handle fetching from local file, HTTP, or S3
      // Then stream to Web Worker in chunks
      await streamMatrixData(matrixUrl);

      setLoadingStatus('Loading coordinates...');
      await loadCoordinatesData(coordsUrl);

      setLoadingStatus('Ready');
    } catch (err) {
      console.error('Failed to load experiment data:', err);
      setLoadingStatus(`Error: ${err}`);
    }
  };

  const streamMatrixData = async (url: string) => {
    // Use Tauri command to fetch and stream file
    // Works for local files, HTTP URLs, or S3 URLs
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    let offset = 0;
    let complete = false;

    while (!complete) {
      const result = await invoke<{ chunk: number[]; complete: boolean }>(
        'stream_file_chunk',
        { url, offset, chunkSize: CHUNK_SIZE }
      );

      const chunk = new Uint8Array(result.chunk);
      loadData(chunk, offset, result.complete);

      offset += chunk.length;
      complete = result.complete;

      setLoadingStatus(`Loading matrix: ${(offset / 1024 / 1024).toFixed(1)} MB`);
    }
  };

  const loadCoordinatesData = async (url: string) => {
    // Load coordinates (much smaller file)
    const coords = await invoke<number[]>('load_coordinates', { url });
    setCoordinates(new Float32Array(coords));
  };

  const handleLassoComplete = (polygon: Float32Array) => {
    // Zone C Step 1: React sends lasso coordinates to Worker
    applyGate(polygon, (count, _mask) => {
      setSelectedCount(count);
      console.log('Selected cells:', count);
      
      // TODO: Update visualization with selection mask
    });
  };

  const handleAnalyze = () => {
    analyzeSelection((result) => {
      setAnalysisResult(result);
    });
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500 bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-bold mb-2">Error</h3>
          <p>{error}</p>
          <p className="text-sm mt-2">
            Note: SharedArrayBuffer requires specific HTTP headers. 
            Check Tauri configuration.
          </p>
        </div>
      </div>
    );
  }

  if (!isInitialized || isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">{loadingStatus}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-800">
          Insight Viewer
        </h1>
        <p className="text-sm text-gray-600">
          Experiment: {experimentId}
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Visualization Panel */}
        <div className="flex-1 p-6">
          <div className="bg-white rounded-lg shadow-lg p-4 h-full">
            <ScatterPlot
              width={800}
              height={600}
              onLassoComplete={handleLassoComplete}
            />
          </div>
        </div>

        {/* Side Panel */}
        <div className="w-96 bg-white border-l p-6 space-y-4">
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Selection</h3>
            <p className="text-2xl font-bold text-blue-600">
              {selectedCount.toLocaleString()}
            </p>
            <p className="text-sm text-gray-600">cells selected</p>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={selectedCount === 0}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Analyze Selection
          </button>

          {analysisResult && (
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">Analysis Results</h3>
              <pre className="text-sm bg-gray-50 p-2 rounded overflow-auto">
                {analysisResult}
              </pre>
            </div>
          )}

          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Tools</h3>
            <div className="space-y-2">
              <button className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50">
                Export Selection
              </button>
              <button className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50">
                Save Gate
              </button>
              <button className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50">
                Gene Expression Heatmap
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
