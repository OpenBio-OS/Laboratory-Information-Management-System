import { useEffect, useState, useCallback, useRef } from 'react';
import { ScatterPlot } from './ScatterPlot';
import { useWasmWorker } from '../hooks/useWasmWorker';
import { Loader2, AlertCircle, Maximize2, ZoomIn, Info } from 'lucide-react';

interface PCAViewerProps {
  pcaAsset: {
    id: string;
    name: string;
    url?: string;
    path: string;
  };
}

export function PCAViewer({ pcaAsset }: PCAViewerProps) {
  const {
    loadPca,
    getPcaData,
    coordsBuffer,
    selectionBuffer,
    applyGate,
    isInitialized,
    isLoading: wasmLoading,
    createSharedBuffer,
    getCells
  } = useWasmWorker();

  // Initialize buffers once
  useEffect(() => {
    if (isInitialized && !coordsBuffer) {
      console.log("[ui] PCAViewer: initializing buffers");
      createSharedBuffer(1024 * 1024);
    }
  }, [isInitialized, coordsBuffer, createSharedBuffer]);

  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const [points, setPoints] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionCount, setSelectionCount] = useState(0);

  useEffect(() => {
    // CRITICAL: Wait for BOTH initialization AND the buffer to exist
    if (!isInitialized || !pcaAsset.url || !coordsBuffer) {
      return;
    }

    const loadData = async () => {
      console.log("[ui] PCAViewer: loading data for asset", pcaAsset.name);
      try {
        setIsLoading(true);
        setError(null);

        // Fetch the file content as array buffer
        const fetchUrl = pcaAsset.url || pcaAsset.path;
        if (!fetchUrl) throw new Error('No path or URL for asset');

        console.log("[ui] PCAViewer: fetching from", fetchUrl);
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Failed to fetch PCA data: ${response.statusText}`);

        const buffer = await response.arrayBuffer();
        console.log("[ui] PCAViewer: received buffer of size", buffer.byteLength);

        // Sniff delimiter
        const text = new TextDecoder().decode(buffer.slice(0, 1000));
        let delimiter = 44; // Default to COMMA
        if (text.includes('\t')) {
          delimiter = 9;
        } else if (pcaAsset.name.endsWith('.tsv') || pcaAsset.name.endsWith('.txt')) {
          delimiter = 9;
        }

        console.log("[ui] PCAViewer: using delimiter", delimiter);

        // Load into WASM
        loadPca(buffer, delimiter);

        // Get parsed points for tooltips/metadata
        getPcaData((data) => {
          console.log("[ui] PCAViewer: parsed", data.length, "points");

          // Manually fill the coordinates buffer
          if (coordsBuffer && data.length > 0) {
            getCells((cells: any[]) => {
              console.log("[ui] PCAViewer: writing", cells.length, "cells to coordsBuffer");
              const coordsView = new Float32Array(coordsBuffer);
              const selectionView = new Float32Array(selectionBuffer!);

              cells.forEach((cell: any, i: number) => {
                coordsView[i * 2] = cell.x;
                coordsView[i * 2 + 1] = cell.y;
                selectionView[i] = 0.0; // Unselected

                // Debug log
                if (i === 0) console.log("[ui] PCAViewer: sample coordinate snippet", cell.x, cell.y);
              });

              // Trigger re-render of ScatterPlot only AFTER buffer is filled
              setPoints(data);
              setIsLoading(false);
            });
          } else {
            setPoints(data);
            setIsLoading(false);
          }
        });

      } catch (err) {
        console.error('[ui] PCA Loading Error:', err);
        setError(String(err));
        setIsLoading(false);
      }
    };

    loadData();
  }, [isInitialized, pcaAsset, loadPca, getPcaData, getCells, coordsBuffer, selectionBuffer]);

  const handleLasso = useCallback((polygon: Float32Array) => {
    applyGate(polygon, (count, mask) => {
      setSelectionCount(count);

      // If we are in an environment WITHOUT SharedArrayBuffer, we MUST manually sync the mask
      if (mask && selectionBuffer) {
        console.log("[ui] PCAViewer: syncing selection mask to local buffer");
        const selectionView = new Float32Array(selectionBuffer);
        mask.forEach((val, i) => {
          selectionView[i] = val ? 1.0 : 0.0;
        });
      }
    });
  }, [applyGate, selectionBuffer]);

  if (isLoading || wasmLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-black/20 rounded-2xl border border-white/5">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin mb-3" />
        <p className="text-white/40 text-sm">Parsing PCA results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-red-500/5 rounded-2xl border border-red-500/10">
        <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
        <p className="text-red-400 text-sm font-medium">Failed to load PCA</p>
        <p className="text-red-400/60 text-xs mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Viewer Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-primary/10 rounded-lg">
            <ZoomIn size={18} className="text-brand-primary" />
          </div>
          <div>
            <h3 className="text-white font-medium">Principal Component Analysis</h3>
            <p className="text-xs text-white/40">{points.length} samples processed</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectionCount > 0 && (
            <div className="px-3 py-1 bg-brand-primary/20 border border-brand-primary/30 rounded-full text-[10px] font-bold text-brand-primary uppercase tracking-wider animate-fade-in">
              {selectionCount} Selected
            </div>
          )}
          <button className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all" title="Full Screen">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-[400px] relative bg-neutral-900/50 rounded-2xl border border-white/5 overflow-hidden group"
      >
        <ScatterPlot
          width={dimensions.width}
          height={dimensions.height}
          pointsCount={points.length}
          coordsBuffer={coordsBuffer}
          selectionBuffer={selectionBuffer}
          points={points}
          onLassoComplete={handleLasso}
        />

        {/* Plot Info Legend */}
        <div className="absolute bottom-6 right-6 p-4 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-[10px] space-y-3 pointer-events-none shadow-2xl z-20">
          <div className="flex items-center gap-3 text-white/80">
            <div className="w-3 h-3 rounded-full bg-[#00ccff] shadow-[0_0_10px_rgba(0,204,255,0.6)]" />
            <span className="font-semibold tracking-wide">Biological Samples</span>
          </div>
          <div className="flex items-center gap-3 text-white/80">
            <div className="w-3 h-3 rounded-full bg-[#ff4d4d] shadow-[0_0_10px_rgba(255,77,77,0.6)]" />
            <span className="font-semibold tracking-wide">Selected Regions</span>
          </div>
          <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-white/40">
            <Info size={12} />
            <span className="font-medium">Click & drag to lasso points</span>
          </div>
        </div>
      </div>
    </div>
  );
}
