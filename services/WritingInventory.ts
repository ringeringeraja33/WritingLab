import { countWordRevisionChurn, wordcountTokens, type WordcountPrepareOptions } from '../utils/wordcountText';

/** Separate changes to the document set/counting rules from edits to existing prose. */
export class WritingInventory {
    private entries = new Map<string, { text: string; words: number }>();
    private rules = '';
    total = 0;

    reset(): void { this.entries.clear(); this.rules = ''; this.total = 0; }

    countTotal(documents: Iterable<[string, string]>, locale: string, options: WordcountPrepareOptions): number {
        const sameRules = JSON.stringify([locale, options]) === this.rules;
        let total = 0;
        for (const [path, text] of documents) {
            const previous = this.entries.get(path);
            total += sameRules && previous?.text === text
                ? previous.words : wordcountTokens(text, locale, options).length;
        }
        return total;
    }

    update(documents: Iterable<[string, string]>, locale: string, options: WordcountPrepareOptions) {
        const rules = JSON.stringify([locale, options]);
        const sameRules = rules === this.rules;
        const next = new Map<string, { text: string; words: number }>();
        let total = 0, words = 0, revisions = 0;
        for (const [path, text] of documents) {
            const previous = this.entries.get(path);
            const count = sameRules && previous?.text === text
                ? previous.words : wordcountTokens(text, locale, options).length;
            next.set(path, { text, words: count });
            total += count;
            if (sameRules && previous) {
                words += count - previous.words;
                if (text !== previous.text) revisions += countWordRevisionChurn(previous.text, text, locale, options);
            }
        }
        const inventoryDelta = total - this.total - words;
        this.entries = next; this.total = total; this.rules = rules;
        return { total, words, revisions, inventoryDelta };
    }
}
