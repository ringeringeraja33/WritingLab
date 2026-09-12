import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import ts from 'typescript';

const bundle = await build({ stdin: { contents: `export * from './models/ProjectCapabilities'; export * from './models/ProjectPages'; export * from './services/ProjectCapabilityService'; export * from './utils/tabStripReorder'; export * from './models/StoryLineProject';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { normalizeProjectCapabilities: normalize, moduleEnabled: enabled, toggleProjectModule: toggle, PROJECT_PAGES } = api;
const custom = modules => normalize({ version: 2, preset: 'custom', modules });

test('v1 grouped boards and structure migrate without losing any former subview', () => {
    const legacy = normalize({ version: 1, preset: 'custom', modules: ['board', 'structure'] });
    for (const id of ['flatCanvas', 'columnBoard', 'timeline', 'trackComparison', 'plotList', 'subwayMap', 'chapterTemplates', 'scenes']) assert.ok(enabled(legacy, id), id);
    assert.equal(legacy.version, 2);
    assert.ok(!legacy.modules.some(id => ['board', 'structure', 'plotlines'].includes(id)));
    assert.deepEqual(normalize(legacy), legacy);
});

test('a v2 disabled page never reappears from a stale legacy alias', () => {
    const caps = custom(['flatCanvas', 'board', 'structure', 'plotlines']);
    assert.equal(enabled(caps, 'flatCanvas'), true);
    for (const id of ['columnBoard', 'timeline', 'plotList', 'subwayMap']) assert.equal(enabled(caps, id), false);
});

for (const id of ['flatCanvas', 'columnBoard', 'timeline', 'trackComparison', 'plotList', 'subwayMap', 'canvas']) {
    test(`${id} has an independent capability and unique workspace page`, () => {
        const caps = custom([id]);
        const pages = PROJECT_PAGES.filter(page => enabled(caps, page.module));
        assert.deepEqual(pages.map(page => page.module), [id]);
        assert.equal(enabled(custom(toggle(caps.modules, id, false)), id), false);
    });
}

test('chapter templates remain optional but do not occupy a navigation page', () => {
    const caps = custom(['chapterTemplates']);
    assert.ok(enabled(caps, 'chapterTemplates'));
    assert.ok(!PROJECT_PAGES.some(page => page.module === 'chapterTemplates'));
    assert.equal(enabled(custom(toggle(caps.modules, 'chapterTemplates', false)), 'chapterTemplates'), false);
});

test('generic card boards need Notes, not Scenes or Library', () => {
    const caps = custom(['flatCanvas', 'columnBoard']);
    assert.ok(enabled(caps, 'notes'));
    for (const id of ['scenes', 'library', 'table', 'canvas']) assert.equal(enabled(caps, id), false);
    assert.equal(enabled(caps, 'board'), true, 'shared storage owner stays active');
    assert.deepEqual(toggle(caps.modules, 'notes', false), []);
});

test('project tab preferences are deduplicated, retained and isolated', () => {
    const a = normalize({ ...custom(['flatCanvas', 'columnBoard']), navigation: { order: ['columnBoard', 'bogus', 'flatCanvas', 'columnBoard'], hidden: ['flatCanvas'], defaultPage: 'columnBoard' } });
    assert.deepEqual(a.navigation, { order: ['columnBoard', 'flatCanvas'], hidden: ['flatCanvas'], defaultPage: 'columnBoard' });
    assert.equal(custom(['manuscript']).navigation, undefined);
    assert.ok(enabled(a, 'flatCanvas'), 'hiding is not disabling');
    assert.deepEqual(normalize(a), a);
});

test('dragged tab order keeps unseen pages after the visible strip', () => {
    assert.deepEqual(api.mergeProjectPageOrder(['manuscript', 'table', 'timeline'], ['table', 'manuscript']),
        ['table', 'manuscript', 'timeline', ...PROJECT_PAGES.map(page => page.module).filter(id => !['table', 'manuscript', 'timeline'].includes(id))]);
    assert.deepEqual(api.sortByProjectPageOrder(
        [{ type: 'narrative-lab-plotgrid' }, { type: 'narrative-lab-manuscript' }],
        ['table', 'manuscript'],
    ).map(item => item.type), ['narrative-lab-plotgrid', 'narrative-lab-manuscript']);
});

test('tab groups flatten drag order without dropping later pages', () => {
    assert.deepEqual(api.PROJECT_TAB_GROUPS.map(group => group.id), ['manuscript', 'informationTable', 'organize', 'planning', 'library', 'presentation']);
    assert.deepEqual(api.PROJECT_TAB_GROUPS.slice(0, 2).map(group => group.modules), [['manuscript'], ['table']]);
    assert.equal(api.PROJECT_TAB_GROUPS.find(group => group.id === 'organize').modules.includes('table'), false);
    assert.deepEqual(api.flattenTabGroupOrder(['planning', 'manuscript'], ['manuscript', 'flatCanvas', 'timeline', 'plotList']), [
        'timeline', 'plotList', 'trackComparison', 'subwayMap', 'manuscript', 'flatCanvas',
        ...PROJECT_PAGES.map(page => page.module).filter(id => !['timeline', 'plotList', 'trackComparison', 'subwayMap', 'manuscript', 'flatCanvas'].includes(id)),
    ]);
    assert.deepEqual(api.sortTabGroups([...api.PROJECT_TAB_GROUPS], ['timeline', 'manuscript']).map(group => group.id),
        ['planning', 'manuscript', 'informationTable', 'organize', 'library', 'presentation']);
});

test('capability persistence rolls back memory on failure and never deletes files', async () => {
    const before = custom(['flatCanvas']);
    const project = { filePath: 'Projects/论文/论文.md', capabilities: before };
    const calls = [];
    const service = new api.ProjectCapabilityService({
        ensureProjectModuleStorage: async (_project, caps) => calls.push(caps),
        saveProjectFrontmatter: async () => { throw new Error('disk full'); },
    });
    await assert.rejects(service.apply(project, custom(['columnBoard'])), /disk full/);
    assert.equal(project.capabilities, before);
    assert.equal(calls.length, 1);
});

test('tab order writes skip module storage and roll back on failure', async () => {
    const before = custom(['flatCanvas']);
    const project = { filePath: 'Projects/论文/论文.md', capabilities: before };
    const calls = [];
    const failing = new api.ProjectCapabilityService({
        ensureProjectModuleStorage: async () => calls.push('storage'),
        saveProjectFrontmatter: async () => { throw new Error('disk full'); },
    });
    await assert.rejects(failing.applyNavigation(project, { order: ['flatCanvas'], hidden: [] }), /disk full/);
    assert.equal(project.capabilities, before);
    assert.deepEqual(calls, []);
    const ok = new api.ProjectCapabilityService({
        ensureProjectModuleStorage: async () => calls.push('storage'),
        saveProjectFrontmatter: async () => calls.push('save'),
    });
    await ok.applyNavigation(project, { order: ['flatCanvas'], hidden: [] });
    assert.deepEqual(calls, ['save']);
    assert.deepEqual(project.capabilities.navigation.order, ['flatCanvas']);
});

const mainText = await readFile('main.ts', 'utf8');
const mainAst = ts.createSourceFile('main.ts', mainText, ts.ScriptTarget.Latest, true);
const mainClass = mainAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SceneCardsPlugin');
const method = mainClass.members.find(node => node.name?.getText(mainAst) === 'updateProjectModules').getText(mainAst);
const { code } = await transform(`class Probe { ${method} }; export { Probe };`, { loader: 'ts', format: 'cjs' });
function lifecycleFixture(failure) {
    const calls = [], target = { filePath: 'Projects/论文/论文.md' };
    const a = { getViewState: () => ({ type: 'column', state: { narrativeLabProjectFile: target.filePath } }), view: { getViewType: () => 'column', prepareForModuleDisable: async () => { calls.push('flush'); if (failure === 'flush') throw Error('save failed'); } }, async setViewState(state) { calls.push(state.type); } };
    const b = { getViewState: () => ({ type: 'column', state: { narrativeLabProjectFile: 'Other/Other.md' } }), view: { getViewType: () => 'column' }, async setViewState() { throw Error('wrong project'); } };
    const module = { exports: {} };
    new Function('module', 'moduleEnabled', 'normalizePath', 'getLeafNarrativeLabProjectFile', 'narrativeLabLeafState', 'PROJECT_OVERVIEW_VIEW_TYPE', 't', code)(module, enabled, path => path, leaf => leaf.getViewState().state.narrativeLabProjectFile, (path, extra) => ({ narrativeLabProjectFile: path, ...extra }), 'overview', key => key);
    const probe = new module.exports.Probe();
    Object.assign(probe, {
        app: { workspace: { iterateAllLeaves: fn => [a, b].forEach(fn) } },
        moduleForView: () => 'columnBoard',
        sceneManager: { activeProject: target, setActiveProject: async () => calls.push('reload') },
        flushWritingTrackers() {}, settleWritingTrackerChanges: async () => {}, saveProjectSystemData: async () => calls.push('system-save'),
        capabilityService: { apply: async () => { calls.push('apply'); if (failure === 'apply') throw Error('manifest failed'); } },
    });
    return { probe, calls, target };
}
test('disabling flushes under old capabilities, saves, then shows a project-bound disabled page', async () => {
    const f = lifecycleFixture();
    await f.probe.updateProjectModules(f.target, custom([]));
    assert.deepEqual(f.calls, ['flush', 'empty', 'system-save', 'apply', 'overview', 'reload']);
});
test('failed editor save prevents capability mutation or tab unloading', async () => {
    const f = lifecycleFixture('flush');
    await assert.rejects(f.probe.updateProjectModules(f.target, custom([])), /save failed/);
    assert.deepEqual(f.calls, ['flush']);
    assert.equal(f.probe.moduleUpdateInProgress, false);
});
test('failed manifest save restores suspended leaves', async () => {
    const f = lifecycleFixture('apply');
    await assert.rejects(f.probe.updateProjectModules(f.target, custom([])), /manifest failed/);
    assert.deepEqual(f.calls, ['flush', 'empty', 'system-save', 'apply', 'column']);
});

test('creation and settings share the grouped picker; writing counters are the final two rows', async () => {
    const picker = await readFile('components/ProjectModulePicker.ts', 'utf8');
    const modal = await readFile('components/ProjectModulesModal.ts', 'utf8');
    assert.match(picker, /Narrative planning'[\s\S]*?Narrative content'[\s\S]*?Materials and research'/);
    assert.match(picker, /modules: \['scenes', 'sceneDetails', 'sceneNotes', 'synopsis', 'series'\]/);
    assert.match(picker, /nl-library-pack-choices/);
    assert.match(picker, /Literature library/);
    assert.match(picker, /Narrative library/);
    assert.match(picker, /applyLibraryPackToModules/);
    assert.doesNotMatch(picker, /Can be used together with characters and locations/);
    assert.match(picker, /Writing progress', icon: 'chart-no-axes-column', modules: \['writingTracker', 'writingStats'\]/);
    assert.doesNotMatch(picker, /citations/);
    assert.match(mainText, /renderProjectModulePicker\(moduleChoices/);
    assert.match(mainText, /const labels = \[t\('Project basics'\), t\('Choose modules'\), t\('Review and create'\)\]/);
    assert.doesNotMatch(mainText, /const browseBtn/);
    const styles = await readFile('styles.css', 'utf8');
    const rule = styles.match(/\.nl-project-module-choices\s*\{[^}]+\}/)[0];
    assert.doesNotMatch(rule, /max-height|overflow-y:\s*auto/);
    const cell = styles.match(/body \.nl-project-module-picker \.nl-module-grid > \.setting-item\.setting-item,[\s\S]*?background: var\(--background-primary\);/)[0];
    assert.match(cell, /padding:\s*14px 18px/);
    assert.match(cell, /flex-flow:\s*row nowrap/);
    assert.match(cell, /border-top:\s*1px solid/);
    assert.match(cell, /border-left:\s*1px solid/);
    assert.match(styles, /\.nl-project-module-picker \.nl-module-grid \.setting-item-control \{[\s\S]*?position:\s*static !important/);
    assert.match(styles, /\.nl-project-module-picker \.nl-module-grid \.setting-item-description \{[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(styles, /\.nl-module-group \{[^}]*padding:\s*16px 16px 16px/s);
    assert.match(styles, /\.nl-module-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
    assert.doesNotMatch(styles, /\.nl-module-grid > \.setting-item:last-child:nth-child\(odd\)/);
    assert.doesNotMatch(styles, /\.nl-module-group-tracking \.nl-module-grid \{[^}]*grid-template-columns:\s*1fr/);
    assert.match(modal, /sortTabGroups\(\[\.\.\.PROJECT_TAB_GROUPS\], order\)/);
    assert.match(modal, /groupPages\.length === 1 \? ' is-single'/);
    assert.match(modal, /if \(groupPages\.length > 1\)/);
    assert.match(styles, /\.nl-project-settings-modal \.nl-layout-group \{[^}]*border:[^;]+;[^}]*border-radius:/s);
    assert.match(styles, /\.nl-layout-group\.is-single > \.setting-item\.nl-layout-page-row \{ border-top: 0; \}/);
});

test('tab strip insert index splits at each tab midpoint', () => {
    const tabs = [{ left: 0, width: 100 }, { left: 100, width: 80 }];
    assert.equal(api.tabStripInsertIndex(tabs, 10), 0);
    assert.equal(api.tabStripInsertIndex(tabs, 60), 1);
    assert.equal(api.tabStripInsertIndex(tabs, 170), 2);
    assert.equal(api.tabStripMoveCommits(0, 1), false);
    assert.equal(api.tabStripMoveCommits(0, 2), true);
});

test('tab bar drag reorders without disabling modules', async () => {
    const switcher = await readFile('components/ViewSwitcher.ts', 'utf8');
    assert.match(switcher, /attachPointerTabReorder/);
    assert.doesNotMatch(switcher, /tab\.draggable = true/);
    assert.match(switcher, /updateProjectTabOrder/);
    assert.match(switcher, /flattenTabGroupOrder/);
    assert.match(switcher, /PROJECT_TAB_GROUPS/);
    const categoryTabs = await readFile('components/CodexCategoryTabs.ts', 'utf8');
    assert.match(categoryTabs, /attachPointerTabReorder/);
    assert.match(await readFile('utils/tabStripReorder.ts', 'utf8'), /addEventListener\('pointerup', onDocUp, true\)/);
    assert.match(mainText, /async updateProjectTabOrder/);
    const orderFn = mainText.slice(mainText.indexOf('async updateProjectTabOrder'), mainText.indexOf('closeDisabledProjectViews'));
    assert.doesNotMatch(orderFn, /prepareForModuleDisable/);
    assert.match(orderFn, /applyNavigation/);
});

// Real storage methods against an in-memory vault; no user files are touched.
const sceneSource = await readFile('services/SceneManager.ts', 'utf8');
const sceneAst = ts.createSourceFile('SceneManager.ts', sceneSource, ts.ScriptTarget.Latest, true);
const sceneClass = sceneAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SceneManager');
const noteMethods = ['ensureProjectModuleStorage', 'getOrCreateSceneNotesFile', 'getSceneNotesFile', 'writeSceneNotes']
    .map(name => sceneClass.members.find(node => node.name?.getText(sceneAst) === name).getText(sceneAst)).join('\n');
const noteCode = (await transform(`class SceneNotesProbe { ${noteMethods} }; export { SceneNotesProbe };`, { loader: 'ts', format: 'cjs' })).code;
function notesFixture() {
    class File { constructor(path, text) { this.path = path; this.text = text; } }
    const files = new Map(), folders = [], writes = [], updates = [];
    const module = { exports: {} };
    new Function('module', 'TFile', 'normalizePath', 'deriveProjectFoldersFromFilePath', 'resolveManuscriptBinderFolder', 'moduleEnabled', 'usesAuthoredCanvasFolder', noteCode)(
        module, File, path => path, api.deriveProjectFoldersFromFilePath, api.resolveManuscriptBinderFolder, enabled, api.usesAuthoredCanvasFolder);
    const probe = new module.exports.SceneNotesProbe();
    Object.assign(probe, {
        app: { vault: {
            getAbstractFileByPath: path => files.get(path),
            adapter: { exists: async path => files.has(path) },
            create: async (path, text) => { writes.push(path); files.set(path, new File(path, text)); },
            modify: async (file, text) => { writes.push(file.path); file.text = text; },
        } },
        ensureFolder: async path => { folders.push(path); },
        getSceneNotesFolder: () => 'Projects/Novel/SceneNotes',
        getUniqueSceneNotesPath: () => 'Projects/Novel/SceneNotes/Scene - Notes.md',
        migrateLegacySceneNotesName: async (_scene, file) => file.path,
        updateScene: async (path, data) => { updates.push({ path, data }); },
    });
    return { probe, File, files, folders, writes, updates, scene: { filePath: 'Projects/Novel/Scenes/Scene.md' } };
}

test('enabling scene notes never scaffolds an empty SceneNotes folder', async () => {
    const f = notesFixture();
    for (let i = 0; i < 2; i++) await f.probe.ensureProjectModuleStorage({ filePath: 'Projects/Novel/Novel.md' }, custom(['sceneNotes']));
    assert.ok(f.folders.includes('Projects/Novel/Scenes'));
    assert.ok(!f.folders.some(path => path.endsWith('/SceneNotes')));
    assert.deepEqual(f.writes, []);
});

test('reading or blurring empty notes does not create folders, files or references', async () => {
    const f = notesFixture();
    assert.equal(f.probe.getSceneNotesFile(f.scene), undefined);
    await f.probe.writeSceneNotes(f.scene, ' \n\t');
    f.scene.notesFile = 'Projects/Novel/SceneNotes/missing.md';
    await f.probe.writeSceneNotes(f.scene, '');
    assert.deepEqual(f.folders, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.updates, []);
});

test('writing real scene notes creates storage on demand; clearing retains the file', async () => {
    const f = notesFixture();
    await f.probe.writeSceneNotes(f.scene, '附注内容\n');
    const path = f.scene.notesFile;
    assert.deepEqual(f.folders, ['Projects/Novel/SceneNotes']);
    assert.equal(f.files.get(path).text, '附注内容\n');
    assert.equal(f.updates.length, 1);
    await f.probe.writeSceneNotes(f.scene, '');
    assert.equal(f.files.get(path).text, '');
    assert.equal(f.scene.notesFile, path);
    assert.equal(f.folders.length, 1);
});

test('existing linked scene notes remain readable and reusable without creating storage', async () => {
    const f = notesFixture(), path = 'Projects/Novel/SceneNotes/Existing.md';
    f.files.set(path, new f.File(path, '保留旧附注'));
    f.scene.notesFile = path;
    assert.equal(f.probe.getSceneNotesFile(f.scene), path);
    assert.equal(await f.probe.getOrCreateSceneNotesFile(f.scene), path);
    assert.equal(f.files.get(path).text, '保留旧附注');
    assert.deepEqual(f.folders, []);
    assert.deepEqual(f.writes, []);
});
