import { useState, useMemo } from 'react';
import { Search, Download, ChevronUp, ChevronDown } from 'lucide-react';

interface TableViewProps {
  data: any[];
  title?: string;
  onDownload?: () => void;
}

export function TableView({ data, title, onDownload }: TableViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Extract columns from datakeys
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).map(key => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
    }));
  }, [data]);

  // Filter and sort data
  const processedData = useMemo(() => {
    let result = [...data];

    // Filter
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(row =>
        Object.values(row).some(val =>
          String(val).toLowerCase().includes(lowerSearch)
        )
      );
    }

    // Sort
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];

        if (aVal === bVal) return 0;

        const comparison = aVal < bVal ? -1 : 1;
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [data, searchTerm, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="flex flex-col bg-neutral-900/30 rounded-2xl border border-white/5 mx-4">
      {/* Table Controls */}
      <div className="p-4 border border-white/5 rounded-t-2xl bg-white/5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-white font-semibold">{title || 'Data Table'}</h3>
          <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-white/40 font-mono">
            {processedData.length} rows
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
            <input
              type="text"
              placeholder="Search results..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-brand-primary/50 transition-all placeholder:text-white/20"
            />
          </div>

          <button
            onClick={onDownload}
            className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
            title="Download CSV"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Table Area */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#1a1a1a]">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => requestSort(col.key)}
                  className="px-4 py-3 text-[11px] font-bold text-white/40 uppercase tracking-wider cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {col.label}
                    <div className="flex flex-col">
                      <ChevronUp size={10} className={sortConfig?.key === col.key && sortConfig.direction === 'asc' ? 'text-brand-primary' : 'text-white/10'} />
                      <ChevronDown size={10} className={sortConfig?.key === col.key && sortConfig.direction === 'desc' ? 'text-brand-primary' : 'text-white/10'} />
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {processedData.map((row, idx) => (
              <tr key={idx} className="hover:bg-white/5 transition-colors group">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-2.5 text-sm text-white/80 font-mono">
                    {typeof row[col.key] === 'number'
                      ? row[col.key].toFixed(4)
                      : String(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {processedData.length === 0 && (
          <div className="p-12 text-center text-white/20 italic">
            No matching rows found
          </div>
        )}
      </div>
    </div>
  );
}
