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

// Fallback for SharedArrayBuffer
const BufferClass = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer;

export function useWasmWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Buffer state (can be SharedArrayBuffer or ArrayBuffer)
  const [matrixBuffer, setMatrixBuffer] = useState<any>(null);
  const [coordsBuffer, setCoordsBuffer] = useState<any>(null);
  const [selectionBuffer, setSelectionBuffer] = useState<any>(null);

  // Refs for internal worker interaction
  const sharedBufferRef = useRef<any>(null);
  const coordsBufferRef = useRef<any>(null);
  const selectionBufferRef = useRef<any>(null);

  // Initialize worker on mount
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/wasm.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, error: errMsg } = event.data;

      switch (type) {
        case 'initialized':
        case 'pcaLoaded':
        case 'dataLoaded':
        case 'bufferSet':
        case 'coordinatesSet':
          setIsInitialized(true);
          setIsLoading(false);
          break;

        case 'error':
          setError(errMsg || 'Unknown error');
          setIsLoading(false);
          break;
      }
    };

    workerRef.current = worker;
    setIsLoading(true);
    worker.postMessage({ type: 'init' });

    return () => {
      worker.terminate();
    };
  }, []);

  const createSharedBuffer = useCallback((sizeBytes: number) => {
    try {
      console.log("[wasm-worker] createSharedBuffer: using", BufferClass.name, "size", sizeBytes);

      const buffer = new BufferClass(sizeBytes);
      sharedBufferRef.current = buffer;

      const coords = new BufferClass(8 * 1024 * 1024);
      coordsBufferRef.current = coords;

      const selection = new BufferClass(4 * 1024 * 1024);
      selectionBufferRef.current = selection;

      setMatrixBuffer(buffer);
      setCoordsBuffer(coords);
      setSelectionBuffer(selection);

      // Note: If using ArrayBuffer, this will CLONE or fail to share memory
      // but for this specific data flow (JS-side fill), it allows the UI to proceed.
      workerRef.current?.postMessage({
        type: 'setSharedBuffer',
        payload: {
          buffer,
          coordsBuffer: coords,
          selectionBuffer: selection
        },
      });

      return { buffer, coordsBuffer: coords, selectionBuffer: selection };
    } catch (err) {
      console.error("[wasm-worker] createSharedBuffer ERROR:", err);
      setError('Failed to allocate memory buffers.');
      return null;
    }
  }, []);

  const loadData = useCallback((chunk: Uint8Array, offset: number = 0, complete: boolean = false) => {
    if (!workerRef.current) return;
    setIsLoading(true);
    workerRef.current.postMessage({
      type: 'loadData',
      payload: { chunk, offset, complete },
    });
  }, []);

  const setCoordinates = useCallback((coords: Float32Array) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'setCoordinates',
      payload: { coords: Array.from(coords) },
    });
  }, []);

  const applyGate = useCallback((polygon: Float32Array, callback: (count: number, mask: number[]) => void) => {
    if (!workerRef.current) return;

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'gateApplied') {
        callback(event.data.count || 0, event.data.selectionMask || []);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);
    workerRef.current.postMessage({
      type: 'applyGate',
      payload: { polygon: Array.from(polygon) },
    });
  }, []);

  const analyzeSelection = useCallback((callback: (result: any) => void) => {
    if (!workerRef.current) return;

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'analysisComplete') {
        callback(event.data.result);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);
    workerRef.current.postMessage({ type: 'analyzeSelection' });
  }, []);

  const getCells = useCallback((callback: (cells: any[]) => void) => {
    if (!workerRef.current) return;

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'cellsData') {
        callback(event.data.data || []);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);
    workerRef.current.postMessage({ type: 'getCells' });
  }, []);

  const loadPca = useCallback((data: ArrayBuffer, delimiter?: number) => {
    if (!workerRef.current) return;
    setIsLoading(true);
    workerRef.current.postMessage({
      type: 'loadPca',
      payload: { data, delimiter },
    });
  }, []);

  const getPcaData = useCallback((callback: (data: any[]) => void) => {
    if (!workerRef.current) return;

    const handler = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'pcaData') {
        callback(event.data.data || []);
        workerRef.current?.removeEventListener('message', handler);
      }
    };

    workerRef.current.addEventListener('message', handler);
    workerRef.current.postMessage({ type: 'getPcaData' });
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
    loadPca,
    getPcaData,
    coordsBuffer,
    selectionBuffer,
    matrixBuffer,
  };
}
