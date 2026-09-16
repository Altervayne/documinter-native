/*
 * Shared binder constants with no storage dependency, so both the pure mappers and the filesystem
 * backend can name the root without pulling in a backend module.
 */

/** The binder root's folder id: the parent id of every top-level document and folder. */
export const ROOT_FOLDER_ID = '0'
