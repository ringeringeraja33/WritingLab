// Isolated DOM regression test: exercises real components, never opens or writes a vault.
// Set NARRATIVE_LAB_PLAYWRIGHT to a Playwright package path when not installed locally.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NARRATIVE_LAB_PLAYWRIGHT || 'playwright');
const main = await readFile('main.ts', 'utf8');
const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const pluginClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SceneCardsPlugin');
const wizard = pluginClass.members.find(node => node.name?.getText(ast) === 'openNewProjectModal').getText(ast);
const manuscript = await readFile('views/ManuscriptView.ts','utf8');
const manuscriptAst = ts.createSourceFile('ManuscriptView.ts',manuscript,ts.ScriptTarget.Latest,true);
const manuscriptClass = manuscriptAst.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ManuscriptView');
const foldMethods = ['loadDocumentFolds','installDocumentFold'].map(name=>manuscriptClass.members.find(node=>node.name?.getText(manuscriptAst)===name).getText(manuscriptAst)).join('\n');
const board = await readFile('views/BoardView.ts', 'utf8');
const boardAst = ts.createSourceFile('BoardView.ts', board, ts.ScriptTarget.Latest, true);
const boardClass = boardAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BoardView');
const boardToolbar = boardClass.members.find(node => node.name?.getText(boardAst) === 'renderToolbar').getText(boardAst);
const host = `
window.activeDocument = document;
window.activeWindow = window;
const create = function(tag, options = {}) {
  if (typeof options === 'string') options = {cls: options};
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text != null) el.textContent = options.text;
  if (options.type) el.type = options.type;
  for (const [k,v] of Object.entries(options.attr || {})) el.setAttribute(k,v);
  options.prepend ? this.prepend(el) : this.append(el); return el;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function(options) { return create.call(this,'div', options); };
HTMLElement.prototype.createSpan = function(options) { return create.call(this,'span', options); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...cls) { this.classList.add(...cls); };
HTMLElement.prototype.removeClass = function(...cls) { this.classList.remove(...cls); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
HTMLElement.prototype.setAttr = function(key,value) { this.setAttribute(key,value); };
HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
HTMLElement.prototype.toggle = function(on) { this.style.display = on ? '' : 'none'; };
export const normalizePath = value => value;
export const setIcon = (el, icon) => { el.dataset.icon = icon; el.textContent = '◇'; };
export class WorkspaceLeaf {}
export class TFolder {}
export class ItemView {
 constructor(leaf){this.app=leaf.app;this.containerEl=document.body.createDiv();this.containerEl.createDiv();this.containerEl.createDiv();}
 getState(){return {}} async setState(){} register(){}
}
export class Notice { constructor(message) { window.lastNotice = message; } }
export class Modal {
 constructor(app) { this.app=app; this.modalEl=document.body.createDiv('modal'); this.titleEl=this.modalEl.createEl('h2',{cls:'modal-title'}); this.contentEl=this.modalEl.createDiv('modal-content'); }
 open() { this.onOpen?.(); }
 close() { this.onClose?.(); this.modalEl.remove(); }
}
export class FuzzySuggestModal extends Modal { setPlaceholder(){return this} }
class Control {
 constructor(el) { this.inputEl=el; this.buttonEl=el; this.el=el; }
 addOption(value,label) { this.el.createEl('option',{text:label,attr:{value}}); return this; }
 setValue(value) { if(this.el.type==='checkbox') this.el.checked=value; else this.el.value=value; return this; }
 setPlaceholder(value) { this.el.placeholder=value; return this; }
 setDisabled(value) { this.el.disabled=value; return this; }
 setButtonText(value) { this.el.textContent=value; return this; }
 setIcon(value) { setIcon(this.el,value); return this; }
 setTooltip(value) { this.el.setAttribute('aria-label',value); return this; }
 setCta() { this.el.classList.add('mod-cta'); return this; }
 onChange(fn) { this.el.addEventListener('change',()=>fn(this.el.type==='checkbox'?this.el.checked:this.el.value)); return this; }
 onClick(fn) { this.el.addEventListener('click',fn); return this; }
}
export class Setting {
 constructor(el) { this.settingEl=el.createDiv('setting-item'); this.info=this.settingEl.createDiv('setting-item-info'); this.controls=this.settingEl.createDiv('setting-item-control'); }
 setName(text) { this.info.createDiv({cls:'setting-item-name',text}); return this; }
 setDesc(text) { this.info.createDiv({cls:'setting-item-description',text}); return this; }
 addDropdown(fn) { fn(new Control(this.controls.createEl('select'))); return this; }
 addText(fn) { fn(new Control(this.controls.createEl('input'))); return this; }
 addToggle(fn) { fn(new Control(this.controls.createEl('input',{type:'checkbox',cls:'checkbox-container'}))); return this; }
 addButton(fn) { fn(new Control(this.controls.createEl('button',{attr:{type:'button'}}))); return this; }
}
export class Menu {
 items=[];
 addItem(fn) { const data={}; const item={ setTitle(v){data.title=v;return item},setIcon(){return item},onClick(v){data.click=v;return item} }; fn(item); this.items.push(data); return this; }
 addSeparator() { return this; }
 showAtPosition(pos) { document.querySelector('.test-menu')?.remove(); const el=document.body.createDiv('test-menu'); Object.assign(el.style,{left:pos.x+'px',top:pos.y+'px'}); for (const item of this.items) el.createEl('button',{text:item.title}).addEventListener('click',()=>{el.remove();item.click()}); }
}
`;
const stubs = {
    ConverterModal: 'export class ConverterModal { open(){} }',
    MobileAdapter: 'export const isMobile=false; export const DESKTOP_ONLY_VIEWS=new Set();',
    Tooltip: 'export const attachTooltip=(el,text)=>el.title=text;',
    LibraryModeBar: 'export const getRememberedLibraryCategory=()=>null; export const resolveLibraryViewType=()=>"narrative-lab-library";',
    LibraryCategorySync: 'export const resolveLibraryCategoryLabel=(_,__,label)=>label;',
    Codex: 'export const getBuiltinCodexCategory=()=>null; export const makeProfileCodexCategory=x=>x; export const shouldCreateLibraryCategoryFolder=()=>true;',
    NCanvasLibraryView: 'export const openNewProjectCanvasModal=()=>{};',
};
const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { Modal, Setting, Notice } from 'obsidian';
import * as obsidian from 'obsidian';
import { attachTooltip } from './components/Tooltip';
import { renderProjectModulePicker, PROJECT_MODULE_LABELS } from './components/ProjectModulePicker';
import { ProjectModulesModal } from './components/ProjectModulesModal';
import { renderViewSwitcher } from './components/ViewSwitcher';
import { PROJECT_PRESETS, capabilitiesForPreset, resolveModuleDependencies, normalizeProjectCapabilities, moduleEnabled } from './models/ProjectCapabilities';
import { PROJECT_PAGES } from './models/ProjectPages';
import { WritingTrackerPanel } from './views/WritingTrackerPanel';
import { WritingTracker } from './services/WritingTracker';
import { FolderWritingScope } from './services/FolderWritingScope';
import { setActiveUiLanguage, t } from './utils/i18n';
class ProjectFolderSuggest { constructor(...args){} close(){} }
class Wizard { ${wizard} }
class BoardToolbarHarness {
 boardMode='corkboard'; groupBy='chapter'; boundProjectFile='Projects/Test/Test.md';
 constructor(public plugin, public leaf) {}
 getViewType(){return this.boardMode==='kanban'?'narrative-lab-column-board':'narrative-lab-board'}
 usesScenes(){return true}
 ${boardToolbar}
}
class FoldHarness {
 documentFolds={}; documentFoldOwner=''; lazyObserver=null;
 constructor(private owner:string){this.loadDocumentFolds()}
 getBoundProjectFile(){return this.owner}
 async mountEditor(){window.foldMounts=(window.foldMounts||0)+1}
 ${foldMethods}
}
window.showFolds=(owner='A')=>{document.body.empty();window.foldMounts=0;const harness=new FoldHarness(owner);
 const wrap=document.body.createDiv('story-line-manuscript-container');
 for(const path of ['one.md','two.md']){const block=wrap.createEl('details',{cls:'sl-manuscript-scene-block'});harness.installDocumentFold(block,path);
 block.createEl('summary',{cls:'sl-manuscript-scene-header',text:path});const editor=block.createDiv('sl-manuscript-editor-wrap');editor.createEl('textarea').value='unsaved writing';}
};
setActiveUiLanguage('zh');
const project={title:'测试项目',filePath:'Projects/Test/Test.md',capabilities:capabilitiesForPreset('full-narrative')};
const plugin={ app:{workspace:{revealLeaf(){}}}, settings:{storyLineRoot:'Projects'}, sceneManager:{getProjects:()=>[project]}, capabilityService:{get:()=>normalizeProjectCapabilities(project.capabilities),isEnabled:(module)=>moduleEnabled(project.capabilities,module)},
 getProjectDisplayName:()=>project.title, async updateProjectTabOrder(p,order){p.capabilities.navigation={...p.capabilities.navigation,order,hidden:p.capabilities.navigation?.hidden??[]};},
 openChapterTemplates:async()=>{window.lastTool='chapterTemplates';},
 isViewEnabled(type){ const page=PROJECT_PAGES.find(p=>p.type===type); return page?moduleEnabled(project.capabilities,page.module):false; },
 async updateProjectModules(p,c){p.capabilities=c;}, getNcanvasPathsForProject:()=>({candidates:[]}), openProjectCanvasTab(){window.lastPage='canvas';}, activateView(type){window.lastPage=type;} };
window.showSettings=()=>{document.body.empty();new ProjectModulesModal(plugin.app,plugin,project).open()};
window.showWizard=()=>{document.body.empty();const instance=new Wizard();Object.assign(instance,plugin);void instance.openNewProjectModal()};
window.showTabs=()=>{document.body.empty();const toolbar=document.body.createDiv('story-line-toolbar');toolbar.createEl('h3',{text:'Test',cls:'story-line-view-title'});
const leaf={view:{containerEl:document.body,register(){}},getViewState:()=>({state:{narrativeLabProjectFile:project.filePath}}),async setViewState(state){window.lastPage=state.type;}};
renderViewSwitcher(toolbar,'narrative-lab-board',plugin,leaf);};
window.showNarrowBoard=(width=560,mode='corkboard')=>{
 document.body.empty();
 // Fixed pane inside a wide viewport, matching desktop split views.
 const pane=document.body.createDiv({cls:'test-narrow-pane'});
 Object.assign(pane.style,{width:width+'px',height:'440px',display:'flex',flexDirection:'column',background:'white'});
 project.title='Writing · 一个需要在窄面板中截断的很长项目名称';
 const leaf={view:{containerEl:pane,register(){}},getViewState:()=>({state:{narrativeLabProjectFile:project.filePath}}),async setViewState(s){window.lastPage=s.type;}};
 const toolbar=pane.createDiv('story-line-toolbar sl-two-row-toolbar');
 const harness=new BoardToolbarHarness(plugin,leaf);harness.boardMode=mode;harness.renderToolbar(toolbar);
 const canvas=pane.createDiv({cls:'test-canvas',text:'画布内容'});Object.assign(canvas.style,{flex:'1 1 0',minHeight:'0',background:'#f4f6fa'});
};
window.showFolderTracker=async(width)=>{
 document.body.empty();const scope=new FolderWritingScope({id:'folder1',path:'日记/随笔',recursive:true,locale:'zh',tracker:{history:{}}});
 scope.setText('日记/随笔/一.md','这是已有的文稿内容。',false);scope.tracker.startSession(scope.totalWords,true);
 let panel;
 const folderService={current:scope,ready:true,busy:false,error:'',savedScopes:[scope.config],scheduleSave(){},
 async stop(){this.savedScopes=this.savedScopes.filter(s=>s.id!==this.current.config.id);this.current=null;this.ready=false;panel.refresh()},async select(){this.current=scope;this.ready=true;panel.refresh()}};
 const trackerPlugin={...plugin,writingTracker:new WritingTracker(),globalWritingTracker:{tracker:new WritingTracker()},folderWritingTracker:folderService,
 app:{...plugin.app,workspace:{...plugin.app.workspace,requestSaveLayout(){}}},scheduleWritingTrackerSave(){},saveSettings:async()=>{}};
 panel=new WritingTrackerPanel({app:trackerPlugin.app},trackerPlugin);if(width)panel.containerEl.style.width=width+'px';await panel.onOpen();panel.setScope('folder');window.folderPanel=panel;
 window.folderService=folderService;
};
` }, bundle: true, write: false, format: 'iife',
    plugins: [{ name: 'isolated-host', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
        b.onResolve({ filter: /(ConverterModal|MobileAdapter|Tooltip|LibraryModeBar|LibraryCategorySync|models\/Codex|NCanvasLibraryView)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'host' }));
        b.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: args.path === 'obsidian' ? host : stubs[args.path], loader: 'js' }));
    } }],
});
const browser = await chromium.launch({ headless: true, ...(process.env.NARRATIVE_LAB_BROWSER ? { executablePath: process.env.NARRATIVE_LAB_BROWSER } : {}) });
const output = await mkdtemp(join(tmpdir(), 'writinglab-module-ui-'));
try {
    const page = await browser.newPage({ viewport: { width: 1050, height: 850 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('http://writinglab-ui.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><body></body>'}));
    await page.goto('http://writinglab-ui.test/');
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await page.addStyleTag({ content: `:root{--background-primary:#fff;--background-modifier-border:#ddd;--text-normal:#242424;--text-muted:#666;--size-4-2:8px;--font-ui-small:13px;--interactive-accent:#3878bc}*{box-sizing:border-box}body{font:15px system-ui;margin:0;background:#f4f4f4;color:#242424}.modal{margin:20px auto;background:white;padding:24px;border-radius:12px;max-width:94vw}.modal-content{max-height:75vh;overflow:auto}.setting-item{display:flex;justify-content:space-between;align-items:center;padding:12px 0;gap:12px}.setting-item-control{display:flex;align-items:center;gap:8px}.setting-item-description{font-size:12px;color:#666;margin-top:5px}button,select,input{font:inherit}button,select{padding:6px 10px;border:1px solid #ddd;background:white;border-radius:6px}input[type=checkbox]{width:30px;height:22px;accent-color:#3878bc}.mod-cta{background:#3878bc;color:white}.test-menu{position:fixed;display:grid;z-index:100;background:white;border:1px solid #ddd;padding:8px}.story-line-toolbar{background:white;padding:16px}` });
    await page.addStyleTag({ content: await readFile('styles.css', 'utf8') });
    if (process.env.NARRATIVE_LAB_THEME_CSS) await page.addStyleTag({ content: await readFile(process.env.NARRATIVE_LAB_THEME_CSS, 'utf8') });
    // Emulate large host text and native first-row rules; scoped UI styles must win.
    await page.addStyleTag({content:`:root{--background-secondary:#f3f4f6;--background-primary-alt:#f9fafb;--font-interface:system-ui,sans-serif}body{font-size:24px}.modal-title{margin:0 0 8px}.setting-item:first-child{padding-top:0;border-top:0}input[type=checkbox]{appearance:none;position:relative;flex-shrink:0;width:32px;height:19px;border-radius:20px;margin:0;background:#ced2d8;border:0}input[type=checkbox]:checked{background:#3878bc}input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:white;box-shadow:0 1px 2px #0002}input[type=checkbox]:checked::after{left:16px}`});
    await page.addScriptTag({ content: result.outputFiles[0].text });
    assert.deepEqual(errors, [], 'fixture module initialization');
    await page.evaluate(() => window.showSettings());
    assert.deepEqual(await page.locator('[data-module]').evaluateAll(rows => rows.slice(-2).map(row => row.dataset.module)), ['writingTracker','writingStats']);
    for (const id of ['flatCanvas','columnBoard','canvas','timeline','trackComparison','plotList','subwayMap','chapterTemplates']) assert.equal(await page.locator(`[data-module="${id}"]`).count(), 1);
    await page.locator('[data-module="flatCanvas"] input').uncheck();
    assert.equal(await page.locator('[data-module="columnBoard"] input').isChecked(), true);
    assert.equal(await page.locator('[data-module="manuscript"] .setting-item-name').evaluate(el=>getComputedStyle(el).fontSize),'13px');
    assert.equal(await page.locator('[data-module="manuscript"]').evaluate(el=>getComputedStyle(el).paddingTop),'14px');
    assert.equal(await page.locator('[data-module="manuscript"]').evaluate(el=>getComputedStyle(el).paddingLeft),'18px');
    assert.equal(await page.locator('[data-module="manuscript"]').evaluate(el=>getComputedStyle(el).borderTopWidth),'1px');
    assert.equal(await page.locator('[data-module="notes"]').evaluate(el=>getComputedStyle(el).borderTopWidth),'1px', 'first-child keeps a full border');
    assert.equal(await page.locator('[data-module="notes"]').evaluate(el => {
        const name = el.querySelector('.setting-item-name').getBoundingClientRect();
        const toggle = el.querySelector('input').getBoundingClientRect();
        return name.right <= toggle.left;
    }), true, 'toggle stays to the right of its label');
    assert.equal(await page.locator('[data-module="library"]').evaluate(el => {
        const desc = el.querySelector('.setting-item-description').getBoundingClientRect();
        const toggle = el.querySelector('input').getBoundingClientRect();
        return desc.right <= toggle.left - 4;
    }), true, 'description does not overlap the toggle');
    assert.equal(await page.locator('[data-library-pack="academic"]').count(), 1);
    assert.equal(await page.locator('[data-library-pack="narrative"]').count(), 1);
    assert.equal(await page.locator('[data-library-pack="both"]').count(), 1);
    assert.equal(await page.locator('[data-module="characters"]').count(), 0);
    assert.equal(await page.locator('[data-library-pack="narrative"] input').isChecked(), true);
    assert.equal(await page.locator('[data-library-pack="academic"] input').isChecked(), false);
    await page.locator('[data-library-pack="academic"] input').check();
    assert.equal(await page.locator('[data-library-pack="academic"] input').isChecked(), true);
    assert.equal(await page.locator('[data-library-pack="narrative"] input').isChecked(), false);
    assert.equal(await page.locator('.nl-module-group-tracking .nl-module-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    assert.deepEqual(await page.locator('.nl-module-group h3').evaluateAll(els => els.map(el => el.textContent)), ['写作','画布与整理','叙事规划','叙事内容','资料与研究','写作进度']);
    assert.equal(await page.locator('[data-module="series"]').evaluate(el => {
        const grid = el.parentElement.getBoundingClientRect();
        return el.getBoundingClientRect().width < grid.width * 0.7;
    }), true, 'odd leftover module stays in the left column');
    await page.getByRole('tab',{name:'页签布局',exact:true}).click();
    assert.ok(await page.getByText('分组只整理入口，各功能仍可独立开关。',{exact:true}).isVisible());
    assert.ok(await page.locator('.nl-layout-group-heading').filter({hasText:'整理'}).isVisible());
    assert.equal(await page.locator('.nl-layout-group').count(),6);
    for (const label of ['文稿','信息表','资料库','演示']) assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').getByText(label,{exact:true}).count(),1);
    assert.equal(await page.locator('.nl-layout-group.is-single').count(),4);
    assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').getByText('章节模板',{exact:true}).count(),0);
    assert.ok(await page.getByText('项目默认页面',{exact:true}).isVisible());
    await page.getByRole('tab',{name:'页签布局',exact:true}).press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'字数统计',exact:true}).getAttribute('aria-selected'),'true');
    await page.getByRole('tab',{name:'字数统计',exact:true}).press('Home');
    assert.equal(await page.locator('[data-module="flatCanvas"] input').isChecked(),false,'tab changes retain pending choices');
    await page.locator('.nl-settings-viewport').evaluate(el=>el.scrollTop=0);
    await page.locator('[data-module="chapterTemplates"] button').click();
    assert.equal(await page.evaluate(()=>window.lastTool),'chapterTemplates');
    await page.locator('.nl-settings-viewport').evaluate(el=>el.scrollTop=0);
    const footer=await page.locator('.nl-settings-footer').boundingBox();
    assert.ok(footer.y+footer.height<=850,'footer stays visible');
    await page.screenshot({ path: join(output,'settings-wide.png') });
    await page.setViewportSize({width:440,height:820});
    assert.equal(await page.locator('.nl-module-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const narrowFooter=await page.locator('.nl-settings-footer').boundingBox();
    assert.ok(narrowFooter.y+narrowFooter.height<=820,'narrow footer stays visible');
    await page.locator('.nl-settings-viewport').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await page.locator('[data-module="writingStats"]').isVisible());
    await page.locator('.nl-settings-viewport').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:join(output,'settings-narrow.png')});
    await page.evaluate(() => window.showWizard());
    assert.equal(await page.locator('.nl-creation-step:not([hidden])').count(),1);
    await page.locator('.nl-create-next').click();
    assert.ok(await page.evaluate(()=>window.lastNotice));
    await page.locator('.setting-item').filter({has:page.locator('.setting-item-name',{hasText:'项目标题'})}).locator('input').fill('测试论文');
    await page.locator('.setting-item').filter({has:page.locator('.setting-item-name',{hasText:'项目标题'})}).locator('input').dispatchEvent('change');
    await page.locator('.nl-create-next').click();
    assert.ok((await page.locator('.nl-creation-progress').innerText()).startsWith('2 / 3'));
    assert.equal(await page.locator('[data-module="canvas"]').count(),1);
    await page.locator('.nl-create-next').click();
    assert.ok(await page.locator('.nl-create-submit').isVisible());
    await page.locator('.nl-create-back').click();
    assert.equal(await page.locator('[data-module="columnBoard"] input').isChecked(),true);
    await page.setViewportSize({width:780,height:850});
    await page.evaluate(()=>window.showTabs());
    await page.waitForTimeout(100);
    assert.deepEqual(await page.locator('.story-line-view-switcher > [data-group]').evaluateAll(tabs => tabs.slice(0, 2).map(tab => tab.dataset.group)), ['manuscript','informationTable']);
    assert.ok(await page.locator('[data-group="informationTable"]').filter({hasText:'信息表'}).isVisible());
    assert.equal(await page.locator('[data-group="informationTable"] .codex-dropdown-chevron').count(),0);
    await page.locator('[data-group="informationTable"]').click();
    assert.equal(await page.evaluate(()=>window.lastPage),'narrative-lab-plotgrid');
    assert.ok(await page.locator('.story-line-view-tab').filter({hasText:'整理'}).isVisible());
    assert.ok(await page.locator('.story-line-view-tab').filter({hasText:'叙事规划'}).isVisible());
    assert.ok(await page.locator('.story-line-view-tab.active').isVisible());
    assert.ok((await page.locator('.story-line-view-tab.is-reorderable').count()) > 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.story-line-view-tab').filter({hasText:'叙事规划'}).locator('.codex-dropdown-chevron').click();
    await page.locator('.test-menu button').first().waitFor();
    await page.locator('.test-menu button').filter({hasText:'情节地铁图'}).click();
    assert.equal(await page.evaluate(()=>window.lastPage),'narrative-lab-subway');
    await page.screenshot({path:join(output,'tabs-overflow.png')});
    // Regression: toolbar rows must grow, even with large host fonts in a
    // narrow desktop pane. Check real Board toolbar construction, not a mock.
    await page.setViewportSize({width:1400,height:900});
    for (const mode of ['corkboard','kanban']) {
        await page.evaluate(mode=>window.showNarrowBoard(560,mode),mode);
        for (const width of [560,360,240,900,560]) {
            await page.locator('.test-narrow-pane').evaluate((el,width)=>el.style.width=width+'px',width);
            await page.waitForTimeout(80);
            const layout=await page.locator('.story-line-toolbar').evaluate(el=>{
                const box=e=>e.getBoundingClientRect(),header=box(el),nav=box(el.querySelector('.story-line-view-switcher'));
                const controls=box(el.querySelector('.story-line-toolbar-controls'));
                const buttons=[...el.querySelectorAll('button')].filter(b=>!b.hidden&&box(b).width&&box(b).height);
                return {narrow:el.classList.contains('sl-toolbar-narrow'),controlsBelowTabs:controls.top>=nav.bottom,
                    contained:buttons.every(b=>{const r=box(b);return r.left>=header.left&&r.right<=header.right+1&&r.top>=header.top&&r.bottom<=header.bottom+1}),
                    noButtonOverlap:buttons.every((b,i)=>buttons.slice(i+1).every(c=>{const a=box(b),d=box(c);return a.right<=d.left+1||d.right<=a.left+1||a.bottom<=d.top+1||d.bottom<=a.top+1})),
                    canvasBelow:box(el.nextElementSibling).top>=header.bottom,
                    fits:el.scrollWidth<=el.clientWidth+1};
            });
            assert.deepEqual(layout,{narrow:width<=640,controlsBelowTabs:true,contained:true,noButtonOverlap:true,canvasBelow:true,fits:true},mode+' at '+width+'px');
            assert.ok(await page.locator('.story-line-view-tab.active').isVisible());
            if(width===240) await page.screenshot({path:join(output,'narrow-'+mode+'-240.png')});
        }
        await page.screenshot({path:join(output,'narrow-'+mode+'.png')});
    }
    await page.evaluate(()=>window.showFolds());
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>window.foldMounts),0,'initial disclosure events cannot mount every editor');
    await page.locator('summary').first().click();
    assert.equal(await page.locator('details').first().evaluate(el=>el.open),false);
    assert.equal(await page.locator('textarea').first().inputValue(),'unsaved writing','collapse retains pending edits');
    await page.waitForTimeout(30);
    await page.evaluate(()=>window.showFolds());
    assert.equal(await page.locator('details').first().evaluate(el=>el.open),false,'file fold state persists within project');
    await page.evaluate(()=>window.showFolds('B'));
    assert.equal(await page.locator('details').first().evaluate(el=>el.open),true,'another project keeps independent fold state');
    await page.locator('summary').first().focus();await page.locator('summary').first().press('Enter');
    assert.equal(await page.locator('details').first().evaluate(el=>el.open),false,'keyboard folding');
    await page.setViewportSize({width:400,height:900});
    await page.evaluate(()=>window.showFolderTracker());
    assert.ok(await page.getByText('日记/随笔',{exact:true}).isVisible());
    assert.equal(await page.locator('.nl-folder-tracker-hint, .nl-folder-tracker-footnote').count(),0);
    assert.ok(await page.getByText('已加入统计',{exact:true}).isVisible());
    await page.evaluate(()=>{window.folderService.current.tracker.setProjectFilesOpen(false);window.folderPanel.refresh()});
    assert.ok(await page.getByText('已加入统计',{exact:true}).isVisible(),'closed documents do not remove a folder from tracking');
    assert.ok(await page.getByText('写作冲刺',{exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>window.folderPanel.getState().writingTrackerScope),'folder');
    await page.screenshot({path:join(output,'folder-tracker.png')});
    await page.getByRole('button',{name:'移出统计列表',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'添加统计文件夹',exact:true}).isVisible());
    assert.equal(await page.getByRole('button',{name:'日记/随笔 · 包含子文件夹',exact:true}).count(),0);
    assert.equal(await page.locator('.nl-folder-tracker-hint, .nl-folder-tracker-footnote').count(),0);
    assert.equal(await page.locator('select').count(),0,'idle state has no placeholder dropdown');
    assert.equal(await page.getByText('写作冲刺',{exact:true}).count(),0,'stopped scope does not display another tracker');
    await page.evaluate(()=>window.folderPanel.onClose());
    await page.setViewportSize({width:1400,height:900});
    await page.evaluate(()=>window.showFolderTracker(240));
    assert.ok(await page.getByRole('button',{name:'开始',exact:true}).isVisible());
    await page.getByRole('button',{name:'移出统计列表',exact:true}).click();
    await page.evaluate(()=>{
        window.folderService.savedScopes=[{id:'long',path:'Projects/一个名称很长的资料目录/LongFolderNameWithoutAnyBreaksForWritingStatistics',recursive:true}];
        window.folderPanel.refresh();
    });
    const folderLayout=await page.locator('.nl-tracker-panel').evaluate(el=>{
        const b=el.getBoundingClientRect();return {fits:el.scrollWidth<=el.clientWidth,
            buttonsFit:[...el.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right+1})};
    });
    assert.deepEqual(folderLayout,{fits:true,buttonsFit:true},'long saved-folder names fit a 240px sidebar');
    await page.screenshot({path:join(output,'narrow-folder-tracker.png')});
    await page.evaluate(()=>window.folderPanel.onClose());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,output,checks:['grouped switches','independent toggles','tracking last','responsive settings','wizard validation and back navigation','visible active tab','grouped tab navigation','chapter templates tool entry','persistent per-file folding','keyboard folding','folder tracker controls and stop','240-900px pane resize without toolbar overlap','240px sidebar with long folder names']},null,2));
} finally { await browser.close(); }
