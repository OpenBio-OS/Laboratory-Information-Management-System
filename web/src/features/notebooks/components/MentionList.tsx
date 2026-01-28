/**
 * Mention suggestion list component for @mentions
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export interface MentionItem {
  id: string;
  label: string;
  type: 'sample' | 'equipment' | 'paper';
  metadata?: any;
}

export interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export const MentionList = forwardRef((props: MentionListProps, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler();
        return true;
      }

      if (event.key === 'ArrowDown') {
        downHandler();
        return true;
      }

      if (event.key === 'Enter') {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="bg-white border rounded-lg shadow-lg p-2 text-sm text-gray-500">
        No results
      </div>
    );
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'sample': return 'bg-blue-100 text-blue-700';
      case 'equipment': return 'bg-purple-100 text-purple-700';
      case 'paper': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="bg-white border rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
      {props.items.map((item, index) => (
        <button
          className={`
            w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 transition-colors
            ${index === selectedIndex ? 'bg-gray-100' : ''}
          `}
          key={item.id}
          onClick={() => selectItem(index)}
        >
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(item.type)}`}>
            {item.type}
          </span>
          <span className="text-sm font-medium text-gray-900">{item.label}</span>
          {item.metadata && (
            <span className="text-xs text-gray-500 ml-auto">
              {item.type === 'sample' && item.metadata.type}
              {item.type === 'equipment' && item.metadata.model}
              {item.type === 'paper' && item.metadata.year}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = 'MentionList';
