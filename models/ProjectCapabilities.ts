export const PROJECT_CAPABILITIES_VERSION = 2;

export const PROJECT_MODULE_IDS = [
    'manuscript', 'notes', 'outline',
    'flatCanvas', 'columnBoard', 'table', 'canvas',
    'timeline', 'trackComparison', 'plotList', 'subwayMap', 'chapterTemplates',
    'research', 'library', 'scenes', 'characters',
    'locations', 'sceneDetails', 'sceneNotes', 'synopsis', 'series',
    'writingTracker', 'writingStats',
] as const;

export type SelectableProjectModuleId = typeof PROJECT_MODULE_IDS[number];
/** Internal data-owner aliases. Never persist these in a v2 manifest. */
export type ProjectModuleId = SelectableProjectModuleId | 'board' | 'structure' | 'plotlines';
const LEGACY_MODULES = {
    board: ['flatCanvas', 'columnBoard'],
    structure: ['timeline', 'trackComparison', 'chapterTemplates'],
    plotlines: ['plotList', 'subwayMap'],
} as const;
export type ProjectPresetId = 'plain-writing' | 'essay' | 'research-paper'
    | 'literature-review' | 'novel' | 'full-narrative' | 'custom' | 'legacy-full';
export type WordCountProfileId = 'general' | 'academic' | 'narrative' | 'custom';
export const LIBRARY_CATEGORY_PACKS = ['narrative', 'academic', 'both', 'none'] as const;
export type LibraryCategoryPackId = typeof LIBRARY_CATEGORY_PACKS[number];

export interface ProjectCapabilities {
    version: number;
    preset: ProjectPresetId;
    modules: ProjectModuleId[];
    wordCountProfile: WordCountProfileId;
    libraryPack: LibraryCategoryPackId;
    navigation?: {
        order: ProjectModuleId[];
        hidden: ProjectModuleId[];
        defaultPage?: ProjectModuleId;
    };
}

/**
 * Canonical, read-only interpretation of a project's content boundaries.
 * Consumers should ask this policy instead of combining presets, module flags,
 * and Library packs independently.
 */
export interface ProjectContentPolicy {
    libraryEnabled: boolean;
    libraryPack: LibraryCategoryPackId;
    academicLibrary: boolean;
    narrativeLibrary: boolean;
    characters: boolean;
    locations: boolean;
    narrativeScenes: boolean;
    thesesBinder: boolean;
    authoredCanvas: boolean;
}

export const PROJECT_MODULE_DEPENDENCIES: Readonly<Partial<Record<ProjectModuleId, readonly ProjectModuleId[]>>> = {
    writingTracker: [], writingStats: [], research: ['notes'],
    flatCanvas: ['notes'], columnBoard: ['notes'], timeline: ['scenes'],
    trackComparison: ['scenes'], plotList: ['scenes'], subwayMap: ['scenes'],
    chapterTemplates: ['scenes'],
    characters: ['library'], locations: ['library'], sceneDetails: ['scenes'],
    sceneNotes: ['scenes'], synopsis: ['scenes'], series: ['library'],
};

const WRITING = ['manuscript', 'writingTracker', 'writingStats'] as const;
const RESEARCH = ['manuscript', 'notes', 'outline', 'writingTracker', 'writingStats',
    'research', 'library', 'flatCanvas', 'columnBoard', 'table', 'scenes'] as const;
const NARRATIVE = ['manuscript', 'notes', 'outline', 'writingTracker', 'writingStats',
    'research', 'library', 'table', 'canvas', 'scenes', 'flatCanvas', 'columnBoard',
    'timeline', 'trackComparison', 'plotList', 'subwayMap', 'chapterTemplates',
    'characters', 'locations', 'sceneDetails',
    'sceneNotes', 'synopsis'] as const;

export const PROJECT_PRESETS: Readonly<Record<ProjectPresetId, readonly ProjectModuleId[]>> = {
    'plain-writing': WRITING,
    essay: ['manuscript', 'notes', 'writingTracker', 'writingStats'],
    'research-paper': RESEARCH,
    'literature-review': RESEARCH,
    novel: NARRATIVE,
    'full-narrative': [...NARRATIVE, 'series'],
    custom: WRITING,
    'legacy-full': PROJECT_MODULE_IDS,
};

export function isProjectModuleId(value: unknown): value is ProjectModuleId {
    return typeof value === 'string' && ((PROJECT_MODULE_IDS as readonly string[]).includes(value)
        || Object.prototype.hasOwnProperty.call(LEGACY_MODULES, value));
}

function withResearchOrganizeModules(modules: ProjectModuleId[]): ProjectModuleId[] {
    const next = modules.filter(id => id !== 'canvas');
    for (const id of ['flatCanvas', 'columnBoard'] as const) {
        if (!next.includes(id)) next.push(id);
    }
    return next;
}

function withResearchPaperModules(modules: ProjectModuleId[]): ProjectModuleId[] {
    const next = withResearchOrganizeModules(modules);
    if (!next.includes('scenes')) next.push('scenes');
    return next;
}

function withResearchOrganizeOrder(order: ProjectModuleId[]): ProjectModuleId[] {
    const next: ProjectModuleId[] = order.filter(id => id !== 'canvas');
    const place = (id: ProjectModuleId, before: readonly ProjectModuleId[]) => {
        if (next.includes(id)) return;
        let at = -1;
        for (const item of before) {
            const index = next.indexOf(item);
            if (index >= 0) { at = index; break; }
        }
        if (at < 0) next.push(id);
        else next.splice(at, 0, id);
    };
    place('flatCanvas', ['columnBoard', 'table']);
    place('columnBoard', ['table']);
    return next;
}

export function normalizeProjectCapabilities(value: unknown): ProjectCapabilities {
    if (!value || typeof value !== 'object') {
        return capabilitiesForPreset('legacy-full');
    }
    const raw = value as Record<string, unknown>;
    const preset = typeof raw.preset === 'string' && raw.preset in PROJECT_PRESETS
        ? raw.preset as ProjectPresetId : 'custom';
    let modules = Array.isArray(raw.modules)
        ? raw.modules.filter(isProjectModuleId) : [...PROJECT_PRESETS[preset]];
    // Old grouped pages exposed all their subviews. Expand once, without making
    // a disabled v2 subview reappear through a legacy data-owner alias.
    if (typeof raw.version === 'number' && raw.version >= 2) {
        modules = modules.filter(id => !Object.prototype.hasOwnProperty.call(LEGACY_MODULES, id));
    }
    if (preset === 'research-paper' || preset === 'literature-review') {
        modules = withResearchPaperModules(modules);
    }
    const profile = raw.wordCountProfile;
    const wordCountProfile: WordCountProfileId = profile === 'academic'
        || profile === 'narrative' || profile === 'custom' ? profile : 'general';
    const navigation = raw.navigation && typeof raw.navigation === 'object'
        ? raw.navigation as Record<string, unknown> : null;
    const pageIds = (value: unknown): ProjectModuleId[] => Array.isArray(value)
        ? [...new Set(value.filter(id => (PROJECT_MODULE_IDS as readonly unknown[]).includes(id)))] as ProjectModuleId[] : [];
    const resolvedNavigation = navigation ? {
        order: pageIds(navigation.order), hidden: pageIds(navigation.hidden),
        ...(pageIds([navigation.defaultPage])[0] ? { defaultPage: pageIds([navigation.defaultPage])[0] } : {}),
    } : undefined;
    if (resolvedNavigation && (preset === 'research-paper' || preset === 'literature-review')) {
        resolvedNavigation.order = withResearchOrganizeOrder(resolvedNavigation.order);
        if (resolvedNavigation.defaultPage === 'canvas') resolvedNavigation.defaultPage = 'library';
    }
    const resolvedModules = resolveModuleDependencies(modules);
    const draft: ProjectCapabilities = {
        version: PROJECT_CAPABILITIES_VERSION,
        preset,
        modules: resolvedModules,
        wordCountProfile,
        libraryPack: 'none',
        ...(resolvedNavigation ? { navigation: resolvedNavigation } : {}),
    };
    draft.libraryPack = isLibraryCategoryPackId(raw.libraryPack)
        ? raw.libraryPack
        : inferLibraryCategoryPack(draft);
    // The Library module decides whether a Library exists; its mutually
    // exclusive pack decides which category-owned modules exist inside it.
    // Normalize every persisted combination so stale module flags cannot
    // overrule an explicit academic/empty selection after restart.
    if (!draft.modules.includes('library')) draft.libraryPack = 'none';
    draft.modules = applyLibraryPackToModules(draft.modules, draft.libraryPack);
    return draft;
}

export function capabilitiesForPreset(preset: ProjectPresetId): ProjectCapabilities {
    const navigation = preset === 'research-paper' || preset === 'literature-review'
        ? { order: ['library', 'manuscript', 'flatCanvas', 'columnBoard', 'table'] as ProjectModuleId[], hidden: [] as ProjectModuleId[], defaultPage: 'library' as const }
        : undefined;
    const capabilities: ProjectCapabilities = {
        version: PROJECT_CAPABILITIES_VERSION,
        preset,
        modules: resolveModuleDependencies(PROJECT_PRESETS[preset]),
        wordCountProfile: preset === 'research-paper' || preset === 'literature-review'
            ? 'academic' : preset === 'novel' || preset === 'full-narrative' || preset === 'legacy-full'
                ? 'narrative' : 'general',
        libraryPack: 'none',
        ...(navigation ? { navigation } : {}),
    };
    capabilities.libraryPack = inferLibraryCategoryPack(capabilities);
    return capabilities;
}

export function resolveModuleDependencies(modules: Iterable<ProjectModuleId>): ProjectModuleId[] {
    const enabled = new Set<ProjectModuleId>();
    for (const module of modules) {
        const legacy = LEGACY_MODULES[module as keyof typeof LEGACY_MODULES];
        if (legacy) {
            legacy.forEach(id => enabled.add(id));
            enabled.add('scenes');
            // Both v1 structure screens exposed all five cross-linked subviews.
            if (module === 'structure' || module === 'plotlines') {
                [...LEGACY_MODULES.structure, ...LEGACY_MODULES.plotlines].forEach(id => enabled.add(id));
            }
        }
        else enabled.add(module);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const module of [...enabled]) {
            for (const dependency of PROJECT_MODULE_DEPENDENCIES[module] ?? []) {
                if (!enabled.has(dependency)) { enabled.add(dependency); changed = true; }
            }
        }
    }
    return PROJECT_MODULE_IDS.filter(module => enabled.has(module));
}

export function moduleEnabled(capabilities: ProjectCapabilities | undefined, module: ProjectModuleId): boolean {
    const enabled = normalizeProjectCapabilities(capabilities).modules;
    const legacy = LEGACY_MODULES[module as keyof typeof LEGACY_MODULES];
    return legacy ? legacy.some(id => enabled.includes(id)) : enabled.includes(module);
}

/** Research papers use a Theses binder instead of Scenes. */
export function usesThesesBinder(capabilities?: ProjectCapabilities): boolean {
    const preset = capabilities?.preset ?? (capabilities
        ? normalizeProjectCapabilities(capabilities).preset
        : undefined);
    return preset === 'research-paper' || preset === 'literature-review';
}

export function isLibraryCategoryPackId(value: unknown): value is LibraryCategoryPackId {
    return typeof value === 'string' && (LIBRARY_CATEGORY_PACKS as readonly string[]).includes(value);
}

/** Combine character/location modules with the academic Library toggle. Scenes do not pick a pack. */
export function libraryPackFromSelection(
    modules: Iterable<ProjectModuleId>,
    academicLibrary: boolean,
): LibraryCategoryPackId {
    const enabled = new Set(resolveModuleDependencies(modules));
    const narrative = enabled.has('characters') || enabled.has('locations');
    if (academicLibrary && narrative) return 'both';
    if (academicLibrary) return 'academic';
    if (narrative) return 'narrative';
    return 'none';
}

export function usesAcademicLibraryCategories(pack: LibraryCategoryPackId): boolean {
    return pack === 'academic' || pack === 'both';
}

export function usesNarrativeLibraryCategories(pack: LibraryCategoryPackId): boolean {
    return pack === 'narrative' || pack === 'both';
}

/** Authored Canvas/ corkboard files. Flat/column boards do not use that folder. */
export function usesAuthoredCanvasFolder(capabilities?: ProjectCapabilities): boolean {
    return normalizeProjectCapabilities(capabilities).modules.includes('canvas');
}

/** Keep character/location modules aligned with the chosen Library pack. */
export function applyLibraryPackToModules(
    modules: Iterable<ProjectModuleId>,
    pack: LibraryCategoryPackId,
): ProjectModuleId[] {
    const selected = new Set(resolveModuleDependencies(modules));
    if (pack === 'none') {
        selected.delete('characters');
        selected.delete('locations');
        return PROJECT_MODULE_IDS.filter(id => selected.has(id));
    }
    selected.add('library');
    if (pack === 'academic') {
        selected.delete('characters');
        selected.delete('locations');
    } else {
        selected.add('characters');
        selected.add('locations');
    }
    return resolveModuleDependencies(selected);
}

/** Saved pack, or a fallback that does not treat scenes as narrative Library. */
export function inferLibraryCategoryPack(capabilities: ProjectCapabilities): LibraryCategoryPackId {
    if (capabilities.preset === 'research-paper' || capabilities.preset === 'literature-review'
        || capabilities.preset === 'essay') {
        return 'academic';
    }
    if (capabilities.preset === 'novel' || capabilities.preset === 'full-narrative'
        || capabilities.preset === 'legacy-full') {
        return 'narrative';
    }
    const modules = new Set(capabilities.modules);
    const narrative = modules.has('characters') || modules.has('locations');
    if (narrative) return 'narrative';
    if (modules.has('library')) return 'academic';
    return 'none';
}

/** Fiction worldbuilding tabs, academic literature tabs, both, or neither. */
export function libraryCategoryPack(
    capabilities: ProjectCapabilities | undefined,
): LibraryCategoryPackId {
    return normalizeProjectCapabilities(capabilities).libraryPack;
}

/** Single source of truth for project-type-sensitive UI and storage behavior. */
export function resolveProjectContentPolicy(
    capabilities: ProjectCapabilities | undefined,
): ProjectContentPolicy {
    const normalized = normalizeProjectCapabilities(capabilities);
    const modules = new Set(normalized.modules);
    const libraryEnabled = modules.has('library');
    const pack = libraryEnabled ? normalized.libraryPack : 'none';
    const narrativeLibrary = libraryEnabled && usesNarrativeLibraryCategories(pack);
    const academicLibrary = libraryEnabled && usesAcademicLibraryCategories(pack);
    const thesesBinder = usesThesesBinder(normalized);
    return {
        libraryEnabled,
        libraryPack: pack,
        academicLibrary,
        narrativeLibrary,
        characters: narrativeLibrary && modules.has('characters'),
        locations: narrativeLibrary && modules.has('locations'),
        narrativeScenes: modules.has('scenes') && !thesesBinder,
        thesesBinder,
        authoredCanvas: modules.has('canvas'),
    };
}

/** Disabling a prerequisite also disables its dependants; the UI must show this immediately. */
export function toggleProjectModule(modules: Iterable<ProjectModuleId>, module: ProjectModuleId, on: boolean): ProjectModuleId[] {
    const selected = new Set(resolveModuleDependencies(modules));
    if (on) return resolveModuleDependencies([...selected, module]);
    selected.delete(module);
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of selected) {
            if (PROJECT_MODULE_DEPENDENCIES[id]?.some(dependency => !selected.has(dependency))) {
                selected.delete(id);
                changed = true;
            }
        }
    }
    return PROJECT_MODULE_IDS.filter(id => selected.has(id));
}
