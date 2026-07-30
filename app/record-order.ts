import type { CatalogRecord } from "./record-catalog";

export function moveRecordId(
  recordIds: readonly string[],
  recordId: string,
  targetIndex: number,
) {
  const currentIndex = recordIds.indexOf(recordId);
  if (currentIndex < 0 || recordIds.length < 2) return [...recordIds];
  const nextIndex = Math.max(
    0,
    Math.min(recordIds.length - 1, Math.round(targetIndex)),
  );
  if (currentIndex === nextIndex) return [...recordIds];
  const next = [...recordIds];
  next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, recordId);
  return next;
}

export function sameRecordOrder(
  left: readonly string[],
  right: readonly string[],
) {
  return (
    left.length === right.length &&
    left.every((recordId, index) => recordId === right[index])
  );
}

export function orderRecordsById(
  records: readonly CatalogRecord[],
  recordIds: readonly string[],
) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = recordIds.flatMap((recordId) => {
    const record = byId.get(recordId);
    if (!record) return [];
    byId.delete(recordId);
    return [record];
  });
  return [...ordered, ...byId.values()];
}
