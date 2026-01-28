/**
 * Library Page - Your research paper bookshelf
 * Manage papers you've read with your own notes and comments
 */
import React, { useState } from 'react';
import { libraryApi, Paper } from '../../lib/api';
import { SquareLibrary, Plus, BookOpen, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export const LibraryPage: React.FC = () => {
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);

  const { data: papers = [] } = useQuery({
    queryKey: ['papers'],
    queryFn: libraryApi.list,
  });

  return (
    <div className="flex h-full bg-gray-50">
      {/* Sidebar - Paper list */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold flex items-center gap-2">
              <SquareLibrary size={20} />
              Library
            </h2>
            <button
              onClick={() => alert('Add paper functionality coming soon')}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Add paper"
            >
              <Plus size={18} />
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Your research paper bookshelf
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {papers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <BookOpen size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No papers yet</p>
              <p className="text-xs mt-1">Add papers you've read</p>
            </div>
          ) : (
            papers.map((paper) => (
              <button
                key={paper.id}
                onClick={() => setSelectedPaper(paper)}
                className={`w-full p-3 text-left border-b hover:bg-gray-50 transition-colors ${
                  selectedPaper?.id === paper.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <h3 className="font-medium text-sm line-clamp-2 mb-1">
                  {paper.title}
                </h3>
                {paper.authors && (
                  <p className="text-xs text-gray-600 mb-1">{paper.authors}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {paper.year && <span>{paper.year}</span>}
                  {paper.journal && <span>• {paper.journal}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content - Paper details */}
      <div className="flex-1 flex flex-col">
        {selectedPaper ? (
          <>
            <div className="bg-white border-b p-6">
              <h1 className="text-2xl font-bold mb-3">{selectedPaper.title}</h1>
              {selectedPaper.authors && (
                <p className="text-gray-700 mb-2">{selectedPaper.authors}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-gray-600">
                {selectedPaper.journal && <span>{selectedPaper.journal}</span>}
                {selectedPaper.year && <span>({selectedPaper.year})</span>}
                {selectedPaper.doi && (
                  <a
                    href={`https://doi.org/${selectedPaper.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    DOI <ExternalLink size={14} />
                  </a>
                )}
                {selectedPaper.url && (
                  <a
                    href={selectedPaper.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    Link <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {selectedPaper.abstract && (
                <div>
                  <h3 className="font-semibold mb-2">Abstract</h3>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    {selectedPaper.abstract}
                  </p>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-2">My Notes</h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  {selectedPaper.notes ? (
                    <p className="text-sm whitespace-pre-wrap">{selectedPaper.notes}</p>
                  ) : (
                    <p className="text-sm text-gray-500 italic">
                      No notes yet. Add your thoughts about this paper.
                    </p>
                  )}
                </div>
              </div>

              {selectedPaper.tags && (
                <div>
                  <h3 className="font-semibold mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {JSON.parse(selectedPaper.tags || '[]').map((tag: string, i: number) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <BookOpen size={64} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">Select a paper to view details</p>
              <p className="text-sm mt-2">
                Papers can be @mentioned in experiments for reference
              </p>
            </div>
          </div>
        )}
      </div>

      {/* TODO: Add modal for creating/editing papers */}
    </div>
  );
};
