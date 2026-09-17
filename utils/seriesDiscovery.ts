import { deriveProjectFoldersFromFilePath } from '../models/StoryLineProject';

export interface DiscoveredSeriesProject {
    filePath: string;
    title: string;
    seriesId?: string;
}

function normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isWithin(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
}

/** A live series marker may sit below any user-created folder name. */
export function isDiscoverableSeriesMetadataPath(path: string, configDir = '.obsidian'): boolean {
    const normalized = normalize(path);
    if (!normalized || normalized.split('/').includes('.trash')) return false;
    const normalizedConfig = normalize(configDir);
    if (normalizedConfig && isWithin(normalized.toLowerCase(), normalizedConfig.toLowerCase())) return false;
    const lower = normalized.toLowerCase();
    return lower.endsWith('/series.json') || lower === 'series.json';
}

/**
 * Keep the saved order, then expose direct child projects omitted by stale
 * series metadata. This is intentionally read-only; a later explicit reorder
 * or rename can persist the repaired list through the normal guarded writer.
 */
export function mergeDiscoveredSeriesBookOrder(
    seriesFolder: string,
    bookOrder: readonly string[],
    projects: readonly DiscoveredSeriesProject[],
): string[] {
    const normalizedSeriesFolder = normalize(seriesFolder).toLowerCase();
    const existing = new Set(bookOrder.map(name => name.trim().toLowerCase()).filter(Boolean));
    const missing = new Set<string>();

    for (const project of projects) {
        if (!project.seriesId) continue;
        const projectFolder = normalize(deriveProjectFoldersFromFilePath(project.filePath).baseFolder);
        const separator = projectFolder.lastIndexOf('/');
        const parent = separator >= 0 ? projectFolder.slice(0, separator) : '';
        if (parent.toLowerCase() !== normalizedSeriesFolder) continue;
        const folderName = projectFolder.slice(separator + 1);
        if (!folderName) continue;
        const knownByFolder = existing.has(folderName.toLowerCase());
        const knownByTitle = existing.has(project.title.trim().toLowerCase());
        if (knownByFolder || knownByTitle) continue;
        existing.add(folderName.toLowerCase());
        missing.add(folderName);
    }

    return [...bookOrder, ...[...missing].sort((a, b) => a.localeCompare(b))];
}
