"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CatalogRecord } from "./record-catalog";
import {
  moveRecordId,
  orderRecordsById,
  sameRecordOrder,
} from "./record-order";

type RearrangeLibraryProps = {
  open: boolean;
  records: CatalogRecord[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (recordIds: string[]) => Promise<void>;
};

type DragState = {
  recordId: string;
  pointerId: number;
};

function positionLabel(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function RearrangeLibrary({
  open,
  records,
  saving,
  error,
  onCancel,
  onSave,
}: RearrangeLibraryProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const sourceOrder = useMemo(
    () => records.map((record) => record.id),
    [records],
  );
  const [draftOrder, setDraftOrder] = useState(sourceOrder);
  const [draggedRecordId, setDraggedRecordId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDraftOrder(sourceOrder);
      setDraggedRecordId(null);
      dragRef.current = null;
      setAnnouncement("");
    });
    const focusTimer = window.setTimeout(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-rearrange-handle]")
        ?.focus();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [open, sourceOrder]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const clearPointerDrag = () => {
      dragRef.current = null;
      setDraggedRecordId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", clearPointerDrag);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", clearPointerDrag);
    };
  }, [onCancel, open, saving]);

  if (!open) return null;

  const draftRecords = orderRecordsById(records, draftOrder);
  const dirty = !sameRecordOrder(sourceOrder, draftOrder);

  const announceMove = (recordId: string, targetIndex: number) => {
    const record = records.find((candidate) => candidate.id === recordId);
    setAnnouncement(
      `${record?.title ?? "Record"} moved to position ${targetIndex + 1}.`,
    );
  };

  const moveRecord = (recordId: string, targetIndex: number) => {
    const next = moveRecordId(draftOrder, recordId, targetIndex);
    if (sameRecordOrder(draftOrder, next)) return;
    setDraftOrder(next);
    announceMove(recordId, next.indexOf(recordId));
  };

  const beginPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    recordId: string,
  ) => {
    if (saving || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { recordId, pointerId: event.pointerId };
    setDraggedRecordId(recordId);
  };

  const continuePointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !list) return;
    const target = Array.from(
      list.querySelectorAll<HTMLElement>("[data-rearrange-id]"),
    ).find((card) => {
      const bounds = card.getBoundingClientRect();
      return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    const targetId = target?.dataset.rearrangeId;
    if (!target || !targetId || targetId === drag.recordId) return;
    const currentIndex = draftOrder.indexOf(drag.recordId);
    const targetIndex = draftOrder.indexOf(targetId);
    if (currentIndex < 0 || targetIndex < 0) return;
    const bounds = target.getBoundingClientRect();
    const insertionIndex =
      event.clientY > bounds.top + bounds.height * 0.5
        ? targetIndex + 1
        : targetIndex;
    const nextIndex =
      currentIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
    moveRecord(drag.recordId, nextIndex);
  };

  const finishPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraggedRecordId(null);
  };

  const handleDragKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    recordId: string,
  ) => {
    const currentIndex = draftOrder.indexOf(recordId);
    if (currentIndex < 0) return;
    const targetIndex =
      event.key === "ArrowUp"
        ? currentIndex - 1
        : event.key === "ArrowDown"
          ? currentIndex + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? draftOrder.length - 1
              : null;
    if (targetIndex === null) return;
    event.preventDefault();
    moveRecord(recordId, targetIndex);
  };

  return (
    <div className="rearrange-library" data-testid="rearrange-library">
      <button
        type="button"
        className="rearrange-library__backdrop"
        aria-label="Cancel rearranging records"
        tabIndex={-1}
        disabled={saving}
        onClick={onCancel}
      />
      <section
        ref={dialogRef}
        className="rearrange-library__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rearrange-library-title"
        aria-describedby="rearrange-library-description"
      >
        <header className="rearrange-library__heading">
          <div>
            <p className="eyebrow">Collection order</p>
            <h2 id="rearrange-library-title">Rearrange the shelf</h2>
          </div>
          <button
            type="button"
            className="rearrange-library__close"
            aria-label="Cancel rearranging records"
            disabled={saving}
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <p
          id="rearrange-library-description"
          className="rearrange-library__intro"
        >
          Drag a handle, use the arrow keys, or use the move buttons. The shelf
          changes only after you save.
        </p>

        <ol ref={listRef} className="rearrange-library__list">
          {draftRecords.map((record, index) => {
            const isDragging = draggedRecordId === record.id;
            const coverStyle = {
              "--rearrange-sleeve": record.sleeveColor,
              ...(record.coverImage
                ? {
                    backgroundImage: `url(${JSON.stringify(
                      record.coverImage,
                    )})`,
                  }
                : {}),
            } as CSSProperties;
            return (
              <li
                key={record.id}
                className={isDragging ? "is-dragging" : ""}
                data-rearrange-id={record.id}
              >
                <button
                  type="button"
                  className="rearrange-library__handle"
                  data-rearrange-handle
                  aria-label={`Move ${record.title}. Current position ${
                    index + 1
                  } of ${records.length}.`}
                  disabled={saving}
                  onKeyDown={(event) => handleDragKey(event, record.id)}
                  onPointerDown={(event) =>
                    beginPointerDrag(event, record.id)
                  }
                  onPointerMove={continuePointerDrag}
                  onPointerUp={finishPointerDrag}
                  onPointerCancel={finishPointerDrag}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <span className="rearrange-library__position" aria-hidden="true">
                  {positionLabel(index)}
                </span>
                <span
                  className={`rearrange-library__cover ${
                    record.coverImage ? "has-image" : ""
                  }`}
                  style={coverStyle}
                  aria-hidden="true"
                >
                  {!record.coverImage ? record.shortTitle.slice(0, 1) : null}
                </span>
                <span className="rearrange-library__record">
                  <strong>{record.title}</strong>
                  <small>{record.artist}</small>
                </span>
                <span className="rearrange-library__moves">
                  <button
                    type="button"
                    aria-label={`Move ${record.title} up`}
                    disabled={saving || index === 0}
                    onClick={() => moveRecord(record.id, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${record.title} down`}
                    disabled={saving || index === records.length - 1}
                    onClick={() => moveRecord(record.id, index + 1)}
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>

        {error ? (
          <p className="rearrange-library__error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <footer className="rearrange-library__footer">
          <span>
            {records.length} {records.length === 1 ? "record" : "records"}
          </span>
          <div>
            <button
              type="button"
              className="rearrange-library__cancel"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rearrange-library__save"
              data-testid="save-record-order"
              disabled={saving || !dirty}
              onClick={() => void onSave(draftOrder)}
            >
              {saving ? "Saving…" : "Save order"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
