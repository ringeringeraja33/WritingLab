import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
        export * from './services/WritingInventory';
        export * from './services/WritingTracker';
        export * from './services/GlobalWritingTracker';
        export * from './services/DocumentSourceService';
        export * from './services/FolderWritingScope';
        export * from './utils/wordcountText';
    ` }, bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'host', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `export const normalizePath = p => p.replaceAll('\\\\', '/');` }));
    } }],
});
const { WritingInventory, WritingTracker, GlobalWritingTracker, ProjectMarkdownDocumentSource,
    FolderWritingScope, wordcountTokens, stripWordcountFrontmatter } = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
globalThis.window = globalThis;

function session(initial, locale = 'en') {
    const inventory = new WritingInventory(), tracker = new WritingTracker();
    const initialState = inventory.update(initial, locale, {});
    tracker.startSession(initialState.total, true);
    const update = (docs, options = {}) => {
        const delta = inventory.update(docs, locale, options);
        tracker.rebaseInventory(delta.inventoryDelta);
        tracker.recordRevisionWords(delta.revisions);
        tracker.flushSession(delta.total);
        return delta;
    };
    return { inventory, tracker, update };
}

test('imports, removal, rename and repeated refresh preserve authored history and sprint', () => {
    const s = session([['a', 'one two']]);
    s.tracker.startSprint(2);
    s.update([['a', 'one two three'], ['import', 'existing imported prose']]);
    assert.equal(s.tracker.getTodayWords(), 1);
    s.update([['renamed', 'one two three']]);
    s.update([['renamed', 'one two three']]);
    assert.equal(s.tracker.getTodayWords(), 1);
    assert.equal(s.tracker.getTodayRevisions(), 1);
    assert.equal(s.tracker.getSprintWords(s.inventory.total), 1);
    s.update([]);
    assert.equal(s.tracker.getSessionWords(0), 1);
});

test('text deletion is negative net; same-length replacement only adds revisions', () => {
    const s = session([['a', 'one two three']]);
    s.update([['a', 'one two']]);
    s.update([['a', 'one four']]);
    assert.equal(s.tracker.getTodayWords(), -1);
    assert.equal(s.tracker.getTodayRevisions(), 3);
});

test('counting-rule changes rebase instead of fabricating writing/deletion', () => {
    const s = session([['a', 'body\n- [ ] task words']]);
    s.update([['a', 'body\n- [ ] task words']], { excludeChecklists: true });
    assert.equal(s.inventory.total, 1);
    assert.equal(s.tracker.getTodayWords(), 0);
    assert.equal(s.tracker.getTodayRevisions(), 0);
    s.update([['a', 'body added\n- [ ] task words']], { excludeChecklists: true });
    assert.equal(s.tracker.getTodayWords(), 1);
});

test('short Chinese uses identical folder and project tokens', () => {
    const raw = '你好世界';
    const folder = new FolderWritingScope({ id: 'x', path: 'X', recursive: true, locale: 'auto', tracker: { history: {} } });
    folder.setText('X/a.md', raw, false);
    assert.equal(wordcountTokens(raw, 'auto').length, 2);
    assert.equal(folder.totalWords, wordcountTokens(raw, 'auto').length);
    folder.tracker.startSession(folder.totalWords);
    folder.setText('X/a.md', 'hello world', true);
    assert.equal(folder.tracker.getTodayWords(), 0);
    assert.equal(folder.tracker.getTodayRevisions(), 4);
});

test('metadata, embedded file names and standalone punctuation are not prose', async () => {
    const raw = '\uFEFF---\r\ntitle: hidden title\r\n---\r\nhello ![[cover image.png]] ... — world';
    const source = new ProjectMarkdownDocumentSource({ vault: { cachedRead: async () => raw } }, 'P', 'P/P.md');
    const text = await source.readText({ file: {} });
    assert.equal(text, stripWordcountFrontmatter(raw));
    assert.deepEqual(wordcountTokens(text, 'en'), ['hello', 'world']);
});

test('separate project inventories never transfer session deltas', () => {
    const a = session([['a', 'one']]);
    a.update([['a', 'one two']]);
    const b = session([['b', 'already existing lengthy draft']]);
    b.update([['b', 'already existing lengthy draft']]);
    assert.equal(a.tracker.getTodayWords(), 1);
    assert.equal(b.tracker.getTodayWords(), 0);
});

function globalHarness() {
    const day = '2026-09-07';
    const active = { filePath: 'P/P.md' };
    const writingTracker = new WritingTracker();
    writingTracker.importData({ history: { [day]: 15 } });
    const disk = new Map([['P/System/stats.json', JSON.stringify({ writingTrackerData: { history: { [day]: 10 } } })]]);
    const adapter = { exists: async p => disk.has(p), read: async p => disk.get(p), write: async (p, s) => disk.set(p, s), remove: async p => disk.delete(p) };
    const plugin = { manifest: { id: 'narrative-lab', dir: '.obsidian/plugins/narrative-lab' },
        writingTracker, app: { vault: { adapter } }, sceneManager: { activeProject: active, getProjects: () => [active] } };
    return { ledger: new GlobalWritingTracker(plugin), adapter, disk, day };
}

test('all-project reconciliation includes unsaved active-project history', async () => {
    const h = globalHarness(); await h.ledger.load();
    assert.equal(await h.ledger.reconcileProjectLedgers(), true);
    assert.equal(h.ledger.tracker.getTotalHistoryWords(), 15);
    h.disk.delete('P/System/stats.json');
    assert.equal(await h.ledger.reconcileProjectLedgers(), true);
    assert.equal(h.ledger.tracker.getTotalHistoryWords(), 15);
});

test('all-project reconciliation does not overwrite edits arriving during its async read', async () => {
    const h = globalHarness(); await h.ledger.load();
    const read = h.adapter.read;
    h.adapter.read = async path => {
        if (path === 'P/System/stats.json') h.ledger.recordFlush({ words: 2, revisions: 2 });
        return read(path);
    };
    assert.equal(await h.ledger.reconcileProjectLedgers(), false);
    assert.equal(h.ledger.tracker.getTotalHistoryWords(), 2);
    if (h.ledger.saveTimer !== null) clearTimeout(h.ledger.saveTimer);
});
