// Pipeline Launcher - UI for starting and monitoring bioinformatics pipelines

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PipelineInfo {
  name: string;
  description: string;
  version: string;
}

export function PipelineLauncher({ experimentId }: { experimentId: string }) {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [genome, setGenome] = useState<string>('GRCh38');
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    loadPipelines();
  }, []);

  const loadPipelines = async () => {
    try {
      const data = await invoke<PipelineInfo[]>('list_pipelines');
      setPipelines(data);
      if (data.length > 0) {
        setSelectedPipeline(data[0].name);
      }
    } catch (error) {
      console.error('Failed to load pipelines:', error);
    }
  };

  const launchPipeline = async () => {
    if (!selectedPipeline) return;

    setIsLaunching(true);
    try {
      const response = await invoke('start_pipeline', {
        request: {
          experiment_id: experimentId,
          pipeline_type: selectedPipeline,
          genome: genome || null,
          custom_params: null,
        },
      });

      console.log('Pipeline started:', response);
      
      // Start monitoring
      // TODO: Set up WebSocket connection for log streaming
    } catch (error) {
      console.error('Failed to start pipeline:', error);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-lg p-4 bg-white shadow">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Launch Pipeline</h3>
          <p className="text-sm text-gray-600">
            Run bioinformatics analysis on experiment data
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Pipeline Type
            </label>
            <select
              value={selectedPipeline}
              onChange={(e) => setSelectedPipeline(e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">Select a pipeline</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.name} value={pipeline.name}>
                  {pipeline.name} - {pipeline.description}
                </option>
              ))}
            </select>
          </div>

          {selectedPipeline?.includes('rnaseq') && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Reference Genome
              </label>
              <select
                value={genome}
                onChange={(e) => setGenome(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="GRCh38">GRCh38 (Human)</option>
                <option value="GRCm39">GRCm39 (Mouse)</option>
                <option value="TAIR10">TAIR10 (Arabidopsis)</option>
              </select>
            </div>
          )}

          <button
            onClick={launchPipeline}
            disabled={!selectedPipeline || isLaunching}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
          >
            {isLaunching ? 'Launching...' : 'Launch Pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
