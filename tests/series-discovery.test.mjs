import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
    entryPoints: ['./utils/seriesDiscovery.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});
const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

test('series metadata remains discoverable below user-named archive and library folders', () => {
    assert.equal(module.isDiscoverableSeriesMetadataPath('Archived/项目设定集/series.json'), true);
    assert.equal(module.isDiscoverableSeriesMetadataPath('Library/小说/series.json'), true);
    assert.equal(module.isDiscoverableSeriesMetadataPath('.trash/旧系列/series.json'), false);
    assert.equal(module.isDiscoverableSeriesMetadataPath('.obsidian/plugins/example/series.json'), false);
    assert.equal(module.isDiscoverableSeriesMetadataPath('Archived/项目设定集/series.json.bak'), false);
});

test('live direct-child projects omitted from stale metadata remain visible', () => {
    const order = module.mergeDiscoveredSeriesBookOrder(
        'Archived/项目设定集',
        ['90sMinor'],
        [
            {
                filePath: 'Archived/项目设定集/90sMinor/90sMinor.md',
                title: '90sMinor',
                seriesId: 'Lab',
            },
            {
                filePath: 'Archived/项目设定集/Nachtlied/Nachtlied.md',
                title: 'Nachtlied',
                seriesId: 'Lab',
            },
            {
                filePath: 'Notes/Outside/Outside.md',
                title: 'Outside',
                seriesId: 'Lab',
            },
        ],
    );
    assert.deepEqual(order, ['90sMinor', 'Nachtlied']);
});

test('series discovery does not duplicate a project already stored by title', () => {
    const order = module.mergeDiscoveredSeriesBookOrder(
        'Series',
        ['显示名称'],
        [{ filePath: 'Series/folder-name/project.md', title: '显示名称', seriesId: 'Series' }],
    );
    assert.deepEqual(order, ['显示名称']);
});
