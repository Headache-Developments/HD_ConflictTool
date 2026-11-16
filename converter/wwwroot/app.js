document.querySelector('#open-guide').addEventListener('click', () => document.querySelector('#tool-guide').showModal());
const input = document.querySelector('#file-input');
const folderInput = document.querySelector('#folder-input');
const dropzone = document.querySelector('#dropzone');
const fileList = document.querySelector('#file-list');
const scanBtn = document.querySelector('#scan-btn');
const exportXmlBtn = document.querySelector('#export-xml-btn');
const exportYmapBtn = document.querySelector('#export-ymap-btn');
const review = document.querySelector('#review-content');
document.querySelector('#browse-files').addEventListener('click', () => input.click());
document.querySelector('#browse-folder').addEventListener('click', () => folderInput.click());
const sources = [];
let groups = [];
let reviewReady = false;
let activeOperation = null;
let converterReady = false;

input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
folderInput.addEventListener('change', () => { addFiles([...folderInput.files]); folderInput.value = ''; });
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', e => addFiles(() => droppedFiles(e.dataTransfer)));
scanBtn.addEventListener('click', scan);
exportXmlBtn.addEventListener('click', exportMapXml);
exportYmapBtn.addEventListener('click', exportMapYmaps);
checkConverter();

function updateProgress(kind, label, completed, total) {
  const block = document.querySelector(`#${kind}-progress`);
  block.hidden = false;
  block.querySelector('span').textContent = label;
  const bar = block.querySelector('progress');
  bar.hidden = false;
  if (total) {
    bar.max = total;
    bar.value = completed;
  } else {
    bar.removeAttribute('value');
  }
}

function syncControls() {
  const busy = Boolean(activeOperation);
  scanBtn.disabled = busy || sources.length < 2;
  exportXmlBtn.disabled = busy || !reviewReady;
  exportYmapBtn.disabled = busy || !reviewReady || !converterReady;
  for (const button of document.querySelectorAll('#browse-files, #browse-folder, .remove-file, .field-select, #continue-review-btn')) {
    button.disabled = busy;
  }
}

const paint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runOperation(kind, work) {
  if (activeOperation) return;
  activeOperation = kind;
  syncControls();
  try {
    await work();
  } catch (error) {
    updateProgress(kind, `Failed: ${error.message}`);
    document.querySelector(`#${kind}-progress progress`).hidden = true;
  } finally {
    activeOperation = null;
    syncControls();
  }
}

function addFiles(inputFiles) {
  return runOperation('load', async () => {
    updateProgress('load', 'Finding files…');
    const files = typeof inputFiles === 'function' ? await inputFiles() : inputFiles;
    await loadFiles(files);
  });
}

async function loadFiles(files) {
  const failures = [];
  let added = false;
  let processed = 0;
  for (const file of files) {
    updateProgress('load', `Loading file ${processed + 1} of ${files.length}`, processed++, files.length);
    await paint();
    const sourcePath = file.webkitRelativePath || file.sourcePath || file.name;
    const folderXml = sourcePath !== file.name && /\.xml$/i.test(file.name) && !/\.ymap\.xml$/i.test(file.name);
    if (folderXml) continue;
    if (!/\.(xml|ymap)$/i.test(file.name) || sources.some(s => s.sourcePath === sourcePath)) continue;
    try {
      let text;
      const binary = /\.ymap$/i.test(file.name);
      if (binary) {
        if (!converterReady) throw new Error('Start the app with start.cmd to enable binary YMAP conversion.');
        const form = new FormData(); form.append('file', file);
        const response = await fetch('/api/ymap/to-xml', {method:'POST', body:form});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'CodeWalker could not convert this YMAP.');
        text = result.xml;
      } else {
        text = await file.text();
      }
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('The file is not valid XML.');
      const entities = [...doc.getElementsByTagName('*')].filter(el => el.localName === 'Item' && (el.getAttribute('type') || '').includes('CEntityDef'));
      if (!entities.length) throw new Error('No CodeWalker CEntityDef entries were found in this XML.');
      sources.push({file, sourcePath, label:sourcePath, doc, entities, binary});
      added = true;
    } catch (error) {
      failures.push(`${sourcePath}: ${error.message}`);
    }
  }
  updateProgress('load', `Files checked: ${processed}`, processed, processed || 1);
  renderFiles();
  if (added) resetReview();
  if (failures.length) alert(`Skipped ${failures.length} file(s):\n\n${failures.slice(0, 12).join('\n')}${failures.length > 12 ? '\n…' : ''}`);
}

async function droppedFiles(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  if (!items.some(item => typeof item.webkitGetAsEntry === 'function')) return [...dataTransfer.files];
  const files = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await walkEntry(entry, '', files);
  }
  return files;
}

function walkEntry(entry, parentPath, files) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file(file => { file.sourcePath = `${parentPath}${entry.name}`; files.push(file); resolve(); }, reject);
      return;
    }
    if (!entry.isDirectory) { resolve(); return; }
    const reader = entry.createReader();
    const readBatch = () => reader.readEntries(async entries => {
      if (!entries.length) { resolve(); return; }
      try {
        for (const child of entries) await walkEntry(child, `${parentPath}${entry.name}/`, files);
        readBatch();
      } catch (error) { reject(error); }
    }, reject);
    readBatch();
  });
}

function renderFiles() {
  document.querySelector('#file-count').textContent = `${sources.length} FILE${sources.length === 1 ? '' : 'S'}`;
  syncControls();
  fileList.innerHTML = sources.length ? '' : '<div class="empty-files">Your source maps will appear here.</div>';
  sources.forEach((source, index) => {
    const item = document.createElement('div'); item.className = 'file-item';
    item.innerHTML = `<span class="file-chip">${source.binary ? 'YMAP' : 'XML'}</span><div class="file-meta"><div class="file-name" title="${esc(source.label)}">${esc(source.label)}</div><div class="file-size">${source.entities.length} ENTITIES · ${formatSize(source.file.size)}</div></div><button class="remove-file" aria-label="Remove ${esc(source.label)}">×</button>`;
    item.querySelector('button').addEventListener('click', () => { sources.splice(index, 1); renderFiles(); resetReview(); });
    fileList.append(item);
  });
}

function scan() {
  return runOperation('scan', async () => {
    resetReview();
    syncControls();
    const total = sources.reduce((count, source) => count + source.entities.length, 0);
    const map = new Map();
    let checked = 0;
    for (const [sourceIndex, source] of sources.entries()) {
      for (const [entityIndex, entity] of source.entities.entries()) {
        if (checked % 750 === 0) {
          updateProgress('scan', `Scanning placements · ${checked} of ${total}`, checked, total);
          await paint();
        }
        const key = entityKey(entity);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({sourceIndex, entityIndex, entity});
        checked++;
      }
    }
    updateProgress('scan', 'Building conflict overview…');
    await paint();
    groups = [...map.entries()].map(([key, entries]) => ({key, entries}));
    renderConflictOverview();
    updateProgress('scan', `Scan complete · ${checked} placements checked`, checked, total);
  });
}
function entityKey(entity) {
  const guid = entity.querySelector('guid')?.getAttribute('value') || childText(entity, 'guid');
  const archetype = childText(entity, 'archetypeName') || 'unknown';
  const position = entity.querySelector('position');
  const coords = position ? ['x','y','z'].map(axis => Number(position.getAttribute(axis) || 0).toFixed(3)).join(',') : 'no-position';
  return guid && guid !== '0' ? `guid:${guid}` : `entity:${archetype.toLowerCase()}@${coords}`;
}

function renderConflictOverview() {
  const summary = document.querySelector('#summary');
  const stats = sources.map(source => ({source, overlaps:0, differences:0, peers:new Set()}));
  const duplicateGroups = groups.filter(hasCrossMapConflict);
  let changedFields = 0;

  for (const group of duplicateGroups) {
    const sourceIds = [...new Set(group.entries.map(entry => entry.sourceIndex))];
    const diffs = fieldDiffs(group.entries);
    changedFields += diffs.length;
    for (const sourceId of sourceIds) {
      stats[sourceId].overlaps++;
      stats[sourceId].differences += diffs.length;
      for (const peerId of sourceIds) {
        if (peerId !== sourceId) stats[sourceId].peers.add(sources[peerId].label);
      }
    }
  }

  const conflictingMaps = stats.filter(item => item.overlaps > 0).length;
  summary.hidden = false;
  summary.innerHTML = `<div class="sum-item"><span class="sum-value">${sources.length}</span><span class="sum-label">MAP FILES SCANNED</span></div><div class="sum-item"><span class="sum-value">${conflictingMaps}</span><span class="sum-label">MAPS WITH OVERLAPS</span></div><div class="sum-item"><span class="sum-value">${duplicateGroups.length}</span><span class="sum-label">OVERLAPPING ENTITIES</span></div><div class="sum-item"><span class="sum-value">${changedFields}</span><span class="sum-label">FIELD DIFFERENCES</span></div>`;
  document.querySelector('#review-status').textContent = 'Conflicts found';
  review.innerHTML = `<section class="conflict-overview"><div class="overview-heading"><div><h3>YMAP conflict overview</h3><p>Review every source map and its overlaps before opening merge choices.</p></div><span class="tag">${conflictingMaps} CONFLICTING MAPS</span></div><div class="conflict-table-wrap"><table class="conflict-table"><thead><tr><th>Source YMAP</th><th>Shared entities</th><th>Changed fields</th><th>Overlaps with</th><th>Status</th></tr></thead><tbody>${stats.map(item => `<tr><td class="source-cell" title="${esc(item.source.label)}">${esc(item.source.label)}</td><td>${item.overlaps}</td><td>${item.differences}</td><td class="peer-cell" title="${esc([...item.peers].join(', '))}">${item.peers.size ? esc([...item.peers].join(', ')) : '—'}</td><td><span class="tag ${item.overlaps ? '' : 'unique'}">${item.overlaps ? 'CONFLICT' : 'CLEAR'}</span></td></tr>`).join('')}</tbody></table></div><div class="overview-footnote">Overlaps match entities by GUID when available; otherwise by archetype and position. Exports keep the original map boundaries.</div><button id="continue-review-btn" class="primary-btn continue-review"><span>Continue to field review</span><span aria-hidden="true">↗</span></button></section>`;
  document.querySelector('#continue-review-btn').addEventListener('click', buildReview);
  reviewReady = false;
  exportXmlBtn.disabled = true;
  exportYmapBtn.disabled = true;
}

function buildReview() {
  const duplicates = groups.filter(hasCrossMapConflict);
  const conflictCount = duplicates.reduce((n, g) => n + fieldDiffs(g.entries).length, 0);
  document.querySelector('#review-status').textContent = 'Field review';
  const summary = document.querySelector('#summary'); summary.hidden = false;
  summary.innerHTML = `<div class="sum-item"><span class="sum-value">${groups.length}</span><span class="sum-label">PLACEMENT GROUPS</span></div><div class="sum-item"><span class="sum-value">${duplicates.length}</span><span class="sum-label">OVERLAPS</span></div><div class="sum-item"><span class="sum-value">${conflictCount}</span><span class="sum-label">FIELD DIFFERENCES</span></div>`;
  review.innerHTML = '';
  if (!duplicates.length) review.innerHTML = '<div class="empty-review">No overlapping entities found. Each map will keep its original entities.</div>';
  for (const group of duplicates) review.append(renderGroup(group));
  reviewReady = true;
  exportXmlBtn.disabled = false;
  exportYmapBtn.disabled = !converterReady || activeOperation;
}

function renderGroup(group) {
  const root = document.createElement('article'); root.className = 'entity-group';
  const first = group.entries[0].entity;
  const name = childText(first, 'archetypeName') || 'Unnamed entity';
  const position = first.querySelector('position');
  const coords = position ? `X ${position.getAttribute('x') || '0'} · Y ${position.getAttribute('y') || '0'} · Z ${position.getAttribute('z') || '0'}` : group.key;
  const duplicate = hasCrossMapConflict(group);
  root.innerHTML = `<div class="entity-head"><div><div class="entity-name">${esc(name)}</div><div class="entity-sub">${esc(coords)} · ${group.entries.length} SOURCE${group.entries.length === 1 ? '' : 'S'}</div></div><span class="tag ${duplicate ? '' : 'unique'}">${duplicate ? 'OVERLAP' : 'UNIQUE'}</span></div>`;
  if (!duplicate) return root;
  const diffs = fieldDiffs(group.entries);
  if (!diffs.length) { const same = document.createElement('div'); same.className = 'field-row'; same.innerHTML = '<span class="field-path">Entity data</span><span class="field-value">No unambiguous transferable field differences</span><span></span>'; root.append(same); return root; }
  for (const diff of diffs) {
    const row = document.createElement('div'); row.className = `field-row ${diff.values.length > 1 ? 'conflict' : ''}`;
    const select = document.createElement('select'); select.className = 'field-select'; select.setAttribute('aria-label', `Choose source for ${diff.path}`);
    diff.variants.forEach((variant, vi) => { const option = document.createElement('option'); option.value = String(vi); option.textContent = sources[variant.entry.sourceIndex].label; select.append(option); });
    select.addEventListener('change', () => { diff.choice = Number(select.value); });
    row.innerHTML = `<span class="field-path">${esc(diff.path)}</span><span class="field-value" title="${esc(diff.values.join(' | '))}">${esc(diff.values[0])}${diff.values.length > 1 ? ` <span class="field-variants">(+${diff.values.length - 1} variant${diff.values.length === 2 ? '' : 's'})</span>` : ''}</span>`;
    row.append(select); root.append(row);
  }
  group.diffs = diffs;
  return root;
}

function hasCrossMapConflict(group) {
  return new Set(group.entries.map(entry => entry.sourceIndex)).size > 1;
}

function fieldDiffs(entries) {
  if (new Set(entries.map(entry => entry.sourceIndex)).size !== entries.length) return [];
  const perEntry = entries.map(entry => ({entry, values: new Map(leafValues(entry.entity))}));
  const paths = [...perEntry[0].values.keys()].filter(path =>
    !/^\/(?:guid|parentIndex|numChildren|lodLevel|flags|priorityLevel|extensions)(?:\/|\[|$)/i.test(path) &&
    perEntry.every(item => item.values.has(path))
  );
  return [...paths].map(path => {
    const variants = perEntry.map(item => ({entry:item.entry, value:item.values.get(path) ?? '(field absent)'}));
    return {path, variants, values:[...new Set(variants.map(v => v.value))], choice:0};
  }).filter(d => d.values.length > 1);
}

function resetReview() {
  document.querySelector('#scan-progress').hidden = true;
  document.querySelector('#export-progress').hidden = true;
  groups = [];
  reviewReady = false;
  document.querySelector('#summary').hidden = true;
  document.querySelector('#review-status').textContent = 'Waiting for maps';
  review.innerHTML = '<div class="welcome"><div class="map-glyph"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M12 24 38 13l25 11 25-11v63L63 87 38 76 12 87zM38 13v63m25-52v63"/><path d="m47 43 8-10 8 10-8 11z"/></svg></div><h3>Source maps changed.</h3><p>Scan the current file list to see all YMAP conflicts before continuing.</p></div>';
  exportXmlBtn.disabled = true;
  exportYmapBtn.disabled = true;
}

function leafValues(node, prefix = '') {
  const entries = [];
  for (const attr of [...node.attributes]) entries.push([`${prefix}/@${attr.name}`, attr.value]);
  const children = [...node.children];
  const seen = new Map();
  for (const child of children) {
    const n = seen.get(child.localName) || 0; seen.set(child.localName, n + 1);
    const childPath = `${prefix}/${child.localName}${children.filter(c => c.localName === child.localName).length > 1 ? `[${n}]` : ''}`;
    if (child.children.length || child.attributes.length) entries.push(...leafValues(child, childPath));
    else entries.push([childPath, child.textContent.trim()]);
  }
  if (!children.length && !node.attributes.length && node.textContent.trim()) entries.push([`${prefix}/text()`, node.textContent.trim()]);
  return entries;
}

function createMapExports() {
  const maps = sources.map(source => {
    const doc = source.doc.cloneNode(true);
    const entities = [...doc.getElementsByTagName('*')].filter(el =>
      el.localName === 'Item' && (el.getAttribute('type') || '').includes('CEntityDef')
    );
    const name = source.file.name.replace(/(?:\.ymap)?\.(?:xml|ymap)$/i, '') + '.ymap';
    return {source, doc, entities, name, changed:false};
  });

  for (const group of groups) {
    for (const diff of group.diffs || []) {
      const {value} = diff.variants[diff.choice];
      for (const {sourceIndex, entityIndex} of group.entries) {
        const map = maps[sourceIndex];
        const entity = map.entities[entityIndex];
        if (getPathValue(entity, diff.path) === value) continue;
        setPathValue(entity, diff.path, value);
        map.changed = true;
      }
    }
  }
  return maps;
}
function pathParts(path) { return path.split('/').filter(Boolean); }
function getPathValue(node, path) {
  let current = node;
  for (const segment of pathParts(path).slice(0, -1)) { const name = segment.replace(/\[\d+\]$/, ''); const index = Number(segment.match(/\[(\d+)\]$/)?.[1] || 0); current = [...current.children].filter(c => c.localName === name)[index]; if (!current) return ''; }
  const last = pathParts(path).at(-1);
  if (last.startsWith('@')) return current.getAttribute(last.slice(1)) ?? '';
  const name = last.replace(/\[\d+\]$/, ''); const index = Number(last.match(/\[(\d+)\]$/)?.[1] || 0); const child = [...current.children].filter(c => c.localName === name)[index];
  return child ? (child.children.length || child.attributes.length ? '' : child.textContent.trim()) : '';
}
function setPathValue(node, path, value) {
  let current = node;
  for (const segment of pathParts(path).slice(0, -1)) { const name = segment.replace(/\[\d+\]$/, ''); const index = Number(segment.match(/\[(\d+)\]$/)?.[1] || 0); current = [...current.children].filter(c => c.localName === name)[index]; if (!current) return; }
  const last = pathParts(path).at(-1);
  if (last.startsWith('@')) { current.setAttribute(last.slice(1), value); return; }
  const name = last.replace(/\[\d+\]$/, ''); const index = Number(last.match(/\[(\d+)\]$/)?.[1] || 0); const child = [...current.children].filter(c => c.localName === name)[index]; if (child && !child.children.length && !child.attributes.length) child.textContent = value;
}
function childText(node, name) { return [...node.children].find(c => c.localName === name)?.textContent.trim() || ''; }
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mapXmlBlob(map) {
  const text = new XMLSerializer().serializeToString(map.doc);
  return new Blob([text], {type:'application/xml'});
}

function exportMapXml() {
  if (reviewReady) return exportMaps(false);
}

function exportMapYmaps() {
  if (reviewReady && converterReady) return exportMaps(true);
}

async function zipYmaps(files) {
  if (files.length > 0xffff) throw new Error('Too many maps for one ZIP.');
  const crcTable = Uint32Array.from({length:256}, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc;
  });
  const encoder = new TextEncoder();
  const localParts = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [index, {blob, name}] of files.entries()) {
    updateProgress('export', `Packing ZIP · ${index + 1} of ${files.length}`, index, files.length);
    await paint();
    const filename = encoder.encode(`ymaps/${name}`);
    const size = blob.size;
    if (filename.length > 0xffff || offset + 30 + filename.length + size > 0xffffffff) {
      throw new Error('The maps exceed the ZIP size limit. Export fewer maps at once.');
    }
    let crc = 0xffffffff;
    for await (const chunk of blob.stream()) {
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, filename.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    new Uint8Array(central.buffer, 6, 26).set(new Uint8Array(local.buffer, 4, 26));
    central.setUint32(42, offset, true);
    localParts.push(local.buffer, filename, blob);
    directory.push(central.buffer, filename);
    offset += 30 + filename.length + size;
    directorySize += 46 + filename.length;
  }
  if (offset + directorySize + 22 > 0xffffffff) {
    throw new Error('The maps exceed the ZIP size limit. Export fewer maps at once.');
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...localParts, ...directory, end.buffer], {type:'application/zip'});
}
function exportMaps(binary) {
  return runOperation('export', async () => {
    updateProgress('export', 'Applying reviewed choices…');
    await paint();
    const maps = createMapExports();
    if (binary) {
      const names = new Set();
      for (const {name} of maps) {
        const key = name.normalize('NFC').toLowerCase();
        if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error(`Invalid output filename: ${name}`);
        if (names.has(key)) throw new Error(`More than one source exports as ${name}. Export those alternatives in separate batches.`);
        names.add(key);
      }
    }
    const results = [];
    for (const map of maps) {
      updateProgress('export', `Preparing ${map.name} · ${results.length + 1} of ${maps.length}`, results.length, maps.length);
      await paint();
      try {
        let blob;
        if (!binary) {
          blob = mapXmlBlob(map);
        } else if (!map.changed && map.source.binary) {
          blob = map.source.file;
        } else {
          const form = new FormData();
          form.append('file', mapXmlBlob(map), map.name + '.xml');
          const response = await fetch('/api/ymap/from-xml', {method:'POST', body:form});
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Converter returned HTTP ${response.status}.`);
          }
          blob = await response.blob();
        }
        results.push({blob, name: binary ? map.name : map.name + '.xml'});
      } catch (error) {
        throw new Error(`${map.source.label}: ${error.message}`);
      }
    }
    if (binary) {
      const zip = await zipYmaps(results);
      downloadBlob(zip, 'hd_conflicttool_ymaps.zip');
      updateProgress('export', `ZIP download requested · ${results.length} YMAPs`, results.length, results.length);
      return;
    }
    for (const {blob, name} of results) downloadBlob(blob, name);
    updateProgress('export', `Downloads requested · ${results.length} of ${maps.length}`, results.length, maps.length);
  });
}
async function checkConverter() {
  const state = document.querySelector('#converter-state');
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('Converter unavailable');
    converterReady = true; state.textContent = 'Local converter ready'; state.dataset.state = 'ready';
  } catch {
    converterReady = false; state.textContent = 'Binary converter offline'; state.dataset.state = 'offline';
  }
  exportYmapBtn.disabled = !converterReady || !reviewReady || activeOperation;
}

const installedVersion = '0.2.5';
const repository = 'Headache-Developments/HD_ConflictTool';

function isNewerVersion(candidate, installed) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) return false;
  const current = installed.split('.').map(Number);
  const latest = candidate.split('.').map(Number);
  if (!latest.every(Number.isSafeInteger)) return false;
  for (const [index, part] of latest.entries()) {
    if (part !== current[index]) return part > current[index];
  }
  return false;
}

async function checkForUpdate() {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repository}_Version/main/VERSION.txt`, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return;
    const latest = (await response.text()).trim();
    if (!isNewerVersion(latest, installedVersion)) return;
    document.querySelector('#update-message').textContent = `Update available: v${latest}. You’re using v${installedVersion}.`;
    document.querySelector('#update-download').href = `https://github.com/${repository}/archive/refs/tags/v${latest}.zip`;
    document.querySelector('#update-banner').hidden = false;
  } catch {
    // Checking for updates is optional when GitHub is unreachable.
  }
}

checkForUpdate();
setInterval(checkForUpdate, 30 * 60 * 1000);
