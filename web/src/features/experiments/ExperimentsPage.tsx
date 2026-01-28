/**
 * Experiments Page - The notebook for your experimental work
 * Each experiment has a rich text editor where you can write notes and @mention samples, equipment, and papers
 */
import React, { useState } from 'react';
import { experimentsApi, Experiment } from '../../lib/api';
import { FlaskConical, Plus, Calendar } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NotebookEditor } from '../notebooks/components/NotebookEditor';

export const ExperimentsPage: React.FC = () => {
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: experiments = [] } = useQuery({
    queryKey: ['experiments'],
    queryFn: experimentsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      experimentsApi.create(data),
    onSuccess: (newExperiment) => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setSelectedExperiment(newExperiment);
      setShowCreateModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      experimentsApi.update(id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });

  const handleContentChange = (content: string) => {
    if (selectedExperiment) {
      updateMutation.mutate({ id: selectedExperiment.id, content });
    }
  };

  return (
    <div className="flex h-full bg-gray-50">
      {/* Sidebar - Experiments list */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold flex items-center gap-2">
              <FlaskConical size={20} />
              Experiments
            </h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Create experiment"
            >
              <Plus size={18} />
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Your laboratory notebooks
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {experiments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FlaskConical size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No experiments yet</p>
              <p className="text-xs mt-1">Create your first experiment</p>
            </div>
          ) : (
            experiments.map((exp) => (
              <button
                key={exp.id}
                onClick={() => setSelectedExperiment(exp)}
                className={`w-full p-3 text-left border-b hover:bg-gray-50 transition-colors ${
                  selectedExperiment?.id === exp.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <h3 className="font-medium text-sm line-clamp-2 mb-1">
                  {exp.name}
                </h3>
                {exp.description && (
                  <p className="text-xs text-gray-600 line-clamp-1 mb-1">
                    {exp.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Calendar size={12} />
                  <span>{new Date(exp.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content - Experiment notebook */}
      <div className="flex-1 flex flex-col">
        {selectedExperiment ? (
          <>
            <div className="bg-white border-b p-6">
              <h1 className="text-2xl font-bold mb-2">{selectedExperiment.name}</h1>
              {selectedExperiment.description && (
                <p className="text-gray-600 text-sm">{selectedExperiment.description}</p>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              <NotebookEditor
                initialContent={selectedExperiment.content || ''}
                onSave={handleContentChange}
                experimentId={selectedExperiment.id}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <FlaskConical size={64} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">Select an experiment to view your notebook</p>
              <p className="text-sm mt-2">
                Use @mentions to reference samples, equipment, and papers
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create experiment modal */}
      {showCreateModal && (
        <CreateExperimentModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isCreating={createMutation.isPending}
        />
      )}
    </div>
  );
};

interface CreateExperimentModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string }) => void;
  isCreating: boolean;
}

const CreateExperimentModal: React.FC<CreateExperimentModalProps> = ({
  onClose,
  onCreate,
  isCreating,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate({ name: name.trim(), description: description.trim() || undefined });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create New Experiment</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., CRISPR Screen March 2024"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of this experiment..."
              rows={3}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
              disabled={isCreating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
