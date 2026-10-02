import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalizePath = value => String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const bundle = await build({
    stdin: { contents: `export * from './services/ProjectLibraryArtifacts'; export * from './services/ProjectDocumentBase'; export * from './utils/vaultFolders'; export { deriveProjectFoldersFromFilePath } from './models/StoryLineProject'; export { TFile } from 'obsidian';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm',
    plugins: [{ name: 'host', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
        b.onResolve({ filter: /utils\/i18n$/ }, () => ({ path: 'i18n', namespace: 'host' }));
        b.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: path === 'obsidian'
            ? `export const normalizePath = ${normalizePath.toString()}; export class TFile { constructor(path, content) { this.path = path; this.content = content; } }`
            : `export const t = key => key;` }));
    } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const source = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const native = await source('components/NativeLibraryBase.ts');
const main = await source('main.ts');
const series = await source('services/SeriesManager.ts');
const codec = await source('services/PlotGridXlsxCodec.ts');
const nativeFns = await transform(native.slice(native.indexOf('function getProjectBaseFolder('), native.indexOf('/** Legacy pre-rename Library Base:')), { loader: 'ts' });
const nativeApi = new Function('normalizePath', 'deriveProjectFoldersFromFilePath', 'LIBRARY_BASE_PREFIX', 'relocateProjectLibraryArtifact', `${nativeFns.code}; return { getLibraryBasePath, relocateLegacyProjectLibraryBase };`)(normalizePath, api.deriveProjectFoldersFromFilePath, 'library', api.relocateProjectLibraryArtifact);
const codecFns = await transform(codec.slice(codec.indexOf('function sanitizeProjectArtifactName('), codec.indexOf('/** Canonical sidecar:')).replace(/export /g, ''), { loader: 'ts' });
const paths = new Function('PLOTGRID_XLSX_PREFIX', 'PLOTGRID_XLSX_LEGACY_FILENAME', `${codecFns.code}; return { plotGridXlsxPath, legacyPlotGridXlsxPath };`)('datasheet', 'datasheet.xlsx');
const migration = await transform(`class Plugin { ${main.slice(main.indexOf('    async migratePlotGridToLibraryIfNeeded('), main.indexOf('    async loadPlotGrid('))} }`, { loader: 'ts' });
const Plugin = new Function('normalizePath', 'deriveProjectFoldersFromFilePath', 'plotGridXlsxPath', 'legacyPlotGridXlsxPath', 'legacySystemPlotGridXlsxPath', 'legacyPlotGridFolderXlsxPath', 'relocateProjectLibraryArtifact', `${migration.code}; return Plugin;`)(normalizePath, api.deriveProjectFoldersFromFilePath, paths.plotGridXlsxPath, paths.legacyPlotGridXlsxPath, p => `${p}/plotgrid.xlsx`, p => `${p}/PlotGrid/plotgrid.xlsx`, api.relocateProjectLibraryArtifact);

function host() {
    const files = new Map(), unindexed = new Set(), moves = [];
    const addFolder = path => files.set(path, { path });
    const addFile = (path, content = '保留内容') => { const file = new api.TFile(path, content); files.set(path, file); return file; };
    const move = async (from, to) => {
        if (files.has(to)) throw Error('Target exists');
        const file = files.get(from);
        if (!file) throw Error('Source missing');
        files.delete(from); file.path = to; files.set(to, file); moves.push([from, to]);
    };
    const app = {
        vault: {
            getAbstractFileByPath: path => unindexed.has(path) ? null : files.get(path) ?? null,
            createFolder: async path => addFolder(path),
            create: async (path, content) => addFile(path, content),
            adapter: {
                exists: async path => files.has(path),
                stat: async path => files.has(path) ? { type: files.get(path) instanceof api.TFile ? 'file' : 'folder' } : null,
                rename: move,
                readBinary: async path => Buffer.from(files.get(path).content),
                writeBinary: async (path, bytes) => addFile(path, Buffer.from(bytes).toString('utf8')),
                list: async path => {
                    const entries = [...files.keys()].filter(p => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
                    return { files: entries.filter(p => files.get(p) instanceof api.TFile), folders: entries.filter(p => !(files.get(p) instanceof api.TFile)) };
                },
                rmdir: async path => files.delete(path),
            },
        },
        fileManager: { renameFile: async (file, to) => move(file.path, to) },
    };
    return { app, files, moves, addFile, addFolder, unindexed };
}

const project = title => ({ title, filePath: `系列/${title}/${title}.md`, seriesId: '系列' });
const pluginFor = (h, p) => ({ app: h.app, sceneManager: { activeProject: p, getCodexFolder: () => '系列/Library' } });

test('two series members resolve separate local Library Bases, document Bases, and sheets', () => {
    const h = host();
    for (const title of ['第一卷', '第二卷']) {
        const p = project(title);
        assert.equal(nativeApi.getLibraryBasePath(pluginFor(h, p)), `系列/${title}/Library/library-${title}.base`);
        assert.equal(api.projectDocumentBasePath(p), `系列/${title}/Library/writing-${title}.base`);
        assert.equal(paths.plotGridXlsxPath(`系列/${title}`), `系列/${title}/Library/datasheet-${title}.xlsx`);
    }
});

test('named legacy Base relocation preserves contents and leaves shared and sibling Bases alone', async () => {
    const h = host(), p = project('第一卷');
    const original = h.addFile('系列/Library/library-第一卷.base', 'views:\n  - name: 我的视图\n    columnSize: 240\n');
    h.addFile('系列/Library/library-第二卷.base', 'sibling');
    h.addFile('系列/Library/library.base', 'shared');
    const plugin = pluginFor(h, p), destination = nativeApi.getLibraryBasePath(plugin);
    await nativeApi.relocateLegacyProjectLibraryBase(plugin, destination);
    assert.equal(h.files.get(destination), original);
    assert.match(original.content, /我的视图/);
    assert.equal(h.files.get('系列/Library/library-第二卷.base').content, 'sibling');
    assert.equal(h.files.get('系列/Library/library.base').content, 'shared');
    assert.equal(h.moves.length, 1);
});

test('existing local Base wins without deleting or overwriting the legacy file', async () => {
    const h = host(), source = '系列/Library/library-第一卷.base', target = '系列/第一卷/Library/library-第一卷.base';
    h.addFile(source, 'old'); h.addFile(target, 'local');
    assert.equal(await api.relocateProjectLibraryArtifact(h.app, source, target), false);
    assert.equal(h.files.get(source).content, 'old'); assert.equal(h.files.get(target).content, 'local');
    assert.deepEqual(h.moves, []);
});

test('concurrent relocation runs once and supports files not yet indexed', async () => {
    const h = host(), source = '系列/Library/datasheet-第一卷.xlsx', target = '系列/第一卷/Library/datasheet-第一卷.xlsx';
    h.addFile(source); h.unindexed.add(source);
    const results = await Promise.all([api.relocateProjectLibraryArtifact(h.app, source, target), api.relocateProjectLibraryArtifact(h.app, source, target)]);
    assert.deepEqual(results, [true, false]); assert.equal(h.moves.length, 1);
});

test('failed relocation leaves the original file intact and can be retried', async () => {
    const h = host(), from = '系列/Library/library-第一卷.base', to = '系列/第一卷/Library/library-第一卷.base';
    const original = h.addFile(from), rename = h.app.fileManager.renameFile;
    h.app.fileManager.renameFile = async () => { throw Error('Locked file'); };
    await assert.rejects(api.relocateProjectLibraryArtifact(h.app, from, to), /Locked file/);
    assert.equal(h.files.get(from), original); assert.ok(!h.files.has(to));
    h.app.fileManager.renameFile = rename;
    assert.equal(await api.relocateProjectLibraryArtifact(h.app, from, to), true);
});

test('document Base migrates either legacy root name into Library without changing user configuration', async () => {
    for (const name of ['writing.base', 'writing-第一卷.base']) {
        const h = host(), p = project('第一卷');
        const original = h.addFile(`系列/第一卷/${name}`, '我的列与筛选');
        const result = await api.ensureProjectDocumentBase(h.app, p);
        assert.equal(result, original); assert.equal(result.content, '我的列与筛选');
        assert.equal(result.path, '系列/第一卷/Library/writing-第一卷.base');
    }
});

test('new document Base is created in project Library and existing local views are preserved', async () => {
    const h = host(), p = project('第一卷');
    const file = await api.ensureProjectDocumentBase(h.app, p);
    assert.equal(file.path, '系列/第一卷/Library/writing-第一卷.base');
    assert.match(file.content, /file.inFolder\("系列\/第一卷"\)/);
    h.addFile('系列/第一卷/writing.base', 'legacy');
    assert.equal(await api.ensureProjectDocumentBase(h.app, p), file);
    assert.equal(h.files.get('系列/第一卷/writing.base').content, 'legacy');
});

test('sheet migration uses the requested project, keeps sibling and unnamed shared sheets, and never overwrites', async () => {
    for (const hasLocal of [false, true]) {
        const h = host(), projects = [project('第一卷'), project('第二卷')];
        h.addFile('系列/Library/datasheet-第二卷.xlsx', 'second sheet');
        h.addFile('系列/Library/datasheet-第一卷.xlsx', 'first sheet');
        h.addFile('系列/Library/datasheet.xlsx', 'ambiguous shared');
        const target = '系列/第二卷/Library/datasheet-第二卷.xlsx';
        if (hasLocal) h.addFile(target, 'local sheet');
        const plugin = Object.assign(new Plugin(), {
            app: h.app, projectExistsForWrite: async () => true,
            sceneManager: { activeProject: projects[0], getProjects: () => projects, getSeriesFolderForProject: p => p.seriesId ? '系列' : null },
        });
        await plugin.migratePlotGridToLibraryIfNeeded(projects[1].filePath);
        assert.equal(h.files.get(target).content, hasLocal ? 'local sheet' : 'second sheet');
        assert.equal(h.files.has('系列/Library/datasheet-第二卷.xlsx'), hasLocal);
        assert.equal(h.files.get('系列/Library/datasheet-第一卷.xlsx').content, 'first sheet');
        assert.equal(h.files.get('系列/Library/datasheet.xlsx').content, 'ambiguous shared');
    }
});

const transferSource = series.slice(series.indexOf('    private async migrateCodexFolder('), series.indexOf('    private async trashDuplicateLibraryFiles('));
const transfer = await transform(`class Transfer { ${transferSource} }`, { loader: 'ts' });
const Transfer = new Function('normalizePath', 'TFile', 'isProjectScopedLibraryArtifact', 'isUntrackedLibraryNoise', 'createLibraryTransferJournal', 't', `${transfer.code}; return Transfer;`)(normalizePath, api.TFile, api.isProjectScopedLibraryArtifact, api.isUntrackedLibraryNoise, () => ({ movedFiles: [], copiedFiles: [], duplicateFiles: [] }), key => key);

const recoverySource = series.slice(series.indexOf('    private async restoreProjectLibraryArtifacts('), series.indexOf('    /** Prefer the current Library name'));
const recovery = await transform(`class Recovery { ${recoverySource} }`, { loader: 'ts' });
const Recovery = new Function('normalizePath', 'deriveProjectFoldersFromFilePath', 'projectDocumentBasePath', 'relocateProjectLibraryArtifact', 'isProjectScopedLibraryArtifact', `${recovery.code}; return Recovery;`)(normalizePath, api.deriveProjectFoldersFromFilePath, api.projectDocumentBasePath, api.relocateProjectLibraryArtifact, api.isProjectScopedLibraryArtifact);

test('series exit recovers only the departing project and lists unresolved files before series disposal', async () => {
    const h = host(), p = project('第一卷');
    h.addFolder('系列/Library'); h.addFolder('系列/Library/自定义');
    h.addFile('系列/Library/library-第一卷.base', 'my base');
    h.addFile('系列/Library/datasheet-第一卷.xlsx', 'my sheet');
    h.addFile('系列/Library/writing-第一卷.base', 'my document list');
    h.addFile('系列/Library/library-第二卷.base', 'sibling');
    h.addFile('系列/Library/自定义/未分配.sheet', 'unresolved');
    h.addFile('系列/Library/角色.md', 'shared');
    const manager = Object.assign(new Recovery(), { app: h.app });
    await manager.restoreProjectLibraryArtifacts(p, '系列');
    for (const name of ['library-第一卷.base', 'datasheet-第一卷.xlsx', 'writing-第一卷.base']) {
        assert.ok(h.files.has(`系列/第一卷/Library/${name}`)); assert.ok(!h.files.has(`系列/Library/${name}`));
    }
    assert.deepEqual((await manager.listProjectLibraryArtifacts('系列/Library')).sort(), ['系列/Library/library-第二卷.base', '系列/Library/自定义/未分配.sheet'].sort());
    const exitMethod = series.slice(series.indexOf('    async removeProjectFromSeries('), series.indexOf('    async removeMissingProjectReference('));
    assert.ok(exitMethod.indexOf('restoreProjectLibraryArtifacts') < exitMethod.indexOf('await this.moveProjectFolder'));
    const dissolve = series.slice(series.indexOf('    async dissolveSeries('), series.indexOf('    // ── Series discovery'));
    assert.ok(dissolve.indexOf('unresolvedArtifacts.length > 0') < dissolve.indexOf('await this.app.fileManager.trashFile'));
});

test('series recovery preserves both conflicting versions and keeps the conflict visible to the disposal guard', async () => {
    const h = host(); h.addFolder('系列/Library');
    h.addFile('系列/Library/library-第一卷.base', 'older settings');
    h.addFile('系列/第一卷/Library/library-第一卷.base', 'local settings');
    const manager = Object.assign(new Recovery(), { app: h.app });
    await manager.restoreProjectLibraryArtifacts(project('第一卷'), '系列');
    assert.equal(h.files.get('系列/第一卷/Library/library-第一卷.base').content, 'local settings');
    assert.equal(h.files.get('系列/Library/library-第一卷.base').content, 'older settings');
    assert.deepEqual(await manager.listProjectLibraryArtifacts('系列/Library'), ['系列/Library/library-第一卷.base']);
});

test('joining a series retains all project Bases and sheets, including nested custom files', async () => {
    const h = host(), local = '系列/第一卷/Library', shared = '系列/Library';
    h.addFolder(local); h.addFolder(`${local}/自定义`); h.addFolder(shared);
    const artifacts = ['writing-第一卷.base', 'library-第一卷.base', '自定义/我的视图.base', 'datasheet-第一卷.xlsx', '自定义/人物表.sheet', '自定义/预算.xlsx'];
    for (const file of artifacts) h.addFile(`${local}/${file}`, file);
    h.addFile(`${local}/角色.md`, 'shared entity');
    const manager = Object.assign(new Transfer(), { app: h.app, ensureFolder: path => api.ensureVaultFolder(h.app, path) });
    await manager.migrateCodexFolder(local, shared);
    for (const file of artifacts) { assert.equal(h.files.get(`${local}/${file}`).content, file); assert.ok(!h.files.has(`${shared}/${file}`)); }
    assert.equal(h.files.get(`${shared}/角色.md`).content, 'shared entity');
});

test('leaving a series does not copy a sibling Base or sheet into the project', async () => {
    const h = host(), local = '系列/第一卷/Library', shared = '系列/Library';
    h.addFolder(shared); h.addFile(`${shared}/library-第二卷.base`); h.addFile(`${shared}/datasheet-第二卷.xlsx`); h.addFile(`${shared}/角色.md`, 'shared entity');
    const manager = Object.assign(new Transfer(), { app: h.app, ensureFolder: path => api.ensureVaultFolder(h.app, path) });
    await manager.copyFolderRecursive(shared, local);
    assert.equal(h.files.get(`${local}/角色.md`).content, 'shared entity');
    assert.ok(!h.files.has(`${local}/library-第二卷.base`)); assert.ok(!h.files.has(`${local}/datasheet-第二卷.xlsx`));
});
