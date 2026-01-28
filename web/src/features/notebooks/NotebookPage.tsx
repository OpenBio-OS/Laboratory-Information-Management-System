/**
 * Laboratory Notebook Page
 * Main interface for viewing and editing experiment notebooks
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notebooksApi, experimentsApi, Notebook } from '../../lib/api';
import { NotebookEditor } from './components/NotebookEditor';
import { BookOpen, Plus, Save, FileText } from 'lucide-react';

export const NotebookPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [showExperimentList, setShowExperimentList] = useState(false);
  const [editorContent, setEditorContent] = useState('');

  // Fetch experiments
  const { data: experiments = [] } = useQuery({
    queryKey: ['experiments'],
    queryFn: experimentsApi.list,
  });

  // Fetch notebooks
  const { data: notebooks = [], isLoading } = useQuery({
    queryKey: ['notebooks'],
    queryFn: notebooksApi.list,
  });

  // Create notebook mutation
  const createNotebookMutation = useMutation({
    mutationFn: (experimentId: string) =>
      notebooksApi.create({
        experimentId,
        title: 'New Laboratory Notebook',
        description: 'Document your experimental procedures and observations',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    },
  });

  // Update notebook mutation
  const updateNotebookMutation = useMutation({
    mutationFn: (data: { id: string; content: string }) =>
      notebooksApi.update(data.id, { content: data.content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    },
  });

  // Create mention mutation
  const createMentionMutation = useMutation({
    mutationFn: (data: {
      notebookId: string;
      entityType: string;
      entityId: string;
      snapshotData: string;
    }) => notebooksApi.createMention(data.notebookId, data),
  });

  // Load selected notebook content
  useEffect(() => {
    if (selectedNotebook) {
      setEditorContent(selectedNotebook.content || '');
    }
  }, [selectedNotebook]);

  const handleSave = () => {
    if (selectedNotebook) {
      updateNotebookMutation.mutate({
        id: selectedNotebook.id,
        content: editorContent,
      });
    }
  };

  const handleMention = (entityType: string, entityId: string, metadata: any) => {
    if (selectedNotebook) {
      createMentionMutation.mutate({
        notebookId: selectedNotebook.id,
        entityType,
        entityId,
        snapshotData: JSON.stringify(metadata || {}),
      });
    }
  };

  const handleCreateNotebook = (experimentId: string) => {
    createNotebookMutation.mutate(experimentId);
    setShowExperimentList(false);
  };

  // Find experiments without notebooks
  const experimentsWithoutNotebooks = experiments.filter(
    (exp) => !notebooks.some((nb) => nb.experimentId === exp.id)
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading notebooks...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-50">
      {/* Sidebar - Notebook List */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BookOpen size={20} />
              Lab Notebooks
            </h2>
            <button
              onClick={() => setShowExperimentList(!showExperimentList)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Create New Notebook"
            >
              <Plus size={20} />
            </button>
          </div>

          {/* Create notebook dropdown */}
          {showExperimentList && (
            <div className="mt-2 border rounded-lg p-2 bg-gray-50">
              <p className="text-xs text-gray-600 mb-2">
                Select an experiment to create a notebook:
              </p>
              {experimentsWithoutNotebooks.length === 0 ? (
                <p className="text-sm text-gray-500">
                  All experiments have notebooks
                </p>
              ) : (
                <div className="space-y-1">
                  {experimentsWithoutNotebooks.map((exp) => (
                    <button
                      key={exp.id}
                      onClick={() => handleCreateNotebook(exp.id)}
                      className="w-full text-left p-2 text-sm hover:bg-white rounded border border-transparent hover:border-gray-200"
                    >
                      {exp.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {notebooks.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <FileText size={48} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No notebooks yet</p>
              <p className="text-xs mt-1">Create an experiment first</p>
            </div>
          ) : (
            <div className="divide-y">
              {notebooks.map((notebook) => {
                const experiment = experiments.find(
                  (e) => e.id === notebook.experimentId
                );
                return (
                  <button
                    key={notebook.id}
                    onClick={() => setSelectedNotebook(notebook)}
                    className={`
                      w-full p-4 text-left hover:bg-gray-50 transition-colors
                      ${selectedNotebook?.id === notebook.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}
                    `}
                  >
                    <div className="font-medium text-sm">{notebook.title}</div>
                    {experiment && (
                      <div className="text-xs text-gray-500 mt-1">
                        Experiment: {experiment.name}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Updated {new Date(notebook.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        {selectedNotebook ? (
          <>
            <div className="bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">{selectedNotebook.title}</h1>
                {selectedNotebook.description && (
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedNotebook.description}
                  </p>
                )}
              </div>
              <button
                onClick={handleSave}
                disabled={updateNotebookMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Save size={18} />
                {updateNotebookMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <NotebookEditor
                content={editorContent}
                onChange={setEditorContent}
                onMention={handleMention}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <BookOpen size={64} className="mx-auto mb-4" />
              <p className="text-lg">Select a notebook to start editing</p>
              <p className="text-sm mt-2">
                or create a new one for your experiment
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
