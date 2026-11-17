import { memo, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PanelHead } from "@/components/PanelHead";
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
        className="relative block aspect-[240/135] w-full overflow-hidden rounded-[var(--r-ctl)] border border-[var(--line)] bg-[var(--bg-sunk)] transition-colors hover:border-[var(--line-strong)]"
      >
        {item.thumb ? (
          <img src={item.thumb} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <span className="readout flex size-full items-center justify-center text-[10px] text-[var(--dim)]">NO PREVIEW</span>
        )}
        {item.isGif && (
          <span className="readout absolute top-1 left-1 rounded-[2px] bg-black/80 px-1 text-[9px] tracking-wide text-[var(--text)]">
            GIF
          </span>
        )}
      </button>
      <div className="mt-1.5 truncate text-[11.5px] font-[550] text-[var(--text)]">{item.name}</div>
      <div className="readout truncate text-[10px] text-[var(--dim)]">{item.isGif ? "GIF" : "IMG"} · {formatAgo(item.lastUsedAt)}</div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[240/135] items-end justify-center gap-1 rounded-[var(--r-ctl)] bg-black/70 p-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <button type="button" onClick={() => onUse("slot0")} className="keycap px-2 py-0.5 text-[10px]">
          Slot 0
        </button>
        <button type="button" onClick={() => onUse("slot1")} className="keycap px-2 py-0.5 text-[10px]">
          Slot 1
        </button>
        <button
          type="button"
          onClick={() => void remove(item.id)}
          aria-label={`Remove ${item.name} from library`}
          className="keycap-dark keycap-danger px-2 py-0.5 text-[10px]"
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
    <section className="panel flex flex-col gap-3 p-4 min-[900px]:col-span-2" aria-labelledby="display-library">
      <PanelHead n={3} title="Library" id="display-library" className="mb-0">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search library"
            className="h-8 w-44 rounded-[var(--r-ctl)] border border-[var(--line)] bg-[var(--bg-sunk)] px-2.5 text-xs text-[var(--text)] placeholder:text-[var(--dim)]"
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
      </PanelHead>

      {library.length === 0 ? (
        <p className="rounded-[var(--r-panel)] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
          No images yet.
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
      <p className="readout text-[11px] text-[var(--dim)]">
        {library.length} / {MAX_ITEMS} items · {formatBytes(total)} / {formatBytes(MAX_BYTES)}
      </p>
    </section>
  );
}

export const MediaLibraryPanel = memo(MediaLibraryPanelImpl);
