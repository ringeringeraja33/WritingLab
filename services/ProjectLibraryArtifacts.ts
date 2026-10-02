import { normalizePath, TFile, type App } from 'obsidian';
import { ensureVaultFolder, isTombstonedProjectPath } from '../utils/vaultFolders';

const relocationLocks = new WeakMap<App, Map<string, Promise<boolean>>>();

/** Move an explicitly owned artifact without replacing a local file or rewriting its contents. */
export async function relocateProjectLibraryArtifact(app: App, sourcePath: string, targetPath: string): Promise<boolean> {
    const source = normalizePath(sourcePath);
    const target = normalizePath(targetPath);
    if (source === target || isTombstonedProjectPath(target)) return false;
    let locks = relocationLocks.get(app);
    if (!locks) {
        locks = new Map();
        relocationLocks.set(app, locks);
    }
    while (locks.has(target)) await locks.get(target);
    const pending = (async () => {
        const adapter = app.vault.adapter;
        if (await adapter.exists(target) || !await adapter.exists(source)) return false;
        const file = app.vault.getAbstractFileByPath(source);
        if (file && !(file instanceof TFile)) return false;
        if (!file && (await adapter.stat(source))?.type !== 'file') return false;
        await ensureVaultFolder(app, target.slice(0, target.lastIndexOf('/')));
        if (isTombstonedProjectPath(target) || await adapter.exists(target)) return false;
        if (file instanceof TFile) {
            await app.fileManager.renameFile(file, target);
        } else {
            // Sync can put a file on disk before it reaches the vault index.
            await adapter.rename(source, target);
        }
        return true;
    })();
    locks.set(target, pending);
    try {
        return await pending;
    } finally {
        if (locks.get(target) === pending) locks.delete(target);
    }
}
