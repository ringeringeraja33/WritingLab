/** Insert index in a left-to-right strip. `length` means after the last tab. */
export function tabStripInsertIndex(
    tabs: readonly { left: number; width: number }[],
    clientX: number,
): number {
    for (let i = 0; i < tabs.length; i++) {
        if (clientX < tabs[i].left + tabs[i].width / 2) return i;
    }
    return tabs.length;
}

/** True when dropping at `insertIndex` would actually move `from`. */
export function tabStripMoveCommits(from: number, insertIndex: number): boolean {
    return from >= 0 && insertIndex !== from && insertIndex !== from + 1;
}

const DRAG_THRESHOLD_PX = 6;

export function attachPointerTabReorder(options: {
    container: HTMLElement;
    getTabs: () => HTMLButtonElement[];
    idOf: (tab: HTMLButtonElement) => string | undefined;
    onReorder: (ids: string[]) => void | Promise<void>;
    onError?: (error: unknown) => void;
    ignoreClosest?: string;
    appendBefore?: () => Element | null;
}): void {
    const { container, getTabs, idOf, onReorder, onError, ignoreClosest, appendBefore } = options;
    let dragged: HTMLButtonElement | null = null;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let active = false;
    let suppressClickUntil = 0;
    let boundDoc: Document | null = null;
    let commitQueue: Promise<void> = Promise.resolve();

    const enqueueCommit = (ordered: string[]) => {
        const task = commitQueue
            .catch(() => undefined)
            .then(() => onReorder(ordered));
        commitQueue = task.then(() => undefined, () => undefined);
        void task.catch(error => onError?.(error));
    };

    const visibleTabs = () => getTabs().filter(tab => !tab.hidden);

    const clearIndicators = () => {
        for (const tab of getTabs()) tab.removeClass('is-drag-over-before', 'is-drag-over-after');
    };

    const unbindDoc = () => {
        if (!boundDoc) return;
        boundDoc.removeEventListener('pointermove', onDocMove, true);
        boundDoc.removeEventListener('pointerup', onDocUp, true);
        boundDoc.removeEventListener('pointercancel', onDocUp, true);
        boundDoc = null;
    };

    const paint = (clientX: number) => {
        clearIndicators();
        const visible = visibleTabs();
        if (!dragged || visible.length === 0) return;
        const from = visible.indexOf(dragged);
        const boxes = visible.map(tab => {
            const rect = tab.getBoundingClientRect();
            return { left: rect.left, width: rect.width };
        });
        const index = tabStripInsertIndex(boxes, clientX);
        if (!tabStripMoveCommits(from, index)) return;
        if (index >= visible.length) {
            visible[visible.length - 1]?.addClass('is-drag-over-after');
            return;
        }
        visible[index]?.addClass('is-drag-over-before');
    };

    const finish = (clientX: number) => {
        const tab = dragged;
        const id = pointerId;
        dragged = null;
        pointerId = -1;
        unbindDoc();
        if (!tab) return;
        if (active) {
            const visible = visibleTabs();
            const from = visible.indexOf(tab);
            const boxes = visible.map(item => {
                const rect = item.getBoundingClientRect();
                return { left: rect.left, width: rect.width };
            });
            const to = tabStripInsertIndex(boxes, clientX);
            if (tabStripMoveCommits(from, to)) {
                const before = getTabs().map(idOf).filter((value): value is string => Boolean(value));
                const ref = to < visible.length ? visible[to] : appendBefore?.() ?? null;
                container.insertBefore(tab, ref);
                const ordered = getTabs().map(idOf).filter((value): value is string => Boolean(value));
                if (ordered.join('\0') !== before.join('\0')) {
                    enqueueCommit(ordered);
                }
            }
            suppressClickUntil = Date.now() + 250;
        }
        tab.removeClass('is-dragging');
        clearIndicators();
        if (id >= 0 && tab.hasPointerCapture(id)) {
            try { tab.releasePointerCapture(id); } catch { /* already released */ }
        }
        active = false;
    };

    const onDocMove = (event: PointerEvent) => {
        if (!dragged || event.pointerId !== pointerId) return;
        if (!active) {
            if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) return;
            active = true;
            dragged.addClass('is-dragging');
        }
        event.preventDefault();
        paint(event.clientX);
    };

    const onDocUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        finish(event.clientX);
    };

    for (const tab of getTabs()) {
        tab.addClass('is-reorderable');
        tab.draggable = false;
        tab.addEventListener('dragstart', event => event.preventDefault());
        tab.addEventListener('click', event => {
            if (Date.now() >= suppressClickUntil) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        tab.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            if (ignoreClosest && (event.target as HTMLElement).closest(ignoreClosest)) return;
            if (dragged) finish(event.clientX);
            dragged = tab;
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            active = false;
            boundDoc = tab.ownerDocument;
            boundDoc.addEventListener('pointermove', onDocMove, true);
            boundDoc.addEventListener('pointerup', onDocUp, true);
            boundDoc.addEventListener('pointercancel', onDocUp, true);
            try { tab.setPointerCapture(event.pointerId); } catch { /* capture unsupported */ }
        });
    }
}
