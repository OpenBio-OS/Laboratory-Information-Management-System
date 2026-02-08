// React hook for managing WASM Web Worker

import { useEffect, useRef, useState, useCallback } from 'react';

interface WorkerMessage {
  type: string;
  payload?: any;
  error?: string;
  count?: number;
  selectionMask?: number[];
  result?: any;
  data?: any;
}

export function useWasmWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // SharedArrayBuffer for zero-copy data transfer
  const sharedBufferRef = useRef<SharedArrayBuffer | null>(null);

  // Initialize worker on mount
  useEffect(() => {
    // Create worker
    const worker = new Worker(
      new URL('../workers/wasm.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Handle messages from worker
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, error: errMsg } = event.data;

      switch (type) {
        case 'initialized':
          setIsInitialized(true);
          setIsLoading(false);
          break;

        case 'error':
          setError(errMsg || 'Unknown error');
          setIsLoading(false);
          break;

        default:
          // Other messages handled by specific callbacks
          break;
      }
    };

    workerRef.current = worker;

    // Initialize WASM in worker
    setIsLoading(true);
    worker.postMessage({ type: 'init' });

    // Cleanup on unmount
    return () => {
      worker.terminate();
    };
  }, []);

  // Step A: Create SharedArrayBuffer
  const createSharedBuffer = useCallback((sizeBytes: number) => {
    try {
      const buffer = new SharedArrayBuffer(sizeBytes);
      sharedBufferRef.current = buffer;

      // Step A2: Send reference to worker
      workerRef.current?.postMessage({
        type: 'setSharedBuffer',
        payload: { buffer },
      });

      return buffer;
    } catch (error) {
      setError('SharedArrayBuffer not supported. Ensure proper headers are set.');
      return null;
    }
  }, []);

  // Load data into worker
  const loadData = useCallback(
    (chunk: Uint8Array, offset: number = 0, complete: boolean = false) => {
      if (!workerRef.current) {
        setError('Worker not initialized');
        return;
      }

      setIsLoading(true);
      workerRef.current.postMessage({
        type: 'loadData',
        payload: { chunk, offset, complete },
      });
    },
    []
  );

  // Set cell coordinates
  const setCoordinates = useCallback((coords: Float32Array) => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    workerRef.current.postMessage({
      type: 'setCoordinates',
      payload: { coords: Array.from(coords) },
    });
  }, []);

  // Apply lasso gate
  const applyGate = useCallback(
    (polygon: Float32Array, callback: (count: number, mask: number[]) => void) => {
      if (!workerRef.current) {
        setError('Worker not initialized');
        return;
      }

      // Set up one-time listener for response
      const handler = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === 'gateApplied') {
          callback(event.data.count || 0, event.data.selectionMask || []);
          workerRef.current?.removeEventListener('message', handler);
        }
      };

      workerRef.current.addEventListener('message', handler);

      // Send polygon to worker
      workerRef.current.postMessage({
        type: 'applyGate',
        payload: { polygon: Array.from(polygon) },
      });
    },
    []
  );

  // Analyze selected cells
  const analyzeSelection = useCallback((callback: (result: any) => void) => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'analysisComplete') {
        callback(event.data.result);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);

    workerRef.current.postMessage({ type: 'analyzeSelection' });
  }, []);

  // Get cells for rendering
  const getCells = useCallback((callback: (cells: any[]) => void) => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'cellsData') {
        callback(event.data.data || []);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);

    workerRef.current.postMessage({ type: 'getCells' });
  }, []);

  return {
    isInitialized,
    isLoading,
    error,
    createSharedBuffer,
    loadData,
    setCoordinates,
    applyGate,
    analyzeSelection,
    getCells,
  };
}
