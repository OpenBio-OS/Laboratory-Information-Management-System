import { useMemo } from 'react';
// Wait, I should check if @/lib/utils exists. Standard shadcn/ui setup usually has it.

interface BoxGridProps {
  rows?: number;
  cols?: number;
  samples?: Array<{
    id: string;
    slotPosition: string | null;
    name: string;
    // Add other sample fields as needed
  }>;
  selectedSlot?: string | null;
  onSlotClick?: (slot: string) => void;
  className?: string;
}

export function BoxGrid({
  rows = 9,
  cols = 9,
  samples = [],
  selectedSlot = null,
  onSlotClick,
  className
}: BoxGridProps) {

  // Generate grid slots
  const grid = useMemo(() => {
    const slots = [];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (let r = 0; r < rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const slotId = `${letters[r]}${c}`;
        const sample = samples.find(s => s.slotPosition === slotId);
        slots.push({ id: slotId, sample });
      }
    }
    return slots;
  }, [rows, cols, samples]);

  return (
    <div
      className={`grid gap-1 p-4 bg-black/40 rounded-xl border border-white/10 w-fit ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(40px, 1fr))` }}
    >
      {grid.map(({ id, sample }) => (
        <button
          key={id}
          onClick={() => onSlotClick?.(id)}
          className={`
            aspect-square rounded-md flex items-center justify-center text-xs relative group transition-all duration-200
            ${sample
              ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/50 hover:bg-brand-primary/30'
              : selectedSlot === id
                ? 'bg-brand-primary/30 text-white border border-brand-primary hover:bg-brand-primary/40'
                : 'bg-white/5 text-white/20 border border-transparent hover:bg-white/10 hover:border-white/10'
            }
          `}
          title={sample ? `${id}: ${sample.name}` : id}
        >
          <span className="z-10">{sample ? '' : id}</span>

          {sample && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-brand-primary shadow-[0_0_5px_currentColor]" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
