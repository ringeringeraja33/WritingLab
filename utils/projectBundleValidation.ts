export function normalizeProjectBundleRelativePath(value: string): string {
    const raw = value.trim().replace(/\\/g, '/');
    if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.includes('\0')) {
        throw new Error(`Unsafe project bundle path: ${value}`);
    }
    const parts = raw.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Unsafe project bundle path: ${value}`);
    }
    return parts.join('/');
}

export function isRootProjectManifest(relativePath: string, content: string): boolean {
    return !relativePath.includes('/')
        && /\.md$/i.test(relativePath)
        && /^---[\s\S]*?type:\s*(?:storyline|narrative-lab)\b/m.test(content);
}

const PROJECT_RECOVERY_MARKERS = new Set([
    'board.json',
    'characters.json',
    'library-categories.json',
    'plotgrid.json',
    'plotlines.json',
    'stats.json',
    'timeline.json',
]);

/**
 * Recognize a project manifest whose YAML header was removed while keeping
 * the user's document body intact. Recovery requires at least two independent
 * NarrativeLab System markers and an unambiguous Markdown file at the project
 * root, so an ordinary folder named System is never promoted by name alone.
 */
export function isRecoverableProjectManifestPath(
    candidatePath: string,
    knownPaths: readonly string[],
): boolean {
    const normalize = (path: string): string => path
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
    const candidate = normalize(candidatePath);
    if (!candidate.endsWith('.md') || !candidate.includes('/')) return false;
    const parent = candidate.slice(0, candidate.lastIndexOf('/'));
    const folderName = parent.slice(parent.lastIndexOf('/') + 1);
    const basename = candidate.slice(candidate.lastIndexOf('/') + 1, -3);
    const paths = knownPaths.map(normalize);
    const rootMarkdown = paths.filter(path =>
        path.endsWith('.md') && path.slice(0, path.lastIndexOf('/')) === parent);
    const markerPrefix = `${parent}/system/`;
    const markerCount = new Set(paths
        .filter(path => path.startsWith(markerPrefix))
        .map(path => path.slice(markerPrefix.length))
        .filter(name => !name.includes('/') && PROJECT_RECOVERY_MARKERS.has(name))).size;
    return markerCount >= 2 && (basename === folderName || rootMarkdown.length === 1);
}
