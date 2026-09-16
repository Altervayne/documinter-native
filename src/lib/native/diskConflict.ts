/*
 * The pure classifier for an open tab against the document's current on-disk record. An external edit or
 * deletion to a file that is open in a tab is reconciled by comparing the disk record's updatedAt to the
 * timestamp the tab last synced to. Dependency-free (no React, no backend) so it stays unit-testable.
 */

import type { BinderDocumentRecord, SaveStatus } from '../../types'

/** The slice of an open tab the classifier reads: its binding, the disk version it synced to, and whether
 *  it carries unsaved edits. */
export interface TabConflictState {
   documentId:      string | null
   syncedUpdatedAt: string | null
   saveStatus:      SaveStatus
}

/**
 * How an open tab stands against the document's current on-disk record:
 *  - `none`     the tab is a scratch (unbound), or already in sync with disk.
 *  - `deleted`  the tab is bound but the file is gone.
 *  - `reload`   disk is newer and the tab is clean, so it can adopt the disk version.
 *  - `conflict` disk is newer and the tab has unsaved edits, so the user must choose.
 * ISO 8601 timestamps compare correctly as strings, so a plain string compare orders the versions.
 */
export function classifyDiskChange(
   tab: TabConflictState,
   diskRecord: BinderDocumentRecord | null,
): 'none' | 'reload' | 'conflict' | 'deleted' {
   if (tab.documentId === null) return 'none'
   if (diskRecord === null) return 'deleted'
   // In sync (or disk is not ahead): an equal or older disk stamp means nothing external landed.
   if (tab.syncedUpdatedAt !== null && diskRecord.updatedAt <= tab.syncedUpdatedAt) return 'none'
   const dirty = tab.saveStatus === 'dirty' || tab.saveStatus === 'saving'
   return dirty ? 'conflict' : 'reload'
}
