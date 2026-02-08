// Web Worker for WASM Engine
// Runs computationally intensive tasks without blocking the UI

// TODO: Build WASM module first with: cd crates/openbio-wasm && wasm-pack build --target web
// import init, { WasmEngine } from '../wasm/openbio_wasm';

let engine: any | null = null;
let sharedBuffer: SharedArrayBuffer | null = null;

// Message types from main thread
interface WorkerMessage {
  type: string;
  payload?: any;
}

// Initialize WASM module
async function initializeWasm() {
  try {
    // TODO: Uncomment when WASM is built
    // await init();
    // engine = new WasmEngine();
    postMessage({ type: 'initialized' });
  } catch (error) {
    postMessage({ type: 'error', error: String(error) });
  }
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'init':
        await initializeWasm();
        break;

      case 'setSharedBuffer':
        // Zone B Step 3: Store reference to SharedArrayBuffer
        sharedBuffer = payload.buffer;
        postMessage({ type: 'bufferSet' });
        break;

      case 'loadData':
        // Zone B: Receive data chunks from Rust backend via Tauri IPC
        // Zone C Step 3: Write data into SharedArrayBuffer
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        if (!sharedBuffer) {
          throw new Error('Shared buffer not set');
        }

        // Convert SharedArrayBuffer to Uint8Array for WASM
        const dataView = new Uint8Array(sharedBuffer);
        const chunk = new Uint8Array(payload.chunk);
        
        // Write chunk into shared buffer at offset
        dataView.set(chunk, payload.offset || 0);

        // Parse matrix when all data is loaded
        if (payload.complete) {
          engine.load_matrix(dataView);
          postMessage({ type: 'dataLoaded' });
        }
        break;

      case 'setCoordinates':
        // Set cell coordinates from UMAP/t-SNE
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        engine.set_coordinates(new Float32Array(payload.coords));
        postMessage({ type: 'coordinatesSet' });
        break;

      case 'applyGate':
        // Zone C Step 1: Receive lasso coordinates from React
        // Zone C Step 2: Run point-in-polygon algorithm on SAB data
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        
        const polygon = new Float32Array(payload.polygon);
        const count = engine.apply_gate(polygon);
        
        // Zone C Step 3: Update selection bitmask (another SAB)
        const selectionMask = engine.get_selection_mask();
        
        postMessage({ 
          type: 'gateApplied', 
          count,
          selectionMask: Array.from(selectionMask)
        });
        break;

      case 'analyzeSelection':
        // Run differential expression on selected cells
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        
        const result = engine.analyze_selection();
        postMessage({ type: 'analysisComplete', result });
        break;

      case 'getCells':
        // Get cell data for rendering
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        
        const cellsJson = engine.get_cells_json();
        postMessage({ type: 'cellsData', data: JSON.parse(cellsJson) });
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    postMessage({ type: 'error', error: String(error) });
  }
};

// Export type for main thread
export {};
