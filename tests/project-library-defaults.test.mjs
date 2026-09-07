import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const result = await build({
    entryPoints: ['models/StoryLineProject.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});
const source = result.outputFiles[0].text;
const {
    DEFAULT_PROJECT_LIBRARY_FOLDERS,
    DEFAULT_PROJECT_LIBRARY_HIDDEN_CATEGORIES,
    deriveProjectFolders,
    deriveProjectFoldersFromFilePath,
    manuscriptBinderFolderName,
    projectRootFromSceneFolder,
    resolveManuscriptBinderFolder,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('new projects bootstrap fixed folders before preset migration', () => {
    assert.deepEqual(
        { ...DEFAULT_PROJECT_LIBRARY_FOLDERS },
        { characters: 'Characters', locations: 'Locations' },
    );
    assert.deepEqual([...DEFAULT_PROJECT_LIBRARY_HIDDEN_CATEGORIES], ['uncategorized']);
});

test('first project load restores pack-specific Library presets once', async () => {
    const source = await readFile('services/LibraryCategorySync.ts', 'utf8');
    const main = await readFile('main.ts', 'utf8');
    const sceneManager = await readFile('services/SceneManager.ts', 'utf8');
    const codex = await readFile('models/Codex.ts', 'utf8');
    assert.match(source, /STORYLINE_PRESET_SEED_VERSION = 2/);
    assert.match(source, /libraryPresetCategoriesForPack/);
    assert.match(source, /initialLibraryCategorySettings/);
    assert.match(source, /ensureLibraryPackCategories/);
    assert.match(source, /usesAcademicLibraryCategories\(pack\) \? ACADEMIC_CODEX_CATEGORIES/);
    assert.match(source, /usesNarrativeLibraryCategories\(pack\) \? BUILTIN_CODEX_CATEGORIES/);
    assert.match(source, /if \(deleted\.has\(preset\.id\)\) return/);
    assert.match(source, /if \(options\.enable\) enabled\.add\(preset\.id\)/);
    assert.match(source, /hasProfilePage: true/);
    assert.match(source, /hiddenFixedCategories: pack === 'academic'/);
    assert.match(source, /shouldCreateLibraryCategoryFolder/);
    assert.match(source, /filterLibraryFoldersForPack/);
    assert.match(source, /shouldCreateLibraryCategoryFolder\(id, pack\) && !hiddenFixed.has\(id\)/);
    assert.match(codex, /id: 'literature'/);
    assert.match(codex, /id: 'claims'/);
    assert.match(codex, /id: 'arguments'/);
    assert.match(codex, /id: 'facts'/);
    assert.match(sceneManager, /JSON.stringify\(initialLibraryCategorySettings\(capabilities\)/);
    assert.match(sceneManager, /defaultLibraryFoldersForCapabilities\(capabilities\)/);
    assert.match(sceneManager, /filterLibraryFoldersForPack/);
    assert.match(sceneManager, /usesAuthoredCanvasFolder\(capabilities\)/);
    assert.match(main, /seedStorylinePresetCategories\(this\)/);
    assert.match(main, /applyLibraryCategorySettings\(this, initialLibraryCategorySettings/);
    assert.doesNotMatch(main, /_legacyLibraryCategoryDefaults\.enabledCategories/);
    assert.match(main, /\(presetsSeeded \|\| migratingLibraryCategories\) \? \{ createMissingRegistered: true \} : \{\}/);
    assert.match(main, /\(presetsSeeded \|\| !stored\) \? \{ createMissingRegistered: true \} : \{\}/);
});

test('hiding a Library category does not let folder adopt resurrect the tab', async () => {
    const source = await readFile('services/LibraryCategorySync.ts', 'utf8');
    const tabs = await readFile('components/CodexCategoryTabs.ts', 'utf8');
    const manager = await readFile('views/CodexView.ts', 'utf8');
    assert.match(source, /shouldEnableAdoptedLibraryCategory/);
    assert.match(source, /Deleted presets stay deleted even if their Library folder is still on disk/);
    assert.doesNotMatch(source, /deleted\.delete\(id\)/);
    assert.match(tabs, /enabledCodex\.has\(category\.id\)/);
    assert.match(tabs, /isViewEnabled\(CHARACTER_VIEW_TYPE, projectFile\)/);
    assert.match(tabs, /isViewEnabled\(LOCATION_VIEW_TYPE, projectFile\)/);
    assert.match(manager, /Hidden presets stay registered so Library\/ folders cannot resurrect their tabs/);
});

test('Library categories always have a profile page and no optional toggle', async () => {
    const [source, tabs, manager, switcher, main] = await Promise.all([
        readFile('services/LibraryCategorySync.ts', 'utf8'),
        readFile('components/CodexCategoryTabs.ts', 'utf8'),
        readFile('views/CodexView.ts', 'utf8'),
        readFile('components/ViewSwitcher.ts', 'utf8'),
        readFile('main.ts', 'utf8'),
    ]);
    assert.doesNotMatch(manager, /codex-category-manager-profile-toggle/);
    assert.doesNotMatch(manager, /Include profile page/);
    assert.doesNotMatch(tabs, /Enable profile page/);
    assert.doesNotMatch(tabs, /Disable profile page/);
    assert.match(manager, /hasProfilePage: true/);
    assert.match(source, /hasProfilePage: true/);
    assert.match(manager, /setLibraryContentMode\(this\.plugin, 'profile', this\.getBoundProjectFile\(\)\)/);
    assert.doesNotMatch(manager, /profileAvailable/);
    assert.doesNotMatch(manager, /activeCategoryHasProfilePage/);
    assert.match(switcher, /makeProfileCodexCategory\(c\.id, c\.label, c\.icon\)/);
    assert.doesNotMatch(switcher, /c\.hasProfilePage/);
    assert.doesNotMatch(main, /cc\.hasProfilePage/);
});

test('academic Library categories stay on Browse without a Profiles archive', async () => {
    const result = await build({
        entryPoints: ['models/Codex.ts'],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
    });
    const { libraryCategoryHasProfilePage, shouldCreateLibraryCategoryFolder } = await import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
    );
    for (const id of ['literature', 'claims', 'arguments', 'facts']) {
        assert.equal(libraryCategoryHasProfilePage(id), false, id);
        assert.equal(shouldCreateLibraryCategoryFolder(id, 'academic'), true, id);
        assert.equal(shouldCreateLibraryCategoryFolder(id, 'narrative'), false, id);
    }
    for (const id of ['items', 'characters', 'locations']) {
        assert.equal(shouldCreateLibraryCategoryFolder(id, 'academic'), false, id);
        assert.equal(shouldCreateLibraryCategoryFolder(id, 'narrative'), true, id);
        assert.equal(shouldCreateLibraryCategoryFolder(id, 'both'), true, id);
    }
    for (const id of ['items', 'characters', 'locations', 'uncategorized', 'custom-world']) {
        assert.equal(libraryCategoryHasProfilePage(id), true, id);
    }
    const view = await readFile('views/CodexView.ts', 'utf8');
    assert.match(view, /if \(!libraryCategoryHasProfilePage\(this\.activeCategory\)\) return/);
    assert.match(view, /libraryCategoryHasProfilePage\(this\.activeCategory\) \? entry\.filePath : null/);
    assert.match(view, /libraryCategoryHasProfilePage\(this\.activeCategory\) \? 'profile' : 'browse'/);
});

test('Library search and filter controls start closed', async () => {
    for (const path of ['views/CharacterView.ts', 'views/LocationView.ts', 'views/CodexView.ts']) {
        const source = await readFile(path, 'utf8');
        assert.match(source, /private browseSearchOpen = false/);
        assert.match(source, /private browseFilterOpen = false/);
    }
});

test('profile layout maps horizontal to columns and vertical to stacked sections', async () => {
    const css = await readFile('styles.css', 'utf8');
    const codex = await readFile('views/CodexView.ts', 'utf8');
    const location = await readFile('views/LocationView.ts', 'utf8');
    assert.match(css, /\.character-detail-board-track\s*\{[\s\S]*?flex-direction: row/);
    assert.match(css, /\.story-line-codex-content\.codex-detail--board/);
    assert.match(codex, /horizontalProfile \? ' character-detail-board-track' : ' character-detail-vertical-track'/);
    assert.match(location, /horizontalProfile \? ' character-detail-board-track' : ' character-detail-vertical-track'/);
    assert.match(codex, /text: t\(cat\.title\)/);
    assert.match(location, /text: t\(category\.title\)/);
});

test('slash and blank new-project locations resolve to the vault root', async () => {
    const vaultRelativeFolderPath = (path) =>
        String(path ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
    assert.equal(vaultRelativeFolderPath('/'), '');
    assert.equal(vaultRelativeFolderPath(''), '');
    assert.equal(vaultRelativeFolderPath(null), '');
    assert.equal(vaultRelativeFolderPath('Projects/Books'), 'Projects/Books');

    const [main, sceneManager, vaultFolders] = await Promise.all([
        readFile('main.ts', 'utf8'),
        readFile('services/SceneManager.ts', 'utf8'),
        readFile('utils/vaultFolders.ts', 'utf8'),
    ]);
    assert.match(vaultFolders, /export function vaultRelativeFolderPath/);
    assert.match(main, /normalizedQuery === '\/'/);
    assert.match(main, /choice\.value === null \|\| choice\.value === ''/);
    assert.match(main, /locationSuggest\?\.close\(\)/);
    assert.match(main, /typed === '\/' \? '' : typed/);
    assert.match(sceneManager, /vaultRelativeFolderPath\(customBasePath \?\? this\.plugin\.settings\.storyLineRoot\)/);
});

test('new project paths use Library rather than Codex', () => {
    const fromTitle = deriveProjectFolders('Writing', 'Book');
    assert.equal(fromTitle.codexFolder, 'Writing/Book/Library');
    assert.equal(fromTitle.characterFolder, 'Writing/Book/Library/Characters');
    assert.equal(fromTitle.locationFolder, 'Writing/Book/Library/Locations');
    assert.equal(fromTitle.sceneFolder, 'Writing/Book/Scenes');

    const fromFile = deriveProjectFoldersFromFilePath('Writing/Book/Book.md');
    assert.equal(fromFile.codexFolder, 'Writing/Book/Library');
});

test('research papers use a Theses binder instead of Scenes', async () => {
    const paper = { version: 2, preset: 'research-paper', modules: ['scenes'], wordCountProfile: 'academic' };
    assert.equal(manuscriptBinderFolderName(paper), 'Theses');
    assert.equal(deriveProjectFolders('Writing', 'Paper', paper).sceneFolder, 'Writing/Paper/Theses');
    assert.equal(deriveProjectFoldersFromFilePath('Writing/Paper/Paper.md', paper).sceneFolder, 'Writing/Paper/Theses');
    assert.equal(projectRootFromSceneFolder('Writing/Paper/Theses'), 'Writing/Paper');
    assert.equal(resolveManuscriptBinderFolder('Writing/Paper', paper, () => false), 'Writing/Paper/Theses');
    assert.equal(resolveManuscriptBinderFolder('Writing/Paper', paper, path => path.endsWith('/Scenes')), 'Writing/Paper/Scenes');

    const [navigatorView, sceneManager, modeBar] = await Promise.all([
        readFile('views/NavigatorView.ts', 'utf8'),
        readFile('services/SceneManager.ts', 'utf8'),
        readFile('components/LibraryModeBar.ts', 'utf8'),
    ]);
    assert.match(navigatorView, /this\.usesThesesBinder\(\) \? t\('Theses'\) : t\('Scenes'\)/);
    assert.match(navigatorView, /this\.usesThesesBinder\(\) \? t\('Chapters'\) : t\('Plotlines'\)/);
    assert.match(sceneManager, /ensureProjectModuleStorage\(project, capabilities\)/);
    assert.match(sceneManager, /'Theses'/);
    assert.match(modeBar, /resolveProjectContentPolicy\(plugin\.capabilityService\.get\(project\)\)\.narrativeScenes/);
    assert.match(sceneManager, /usesThesesBinder\(capabilities\)/);
});

test('flat canvas state is internal and cannot create the authored Canvas folder', async () => {
    const [corkboard, sceneManager, main, boardAction] = await Promise.all([
        readFile('services/CorkboardCanvasService.ts', 'utf8'),
        readFile('services/SceneManager.ts', 'utf8'),
        readFile('main.ts', 'utf8'),
        readFile('components/LibraryEntityBoardAction.ts', 'utf8'),
    ]);
    assert.match(corkboard, /baseFolder}\/System\/\$\{corkboardCanvasFileNameForProject/);
    assert.doesNotMatch(sceneManager, /corkboardCanvasPathForProject/);
    assert.match(main, /if \(!usesAuthoredCanvasFolder\(project\.capabilities\)\) continue/);
    assert.match(main, /!this\.capabilityService\.isEnabled\('canvas', project\)/);
    assert.match(boardAction, /!opts\.plugin\.capabilityService\.isEnabled\('canvas', project\)/);
});
