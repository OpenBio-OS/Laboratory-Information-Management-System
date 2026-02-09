// New Pipeline Run Dialog - Select experiment and configure pipeline
// Enhanced with folder tree view and custom styled selects

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { experimentsApi, Experiment, ExperimentFolder } from '../lib/api';
import { CustomSelect, SelectOption } from './CustomSelect';
import {
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Search,
  FlaskConical,
  FileText,
  Play,
  Loader2,
  AlertCircle,
  Folder,
  FolderOpen,
  Plus,
  Check,
} from 'lucide-react';
import { DockerRequirementModal } from './DockerRequirementModal';

interface FileInfo {
  filename: string;
  path: string;
  size: number;
}

type PipelineSourceType = 'nf-core' | 'github' | 'local';

interface PipelineSource {
  type: PipelineSourceType;
  location: string;  // nf-core name, github URL, or local path
  revision?: string; // git branch/tag for github sources
}

interface PipelineTemplate {
  name: string;
  description: string;
  version: string;
  parameters: ParameterDefinition[];
  source?: PipelineSource;
  isCustom?: boolean;
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

interface NewPipelineRunDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface SelectedExperimentInput {
  experiment: Experiment;
  group: string;
  sampleName: string;
  replicate: string;
}

// Folder Tree Node component
function FolderTreeNode({
  folder,
  experiments,
  selectedExperiments,
  onToggleExperiment,
  expandedFolders,
  onToggleFolder,
  searchQuery,
}: {
  folder: ExperimentFolder;
  experiments: Experiment[];
  selectedExperiments: SelectedExperimentInput[];
  onToggleExperiment: (exp: Experiment) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  searchQuery: string;
}) {
  const isExpanded = expandedFolders.has(folder.id);
  const folderExperiments = experiments.filter(
    (e) => e.folderId === folder.id &&
      (searchQuery === '' || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const experimentCount = experiments.filter((e) => e.folderId === folder.id).length;

  // Skip folder if no matching experiments when searching
  if (searchQuery && folderExperiments.length === 0) {
    return null;
  }

  return (
    <div>
      {/* Folder Header */}
      <button
        onClick={() => onToggleFolder(folder.id)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 rounded-lg transition-colors group"
      >
        <div
          className="w-2 h-2 rounded-sm flex-shrink-0"
          style={{ backgroundColor: folder.color || '#17b978' }}
        />
        {isExpanded ? (
          <FolderOpen size={16} className="text-white/60" />
        ) : (
          <Folder size={16} className="text-white/60" />
        )}
        <span className="text-sm font-medium text-white flex-1 text-left truncate">
          {folder.name}
        </span>
        <span className="text-xs text-white/40">{experimentCount}</span>
        <ChevronDown
          size={14}
          className={`text-white/40 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
        />
      </button>

      {/* Experiments in Folder */}
      {isExpanded && (
        <div className="ml-6 border-l border-white/10 pl-2 space-y-1 mt-1">
          {folderExperiments.length === 0 ? (
            <div className="text-xs text-white/30 py-2 pl-2">No experiments</div>
          ) : (
            folderExperiments.map((exp) => {
              const isSelected = selectedExperiments.some((s) => s.experiment.id === exp.id);
              return (
                <button
                  key={exp.id}
                  onClick={() => onToggleExperiment(exp)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${isSelected
                    ? 'bg-brand-primary/15 border border-brand-primary/30'
                    : 'hover:bg-white/5 border border-transparent'
                    }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected
                    ? 'bg-brand-primary border-brand-primary'
                    : 'border-white/20'
                    }`}>
                    {isSelected && <Check size={10} className="text-black" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{exp.name}</div>
                    <div className="text-xs text-white/40">
                      {new Date(exp.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${exp.status === 'COMPLETED'
                      ? 'bg-brand-primary/10 text-brand-primary'
                      : exp.status === 'IN_PROGRESS'
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-white/5 text-white/40'
                      }`}
                  >
                    {exp.status}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function NewPipelineRunDialog({ onClose, onSuccess }: NewPipelineRunDialogProps) {
  // Step management
  const [step, setStep] = useState<'experiment' | 'pipeline'>('experiment');

  // Folder & experiment state
  const [folders, setFolders] = useState<ExperimentFolder[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExperiments, setSelectedExperiments] = useState<SelectedExperimentInput[]>([]);
  const [experimentFiles, setExperimentFiles] = useState<Record<string, FileInfo[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoadingExperiments, setIsLoadingExperiments] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Pipeline configuration state
  const [availablePipelines, setAvailablePipelines] = useState<PipelineTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PipelineTemplate | null>(null);
  const [showDockerModal, setShowDockerModal] = useState(false);
  const [isCheckingDocker, setIsCheckingDocker] = useState(false);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddPipeline, setShowAddPipeline] = useState(false);

  // Load experiments and folders on mount
  useEffect(() => {
    loadExperimentsAndFolders();
    loadPipelineTemplates();
  }, []);

  // Load files when experiments are selected
  useEffect(() => {
    selectedExperiments.forEach((selected) => {
      if (!experimentFiles[selected.experiment.id]) {
        loadExperimentFiles(selected.experiment.id);
      }
    });
  }, [selectedExperiments]);

  const loadExperimentsAndFolders = async () => {
    setIsLoadingExperiments(true);
    try {
      const [experimentsData, foldersData] = await Promise.all([
        experimentsApi.list(),
        experimentsApi.listFolders(),
      ]);
      setExperiments(experimentsData);
      setFolders(foldersData);
      // Expand all folders by default
      setExpandedFolders(new Set(foldersData.map((f) => f.id)));
    } catch (err) {
      console.error('Failed to load experiments:', err);
      setError('Failed to load experiments');
    } finally {
      setIsLoadingExperiments(false);
    }
  };

  const loadExperimentFiles = async (experimentId: string) => {
    setIsLoadingFiles(true);
    try {
      const result = await experimentsApi.listFiles(experimentId);
      setExperimentFiles((prev) => ({
        ...prev,
        [experimentId]: result.files || [],
      }));
    } catch (err) {
      console.error('Failed to load experiment files:', err);
      // Don't clear all files, just this one failed
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const loadPipelineTemplates = async () => {
    try {
      const templates = await invoke<PipelineTemplate[]>('get_pipeline_templates');
      setAvailablePipelines(templates);
      if (templates.length > 0) {
        setSelectedTemplate(templates[0]);
        initializeParameters(templates[0]);
      }
    } catch (error) {
      console.error('Failed to load pipeline templates:', error);
      const fallback: PipelineTemplate[] = [
        {
          name: 'nf-core/rnaseq',
          description: 'RNA sequencing analysis pipeline',
          version: '3.14.0',
          parameters: [
            {
              name: 'genome',
              label: 'Reference Genome',
              type: 'select',
              required: true,
              options: [
                'GRCh38',      // Human
                'GRCh37',      // Human (legacy)
                'GRCm39',      // Mouse
                'GRCm38',      // Mouse (legacy)
                'R64-1-1',     // Yeast (S. cerevisiae)
                'WBcel235',    // C. elegans
                'BDGP6',       // Drosophila
                'TAIR10',      // Arabidopsis
                'GRCz11',      // Zebrafish
                'Rnor_6.0',    // Rat
                'CanFam3.1',   // Dog
                'Sscrofa11.1', // Pig
                'UMD3.1',      // Bovine
              ]
            },
            { name: 'aligner', label: 'Aligner', type: 'select', required: true, default: 'star_salmon', options: ['star_salmon', 'star_rsem', 'hisat2'] },
          ],
        },
        {
          name: 'nf-core/scrnaseq',
          description: 'Single-cell RNA-seq analysis',
          version: '2.7.1',
          parameters: [
            {
              name: 'genome',
              label: 'Reference Genome',
              type: 'select',
              required: true,
              options: ['GRCh38', 'GRCh37', 'GRCm39', 'GRCm38']
            },
            { name: 'protocol', label: 'Protocol', type: 'select', required: true, options: ['10x', 'smartseq2', 'dropseq'] },
          ],
        },
        {
          name: 'nf-core/atacseq',
          description: 'ATAC-seq peak calling and analysis',
          version: '2.1.2',
          parameters: [
            { name: 'genome', label: 'Reference Genome', type: 'select', required: true, options: ['GRCh38', 'GRCm39', 'TAIR10'] },
            { name: 'narrow_peak', label: 'Call Narrow Peaks', type: 'boolean', required: false, default: 'true' },
          ],
        },
      ];
      setAvailablePipelines(fallback);
      setSelectedTemplate(fallback[0]);
      initializeParameters(fallback[0]);
    }
  };

  const initializeParameters = (pipeline: PipelineTemplate) => {
    const params: Record<string, string> = {};
    pipeline.parameters.forEach((param) => {
      if (param.default) {
        params[param.name] = param.default;
      }
    });
    setParameters(params);
  };

  const handlePipelineChange = (pipelineName: string) => {
    const pipeline = availablePipelines.find((p) => p.name === pipelineName);
    if (pipeline) {
      setSelectedTemplate(pipeline);
      initializeParameters(pipeline);
    }
  };

  const handleParameterChange = (name: string, value: string) => {
    setParameters((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleToggleExperiment = (experiment: Experiment) => {
    setSelectedExperiments((prev) => {
      const exists = prev.find((p) => p.experiment.id === experiment.id);
      if (exists) {
        return prev.filter((p) => p.experiment.id !== experiment.id);
      } else {
        return [...prev, {
          experiment,
          group: 'treatment',
          sampleName: experiment.name, // Default to experiment name
          replicate: '1'
        }];
      }
    });
  };

  const handleUpdateGroup = (experimentId: string, group: string) => {
    setSelectedExperiments((prev) =>
      prev.map((item) =>
        item.experiment.id === experimentId ? { ...item, group } : item
      )
    );
  };

  const handleUpdateSampleName = (experimentId: string, sampleName: string) => {
    setSelectedExperiments((prev) =>
      prev.map((item) =>
        item.experiment.id === experimentId ? { ...item, sampleName } : item
      )
    );
  };

  const handleUpdateReplicate = (experimentId: string, replicate: string) => {
    setSelectedExperiments((prev) =>
      prev.map((item) =>
        item.experiment.id === experimentId ? { ...item, replicate } : item
      )
    );
  };

  const handleLaunchPipeline = async () => {
    if (selectedExperiments.length === 0 || !selectedTemplate) return;

    setIsLaunching(true);
    setError(null);

    try {
      // Use first experiment as primary (mandatory for now)
      const primaryExperiment = selectedExperiments[0].experiment;

      // Prepare experiment inputs for samplesheet generation
      const experimentInputs = selectedExperiments.map((item) => ({
        experiment_id: item.experiment.id,
        experiment_name: item.experiment.name,
        sample_name: item.sampleName,
        group: item.group,
        replicate: item.replicate,
        files: experimentFiles[item.experiment.id] || [],
      }));

      await invoke('start_pipeline', {
        request: {
          experiment_id: primaryExperiment.id,
          pipeline_type: selectedTemplate.name,
          genome: parameters.genome || null,
          custom_params: {
            ...parameters,
            experiment_inputs: experimentInputs,
          },
        },
      });

      onSuccess();
      setStep('pipeline');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to launch pipeline';
      if (msg.includes('DOCKER_REQUIRED') || msg.toLowerCase().includes('docker')) {
        setShowDockerModal(true);
      } else {
        setError(msg);
      }
    } finally {
      setIsLaunching(false);
    }
  };

  const handleRecheckDocker = async () => {
    setIsCheckingDocker(true);
    try {
      const available = await invoke<boolean>('check_docker_installed');
      if (available) {
        setShowDockerModal(false);
      }
    } catch (err) {
      console.error('Failed to recheck Docker:', err);
    } finally {
      setIsCheckingDocker(false);
    }
  };

  // Filter experiments that don't belong to any folder (unfiled)
  const unfiledExperiments = experiments.filter(
    (e) => !e.folderId &&
      (searchQuery === '' || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );



  // Convert pipelines to select options
  const pipelineOptions: SelectOption[] = availablePipelines.map((p) => ({
    value: p.name,
    label: p.name,
    description: `${p.description} (v${p.version})`,
  }));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-white/10">
          <div className="px-6 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold text-white">New Pipeline Run</h2>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="px-6 pb-4 flex items-center gap-2 text-sm">
            <span
              className={`px-2 py-0.5 rounded ${step === 'experiment' ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/40'
                }`}
            >
              1. Select Experiment
            </span>
            <ChevronRight size={14} className="text-white/20" />
            <span
              className={`px-2 py-0.5 rounded ${step === 'pipeline' ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/40'
                }`}
            >
              2. Configure Pipeline
            </span>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {step === 'experiment' && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search experiments..."
                  className="w-full pl-10 pr-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                />
              </div>

              {/* Folder Tree */}
              <div className="bg-black/20 border border-white/10 rounded-xl p-3 max-h-[300px] overflow-auto">
                {isLoadingExperiments ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-brand-primary" size={24} />
                  </div>
                ) : folders.length === 0 && experiments.length === 0 ? (
                  <div className="text-center py-12 text-white/40">
                    <FlaskConical size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No experiments found</p>
                    <p className="text-sm">Create an experiment first to run a pipeline</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {/* Folders */}
                    {folders.map((folder) => (
                      <FolderTreeNode
                        key={folder.id}
                        folder={folder}
                        experiments={experiments}
                        selectedExperiments={selectedExperiments}
                        onToggleExperiment={handleToggleExperiment}
                        expandedFolders={expandedFolders}
                        onToggleFolder={handleToggleFolder}
                        searchQuery={searchQuery}
                      />
                    ))}

                    {/* Unfiled Experiments */}
                    {unfiledExperiments.length > 0 && (
                      <div className="pt-2 border-t border-white/10 mt-2">
                        <div className="text-xs text-white/40 px-3 py-1">Unfiled</div>
                        {unfiledExperiments.map((exp) => (
                          <button
                            key={exp.id}
                            onClick={() => handleToggleExperiment(exp)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${selectedExperiments.some(s => s.experiment.id === exp.id)
                              ? 'bg-brand-primary/15 border border-brand-primary/30'
                              : 'hover:bg-white/5 border border-transparent'
                              }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedExperiments.some(s => s.experiment.id === exp.id)
                              ? 'bg-brand-primary border-brand-primary'
                              : 'border-white/20'
                              }`}>
                              {selectedExperiments.some(s => s.experiment.id === exp.id) && <Check size={10} className="text-black" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-white truncate">{exp.name}</div>
                              <div className="text-xs text-white/40">
                                {new Date(exp.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Experiment Files Preview */}
              {/* Selected Experiments List */}
              {selectedExperiments.length > 0 && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-xl flex flex-col h-full">
                  <h3 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
                    <FlaskConical size={14} />
                    Selected Experiments ({selectedExperiments.length})
                  </h3>

                  <div className="flex-1 overflow-auto space-y-2">
                    {selectedExperiments.map((item) => {
                      const files = experimentFiles[item.experiment.id] || [];
                      return (
                        <div key={item.experiment.id} className="bg-black/20 rounded-lg p-3 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white truncate w-32" title={item.experiment.name}>
                              {item.experiment.name}
                            </span>
                            <button
                              onClick={() => handleToggleExperiment(item.experiment)}
                              className="text-white/40 hover:text-white transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-white/40 w-16">Sample:</span>
                            <input
                              type="text"
                              value={item.sampleName}
                              onChange={(e) => handleUpdateSampleName(item.experiment.id, e.target.value)}
                              placeholder="Sample Name"
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-full"
                            />
                          </div>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-white/40">Group:</span>
                            <input
                              type="text"
                              value={item.group}
                              onChange={(e) => handleUpdateGroup(item.experiment.id, e.target.value)}
                              placeholder="e.g. treatment"
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-24"
                            />
                            <span className="text-xs text-white/40 ml-2">Rep:</span>
                            <input
                              type="text"
                              value={item.replicate}
                              onChange={(e) => handleUpdateReplicate(item.experiment.id, e.target.value)}
                              className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-8 text-center"
                            />
                          </div>

                          <div className="flex items-center gap-2 text-xs text-white/40">
                            <FileText size={10} />
                            {isLoadingFiles ? (
                              <span className="animate-pulse">Loading files...</span>
                            ) : (
                              <span>{files.length} files attached</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'pipeline' && (
            <div className="space-y-6">
              {/* Selected Experiment Summary */}
              {/* Selected Experiment Summary */}
              <div className="p-4 bg-brand-primary/5 border border-brand-primary/20 rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <FlaskConical size={18} className="text-brand-primary" />
                  <div>
                    <div className="font-medium text-white">
                      Selected Experiments ({selectedExperiments.length})
                    </div>
                    <div className="text-sm text-white/40">
                      Configure sample names and groups for analysis
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-white/5 border-b border-white/10">
                      <tr>
                        <th className="px-4 py-2 text-white/60 font-medium">Experiment</th>
                        <th className="px-4 py-2 text-white/60 font-medium">Sample Name</th>
                        <th className="px-4 py-2 text-white/60 font-medium">Group</th>
                        <th className="px-4 py-2 text-white/60 font-medium">Rep</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {selectedExperiments.map((item) => (
                        <tr key={item.experiment.id} className="bg-black/20">
                          <td className="px-4 py-2 text-white">{item.experiment.name}</td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={item.sampleName}
                              onChange={(e) => handleUpdateSampleName(item.experiment.id, e.target.value)}
                              placeholder="Sample Name"
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-full"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={item.group}
                              onChange={(e) => handleUpdateGroup(item.experiment.id, e.target.value)}
                              placeholder="Group"
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-24"
                            />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="text"
                              value={item.replicate}
                              onChange={(e) => handleUpdateReplicate(item.experiment.id, e.target.value)}
                              className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:border-brand-primary/50 w-10 text-center mx-auto"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pipeline Selection with CustomSelect */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-white/60">Pipeline Type *</label>
                  <button
                    onClick={() => setShowAddPipeline(true)}
                    className="flex items-center gap-1 text-xs text-brand-primary hover:text-brand-secondary transition-colors"
                  >
                    <Plus size={12} />
                    Add Custom
                  </button>
                </div>
                <CustomSelect
                  value={selectedTemplate?.name || ''}
                  onChange={handlePipelineChange}
                  options={pipelineOptions}
                  placeholder="Select a pipeline"
                  searchable={pipelineOptions.length > 5}
                />
              </div>

              {/* Pipeline Parameters */}
              {selectedTemplate && selectedTemplate.parameters.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-white/60 border-t border-white/10 pt-4">
                    Pipeline Parameters
                  </h3>

                  {selectedTemplate.parameters.map((param) => (
                    <div key={param.name}>
                      <label className="block text-sm font-medium text-white/80 mb-1.5">
                        {param.label} {param.required && <span className="text-red-400">*</span>}
                      </label>
                      {param.description && (
                        <p className="text-xs text-white/40 mb-2">{param.description}</p>
                      )}

                      {param.type === 'select' && param.options && (
                        <CustomSelect
                          value={parameters[param.name] || ''}
                          onChange={(value) => handleParameterChange(param.name, value)}
                          options={param.options.map((opt) => ({ value: opt, label: opt }))}
                          placeholder={`Select ${param.label}`}
                        />
                      )}

                      {param.type === 'text' && (
                        <input
                          type="text"
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'number' && (
                        <input
                          type="number"
                          value={parameters[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                          required={param.required}
                          placeholder={param.default}
                        />
                      )}

                      {param.type === 'boolean' && (
                        <label className="flex items-center gap-3 cursor-pointer">
                          <div
                            className={`relative w-10 h-5 rounded-full transition-colors ${parameters[param.name] === 'true' ? 'bg-brand-primary' : 'bg-white/10'
                              }`}
                          >
                            <div
                              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${parameters[param.name] === 'true' ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                          </div>
                          <input
                            type="checkbox"
                            checked={parameters[param.name] === 'true'}
                            onChange={(e) =>
                              handleParameterChange(param.name, e.target.checked ? 'true' : 'false')
                            }
                            className="sr-only"
                          />
                          <span className="text-sm text-white/60">Enable</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                  <AlertCircle size={18} />
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
          <div>
            {step === 'pipeline' && (
              <button
                onClick={() => setStep('experiment')}
                className="flex items-center gap-2 px-4 py-2 text-white/60 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm border border-white/10 text-white/80 rounded-lg hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>

            {step === 'experiment' ? (
              <button
                onClick={() => setStep('pipeline')}
                disabled={!selectedExperiments}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleLaunchPipeline}
                disabled={!selectedTemplate || isLaunching}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLaunching ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Start Pipeline
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Add Pipeline Modal (placeholder - to be implemented) */}
      {showAddPipeline && (
        <AddPipelineModal
          onClose={() => setShowAddPipeline(false)}
          onAdd={(pipeline) => {
            setAvailablePipelines((prev) => [...prev, { ...pipeline, isCustom: true }]);
            setShowAddPipeline(false);
          }}
        />
      )}

      {/* Docker Requirement Modal */}
      {showDockerModal && (
        <DockerRequirementModal
          onClose={() => setShowDockerModal(false)}
          onRecheck={handleRecheckDocker}
          isChecking={isCheckingDocker}
        />
      )}
    </div>
  );
}

// Add Pipeline Modal Component
function AddPipelineModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (pipeline: PipelineTemplate) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [sourceType, setSourceType] = useState<PipelineSourceType>('nf-core');
  const [sourceLocation, setSourceLocation] = useState('');
  const [revision, setRevision] = useState('');
  const [parameters, setParameters] = useState<ParameterDefinition[]>([]);

  const addParameter = () => {
    setParameters((prev) => [
      ...prev,
      { name: '', label: '', type: 'text', required: false },
    ]);
  };

  const updateParameter = (index: number, updates: Partial<ParameterDefinition>) => {
    setParameters((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...updates } : p))
    );
  };

  const removeParameter = (index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!name.trim() || !sourceLocation.trim()) return;
    onAdd({
      name: name.trim(),
      description: description.trim(),
      version,
      source: {
        type: sourceType,
        location: sourceLocation.trim(),
        revision: revision.trim() || undefined,
      },
      parameters: parameters.filter((p) => p.name.trim() && p.label.trim()),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div
        className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Add Custom Pipeline</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Pipeline Info */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">
              Pipeline Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., my-org/custom-pipeline"
              className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the pipeline"
              className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">Version</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
            />
          </div>

          {/* Pipeline Source */}
          <div className="border-t border-white/10 pt-4 space-y-4">
            <label className="block text-sm font-medium text-white/60">Pipeline Source *</label>

            {/* Source Type Buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSourceType('nf-core')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${sourceType === 'nf-core'
                  ? 'bg-brand-primary/20 border-brand-primary text-brand-primary border'
                  : 'bg-black/30 border-white/10 text-white/60 border hover:border-white/20'
                  }`}
              >
                nf-core
              </button>
              <button
                type="button"
                onClick={() => setSourceType('github')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${sourceType === 'github'
                  ? 'bg-brand-primary/20 border-brand-primary text-brand-primary border'
                  : 'bg-black/30 border-white/10 text-white/60 border hover:border-white/20'
                  }`}
              >
                GitHub URL
              </button>
              <button
                type="button"
                onClick={() => setSourceType('local')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${sourceType === 'local'
                  ? 'bg-brand-primary/20 border-brand-primary text-brand-primary border'
                  : 'bg-black/30 border-white/10 text-white/60 border hover:border-white/20'
                  }`}
              >
                Local Path
              </button>
            </div>

            {/* Source Location Input */}
            <div>
              <input
                type="text"
                value={sourceLocation}
                onChange={(e) => setSourceLocation(e.target.value)}
                placeholder={
                  sourceType === 'nf-core'
                    ? 'e.g., nf-core/rnaseq'
                    : sourceType === 'github'
                      ? 'e.g., https://github.com/your-org/pipeline'
                      : 'e.g., /path/to/my-pipeline'
                }
                className={`w-full px-4 py-2.5 bg-black/30 border rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 ${!sourceLocation.trim() ? 'border-red-500/50' : 'border-white/10'
                  }`}
              />
              <p className="text-xs text-white/40 mt-1">
                {sourceType === 'nf-core' && 'Enter the nf-core pipeline name (e.g., nf-core/rnaseq, nf-core/sarek)'}
                {sourceType === 'github' && 'Enter the full GitHub/GitLab URL to the pipeline repository'}
                {sourceType === 'local' && 'Enter the absolute path to the pipeline directory on this machine'}
              </p>
            </div>

            {/* Revision field for git-based sources */}
            {(sourceType === 'nf-core' || sourceType === 'github') && (
              <div>
                <label className="block text-sm font-medium text-white/60 mb-1.5">
                  Revision / Branch <span className="text-white/40">(optional)</span>
                </label>
                <input
                  type="text"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  placeholder="e.g., main, v3.12.0, dev"
                  className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                />
              </div>
            )}
          </div>

          {/* Parameters */}
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-white/60">Parameters</label>
              <button
                onClick={addParameter}
                className="flex items-center gap-1 text-xs text-brand-primary hover:text-brand-secondary transition-colors"
              >
                <Plus size={12} />
                Add Parameter
              </button>
            </div>

            <div className="space-y-3">
              {parameters.map((param, index) => (
                <div key={index} className="p-3 bg-black/20 border border-white/10 rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={param.name}
                      onChange={(e) => updateParameter(index, { name: e.target.value })}
                      placeholder="param_name"
                      className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                    />
                    <input
                      type="text"
                      value={param.label}
                      onChange={(e) => updateParameter(index, { label: e.target.value })}
                      placeholder="Display Label"
                      className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                    />
                    <button
                      onClick={() => removeParameter(index)}
                      className="px-2 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <CustomSelect
                      value={param.type}
                      onChange={(value) =>
                        updateParameter(index, { type: value as ParameterDefinition['type'] })
                      }
                      options={[
                        { value: 'text', label: 'Text' },
                        { value: 'number', label: 'Number' },
                        { value: 'select', label: 'Dropdown' },
                        { value: 'boolean', label: 'Toggle' },
                      ]}
                      className="flex-1"
                    />
                    <label className="flex items-center gap-2 text-xs text-white/60">
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={(e) => updateParameter(index, { required: e.target.checked })}
                        className="rounded border-white/20"
                      />
                      Required
                    </label>
                  </div>
                  {param.type === 'select' && (
                    <input
                      type="text"
                      value={param.options?.join(', ') || ''}
                      onChange={(e) =>
                        updateParameter(index, {
                          options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      placeholder="Options (comma-separated)"
                      className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                    />
                  )}
                </div>
              ))}

              {parameters.length === 0 && (
                <p className="text-sm text-white/40 text-center py-4">
                  No parameters defined. Add parameters to configure the pipeline.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-white/10 text-white/80 rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !sourceLocation.trim()}
            className="px-4 py-2 bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
