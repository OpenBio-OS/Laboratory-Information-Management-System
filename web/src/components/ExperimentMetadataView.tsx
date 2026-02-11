import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Microscope, Thermometer, Activity, BookOpen, FileText } from 'lucide-react';

interface ExperimentMetadata {
  experiment_id: string;
  name: string;
  description?: string;
  content?: string;
  linked_papers?: Paper[];
  pipeline_type: string;
  status: string;
  samples: Sample[];
  equipment: Equipment[];
}

interface Sample {
  id: string;
  name: string;
  type: string;
  metadata?: string;
  externalId?: string;
}

interface Equipment {
  id: string;
  name: string;
  type: string;
  model?: string;
  serialNumber?: string;
}

interface Paper {
  id: string;
  title: string;
  url?: string;
  doi?: string;
  notes?: string;
}

interface ExperimentMetadataViewProps {
  experimentId: string;
}

export function ExperimentMetadataView({ experimentId }: ExperimentMetadataViewProps) {
  const [metadata, setMetadata] = useState<ExperimentMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMetadata();
  }, [experimentId]);

  const loadMetadata = async () => {
    setIsLoading(true);
    try {
      const data = await invoke<ExperimentMetadata>('get_experiment_metadata', { id: experimentId });
      setMetadata(data);
    } catch (err) {
      console.error('Failed to load metadata:', err);
      setError('Failed to load experiment details.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
      </div>
    );
  }

  if (error || !metadata) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        {error || "No metadata found."}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 pt-6">
      {/* General Info Card */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg text-white font-medium mb-4 flex items-center gap-2">
          <Activity size={20} className="text-brand-primary" />
          Experiment Details
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Experiment Name</p>
            <p className="text-white text-lg">{metadata.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Pipeline Type</p>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-brand-primary/10 text-brand-primary text-xs font-medium border border-brand-primary/20">
                {metadata.pipeline_type}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Status</p>
            <p className="text-white capitalize">{metadata.status}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">ID</p>
            <p className="text-white/60 font-mono text-sm">{metadata.experiment_id}</p>
          </div>
          {metadata.description && (
            <div className="md:col-span-2 space-y-1 pt-2 border-t border-white/5 mt-2">
              <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Notes</p>
              <p className="text-white/80 text-sm whitespace-pre-wrap">{metadata.description}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Samples Section */}
        <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col">
          <div className="p-4 border-b border-white/5 flex justify-between items-center">
            <h3 className="text-white font-medium flex items-center gap-2">
              <Thermometer size={18} className="text-blue-400" />
              Samples
              <span className="bg-white/10 text-white/60 text-xs px-2 py-0.5 rounded-full ml-2">
                {metadata.samples?.length || 0}
              </span>
            </h3>
          </div>
          <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
            {metadata.samples && metadata.samples.length > 0 ? (
              metadata.samples.map(sample => (
                <div key={sample.id} className="bg-black/20 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-white font-medium">{sample.name}</p>
                    <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded uppercase">{sample.type}</span>
                  </div>
                  {sample.externalId && (
                    <p className="text-xs text-white/40 font-mono mb-1">REF: {sample.externalId}</p>
                  )}
                  {sample.metadata && (
                    <p className="text-xs text-white/60 line-clamp-2">{sample.metadata}</p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-white/30 text-center py-8 text-sm">No samples linked to this experiment.</p>
            )}
          </div>
        </div>

        {/* Equipment Section */}
        <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col">
          <div className="p-4 border-b border-white/5 flex justify-between items-center">
            <h3 className="text-white font-medium flex items-center gap-2">
              <Microscope size={18} className="text-purple-400" />
              Equipment used
              <span className="bg-white/10 text-white/60 text-xs px-2 py-0.5 rounded-full ml-2">
                {metadata.equipment?.length || 0}
              </span>
            </h3>
          </div>
          <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
            {metadata.equipment && metadata.equipment.length > 0 ? (
              metadata.equipment.map(item => (
                <div key={item.id} className="bg-black/20 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-white font-medium">{item.name}</p>
                    <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded uppercase">{item.type}</span>
                  </div>
                  {(item.model || item.serialNumber) && (
                    <div className="flex gap-4 text-xs text-white/40 mt-1">
                      {item.model && <span>Model: {item.model}</span>}
                      {item.serialNumber && <span className="font-mono">SN: {item.serialNumber}</span>}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-white/30 text-center py-8 text-sm">No equipment linked to this experiment.</p>
            )}
          </div>
        </div>

        {/* Linked Papers Section */}
        <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col md:col-span-2">
          <div className="p-4 border-b border-white/5 flex justify-between items-center">
            <h3 className="text-white font-medium flex items-center gap-2">
              <BookOpen size={18} className="text-yellow-400" />
              Linked Papers
              <span className="bg-white/10 text-white/60 text-xs px-2 py-0.5 rounded-full ml-2">
                {metadata.linked_papers?.length || 0}
              </span>
            </h3>
          </div>
          <div className="p-4">
            {metadata.linked_papers && metadata.linked_papers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {metadata.linked_papers.map(paper => (
                  <div key={paper.id} className="bg-black/20 rounded-lg p-4 border border-white/5 hover:border-white/10 transition-colors">
                    <a href={paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : '#')} target="_blank" rel="noopener noreferrer" className="text-white font-medium hover:text-brand-primary transition-colors mb-2 block truncate">
                      {paper.title}
                    </a>
                    {paper.doi && (
                      <p className="text-xs text-white/40 font-mono mb-2">DOI: {paper.doi}</p>
                    )}
                    {paper.notes && (
                      <div className="bg-yellow-500/5 border border-yellow-500/10 rounded p-3 mt-2">
                        <p className="text-xs text-yellow-500/80 uppercase tracking-wider font-semibold mb-1">Paper Notes</p>
                        <p className="text-sm text-white/70 italic text-pretty">"{paper.notes}"</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-white/30 text-center py-8 text-sm">No papers linked to this experiment.</p>
            )}
          </div>
        </div>

        {/* Experiment Notebook Content */}

        <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col md:col-span-2">
          <div className="p-4 border-b border-white/5 flex justify-between items-center">
            <h3 className="text-white font-medium flex items-center gap-2">
              <FileText size={18} className="text-green-400" />
              Experiment Notebook
            </h3>
          </div>
          <div className="p-6">
            <div className="prose prose-invert max-w-none">
              {/* 
                  TODO: Render Rich Text JSON properly. 
                  For now we attempt to display it, or if it's JSON, show a placeholder.
                  Since we don't have the Tiptap renderer here, we might just show raw text if simple,
                  or a message.
                */}
              {(metadata.content && metadata.content !== "") ? (
                <pre className="whitespace-pre-wrap font-mono text-xs text-white/70 bg-black/40 p-4 rounded-lg overflow-x-auto">
                  {(() => {
                    if (!metadata.content) return null;
                    try {
                      if (metadata.content.trim().startsWith('{')) {
                        const json = JSON.parse(metadata.content);
                        const extractText = (node: any): string => {
                          if (!node) return '';
                          if (Array.isArray(node)) return node.map(extractText).join('');
                          if (node.type === 'text' && node.text) return node.text;
                          if (node.content) {
                            const childText = extractText(node.content);
                            if (['paragraph', 'heading', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)) {
                              return childText + '\n\n';
                            }
                            return childText;
                          }
                          return '';
                        };
                        const text = extractText(json);
                        return text || "Empty notebook.";
                      }
                      return metadata.content;
                    } catch (e) {
                      return metadata.content;
                    }
                  })()}
                </pre>
              ) : (
                <p className="text-white/30 text-center py-8 text-sm">No notebook content.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
