// Pipeline Configuration Dialog - Configure Nextflow parameters for an experiment

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PipelineConfigProps {
  experimentId: string;
  onClose: () => void;
  onSubmit: (config: PipelineConfig) => void;
}

interface PipelineConfig {
  pipelineType: string;
  genome?: string;
  parameters: Record<string, string>;
}

interface PipelineTemplate {
  name: string;
  description: string;
  version: string;
  parameters: ParameterDefinition[];
}

interface ParameterDefinition {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required: boolean;
  default?: string;
  options?: string[];
  description?: string;
}

export function PipelineConfigDialog({ experimentId, onClose, onSubmit }: PipelineConfigProps) {
  const [availablePipelines, setAvailablePipelines] = useState<PipelineTemplate[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPipelineTemplates();
  }, []);

  const loadPipelineTemplates = async () => {
    try {
      const templates = await invoke<PipelineTemplate[]>('get_pipeline_templates');
      setAvailablePipelines(templates);
      if (templates.length > 0) {
        setSelectedPipeline(templates[0].name);
        initializeParameters(templates[0]);
      }
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load pipeline templates:', error);
      // Fallback templates
      const fallback: PipelineTemplate[] = [
        {
          name: 'nf-core/rnaseq',
          description: 'RNA sequencing analysis pipeline',
          version: '3.14.0',
          parameters: [
            { name: 'genome', label: 'Reference Genome', type: 'select', required: true, options: ['GRCh38', 'GRCm39', 'TAIR10'] },
            { name: 'aligner', label: 'Aligner', type: 'select', required: true, default: 'star_salmon', options: ['star_salmon', 'star_rsem', 'hisat2'] },
            { name: 'min_mapped_reads', label: 'Min Mapped Reads', type: 'number', required: false, default: '5' },
            { name: 'trimming', label: 'Enable Trimming', type: 'boolean', required: false, default: 'true' },
          ],
        },
        {
          name: 'nf-core/scrnaseq',
          description: 'Single-cell RNA-seq analysis',
          version: '2.7.1',
          parameters: [
            { name: 'genome', label: 'Reference Genome', type: 'select', required: true, options: ['GRCh38', 'GRCm39'] },
            { name: 'protocol', label: 'Protocol', type: 'select', required: true, options: ['10x', 'smartseq2', 'dropseq'] },
            { name: 'chemistry', label: 'Chemistry Version', type: 'select', required: false, options: ['V2', 'V3', 'auto'], default: 'auto' },
          ],
        },
        {
          name: 'nf-core/atacseq',
          description: 'ATAC-seq peak calling and analysis',
          version: '2.1.2',
          parameters: [
            { name: 'genome', label: 'Reference Genome', type: 'select', required: true, options: ['GRCh38', 'GRCm39', 'TAIR10'] },
            { name: 'narrow_peak', label: 'Call Narrow Peaks', type: 'boolean', required: false, default: 'true' },
            { name: 'macs_gsize', label: 'MACS Genome Size', type: 'text', required: false },
          ],
        },
      ];
      setAvailablePipelines(fallback);
      setSelectedPipeline(fallback[0].name);
      initializeParameters(fallback[0]);
      setIsLoading(false);
    }
  };

  const initializeParameters = (pipeline: PipelineTemplate) => {
    const params: Record<string, string> = {};
    pipeline.parameters.forEach(param => {
      if (param.default) {
        params[param.name] = param.default;
      }
    });
    setParameters(params);
  };

  const handlePipelineChange = (pipelineName: string) => {
    setSelectedPipeline(pipelineName);
    const pipeline = availablePipelines.find(p => p.name === pipelineName);
    if (pipeline) {
      initializeParameters(pipeline);
    }
  };

  const handleParameterChange = (name: string, value: string) => {
    setParameters(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const config: PipelineConfig = {
      pipelineType: selectedPipeline,
      parameters,
    };

    if (parameters.genome) {
      config.genome = parameters.genome;
    }

    onSubmit(config);
  };

  const selectedTemplate = availablePipelines.find(p => p.name === selectedPipeline);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">Configure Pipeline</h2>
              <p className="text-sm text-gray-600">Experiment ID: {experimentId}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Pipeline Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pipeline Type *
                </label>
                <select
                  value={selectedPipeline}
                  onChange={(e) => handlePipelineChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  {availablePipelines.map((pipeline) => (
                    <option key={pipeline.name} value={pipeline.name}>
                      {pipeline.name} - {pipeline.description} (v{pipeline.version})
                    </option>
                  ))}
                </select>
              </div>

              {/* Pipeline Parameters */}
              {selectedTemplate && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">
                    Pipeline Parameters
                  </h3>

                  {selectedTemplate.parameters.map((param) => (
                    <div key={param.name}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {param.label} {param.required && <span className="text-red-500">*</span>}
                      </label>
                      {param.description && (
                        <p className="text-xs text-gray-500 mb-2">{param.description}</p>
                      )}

                      {param.type === 'select' && (
                        <select
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          required={param.required}
                        >
                          {!param.default && <option value="">Select {param.label}</option>}
                          {param.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'text' && (
                        <input
                          type="text"
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'number' && (
                        <input
                          type="number"
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'boolean' && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={parameters[param.name] === 'true'}
                            onChange={(e) => handleParameterChange(param.name, e.target.checked ? 'true' : 'false')}
                            className="w-4 h-4 text-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-600">Enable</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 flex-1 py-1.5 text-sm text-white/80 rounded-lg hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Start Pipeline
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
