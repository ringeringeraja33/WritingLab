import { t } from './i18n';
import type { StoryGraphRelationCategory } from '../components/StoryGraph';

/** Wikilink edge types for research / literature-review graphs. */
export const ACADEMIC_STORY_GRAPH_LINK_CATEGORY_IDS = ['cites', 'supports', 'refutes'] as const;

/** Narrative Library leftovers that used to leak into literature graphs (e.g. Skills). */
const NARRATIVE_STORY_GRAPH_LINK_LEFTOVERS = new Set([
    'skill', 'skills', 'item', 'items', 'creature', 'creatures', 'lore',
    'organization', 'organizations', 'culture', 'system', 'systems',
    'character', 'characters', 'location', 'locations',
    '技能', '物品', '生物', '传说', '组织', '文化', '体系', '角色', '地点',
]);

export function academicStoryGraphLinkCategories(): StoryGraphRelationCategory[] {
    return [
        { id: 'cites', label: t('Cites'), color: '#3878BC', arrow: 'single' },
        { id: 'supports', label: t('Supports'), color: '#2E7D32', arrow: 'single' },
        { id: 'refutes', label: t('Refutes'), color: '#C62828', arrow: 'single' },
    ];
}

export function isNarrativeStoryGraphLinkLeftover(
    category: { id?: string; label?: string },
): boolean {
    // IDs carry provenance; labels are user-editable. Filtering by the label
    // would wrongly delete a legitimate academic custom relation that happens
    // to be named “Skill/技能”.
    const id = String(category.id || '').trim().toLowerCase();
    return !!id && NARRATIVE_STORY_GRAPH_LINK_LEFTOVERS.has(id);
}

/**
 * Cite / support / refute first. Keep other user-defined wikilink types, but
 * drop narrative Library leftovers such as Skills.
 */
export function mergeAcademicStoryGraphLinkCategories(
    saved: readonly StoryGraphRelationCategory[],
): StoryGraphRelationCategory[] {
    const academicIds = new Set<string>(ACADEMIC_STORY_GRAPH_LINK_CATEGORY_IDS);
    const byId = new Map(
        academicStoryGraphLinkCategories().map(category => [category.id, { ...category }]),
    );
    const extras: StoryGraphRelationCategory[] = [];
    for (const category of saved) {
        if (academicIds.has(category.id)) {
            const base = byId.get(category.id);
            if (!base) continue;
            byId.set(category.id, {
                ...base,
                ...category,
                label: category.label?.trim() || base.label,
            });
            continue;
        }
        if (isNarrativeStoryGraphLinkLeftover(category)) continue;
        extras.push(category);
    }
    return [...byId.values(), ...extras];
}
