import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Paper,
  Library,
  libraryApi,
  collectionsApi,
  getApiBaseUrl,
} from "../../lib/api";
import { useNavigation } from "../../App";
import { Plus, Search, X, Pin, ExternalLink, FileText, ChevronDown, Check, Trash, Upload, AlertTriangle, Trash2 } from "lucide-react";
import { RichTextEditor } from "../../components/editor/RichTextEditor";

// Portal-based dropdown that escapes modal overflow
interface CollectionSelectProps {
  value: string;
  onChange: (value: string) => void;
  collections: Library[];
}

function CollectionSelect({ value, onChange, collections }: CollectionSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const selectedCollection = collections.find((c) => c.id === value);

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-2.5 bg-black/30 border rounded-lg text-sm text-left transition-all hover:border-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 ${!value ? "border-red-500/50" : "border-white/10"}`}
      >
        <span className="flex items-center gap-2">
          {selectedCollection ? (
            <>
              <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: selectedCollection.color || "#17b978" }} />
              <span className="text-white">{selectedCollection.name}</span>
            </>
          ) : (
            <span className="text-white/50">Select collection (Required)</span>
          )}
        </span>
        <ChevronDown size={16} className={`text-white/40 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] py-1 bg-neutral-900 border border-white/20 rounded-lg shadow-2xl max-h-64 overflow-auto"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => handleSelect(collection.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${value === collection.id ? "bg-brand-primary/15 text-brand-primary" : "text-white/70 hover:bg-white/5"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: collection.color || "#17b978" }} />
                  {collection.name}
                </span>
                {value === collection.id && <Check size={14} className="text-brand-primary" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}


interface AddPaperModalProps {
  onClose: () => void;
  onAdd: (paper: Partial<Paper>) => void;
  collections: Library[];
}

function AddPaperModal({ onClose, onAdd, collections }: AddPaperModalProps) {
  const [doi, setDoi] = useState("");
  const [isLooking, setIsLooking] = useState(false);
  const [lookupSuccess, setLookupSuccess] = useState(false);

  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [journal, setJournal] = useState("");
  const [year, setYear] = useState("");
  const [url, setUrl] = useState("");

  // Default to first collection if available, or empty string
  const [collectionId, setCollectionId] = useState(collections.length > 0 ? collections[0].id : "");

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleDoiLookup = async () => {
    if (!doi.trim()) return;
    setIsLooking(true);
    setLookupSuccess(false);
    try {
      const result = await libraryApi.lookupDoi(doi.trim());
      if (result.title) {
        setTitle(result.title);
        if (result.authors) setAuthors(result.authors);
        if (result.journal) setJournal(result.journal);
        if (result.year) setYear(result.year.toString());
        if (result.url) setUrl(result.url);
        setLookupSuccess(true);
      }
    } catch (err) {
      console.error("DOI lookup failed:", err);
    } finally {
      setIsLooking(false);
    }
  };

  const handleSubmit = () => {
    if (!title.trim() || !collectionId) return;
    onAdd({
      title: title.trim(),
      authors: authors.trim() || undefined,
      journal: journal.trim() || undefined,
      year: year ? parseInt(year) : undefined,
      url: url.trim() || undefined,
      doi: doi.trim() || undefined,
      libraryId: collectionId,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h2 className="text-lg font-semibold text-white">Add Paper</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[65vh] space-y-5">
          {/* DOI Autofill Section - Optional, at top */}
          <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/80">Quick Add via DOI</label>
              <span className="text-xs text-white/40">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={doi}
                onChange={(e) => { setDoi(e.target.value); setLookupSuccess(false); }}
                placeholder="e.g., 10.1038/nature12373"
                className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                onKeyDown={(e) => e.key === 'Enter' && handleDoiLookup()}
              />
              <button
                onClick={handleDoiLookup}
                disabled={isLooking || !doi.trim()}
                className="px-4 py-2 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLooking ? "..." : "Autofill"}
              </button>
            </div>
            {lookupSuccess && (
              <div className="flex items-center gap-2 text-sm text-brand-primary">
                <Check size={14} />
                <span>Fields auto-filled from DOI</span>
              </div>
            )}
          </div>

          {/* Divider with "or" */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/40 uppercase tracking-wider">Paper Details</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Paper title"
                className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Authors</label>
              <input
                type="text"
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="John Doe, Jane Smith"
                className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Journal</label>
                <input
                  type="text"
                  value={journal}
                  onChange={(e) => setJournal(e.target.value)}
                  placeholder="Nature"
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2024"
                  className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                />
              </div>
            </div>

            <div className="relative">
              <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Collection</label>
              <CollectionSelect
                value={collectionId}
                onChange={setCollectionId}
                collections={collections}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !collectionId}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Paper
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeleteCollectionModalProps {
  onClose: () => void;
  onConfirm: () => void;
  collectionName: string;
  paperCount: number;
}

function DeleteCollectionModal({ onClose, onConfirm, collectionName, paperCount }: DeleteCollectionModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const isValid = confirmText.toLowerCase() === "delete";

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleConfirm = () => {
    if (isValid) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-red-500/20 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">Delete Collection</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200">
              <strong>Warning:</strong> This will permanently delete the collection and all {paperCount} paper{paperCount !== 1 ? 's' : ''} inside it, including their PDFs. This action cannot be undone.
            </p>
            <p className="text-sm text-white font-semibold mt-2">{collectionName}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">delete</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete Collection & Papers
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeletePaperModalProps {
  onClose: () => void;
  onConfirm: () => void;
  paperTitle: string;
}

function DeletePaperModal({ onClose, onConfirm, paperTitle }: DeletePaperModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const isValid = confirmText.toLowerCase() === "delete";

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleConfirm = () => {
    if (isValid) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-red-500/20 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">Delete Paper</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200">
              <strong>Warning:</strong> This action cannot be undone. This will permanently delete:
            </p>
            <p className="text-sm text-white font-semibold mt-2 line-clamp-2">{paperTitle}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">delete</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete Paper
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreateCollectionModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; color?: string }) => void;
}

function CreateCollectionModal({ onClose, onCreate }: CreateCollectionModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#17b978");

  const colors = ["#17b978", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#eab308"];

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), description: description.trim() || undefined, color });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-white/10 rounded-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h2 className="text-lg font-semibold text-white">New Collection</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Thesis Papers"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Color</label>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent hover:scale-105"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function LibraryPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [collections, setCollections] = useState<Library[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteCollectionModal, setShowDeleteCollectionModal] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<Library | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const { pendingItemId, clearPendingItem } = useNavigation();

  // Auto-select paper when navigating from experiment mention
  useEffect(() => {
    if (pendingItemId && papers.length > 0) {
      const paper = papers.find(p => p.id === pendingItemId);
      if (paper) {
        setSelectedPaper(paper);
        // If paper is in a collection, select that collection too
        if (paper.libraryId) {
          setSelectedCollection(paper.libraryId);
        }
      }
      clearPendingItem();
    }
  }, [pendingItemId, papers, clearPendingItem]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPaper) return;

    // Use a loading state or toast in production
    try {
      // Optimistic update if needed, but here we wait for server response
      const updatedPaper = await libraryApi.uploadPdf(selectedPaper.id, file);

      // Update local state
      const updateData = (p: Paper) => p.id === updatedPaper.id ? updatedPaper : p;
      setPapers(prev => prev.map(updateData));
      setSelectedPaper(updatedPaper);

      alert("PDF uploaded successfully");
    } catch (err) {
      console.error("Failed to upload PDF", err);
      alert("Failed to upload PDF");
    } finally {
      // clear input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [papersData, collectionsData] = await Promise.all([
        libraryApi.list(),
        collectionsApi.list(),
      ]);
      setPapers(papersData);
      setCollections(collectionsData);
    } catch (err) {
      console.error("Failed to load library data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleAddPaper = async (data: Partial<Paper>) => {
    try {
      const newPaper = await libraryApi.create(data);
      setPapers((prev) => [newPaper, ...prev]);
    } catch (err) {
      console.error("Failed to add paper:", err);
    }
  };

  const handleCreateCollection = async (data: { name: string; description?: string; color?: string }) => {
    try {
      const newCollection = await collectionsApi.create(data);
      setCollections((prev) => [...prev, newCollection]);
    } catch (err) {
      console.error("Failed to create collection:", err);
    }
  };

  const handleTogglePin = async (id: string, isPinned: boolean) => {
    try {
      const updated = await libraryApi.update(id, { is_pinned: isPinned });
      setPapers((prev) => prev.map((p) => (p.id === id ? { ...p, isPinned: updated.isPinned } : p)));
      if (selectedPaper?.id === id) {
        setSelectedPaper({ ...selectedPaper, isPinned: updated.isPinned });
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleDeleteCollectionClick = (collection: Library) => {
    setCollectionToDelete(collection);
    setShowDeleteCollectionModal(true);
  };

  const handleDeleteCollection = async () => {
    if (!collectionToDelete) return;

    try {
      await collectionsApi.delete(collectionToDelete.id);
      // Remove papers from local state that were in this collection
      setPapers((prev) => prev.filter((p) => p.libraryId !== collectionToDelete.id));
      setCollections((prev) => prev.filter((c) => c.id !== collectionToDelete.id));
      if (selectedCollection === collectionToDelete.id) setSelectedCollection(null);
      setShowDeleteCollectionModal(false);
      setCollectionToDelete(null);
    } catch (err) {
      console.error("Failed to delete collection:", err);
      alert(`Failed to delete collection: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredPapers = papers.filter((paper) => {
    // Strict isolation: "Unfiled" view shows only papers with NO libraryId.
    const matchesCollection = selectedCollection === null
      ? !paper.libraryId
      : paper.libraryId === selectedCollection;
    const matchesSearch = searchQuery === "" ||
      paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      paper.authors?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCollection && matchesSearch;
  });

  const sortedPapers = [...filteredPapers].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // View mode: 'list' or 'detail'
  const viewMode = selectedPaper ? 'detail' : 'list';

  // Get current collection name for breadcrumb
  const currentCollectionName = selectedCollection
    ? collections.find(c => c.id === selectedCollection)?.name
    : 'Collections';

  // Handle notes update with auto-save (debounced)
  const handleNotesChange = async (newContent: string) => {
    if (!selectedPaper) return;

    // Optimistic update - immediately update UI
    setSelectedPaper({ ...selectedPaper, notes: newContent });
    setPapers(prev => prev.map(p => p.id === selectedPaper.id ? { ...p, notes: newContent } : p));

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce the actual save - wait 800ms after user stops typing
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await libraryApi.update(selectedPaper.id, { notes: newContent });
      } catch (err) {
        console.error("Failed to save notes:", err);
      }
    }, 800);
  };

  const handleDeletePaper = async () => {
    if (!selectedPaper) return;

    try {
      await libraryApi.delete(selectedPaper.id);
      setPapers(prev => prev.filter(p => p.id !== selectedPaper.id));
      setSelectedPaper(null);
      setShowDeleteModal(false);
    } catch (err) {
      console.error("Failed to delete paper:", err);
      alert(`Failed to delete paper: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Ensure local state matches server state
      loadData();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with Breadcrumbs */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-surface/30 backdrop-blur-md flex-shrink-0">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setSelectedPaper(null); setSelectedCollection(null); }}
            className={`transition-colors ${viewMode === 'list' && !selectedCollection ? 'text-white font-medium' : 'text-white/50 hover:text-white'}`}
          >
            All
          </button>

          {selectedCollection && (
            <>
              <span className="text-white/30">/</span>
              <button
                onClick={() => setSelectedPaper(null)}
                className={`transition-colors ${viewMode === 'list' ? 'text-white font-medium' : 'text-white/50 hover:text-white'}`}
              >
                {currentCollectionName}
              </button>
            </>
          )}

          {selectedPaper && (
            <>
              <span className="text-white/30">/</span>
              <span className="text-white font-medium truncate max-w-md">{selectedPaper.title}</span>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {viewMode === 'list' && (
            <>
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 w-4 h-4 group-focus-within:text-brand-primary transition-colors" />
                <input
                  type="text"
                  placeholder="Search papers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 w-64 transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                disabled={collections.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
                title={collections.length === 0 ? "Create a collection first" : ""}
              >
                <Plus size={16} />
                Add Paper
              </button>
            </>
          )}

          {/* Action buttons for Detail View */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="application/pdf"
            onChange={handleFileChange}
          />

          {selectedPaper && (
            <div className="flex items-center gap-2">
              {selectedPaper.pdfPath ? (
                <a
                  href={`${getApiBaseUrl()}/api/library/${selectedPaper.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border border-green-500/20 rounded-lg text-sm font-medium transition-colors"
                >
                  <FileText size={16} />
                  View PDF
                </a>
              ) : (
                <button
                  onClick={handleUploadClick}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 border border-gray-500/20 rounded-lg text-sm font-medium transition-colors"
                >
                  <Upload size={16} />
                  Upload PDF
                </button>
              )}

              {/* Always allow re-upload if needed */}
              {selectedPaper.pdfPath && (
                <button
                  onClick={handleUploadClick}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="Replace PDF"
                >
                  <Upload size={16} />
                </button>
              )}

              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm font-medium transition-colors"
                title="Permanently delete paper"
              >
                <Trash size={16} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Conditional Rendering */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        {viewMode === 'list' ? (
          <>
            {/* Sidebar */}
            <div className="w-64 bg-black/20 border-r border-white/5 overflow-y-auto flex-shrink-0">
              <div className="space-y-1">
                {/* Unfiled papers view hidden */}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 px-4 pt-4">
                  <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Collections</span>
                  <button
                    onClick={() => setShowCollectionModal(true)}
                    className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-brand-primary hover:bg-brand-primary/10 rounded transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                  </div>
                ) : collections.length === 0 ? (
                  <div className="text-sm mx-4 text-white/30 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
                    No collections yet.
                    <br />
                    <button
                      onClick={() => setShowCollectionModal(true)}
                      className="text-brand-primary hover:underline mt-1"
                    >
                      Add Collection
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {collections.map((collection) => (
                      <div key={collection.id} className="group flex items-center ml-2.5 mr-4">
                        <button
                          onClick={() => setSelectedCollection(collection.id)}
                          className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${selectedCollection === collection.id ? "bg-brand-primary/20 text-brand-primary" : "text-white/70 hover:bg-white/5"}`}
                        >
                          <div className="w-3 h-3 rounded" style={{ backgroundColor: collection.color || "#17b978" }} />
                          <span className="flex-1 text-left truncate">{collection.name}</span>
                          <span className="text-xs text-white/40 mr-2">{papers.filter((p) => p.libraryId === collection.id).length}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCollectionClick(collection)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 transition-all ml-3"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Papers List */}
            <div className="flex-1 overflow-auto p-6">
              {selectedCollection === null ? (
                <div className="flex flex-col items-center pt-16 text-white/30">
                  <div className="w-16 h-16 mb-4 rounded-xl bg-white/5 flex items-center justify-center">
                    <FileText size={32} className="opacity-50" />
                  </div>
                  <p className="text-lg font-medium">Select a collection</p>
                  <p className="text-sm">Choose a collection from the sidebar to view papers</p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                    </div>
                  ) : sortedPapers.length === 0 ? (
                    <div className="text-center py-24">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-white/5 flex items-center justify-center">
                        <FileText size={32} className="text-white/20" />
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-2">No papers yet</h3>
                      <p className="text-white/40 text-sm mb-6">Add your first paper to get started</p>
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors"
                      >
                        <Plus size={16} />
                        Add Paper
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedPapers.map((paper) => (
                        <div
                          key={paper.id}
                          onClick={() => setSelectedPaper(paper)}
                          className="bg-surface/50 hover:bg-neutral-900/80 border border-white/10 hover:border-brand-primary/30 rounded-xl p-5 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start gap-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // handleTogglePin(paper.id, !paper.isPinned);
                              }}
                              // className={`mt-1 transition-colors ${paper.isPinned ? "text-brand-primary" : "text-white/20 hover:text-white/50"}`}
                              className={`mt-1 transition-colors ${paper.isPinned ? "text-brand-primary" : "text-white/20"}`}
                            >
                              <Pin size={16} className={paper.isPinned ? "fill-current" : ""} />
                            </button>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-base font-semibold text-white mb-1 line-clamp-2">{paper.title}</h3>
                              {paper.authors && (
                                <p className="text-sm text-white/60 mb-2 line-clamp-1">{paper.authors}</p>
                              )}
                              <div className="flex items-center gap-3 text-xs text-white/40">
                                {paper.journal && <span className="px-2 py-0.5 bg-white/5 rounded">{paper.journal}</span>}
                                {paper.year && <span>{paper.year}</span>}
                                {paper.doi && (
                                  <a
                                    href={`https://doi.org/${paper.doi}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-brand-primary hover:underline flex items-center gap-1"
                                  >
                                    DOI <ExternalLink size={10} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Full-width Paper Detail View */
          <div className="flex-1 flex flex-col">
            {/* Paper Header */}
            <div className="px-8 pt-8 pb-2">
              <div className="flex items-start gap-4">
                <button
                  onClick={() => handleTogglePin(selectedPaper!.id, !selectedPaper!.isPinned)}
                  className={`p-2 rounded-lg transition-colors ${selectedPaper!.isPinned ? "text-brand-primary bg-brand-primary/10" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`}
                >
                  <Pin size={20} className={selectedPaper!.isPinned ? "fill-current" : ""} />
                </button>
                <div className="flex-1">
                  <h1 className="text-2xl font-bold text-white mb-3 leading-tight">{selectedPaper!.title}</h1>
                  {selectedPaper!.authors && (
                    <p className="text-lg text-white/70 mb-4">{selectedPaper!.authors}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-white/50">
                    {selectedPaper!.journal && (
                      <span className="px-3 py-1 bg-white/5 rounded-lg">{selectedPaper!.journal}</span>
                    )}
                    {selectedPaper!.year && <span>{selectedPaper!.year}</span>}
                    {selectedPaper!.doi && (
                      <a
                        href={`https://doi.org/${selectedPaper!.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-brand-primary hover:underline"
                      >
                        View on DOI <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Notes Editor */}
            <div className="flex-1 overflow-auto px-8 py-6">
              <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4">Notes</h2>
              <RichTextEditor
                content={selectedPaper!.notes || ""}
                onChange={handleNotesChange}
              />
            </div>

            {/* Back Button */}
            <div className="px-8 pb-8 pt-4">
              <div className="pt-6 border-t border-white/10">
                <button
                  onClick={() => setSelectedPaper(null)}
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  ← Back to papers
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddPaperModal onClose={() => setShowAddModal(false)} onAdd={handleAddPaper} collections={collections} />
      )}
      {showCollectionModal && (
        <CreateCollectionModal onClose={() => setShowCollectionModal(false)} onCreate={handleCreateCollection} />
      )}
      {showDeleteModal && selectedPaper && (
        <DeletePaperModal
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDeletePaper}
          paperTitle={selectedPaper.title}
        />
      )}
      {showDeleteCollectionModal && collectionToDelete && (
        <DeleteCollectionModal
          onClose={() => {
            setShowDeleteCollectionModal(false);
            setCollectionToDelete(null);
          }}
          onConfirm={handleDeleteCollection}
          collectionName={collectionToDelete.name}
          paperCount={papers.filter((p) => p.libraryId === collectionToDelete.id).length}
        />
      )}
    </div>
  );
}
