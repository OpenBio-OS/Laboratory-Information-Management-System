// Pipeline Configuration Dialog - Configure Nextflow parameters for an experiment

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Loader2 } from 'lucide-react';

interface PipelineConfigModalProps {
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

export function PipelineConfigModal({ experimentId, onClose, onSubmit }: PipelineConfigModalProps) {
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-white/10 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl text-white">Configure Pipeline</h2>
              <p className="text-xs text-white/40 uppercase tracking-widest">Experiment: {experimentId.slice(0, 12)}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Loader2 className="animate-spin text-brand-primary" size={24} />
              <p className="text-white/40 text-[10px] uppercase tracking-[0.2em]">Synchronizing Templates</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Pipeline Selection */}
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">
                  Pipeline Type *
                </label>
                <select
                  value={selectedPipeline}
                  onChange={(e) => handlePipelineChange(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all font-medium appearance-none"
                  required
                >
                  {availablePipelines.map((pipeline) => (
                    <option key={pipeline.name} value={pipeline.name} className="bg-neutral-900">
                      {pipeline.name} - {pipeline.description} (v{pipeline.version})
                    </option>
                  ))}
                </select>
              </div>

              {/* Pipeline Parameters */}
              {selectedTemplate && (
                <div className="space-y-4">
                  <h3 className="text-lg text-white border-b border-white/10 pb-2">
                    Pipeline Parameters
                  </h3>

                  {selectedTemplate.parameters.map((param) => (
                    <div key={param.name}>
                      <label className="block text-sm font-medium text-white/60 mb-1">
                        {param.label} {param.required && <span className="text-red-500">*</span>}
                      </label>
                      {param.description && (
                        <p className="text-xs text-white/40 mb-2 italic">{param.description}</p>
                      )}

                      {param.type === 'select' && (
                        <select
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all text-sm appearance-none"
                          required={param.required}
                        >
                          {!param.default && <option value="" className="bg-neutral-900">Select {param.label}</option>}
                          {param.options?.map((option) => (
                            <option key={option} value={option} className="bg-neutral-900">
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
                          className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all text-sm placeholder:text-white/20 font-mono"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'number' && (
                        <input
                          type="number"
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:border-brand-primary/50 transition-all text-sm"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'boolean' && (
                        <label className="flex items-center gap-2 group cursor-pointer">
                          <input
                            type="checkbox"
                            checked={parameters[param.name] === 'true'}
                            onChange={(e) => handleParameterChange(param.name, e.target.checked ? 'true' : 'false')}
                            className="w-4 h-4 bg-black/30 border-white/10 rounded text-brand-primary focus:ring-brand-primary focus:ring-offset-0"
                          />
                          <span className="text-sm text-white/60 group-hover:text-white transition-colors">Enable</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="px-6 py-4 bg-white/5 border-t border-white/10 flex justify-between items-center -mx-6 -mb-6 mt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary transition-all shadow-[0_0_20px_rgba(23,185,120,0.2)]"
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
