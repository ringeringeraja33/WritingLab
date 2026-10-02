import { normalizePath, TFile, type App } from 'obsidian';
import type { StoryLineProject } from '../models/StoryLineProject';
import { deriveProjectFoldersFromFilePath } from '../models/StoryLineProject';
import { t } from '../utils/i18n';
import { ensureVaultFolder } from '../utils/vaultFolders';

const LEGACY_DOCUMENT_BASE_FILENAME = 'writing.base';
const EXCLUDED_FOLDERS = ['System', 'Library', 'Canvas', 'Attachments', 'Research', 'Notes', 'Scenes', 'Theses'];

function yamlString(value: string): string {
    return JSON.stringify(value);
}

export function projectDocumentBasePath(project: StoryLineProject): string {
    const baseFolder = deriveProjectFoldersFromFilePath(project.filePath).baseFolder;
    const safeProjectName = project.title.trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/[. ]+$/g, '') || 'Project';
    return normalizePath([baseFolder, 'Library', `writing-${safeProjectName}.base`].filter(Boolean).join('/'));
}

export function legacyProjectDocumentBasePaths(project: StoryLineProject): string[] {
    const baseFolder = deriveProjectFoldersFromFilePath(project.filePath).baseFolder;
    const name = projectDocumentBasePath(project).split('/').pop()!;
    return [normalizePath(`${baseFolder}/${name}`), legacyProjectDocumentBasePath(project)];
}

function legacyProjectDocumentBasePath(project: StoryLineProject): string {
    const baseFolder = deriveProjectFoldersFromFilePath(project.filePath).baseFolder;
    return normalizePath([baseFolder, LEGACY_DOCUMENT_BASE_FILENAME].filter(Boolean).join('/'));
}

export function buildProjectDocumentBase(project: StoryLineProject): string {
    const baseFolder = normalizePath(deriveProjectFoldersFromFilePath(project.filePath).baseFolder);
    const filters = [
        `    - if(file, file.inFolder(${yamlString(baseFolder)}), false)`,
        '    - if(file, file.ext == "md", false)',
        `    - if(file, file.path != ${yamlString(normalizePath(project.filePath))}, false)`,
        ...EXCLUDED_FOLDERS.map(folder =>
            `    - if(file, file.inFolder(${yamlString(normalizePath(`${baseFolder}/${folder}`))}) == false, false)`),
    ];
    return [
        'filters:',
        '  and:',
        ...filters,
        'views:',
        '  - type: table',
        `    name: ${yamlString(t('Document list'))}`,
        '    order:',
        '      - file.name',
        '      - file.mtime',
        '',
    ].join('\n');
}

export async function ensureProjectDocumentBase(app: App, project: StoryLineProject): Promise<TFile> {
    const path = projectDocumentBasePath(project);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error(`Cannot create document Base over a folder: ${path}`);
    await ensureVaultFolder(app, path.slice(0, path.lastIndexOf('/')));
    const legacy = legacyProjectDocumentBasePaths(project)
        .map(candidate => app.vault.getAbstractFileByPath(candidate))
        .find((file): file is TFile => file instanceof TFile);
    if (legacy instanceof TFile) {
        await app.fileManager.renameFile(legacy, path);
        return legacy;
    }
    return app.vault.create(path, buildProjectDocumentBase(project));
}

/** Rebase quoted paths without replacing the user's columns, views or filters. */
export function rebaseDocumentBasePaths(content: string, oldProject: StoryLineProject, project: StoryLineProject): string {
    const oldRoot = normalizePath(deriveProjectFoldersFromFilePath(oldProject.filePath).baseFolder);
    const newRoot = normalizePath(deriveProjectFoldersFromFilePath(project.filePath).baseFolder);
    const oldManifest = normalizePath(oldProject.filePath);
    return content.replace(/"(?:\\.|[^"\\])*"/g, literal => {
        let value: string;
        try { value = JSON.parse(literal) as string; } catch { return literal; }
        if (value === oldManifest) return JSON.stringify(normalizePath(project.filePath));
        if (value === oldRoot) return JSON.stringify(newRoot);
        if (value.startsWith(`${oldRoot}/`)) return JSON.stringify(`${newRoot}${value.slice(oldRoot.length)}`);
        return literal;
    });
}

/** Only migrate a Base that already exists; disabled modules create no files. */
export async function renameProjectDocumentBase(app: App, oldProject: StoryLineProject, project: StoryLineProject): Promise<void> {
    const oldName = projectDocumentBasePath(oldProject).split('/').pop()!;
    const newRoot = deriveProjectFoldersFromFilePath(project.filePath).baseFolder;
    const destination = projectDocumentBasePath(project);
    const candidates = [
        normalizePath(`${newRoot}/Library/${oldName}`),
        normalizePath(`${newRoot}/${oldName}`),
        legacyProjectDocumentBasePath(project),
    ];
    const source = candidates.map(path => app.vault.getAbstractFileByPath(path))
        .find((file): file is TFile => file instanceof TFile);
    if (!source) return;
    if (source.path !== destination) {
        if (await app.vault.adapter.exists(destination)) {
            throw new Error(t('Cannot rename project because this path already exists: {path}', { path: destination }));
        }
        await ensureVaultFolder(app, destination.slice(0, destination.lastIndexOf('/')));
        await app.fileManager.renameFile(source, destination);
    }
    await app.vault.process(source, content => rebaseDocumentBasePaths(content, oldProject, project));
}
