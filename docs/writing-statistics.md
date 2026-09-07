# Writing statistics

The tracker measures changes to readable prose after a baseline is established.
It does not reconstruct writing history from existing documents or file timestamps.

- Project inventory: active workbench scenes, excluding inactive scenes, board notes,
  and optionally arc anchors. Projects without scenes use their Markdown document
  source, excluding the manifest, hidden paths and supporting asset/library folders.
- All projects: the sum of recorded project histories. Folder history is independent
  and is never added again to the project aggregate.
- Net words: additions minus deletions in existing tracked text. Repeated refreshes
  and save echoes do not add a second entry. Replacements of equal token count have
  zero net words and positive revision volume.
- Revisions: inserted/deleted token frequencies. Reordering identical tokens does
  not count as revision volume. This is not a keystroke counter.
- Existing/imported documents, whole-file removal, moves and counting-rule changes
  adjust inventory baselines, preserving accumulated writing and sprint results.
  To count a new draft from its first edit, begin with an empty tracked document.
- Markdown/YAML metadata is excluded from document prose. Embedded file names and
  standalone punctuation do not count. Project count profiles control checklist,
  comment, citation and reference exclusions; folder scopes use global exclusions.
- Chinese uses word segmentation, not a character count. Auto-language short CJK
  text uses the same word tokenizer for project totals, folder totals and revisions.
- Daily average includes zero-output calendar days. Streaks require positive net
  output; today at zero allows yesterday's streak to remain visible.
- Sprint totals are session measurements, not additional daily writing. On the
  all-projects tab, the sprint belongs to the named current project.

Project changes are settled before switching ledgers. A stale asynchronous document
scan cannot replace a newer scan. Aggregate reconciliation uses the active project's
live history and aborts if another edit arrives while it reads project ledgers.
Folder reload restores sprint logs and finalizes interrupted sprints at their last
saved inventory. Historical totals are retained, not retroactively recalculated.

Regression coverage: `tests/writing-count-consistency.test.mjs`,
`tests/writing-tracker-panel.test.mjs`, `tests/folder-writing-tracker.test.mjs`,
and `tests/wordcount-text.test.mjs`.
