import { memo, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAgo, formatBytes, searchItems, totalBytes, MAX_ITEMS, MAX_BYTES, type LibraryItem } from "@/lib/mediaLibrary";
import { useAppStore, type Slot } from "@/store";

export const LIBRARY_DRAG_TYPE = "application/x-gmk87-library";

function LibraryTile({ item, onUse }: { item: LibraryItem; onUse: (slot?: Slot) => void }) {
  const remove = useAppStore((s) => s.libraryRemove);
  return (
    <li className="group relative" data-testid="library-item">
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(LIBRARY_DRAG_TYPE, item.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onUse()}
        title={`${item.name}\nUsed ${item.useCount}× · last ${formatAgo(item.lastUsedAt)}`}
        aria-label={`Use ${item.name}`}
        className="relative block aspect-[240/135] w-full overflow-hidden rounded-[10px] border border-[var(--line)] bg-black transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {item.thumb ? (
          <img src={item.thumb} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-[10px] text-white/50">no preview</span>
        )}
        {item.isGif && (
          <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] font-semibold tracking-wide text-white">
            GIF
          </span>
        )}
      </button>
      <div className="mt-1 truncate text-[11px] text-[var(--text)]">{item.name}</div>
      <div className="truncate text-[10px] text-[var(--muted)]">{formatAgo(item.lastUsedAt)}</div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[240/135] items-end justify-center gap-1 rounded-[10px] bg-black/55 p-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <button type="button" onClick={() => onUse("slot0")} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-black hover:bg-white">
          Slot 0
        </button>
        <button type="button" onClick={() => onUse("slot1")} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-black hover:bg-white">
          Slot 1
        </button>
        <button
          type="button"
          onClick={() => void remove(item.id)}
          aria-label={`Remove ${item.name} from library`}
          className="rounded bg-[var(--danger)]/90 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[var(--danger)]"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function MediaLibraryPanelImpl() {
  const library = useAppStore((s) => s.library);
  const loadLibrary = useAppStore((s) => s.loadLibrary);
  const libraryUse = useAppStore((s) => s.libraryUse);
  const libraryClear = useAppStore((s) => s.libraryClear);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const shown = useMemo(() => searchItems(library, query), [library, query]);
  const total = totalBytes(library);

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4 lg:col-span-2" aria-labelledby="display-library">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="display-library" className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Library · recent images & GIFs
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search library"
            className="h-8 w-44 rounded-[8px] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 text-xs text-[var(--text)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
          {library.length > 0 &&
            (confirmClear ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setConfirmClear(false);
                    void libraryClear();
                  }}
                >
                  Confirm clear
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClear(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)}>
                Clear library
              </Button>
            ))}
        </div>
      </div>

      {library.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
          Nothing here yet. Images and GIFs you add are remembered here so you can switch between them in one click.
        </p>
      ) : shown.length === 0 ? (
        <p className="p-4 text-center text-xs text-[var(--muted)]">No library items match “{query}”.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
          {shown.map((item) => (
            <LibraryTile key={item.id} item={item} onUse={(slot) => void libraryUse(item.id, slot)} />
          ))}
        </ul>
      )}
      <p className="text-[11px] text-[var(--muted)]">
        {library.length} / {MAX_ITEMS} items · {formatBytes(total)} of {formatBytes(MAX_BYTES)} · least-recently-used items are dropped first
        (never one assigned to a slot). Click to load into the selected slot, or drag onto a slot tab.
      </p>
    </section>
  );
}

export const MediaLibraryPanel = memo(MediaLibraryPanelImpl);
