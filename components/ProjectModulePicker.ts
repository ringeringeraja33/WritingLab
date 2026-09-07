import { Setting, setIcon } from 'obsidian';
import {
    applyLibraryPackToModules,
    libraryPackFromSelection,
    toggleProjectModule,
    type LibraryCategoryPackId,
    type ProjectModuleId,
} from '../models/ProjectCapabilities';
import { t } from '../utils/i18n';

export const PROJECT_MODULE_LABELS: Record<ProjectModuleId, string> = {
    manuscript: 'Manuscript', notes: 'Notes', outline: 'Outline',
    writingTracker: 'Writing tracker', writingStats: 'Writing statistics',
    research: 'Research', library: 'Library', table: 'Table', canvas: 'Presentation',
    scenes: 'Scenes', board: 'Board',
    structure: 'Structure', plotlines: 'Plotlines', timeline: 'Timeline',
    flatCanvas: 'Flat canvas', columnBoard: 'Column board', trackComparison: 'Track comparison',
    plotList: 'Plot list', subwayMap: 'Plot subway map', chapterTemplates: 'Chapter templates',
    characters: 'Characters', locations: 'Locations', sceneDetails: 'Scene details',
    sceneNotes: 'Scene notes', synopsis: 'Synopsis', series: 'Series',
};

export const PROJECT_MODULE_GROUPS: { label: string; icon: string; modules: ProjectModuleId[] }[] = [
    { label: 'Writing', icon: 'pen-line', modules: ['manuscript', 'notes', 'outline'] },
    { label: 'Canvases and organization', icon: 'layout-dashboard', modules: ['flatCanvas', 'columnBoard', 'table', 'canvas'] },
    { label: 'Narrative planning', icon: 'git-branch', modules: ['timeline', 'trackComparison', 'plotList', 'subwayMap', 'chapterTemplates'] },
    { label: 'Narrative content', icon: 'notebook-tabs', modules: ['scenes', 'sceneDetails', 'sceneNotes', 'synopsis', 'series'] },
    { label: 'Materials and research', icon: 'library', modules: ['library', 'research'] },
    { label: 'Writing progress', icon: 'chart-no-axes-column', modules: ['writingTracker', 'writingStats'] },
];

const DESCRIPTIONS: Partial<Record<ProjectModuleId, string>> = {
    manuscript: 'The main writing page for drafts.',
    notes: 'A Notes folder in the binder for freeform files.',
    outline: 'A structured outline of the work.',
    flatCanvas: 'Arrange note cards freely on a flat canvas.',
    columnBoard: 'Organize note cards in columns.',
    table: 'A spreadsheet for lists, indexes, and data.',
    canvas: 'Connect nodes and present a sequence.',
    timeline: 'Arrange scenes in reading or chronological order.',
    trackComparison: 'Compare parallel narrative tracks.',
    plotList: 'Review scenes grouped by plotline.',
    subwayMap: 'Visualize plotline intersections as a route map.',
    chapterTemplates: 'Apply and manage act and chapter templates.',
    scenes: 'Scene cards for stories, or thesis files for research papers. Timeline, plot views, and scene sidebars need this.',
    characters: 'Character profiles and the Characters tab in Library. Save settings to hide that tab.',
    locations: 'Location profiles and the Locations tab in Library. Save settings to hide that tab.',
    sceneDetails: 'The scene inspector sidebar: status, POV, and metadata.',
    sceneNotes: 'A sidebar for notes attached to the current scene.',
    synopsis: 'A sidebar for the short synopsis of each scene.',
    series: 'Share library entries across books in a series.',
    library: 'A Library folder. Choose a narrative or literature category set below — they stay separate unless you pick both.',
    research: 'A Research folder in the binder for source notes.',
    writingTracker: 'Daily word-count goals and writing sessions.',
    writingStats: 'Length and readability statistics.',
};

const LIBRARY_PACK_OPTIONS: Array<{
    id: LibraryCategoryPackId;
    name: string;
    description: string;
}> = [
    {
        id: 'narrative',
        name: 'Narrative library',
        description: 'Characters, locations, and fiction worldbuilding folders.',
    },
    {
        id: 'academic',
        name: 'Literature library',
        description: 'Literature, claims, arguments, and facts. Does not create character or location folders.',
    },
    {
        id: 'both',
        name: 'Narrative and literature',
        description: 'Both category sets in the same Library. Use only when you need both.',
    },
    {
        id: 'none',
        name: 'Empty library',
        description: 'Create the Library folder only. Add your own categories later.',
    },
];

export type ProjectModulePickerTools = {
    openChapterTemplates?: () => void;
    chapterTemplatesAvailable?: boolean;
    libraryPack?: LibraryCategoryPackId;
};

function emitPickerChange(
    container: HTMLElement,
    next: Set<ProjectModuleId>,
    libraryPack: LibraryCategoryPackId,
    onChange: (next: Set<ProjectModuleId>, libraryPack: LibraryCategoryPackId) => void,
    tools?: ProjectModulePickerTools,
    focus?: string,
): void {
    const previousPack = container.dataset.prevLibraryPack;
    onChange(next, libraryPack);
    renderProjectModulePicker(container, next, onChange, { ...tools, libraryPack });
    if (previousPack) container.dataset.prevLibraryPack = previousPack;
    const selector = focus?.startsWith('pack:')
        ? `[data-library-pack="${focus.slice(5)}"] .checkbox-container`
        : `[data-module="${focus}"] .checkbox-container`;
    container.querySelector<HTMLElement>(selector)?.focus();
}

function addModuleToggle(
    grid: HTMLElement,
    module: ProjectModuleId,
    selected: Set<ProjectModuleId>,
    onToggle: (enabled: boolean) => void,
    tools?: ProjectModulePickerTools,
): void {
    const setting = new Setting(grid).setName(t(PROJECT_MODULE_LABELS[module]));
    setting.settingEl.dataset.module = module;
    setting.settingEl.setAttr('data-enabled', String(selected.has(module)));
    const description = DESCRIPTIONS[module];
    if (description) setting.setDesc(t(description));
    setting.addToggle(toggle => {
        toggle.setValue(selected.has(module));
        toggle.setTooltip(t(PROJECT_MODULE_LABELS[module]));
        toggle.onChange(onToggle);
    });
    if (module === 'chapterTemplates' && tools?.openChapterTemplates) {
        const openChapterTemplates = tools.openChapterTemplates;
        setting.addButton(button => button.setButtonText(t('Open')).setTooltip(t('Chapter templates and structure'))
            .setDisabled(!selected.has(module) || !tools.chapterTemplatesAvailable)
            .onClick(openChapterTemplates));
    }
}

/** One picker for creation and existing projects. No nested scrolling. */
export function renderProjectModulePicker(
    container: HTMLElement,
    selected: Set<ProjectModuleId>,
    onChange: (next: Set<ProjectModuleId>, libraryPack: LibraryCategoryPackId) => void,
    tools?: ProjectModulePickerTools,
): void {
    const libraryPack = tools?.libraryPack
        ?? libraryPackFromSelection(selected, false);
    container.empty();
    container.addClass('nl-project-module-picker');
    for (const [groupIndex, group] of PROJECT_MODULE_GROUPS.entries()) {
        const section = container.createEl('section', { cls: 'nl-module-group' });
        if (groupIndex === PROJECT_MODULE_GROUPS.length - 1) section.addClass('nl-module-group-tracking');
        const heading = section.createDiv('nl-module-group-heading');
        setIcon(heading.createSpan('nl-module-group-icon'), group.icon);
        heading.createEl('h3', { text: t(group.label) });
        heading.createSpan({ cls: 'nl-module-group-count', text: `${group.modules.filter(id => selected.has(id)).length} / ${group.modules.length}` });
        const grid = section.createDiv('nl-module-grid');
        for (const module of group.modules) {
            addModuleToggle(grid, module, selected, enabled => {
                if (module === 'library') {
                    if (!enabled) {
                        container.dataset.prevLibraryPack = libraryPack;
                        const next = new Set(toggleProjectModule(selected, module, false));
                        emitPickerChange(container, next, 'none', onChange, tools, module);
                        return;
                    }
                    const remembered = container.dataset.prevLibraryPack;
                    const restored: LibraryCategoryPackId =
                        remembered === 'narrative' || remembered === 'academic' || remembered === 'both'
                            ? remembered
                            : (libraryPack === 'none' ? 'academic' : libraryPack);
                    const next = new Set(applyLibraryPackToModules(
                        toggleProjectModule(selected, module, true),
                        restored,
                    ));
                    emitPickerChange(container, next, restored, onChange, tools, module);
                    return;
                }
                const next = new Set(toggleProjectModule(selected, module, enabled));
                emitPickerChange(container, next, libraryPack, onChange, tools, module);
            }, tools);
        }
        if (group.modules.includes('library') && selected.has('library')) {
            const packs = grid.createDiv('nl-library-pack-choices');
            packs.createEl('h4', { cls: 'nl-library-pack-heading', text: t('Library mode') });
            const packGrid = packs.createDiv('nl-library-pack-grid');
            for (const option of LIBRARY_PACK_OPTIONS) {
                const setting = new Setting(packGrid).setName(t(option.name));
                setting.settingEl.dataset.libraryPack = option.id;
                setting.settingEl.setAttr('data-enabled', String(libraryPack === option.id));
                setting.setDesc(t(option.description));
                setting.addToggle(toggle => {
                    toggle.setValue(libraryPack === option.id);
                    toggle.setTooltip(t(option.name));
                    toggle.onChange(on => {
                        const nextPack: LibraryCategoryPackId = on ? option.id : 'none';
                        const next = new Set(applyLibraryPackToModules(selected, nextPack));
                        emitPickerChange(container, next, nextPack, onChange, tools, `pack:${nextPack}`);
                    });
                });
            }
        }
    }
    container.createEl('p', { cls: 'nl-module-dependency-note', text: t('Required content modules are selected automatically. Turning them off also disables dependent views.') });
}
