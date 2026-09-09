import { FileView, MarkdownView, TFile, TFolder, normalizePath } from 'obsidian';
import type SceneCardsPlugin from '../main';
import { FolderWritingScope, type FolderScopeConfig } from './FolderWritingScope';
import { WritingTracker, type WritingTrackerData } from './WritingTracker';
import { WRITING_TRACKER_PANEL_TYPE, WRITING_TRACKER_VIEW_TYPE } from '../constants';
import { t } from '../utils/i18n';

/** Opt-in, vault-local folder scopes. Never creates anything in the source folder. */
export class FolderWritingTracker {
    current: FolderWritingScope | null = null;
    private scopes = new Map<string, FolderWritingScope>();
    private readyScopes = new Set<FolderWritingScope>();
    private indexing = new Map<FolderWritingScope, Promise<void>>();
    private scopeErrors = new Map<FolderWritingScope, string>();
    private pendingReads = new Map<string, object>();
    private operationError = '';
    private entries: FolderScopeConfig[] = [];
    private loaded = false;
    private invalid = false;
    private recovered = false;
    private stopped = false;
    private loadTask: Promise<void> | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private writes: Promise<void> = Promise.resolve();
    private saveTimer: number | null = null;
    private refreshTimer: number | null = null;
    constructor(private plugin: SceneCardsPlugin) {}
    get savedScopes(): readonly FolderScopeConfig[] { return this.entries.filter(entry => entry.enabled !== false); }
    get ready(): boolean { return !!this.current && this.readyScopes.has(this.current); }
    get busy(): boolean { return !!this.current && this.indexing.has(this.current); }
    get error(): string { return (this.current && this.scopeErrors.get(this.current)) || this.operationError; }
    private get path(): string {
        return normalizePath(`${this.plugin.manifest.dir || `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/folder-writing-tracker.json`);
    }
    initialize(): void {
        const { workspace, vault } = this.plugin.app;
        // One event adapter; no folder scans until a scope has been configured.
        this.plugin.registerEvent(workspace.on('editor-change', (editor, info) => {
            const path = info.file?.path;
            if (this.stopped || !path) return;
            const scopes = [...this.scopes.values()].filter(scope => scope.accepts(path));
            if (!scopes.length) return;
            // Invalidate older asynchronous disk reads before applying this edit.
            this.pendingReads.delete(path);
            const text = editor.getValue();
            for (const scope of scopes) scope.setText(path, text, true);
            this.scheduleSave(); this.notify();
        }));
        this.plugin.registerEvent(workspace.on('file-open', () => this.syncActivity()));
        this.plugin.registerEvent(workspace.on('layout-change', () => this.syncActivity()));
        this.plugin.registerEvent(vault.on('modify', file => {
            if (file instanceof TFile) void this.readInventory(file).catch(error => this.fail(error));
        }));
        this.plugin.registerEvent(vault.on('create', file => {
            if (file instanceof TFile) {
                if (file.stat?.size === 0) for (const scope of this.scopes.values()) scope.setText(file.path, '', false);
                void this.readInventory(file).catch(error => this.fail(error));
            } else if (file instanceof TFolder) this.reconcileScopes(file.path);
        }));
        this.plugin.registerEvent(vault.on('delete', file => {
            for (const scope of this.scopes.values()) {
                for (const path of [...scope.texts.keys()]) {
                    if (path === file.path || path.startsWith(file.path + '/')) scope.remove(path);
                }
                if (scope.config.path === file.path || scope.config.path.startsWith(file.path + '/')) {
                    this.readyScopes.delete(scope);
                    this.scopeErrors.set(scope, t('The tracked folder is unavailable. Its history was kept.'));
                }
            }
            this.syncActivity(); this.scheduleSave(); this.notify();
        }));
        this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
            for (const entry of this.entries) {
                if (entry.path === oldPath || entry.path.startsWith(oldPath + '/')) {
                    entry.path = file.path + entry.path.slice(oldPath.length);
                }
            }
            for (const scope of this.scopes.values()) {
                if (scope.config.path === oldPath || scope.config.path.startsWith(oldPath + '/')) {
                    scope.config.path = file.path + scope.config.path.slice(oldPath.length);
                }
                for (const path of [...scope.texts.keys()]) {
                    if (path !== oldPath && !path.startsWith(oldPath + '/')) continue;
                    const text = scope.texts.get(path)!;
                    scope.remove(path);
                    scope.setText(file.path + path.slice(oldPath.length), text, false);
                }
            }
            if (file instanceof TFile) void this.readInventory(file).catch(error => this.fail(error));
            else if (file instanceof TFolder) this.reconcileScopes(file.path);
            this.syncActivity(); this.scheduleSave(); this.notify();
        }));
        workspace.onLayoutReady(() => {
            // Do not hold up workspace restoration for folder indexing.
            window.setTimeout(() => { if (!this.stopped) void this.load().catch(error => this.fail(error)); }, 0);
        });
        const checkpoint = window.setInterval(() => {
            if ([...this.scopes.values()].some(scope => scope.tracker.isSprintRunning())) this.scheduleSave();
        }, 30_000);
        this.plugin.register(() => {
            this.stopped = true;
            window.clearInterval(checkpoint);
            if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
            if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
            for (const scope of this.scopes.values()) scope.tracker.setProjectFilesOpen(false);
            if (this.loaded && !this.invalid && this.entries.length) void this.save().catch(error => console.error('[WritingLab] Folder stats save failed', error));
        });
    }
    private fail(error: unknown): void {
        this.operationError = String(error); this.notify();
        console.error('[WritingLab] Folder statistics:', error);
    }
    private load(): Promise<void> {
        if (this.loadTask) return this.loadTask;
        return this.loadTask = this.loadNow();
    }
    private async loadNow(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        let found = false;
        let selected = '';
        for (const path of [this.path + '.tmp', this.path, this.path + '.bak']) {
            if (!await adapter.exists(path)) continue;
            found = true;
            try {
                const parsed: unknown = JSON.parse(await adapter.read(path));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid folder statistics');
                const data = parsed as { version?: unknown; scopes?: unknown; selected?: unknown };
                if (data.version !== 1 || !Array.isArray(data.scopes)) throw new Error('Invalid folder statistics');
                const scopes: FolderScopeConfig[] = data.scopes.map((raw: unknown) => {
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid folder scope');
                    const entry = raw as Record<string, unknown>;
                    if (typeof entry.id !== 'string' || typeof entry.path !== 'string' || !entry.path
                        || entry.path.split('/').includes('..') || typeof entry.recursive !== 'boolean'
                        || (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')
                        || !entry.tracker || typeof entry.tracker !== 'object' || Array.isArray(entry.tracker)) throw new Error('Invalid folder scope');
                    const tracker = entry.tracker as Record<string, unknown>;
                    if (!tracker.history || typeof tracker.history !== 'object'
                        || Array.isArray(tracker.history)
                        || Object.values(tracker.history).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid folder scope');
                    const restored = new WritingTracker();
                    restored.importData(entry.tracker as WritingTrackerData);
                    return {
                        id: entry.id,
                        path: entry.path,
                        recursive: entry.recursive,
                        locale: typeof entry.locale === 'string' && entry.locale ? entry.locale : 'auto',
                        tracker: restored.exportData(),
                        enabled: entry.enabled !== false,
                        ...(typeof entry.totalWords === 'number' ? { totalWords: entry.totalWords } : {}),
                        ...(typeof entry.sprintInventoryTotal === 'number' ? { sprintInventoryTotal: entry.sprintInventoryTotal } : {}),
                    };
                });
                this.entries = scopes;
                selected = typeof data.selected === 'string' ? data.selected : '';
                this.loaded = true; this.recovered = path !== this.path; break;
            } catch (error) { console.warn('[WritingLab] Folder statistics recovery:', path, error); }
        }
        if (!this.loaded) {
            this.invalid = found; this.loaded = !found;
            if (found) throw new Error(t('Folder statistics could not be read. Existing records were kept.'));
        }
        if (this.stopped) return;
        // Restore every tracked scope, including when no statistics view is open.
        for (const entry of this.savedScopes) this.createScope(entry);
        this.current = this.scopes.get(selected) || null;
        const scopes = [...this.scopes.values()];
        if (this.current) scopes.sort((a, b) => Number(b === this.current) - Number(a === this.current));
        for (const scope of scopes) {
            if (this.stopped) return;
            await this.indexScope(scope);
        }
    }
    async select(path: string, recursive = true): Promise<void> {
        await this.load();
        if (this.invalid) throw new Error(t('Folder statistics could not be read. Existing records were kept.'));
        const normalized = normalizePath(path);
        const listed = this.savedScopes.some(item => item.path === normalized && item.recursive === recursive);
        if (!listed && !(this.plugin.app.vault.getAbstractFileByPath(normalized) instanceof TFolder)) throw new Error(t('Choose an existing folder in this vault.'));
        // Serialize choices: a slow previous scan cannot overwrite a newer target.
        const task = this.queue.catch(() => undefined).then(async () => {
            if (this.stopped) return;
            this.operationError = '';
            let entry = this.entries.find(item => item.path === normalized && item.recursive === recursive);
            if (!entry) {
                entry = { id: crypto.randomUUID(), path: normalized, recursive, locale: 'auto', tracker: { history: {} } };
                this.entries.push(entry);
            }
            entry.enabled = true;
            this.current = this.scopes.get(entry.id) || this.createScope(entry);
            // Selecting a ready scope changes only the displayed statistics.
            if (!this.ready) await this.indexScope(this.current);
            this.notify();
            await this.save();
        });
        this.queue = task;
        return task;
    }
    async stop(): Promise<void> {
        const id = this.current?.config.id;
        await this.load();
        const task = this.queue.catch(() => undefined).then(async () => {
            const scope = id ? this.scopes.get(id) : null;
            if (!scope) return;
            scope.tracker.stopSprint(scope.totalWords);
            scope.tracker.setProjectFilesOpen(false);
            // Keep the ledger for re-adding this scope, but remove it from the
            // recording list. Other scopes and their sessions are unchanged.
            this.entries = this.entries.map(entry => entry.id === id ? { ...scope.snapshot(), enabled: false } : entry);
            this.scopes.delete(scope.config.id);
            this.readyScopes.delete(scope); this.scopeErrors.delete(scope);
            if (this.current === scope) this.current = this.scopes.values().next().value || null;
            await this.save(); this.notify();
        });
        this.queue = task; return task;
    }
    private createScope(entry: FolderScopeConfig): FolderWritingScope {
        const scope = new FolderWritingScope({ ...entry }, {
            excludeComments: this.plugin.settings.excludeCommentsFromWordcount !== false,
            excludeChecklists: this.plugin.settings.excludeChecklistFromWordcount === true,
        });
        scope.tracker.setSprintDuration(Math.max(1, this.plugin.settings.sprintDurationMinutes || 25) * 60_000);
        scope.tracker.startSession(0, false);
        this.scopes.set(entry.id, scope);
        return scope;
    }
    private indexScope(scope: FolderWritingScope): Promise<void> {
        const existing = this.indexing.get(scope);
        if (existing) return existing;
        const task = this.indexScopeNow(scope);
        this.indexing.set(scope, task);
        this.notify();
        return task;
    }
    private async indexScopeNow(scope: FolderWritingScope): Promise<void> {
        try {
            await this.reconcileInventory(scope);
            if (this.stopped || this.scopes.get(scope.config.id) !== scope) return;
            this.readyScopes.add(scope); this.scopeErrors.delete(scope); this.syncActivity();
        } catch (error) {
            this.readyScopes.delete(scope); this.scopeErrors.set(scope, String(error));
        } finally { this.indexing.delete(scope); this.notify(); }
    }
    private reconcileScopes(path: string): void {
        for (const scope of this.scopes.values()) {
            const root = scope.config.path;
            if (root === path || root.startsWith(path + '/')
                || (scope.config.recursive && (root === '/' || path.startsWith(root + '/')))) {
                void this.indexScope(scope);
            }
        }
    }
    private async reconcileInventory(scope: FolderWritingScope): Promise<void> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(scope.config.path);
        if (!(folder instanceof TFolder)) throw new Error(t('The tracked folder is unavailable. Its history was kept.'));
        const folders = [folder]; let processed = 0;
        for (let index = 0; index < folders.length; index++) {
            for (const child of folders[index].children) {
                if (this.stopped || this.scopes.get(scope.config.id) !== scope) return;
                if (child instanceof TFolder && scope.config.recursive && !child.name.startsWith('.')) folders.push(child);
                // A shared file is read once and delivered to all matching scopes.
                if (child instanceof TFile && scope.accepts(child.path) && !scope.texts.has(child.path)) await this.readInventory(child);
                if (++processed % 16 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
            }
        }
    }
    private editorText(path: string): string | undefined {
        let text: string | undefined;
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) text = leaf.view.editor.getValue();
        });
        return text;
    }
    private async readInventory(file: TFile): Promise<void> {
        const path = file.path;
        const scopes = [...this.scopes.values()].filter(scope => scope.accepts(path));
        if (!scopes.length || this.stopped) return;
        const token = {};
        this.pendingReads.set(path, token);
        try {
            const raw = await this.plugin.app.vault.cachedRead(file);
            if (this.stopped || this.pendingReads.get(path) !== token || file.path !== path
                || this.plugin.app.vault.getAbstractFileByPath(path) !== file) return;
            const editor = this.editorText(path);
            // A save can arrive before editor-change. Do not consume that edit as inventory.
            for (const scope of scopes) {
                if (this.scopes.get(scope.config.id) === scope) scope.setText(path, editor ?? raw, editor !== undefined);
            }
            this.scheduleSave();
            this.notify();
        } catch (error) {
            // A failed read must never turn an existing file's count into zero.
            if (scopes.some(scope => !this.readyScopes.has(scope))) throw error;
            this.fail(error);
        } finally { if (this.pendingReads.get(path) === token) this.pendingReads.delete(path); }
    }
    syncActivity(): void {
        if (this.stopped || !this.scopes.size) return;
        const paths: string[] = [];
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof FileView && leaf.view.file) paths.push(leaf.view.file.path);
        });
        for (const scope of this.scopes.values()) {
            const open = this.readyScopes.has(scope) && paths.some(path => scope.accepts(path));
            if (scope.tracker.setProjectFilesOpen(open)) { this.scheduleSave(); this.notify(); }
        }
    }
    scheduleSave(): void {
        if (this.stopped || !this.loaded || this.invalid) return;
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.save().catch(error => this.fail(error));
        }, 600);
    }
    async save(): Promise<void> {
        if (!this.loaded || this.invalid) return;
        this.entries = this.entries.map(entry => this.scopes.get(entry.id)?.snapshot() || entry);
        const payload = JSON.stringify({ version: 1, selected: this.current?.config.id || '', scopes: this.entries }, null, 2);
        const task = this.writes.catch(() => undefined).then(async () => {
            const adapter = this.plugin.app.vault.adapter;
            await adapter.write(this.path + '.tmp', payload);
            if (!this.recovered && await adapter.exists(this.path)) await adapter.write(this.path + '.bak', await adapter.read(this.path));
            await adapter.write(this.path, payload);
            await adapter.remove(this.path + '.tmp');
            this.recovered = false;
        });
        this.writes = task; return task;
    }
    private notify(): void {
        if (this.stopped || this.refreshTimer !== null) return;
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            for (const type of [WRITING_TRACKER_PANEL_TYPE, WRITING_TRACKER_VIEW_TYPE]) {
                for (const leaf of this.plugin.app.workspace.getLeavesOfType(type)) (leaf.view as {refresh?: () => void}).refresh?.();
            }
        }, 250);
    }
}
