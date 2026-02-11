// Web Worker for WASM Engine
// Runs computationally intensive tasks without blocking the UI

// TODO: Build WASM module first with: cd crates/openbio-wasm && wasm-pack build --target web
import init, { WasmEngine } from '../wasm/openbio_wasm';

let engine: WasmEngine | null = null;
let sharedBuffer: ArrayBuffer | null = null;

// Message types from main thread
interface WorkerMessage {
  type: string;
  payload?: any;
}

// Initialize WASM module
async function initializeWasm() {
  try {
    await init();
    engine = new WasmEngine();
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
        // Zone B Step 3: Store reference to ArrayBuffer (Shared or Regular)
        sharedBuffer = payload.buffer;
        const selectionBuffer = payload.selectionBuffer;
        const coordsBuffer = payload.coordsBuffer;

        if (engine) {
          if (selectionBuffer) {
            // @ts-ignore - set_selection_buffer exists on our custom WasmEngine
            engine.set_selection_buffer(selectionBuffer);
          }
          if (coordsBuffer) {
            // @ts-ignore - set_coords_buffer exists on our custom WasmEngine
            engine.set_coords_buffer(coordsBuffer);
          }
        }

        postMessage({ type: 'bufferSet' });
        break;

      case 'loadData':
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        if (!sharedBuffer) {
          throw new Error('Buffer not set');
        }

        const dataView = new Uint8Array(sharedBuffer);
        const chunk = new Uint8Array(payload.chunk);

        // Write chunk into buffer at offset
        dataView.set(chunk, payload.offset || 0);

        // Parse matrix when all data is loaded
        if (payload.complete) {
          engine.load_matrix(dataView);
          postMessage({ type: 'dataLoaded' });
        }
        break;

      case 'setCoordinates':
        if (!engine) {
          throw new Error('Engine not initialized');
        }
        engine.set_coordinates(new Float32Array(payload.coords));
        postMessage({ type: 'coordinatesSet' });
        break;

      case 'applyGate':
        if (!engine) {
          throw new Error('Engine not initialized');
        }

        const polygon = new Float32Array(payload.polygon);
        const count = engine.apply_gate(polygon);

        // Update selection bitmask
        const selectionMask = engine.get_selection_mask();

        postMessage({
          type: 'gateApplied',
          count,
          selectionMask: Array.from(selectionMask)
        });
        break;

      case 'analyzeSelection':
        if (!engine) {
          throw new Error('Engine not initialized');
        }

        const result = engine.analyze_selection();
        postMessage({ type: 'analysisComplete', result });
        break;

      case 'getCells':
        if (!engine) {
          throw new Error('Engine not initialized');
        }

        const cellsJson = engine.get_cells_json();
        postMessage({ type: 'cellsData', data: JSON.parse(cellsJson) });
        break;

      case 'loadPca':
        if (!engine) {
          throw new Error('Engine not initialized');
        }

        const pcaData = new Uint8Array(payload.data);
        const delimiter = payload.delimiter || 44;

        // @ts-ignore - load_pca exists on our custom WasmEngine
        engine.load_pca(pcaData, delimiter);
        postMessage({ type: 'pcaLoaded' });
        break;

      case 'getPcaData':
        if (!engine) {
          throw new Error('Engine not initialized');
        }

        // @ts-ignore - get_pca_json exists on our custom WasmEngine
        const pcaJson = engine.get_pca_json();
        postMessage({ type: 'pcaData', data: JSON.parse(pcaJson) });
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    postMessage({ type: 'error', error: String(error) });
  }
};

export { };
