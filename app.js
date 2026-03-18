/* ================================================================
   EML STUDIO — app.js  (Photoshop‑class editor engine)
   ================================================================ */

// ── STATE ──────────────────────────────────────────────────────────
let canvas = null, currentTool = 'select', activeObj = null;
let history = [], historyIdx = -1, historyLock = false;
let isPanning = false, clipboard = null;
let startPt = null, tempObj = null;
let penPts = [], penPreview = null;
let cropBox = null;
let adjState = {};

// cached DOM
const $fg  = () => document.getElementById('fg-color');
const $bg  = () => document.getElementById('bg-color');
const $layers   = () => document.getElementById('layers-list');
const $opts     = () => document.getElementById('tool-opts');
const $props    = () => document.getElementById('props-body');
const $zoomLbl  = () => document.getElementById('zoom-level');
const $sizeLbl  = () => document.getElementById('canvas-size');
const $posLbl   = () => document.getElementById('mouse-pos');
const $titleBar = () => document.getElementById('title-info');

// ── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // toolbar buttons
    document.querySelectorAll('.tb').forEach(b =>
        b.addEventListener('click', () => b.dataset.tool && setTool(b.dataset.tool))
    );

    // file inputs
    document.getElementById('file-input').addEventListener('change', handleFileOpen);
    document.getElementById('file-json').addEventListener('change', handleJsonOpen);

    // layer controls
    document.getElementById('blend-mode').addEventListener('change', e => {
        if (activeObj) { activeObj.globalCompositeOperation = e.target.value; canvas.renderAll(); save(); }
    });
    document.getElementById('l-opacity').addEventListener('input', e => {
        if (activeObj) { activeObj.set('opacity', e.target.value / 100); canvas.renderAll(); save(); }
    });

    // keyboard
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
});

// ── DOCUMENT ───────────────────────────────────────────────────────
window.createNewDocument = function (w = 1280, h = 720) {
    document.getElementById('welcome').style.display = 'none';
    const wrap = document.getElementById('doc-wrap');
    wrap.style.display = 'block';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';

    if (canvas) canvas.dispose();
    canvas = new fabric.Canvas('c', { width: w, height: h, preserveObjectStacking: true, backgroundColor: '#ffffff' });

    history = []; historyIdx = -1; save();

    // events
    canvas.on('object:added',    () => { refreshLayers(); save(); });
    canvas.on('object:modified', () => { refreshLayers(); refreshProps(); save(); });
    canvas.on('object:removed',  () => { refreshLayers(); save(); });
    canvas.on('selection:created', e => { activeObj = e.selected?.[0]; refreshLayers(); refreshProps(); });
    canvas.on('selection:updated', e => { activeObj = e.selected?.[0]; refreshLayers(); refreshProps(); });
    canvas.on('selection:cleared',() => { activeObj = null; refreshLayers(); refreshProps(); });

    setupMouse();
    setTool('select');
    $titleBar().textContent = `${w} × ${h} px`;
    $sizeLbl().textContent = `${w}×${h}`;
    $zoomLbl().textContent = '100%';
};

// ── FILE OPEN / IMPORT ─────────────────────────────────────────────
function handleFileOpen(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!canvas) {
        const tmp = new Image();
        tmp.src = URL.createObjectURL(file);
        tmp.onload = () => { createNewDocument(Math.min(tmp.width,1920), Math.min(tmp.height,1080)); addImage(file); };
    } else addImage(file);
    e.target.value = '';
}

function addImage(file) {
    const r = new FileReader();
    r.onload = fr => {
        fabric.Image.fromURL(fr.target.result, img => {
            if (img.width > canvas.width) img.scaleToWidth(canvas.width * 0.9);
            img.set({ left: canvas.width/2, top: canvas.height/2, originX:'center', originY:'center', name: file.name || 'Image', _id: Date.now() });
            canvas.add(img);
            canvas.setActiveObject(img);
        });
    };
    r.readAsDataURL(file);
}

function handleJsonOpen(e) {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = fr => {
        if (!canvas) createNewDocument();
        canvas.loadFromJSON(fr.target.result, () => { canvas.renderAll(); refreshLayers(); });
    };
    r.readAsText(file);
    e.target.value = '';
}

// ── TOOL SETTER ────────────────────────────────────────────────────
function setTool(name) {
    if (!canvas) return;
    currentTool = name;

    // visual
    document.querySelectorAll('.tb').forEach(b => b.classList.toggle('active', b.dataset.tool === name));

    // reset modes
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.forEachObject(o => { o.selectable = true; o.evented = true; });
    canvas.defaultCursor = 'default';
    cleanup();

    let html = '';
    switch (name) {
        case 'select':
            html = `<i class="ph ph-cursor"></i> Move Tool`;
            break;

        case 'marquee':
            html = `<i class="ph ph-bounding-box"></i> Marquee — drag to select region`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'lasso':
            html = `<i class="ph ph-selection-plus"></i> Lasso — freehand select (draws path)`;
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'rgba(0,100,255,0.3)';
            canvas.freeDrawingBrush.width = 2;
            break;

        case 'wand':
            html = `<i class="ph ph-magic-wand"></i> Magic Wand — click to auto‑select similar objects`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'crop':
            html = `<i class="ph ph-crop"></i> Crop — drag area then <button class="psbtn" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyCrop()">Apply Crop</button>`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'eyedropper':
            html = `<i class="ph ph-eyedropper"></i> Eyedropper — click to sample color`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'brush':
            html = `<i class="ph ph-paint-brush-broad"></i> Brush <span class="opt-sep"></span>
                Size: <input type="range" id="bsize" min="1" max="200" value="8"> <span id="bsv">8px</span>
                <span class="opt-sep"></span> Opacity: <input type="range" id="bopa" min="1" max="100" value="100"> <span id="bov">100%</span>`;
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = $fg().value;
            canvas.freeDrawingBrush.width = 8;
            break;

        case 'eraser':
            html = `<i class="ph ph-eraser"></i> Eraser <span class="opt-sep"></span>
                Size: <input type="range" id="esize" min="1" max="200" value="20"> <span id="esv">20px</span>`;
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'white';
            canvas.freeDrawingBrush.width = 20;
            break;

        case 'bucket':
            html = `<i class="ph ph-paint-bucket"></i> Paint Bucket — click on a shape to fill with foreground color`;
            canvas.defaultCursor = 'crosshair';
            break;

        case 'gradient':
            html = `<i class="ph ph-gradient"></i> Gradient — select object then <button class="psbtn" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyGradient()">Apply Gradient</button>
                <select id="grad-type" style="margin-left:8px"><option value="linear">Linear</option><option value="radial">Radial</option></select>`;
            break;

        case 'blur-tool':
            html = `<i class="ph ph-drop"></i> Blur / Sharpen — select image, then:
                <button class="psbtn sec" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyQuickFilter('blur')">Blur</button>
                <button class="psbtn sec" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyQuickFilter('sharpen')">Sharpen</button>`;
            break;

        case 'dodge':
            html = `<i class="ph ph-sun-dim"></i> Dodge/Burn — select image:
                <button class="psbtn sec" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyQuickFilter('brighten')">Dodge</button>
                <button class="psbtn sec" style="padding:1px 8px;font-size:10px;margin-left:8px" onclick="applyQuickFilter('darken')">Burn</button>`;
            break;

        case 'pen':
            html = `<i class="ph ph-pen-nib"></i> Pen — click to place points, double‑click to close path`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            penPts = [];
            break;

        case 'text':
            html = `<i class="ph ph-text-t"></i> Text — click canvas to add text <span class="opt-sep"></span>
                Font: <select id="tfont"><option>Arial</option><option>Georgia</option><option>Courier New</option><option>Verdana</option><option>Impact</option><option>Comic Sans MS</option></select>
                Size: <input type="number" id="tsize" value="40" style="width:50px">`;
            canvas.defaultCursor = 'text';
            break;

        case 'shapes':
            html = `<i class="ph ph-rectangle"></i> Shapes — drag to draw <span class="opt-sep"></span>
                <select id="shape-sel"><option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option><option value="star">Star</option></select>
                <label style="margin-left:8px;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="shape-fill" checked> Fill</label>
                <label style="margin-left:8px;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="shape-stroke"> Stroke</label>`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'line':
            html = `<i class="ph ph-line-segment"></i> Line — drag to draw <span class="opt-sep"></span>
                Width: <input type="range" id="lwidth" min="1" max="30" value="3"> <span id="lwv">3px</span>`;
            noSelect(); canvas.defaultCursor = 'crosshair';
            break;

        case 'hand':
            html = `<i class="ph ph-hand-palm"></i> Hand — drag to pan`;
            noSelect(); canvas.defaultCursor = 'grab';
            break;

        case 'zoom':
            html = `<i class="ph ph-magnifying-glass"></i> Zoom — click (+), Alt+click (−), scroll wheel`;
            noSelect(); canvas.defaultCursor = 'zoom-in';
            break;

        default:
            html = `Tool: ${name}`;
    }
    $opts().innerHTML = html;
    bindOpts();
}

function noSelect() { canvas.selection = false; canvas.forEachObject(o => { o.selectable = false; o.evented = false; }); }
function cleanup() {
    if (cropBox) { canvas.remove(cropBox); cropBox = null; }
    if (penPreview) { canvas.remove(penPreview); penPreview = null; penPts = []; }
    if (tempObj) { canvas.remove(tempObj); tempObj = null; }
}

function bindOpts() {
    const bsize = document.getElementById('bsize');
    if (bsize) { bsize.oninput = () => { canvas.freeDrawingBrush.width = +bsize.value; document.getElementById('bsv').textContent = bsize.value+'px'; }; }
    const bopa = document.getElementById('bopa');
    if (bopa) { bopa.oninput = () => { const a = bopa.value/100; canvas.freeDrawingBrush.color = hexToRgba($fg().value, a); document.getElementById('bov').textContent = bopa.value+'%'; }; }
    const esize = document.getElementById('esize');
    if (esize) { esize.oninput = () => { canvas.freeDrawingBrush.width = +esize.value; document.getElementById('esv').textContent = esize.value+'px'; }; }
    const lw = document.getElementById('lwidth');
    if (lw) { lw.oninput = () => { document.getElementById('lwv').textContent = lw.value+'px'; }; }
}

// ── MOUSE EVENTS ───────────────────────────────────────────────────
function setupMouse() {
    let drag = false, lx, ly;

    // Mouse position display
    canvas.on('mouse:move', opt => {
        const p = canvas.getPointer(opt.e);
        $posLbl().textContent = `X: ${Math.round(p.x)}  Y: ${Math.round(p.y)}`;

        if (drag) {
            const vpt = canvas.viewportTransform;
            vpt[4] += opt.e.clientX - lx;
            vpt[5] += opt.e.clientY - ly;
            canvas.requestRenderAll();
            lx = opt.e.clientX; ly = opt.e.clientY;
        }
        if (tempObj) drawTemp(p);
    });

    canvas.on('mouse:down', opt => {
        const e = opt.e, p = canvas.getPointer(e);

        // Zoom
        if (currentTool === 'zoom') {
            let z = canvas.getZoom();
            z = e.altKey ? z * 0.8 : z * 1.25;
            z = Math.min(20, Math.max(0.05, z));
            canvas.zoomToPoint({ x: e.offsetX, y: e.offsetY }, z);
            $zoomLbl().textContent = Math.round(z * 100) + '%';
            return;
        }

        // Pan
        if (currentTool === 'hand' || e.altKey || isPanning) {
            drag = true; canvas.defaultCursor = 'grabbing'; lx = e.clientX; ly = e.clientY; return;
        }

        // Eyedropper
        if (currentTool === 'eyedropper') {
            const ctx = canvas.getContext('2d');
            const px = ctx.getImageData(Math.round(p.x * canvas.getZoom()), Math.round(p.y * canvas.getZoom()), 1, 1).data;
            $fg().value = '#' + [px[0],px[1],px[2]].map(c => c.toString(16).padStart(2,'0')).join('');
            return;
        }

        // Bucket
        if (currentTool === 'bucket') {
            const target = canvas.findTarget(opt.e);
            if (target && target.type !== 'image') { target.set('fill', $fg().value); canvas.renderAll(); save(); }
            else if (!target) { canvas.backgroundColor = $fg().value; canvas.renderAll(); save(); }
            return;
        }

        // Wand — select object under cursor
        if (currentTool === 'wand') {
            const target = canvas.findTarget(opt.e);
            if (target) { canvas.setActiveObject(target); canvas.renderAll(); }
            return;
        }

        // Pen
        if (currentTool === 'pen') {
            penPts.push({ x: p.x, y: p.y });
            redrawPenPreview();
            return;
        }

        // Text
        if (currentTool === 'text') {
            const font = document.getElementById('tfont')?.value || 'Arial';
            const size = parseInt(document.getElementById('tsize')?.value) || 40;
            const t = new fabric.IText('Text', { left: p.x, top: p.y, fontFamily: font, fontSize: size, fill: $fg().value, name: 'Text', _id: Date.now() });
            canvas.add(t);
            canvas.setActiveObject(t);
            setTool('select');
            return;
        }

        // Shape / Line / Marquee / Crop start
        startPt = { x: p.x, y: p.y };

        if (currentTool === 'shapes') {
            const sel = document.getElementById('shape-sel')?.value || 'rect';
            const fill = document.getElementById('shape-fill')?.checked ? $fg().value : 'transparent';
            const stroke = document.getElementById('shape-stroke')?.checked ? $fg().value : '';
            const sw = stroke ? 2 : 0;
            if (sel === 'rect') tempObj = new fabric.Rect({ left:p.x, top:p.y, width:0, height:0, fill, stroke, strokeWidth:sw, name:'Rect', _id:Date.now() });
            else if (sel === 'ellipse') tempObj = new fabric.Ellipse({ left:p.x, top:p.y, rx:0, ry:0, fill, stroke, strokeWidth:sw, name:'Ellipse', _id:Date.now() });
            else if (sel === 'triangle') tempObj = new fabric.Triangle({ left:p.x, top:p.y, width:0, height:0, fill, stroke, strokeWidth:sw, name:'Triangle', _id:Date.now() });
            else if (sel === 'star') tempObj = new fabric.Polygon(starPoints(5,0,0), { left:p.x, top:p.y, fill, stroke, strokeWidth:sw, name:'Star', _id:Date.now(), scaleX:0.01, scaleY:0.01 });
            if (tempObj) canvas.add(tempObj);
        }

        if (currentTool === 'line') {
            const w = parseInt(document.getElementById('lwidth')?.value) || 3;
            tempObj = new fabric.Line([p.x,p.y,p.x,p.y], { stroke: $fg().value, strokeWidth: w, name:'Line', _id:Date.now() });
            canvas.add(tempObj);
        }

        if (currentTool === 'marquee') {
            tempObj = new fabric.Rect({ left:p.x, top:p.y, width:0, height:0, fill:'rgba(0,100,255,0.15)', stroke:'#5af', strokeWidth:1, strokeDashArray:[4,4], selectable:false, evented:false, _isMarquee:true });
            canvas.add(tempObj);
        }

        if (currentTool === 'crop') {
            cropBox = new fabric.Rect({ left:p.x, top:p.y, width:0, height:0, fill:'rgba(0,0,0,0.4)', stroke:'#fff', strokeWidth:1, strokeDashArray:[6,4], selectable:false, evented:false });
            canvas.add(cropBox);
        }
    });

    canvas.on('mouse:up', opt => {
        drag = false;
        if (currentTool === 'hand') canvas.defaultCursor = 'grab';

        if (currentTool === 'shapes' && tempObj) {
            if ((tempObj.width||0) < 2 && (tempObj.height||0) < 2) canvas.remove(tempObj);
            tempObj = null; save();
        }
        if (currentTool === 'line' && tempObj) { tempObj = null; save(); }

        if (currentTool === 'marquee' && tempObj) {
            // select objects that overlap
            const r = tempObj.getBoundingRect();
            canvas.remove(tempObj);
            const hits = canvas.getObjects().filter(o => !o._isMarquee && o.intersectsWithRect(
                new fabric.Point(r.left, r.top), new fabric.Point(r.left+r.width, r.top+r.height)
            ));
            if (hits.length) { const s = new fabric.ActiveSelection(hits, { canvas }); canvas.setActiveObject(s); }
            tempObj = null;
            canvas.renderAll();
        }
        startPt = null;
    });

    canvas.on('mouse:dblclick', opt => {
        if (currentTool === 'pen' && penPts.length > 2) {
            let d = `M ${penPts[0].x} ${penPts[0].y} `;
            for (let i=1;i<penPts.length;i++) d += `L ${penPts[i].x} ${penPts[i].y} `;
            d += 'z';
            if (penPreview) canvas.remove(penPreview);
            const path = new fabric.Path(d, { fill: $fg().value, stroke: $fg().value, strokeWidth:1, name:'Path', _id:Date.now() });
            canvas.add(path); canvas.setActiveObject(path);
            penPts = []; penPreview = null; save(); setTool('select');
        }
    });

    // Zoom wheel
    canvas.on('mouse:wheel', opt => {
        const d = opt.e.deltaY;
        let z = canvas.getZoom();
        z *= 0.999 ** d;
        z = Math.min(20, Math.max(0.05, z));
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, z);
        opt.e.preventDefault();
        $zoomLbl().textContent = Math.round(z*100)+'%';
    });

    // Eraser composite
    canvas.on('path:created', opt => {
        if (currentTool === 'eraser') { opt.path.globalCompositeOperation = 'destination-out'; opt.path.name = 'Erase'; canvas.renderAll(); }
        if (currentTool === 'lasso') { opt.path.name = 'Selection'; opt.path.set({ fill:'rgba(0,100,255,0.1)', stroke:'#5af', strokeWidth:1 }); canvas.renderAll(); }
        if (currentTool === 'brush') { opt.path.name = 'Brush Stroke'; }
    });
}

function drawTemp(p) {
    if (!startPt) return;
    const dx = p.x - startPt.x, dy = p.y - startPt.y;
    if (currentTool === 'shapes' && tempObj) {
        if (tempObj.type === 'rect' || tempObj.type === 'triangle') {
            tempObj.set({ width: Math.abs(dx), height: Math.abs(dy), left: Math.min(p.x,startPt.x), top: Math.min(p.y,startPt.y) });
        } else if (tempObj.type === 'ellipse') {
            tempObj.set({ rx: Math.abs(dx)/2, ry: Math.abs(dy)/2, left: Math.min(p.x,startPt.x), top: Math.min(p.y,startPt.y) });
        } else if (tempObj.type === 'polygon') {
            const s = Math.max(Math.abs(dx), Math.abs(dy));
            tempObj.set({ scaleX: s/50, scaleY: s/50 });
        }
    }
    if (currentTool === 'line' && tempObj) tempObj.set({ x2: p.x, y2: p.y });
    if ((currentTool === 'marquee' && tempObj) || (currentTool === 'crop' && cropBox)) {
        const box = currentTool === 'crop' ? cropBox : tempObj;
        box.set({ width: Math.abs(dx), height: Math.abs(dy), left: Math.min(p.x,startPt.x), top: Math.min(p.y,startPt.y) });
    }
    canvas.renderAll();
}

function redrawPenPreview() {
    if (penPreview) canvas.remove(penPreview);
    if (penPts.length < 2) return;
    let d = `M ${penPts[0].x} ${penPts[0].y} `;
    for (let i=1;i<penPts.length;i++) d += `L ${penPts[i].x} ${penPts[i].y} `;
    penPreview = new fabric.Path(d, { fill:'', stroke: $fg().value, strokeWidth:2, selectable:false, evented:false });
    canvas.add(penPreview);
}

function starPoints(n, cx, cy, r) {
    r = r || 25;
    const pts = [];
    for (let i = 0; i < n*2; i++) {
        const rad = (i * Math.PI) / n - Math.PI/2;
        const rr = i % 2 === 0 ? r : r/2;
        pts.push({ x: cx + rr * Math.cos(rad), y: cy + rr * Math.sin(rad) });
    }
    return pts;
}

// ── CROP ───────────────────────────────────────────────────────────
window.applyCrop = function () {
    if (!cropBox || cropBox.width < 2) return alert('Draw crop area first.');
    const l = cropBox.left, t = cropBox.top, w = cropBox.width, h = cropBox.height;
    canvas.remove(cropBox); cropBox = null;
    canvas.getObjects().forEach(o => { o.set({ left: o.left - l, top: o.top - t }); o.setCoords(); });
    document.getElementById('doc-wrap').style.width = w+'px';
    document.getElementById('doc-wrap').style.height = h+'px';
    canvas.setDimensions({ width:w, height:h });
    canvas.renderAll(); save(); setTool('select');
    $sizeLbl().textContent = `${Math.round(w)}×${Math.round(h)}`;
    $titleBar().textContent = `${Math.round(w)} × ${Math.round(h)} px`;
};

// ── GRADIENT ───────────────────────────────────────────────────────
window.applyGradient = function () {
    if (!activeObj) return alert('Select a shape or text first.');
    const type = document.getElementById('grad-type')?.value || 'linear';
    const coords = type === 'radial'
        ? { r1: 0, r2: activeObj.width/2, x1: activeObj.width/2, y1: activeObj.height/2, x2: activeObj.width/2, y2: activeObj.height/2 }
        : { x1: 0, y1: 0, x2: activeObj.width, y2: activeObj.height };
    activeObj.set('fill', new fabric.Gradient({ type, coords, colorStops:[ {offset:0,color:$fg().value}, {offset:1,color:$bg().value} ] }));
    canvas.renderAll(); save();
};

// ── ADJUSTMENTS DIALOG ─────────────────────────────────────────────
window.showAdjustments = function (type) {
    if (!activeObj || activeObj.type !== 'image') return alert('Select an image layer.');
    adjState = { type, target: activeObj };
    document.getElementById('adj-title').textContent = type === 'brightness' ? 'Brightness / Contrast' : type === 'hue' ? 'Hue / Saturation' : 'Invert';
    let body = '';
    if (type === 'brightness') {
        body = `<label>Brightness</label><input type="range" id="adj-b" min="-100" max="100" value="0">
                <label>Contrast</label><input type="range" id="adj-c" min="-100" max="100" value="0">`;
    } else if (type === 'hue') {
        body = `<label>Hue</label><input type="range" id="adj-h" min="-180" max="180" value="0">
                <label>Saturation</label><input type="range" id="adj-s" min="-100" max="100" value="0">`;
    } else {
        body = `<p style="padding:8px 0">Invert all colors of the selected image.</p>`;
    }
    document.getElementById('adj-body').innerHTML = body;
    document.getElementById('adj-dialog').style.display = 'flex';

    // live preview for adjustments
    ['adj-b','adj-c','adj-h','adj-s'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = () => previewAdj();
    });
};

function previewAdj() {
    const t = adjState.target; if (!t) return;
    t.filters = [];
    if (adjState.type === 'brightness') {
        const b = (document.getElementById('adj-b')?.value || 0) / 100;
        const c = (document.getElementById('adj-c')?.value || 0) / 100;
        if (b) t.filters.push(new fabric.Image.filters.Brightness({ brightness: b }));
        if (c) t.filters.push(new fabric.Image.filters.Contrast({ contrast: c }));
    } else if (adjState.type === 'hue') {
        // Fabric 5 doesn't have native Hue filter; use saturation filter as proxy
        const s = (document.getElementById('adj-s')?.value || 0) / 100;
        if (s) t.filters.push(new fabric.Image.filters.Saturation({ saturation: s }));
    }
    t.applyFilters(); canvas.renderAll();
}

window.applyAdj = function () {
    if (adjState.type === 'invert' && adjState.target) {
        adjState.target.filters.push(new fabric.Image.filters.Invert());
        adjState.target.applyFilters(); canvas.renderAll();
    }
    save(); closeAdj();
};
window.closeAdj = function () { document.getElementById('adj-dialog').style.display = 'none'; adjState = {}; };

// ── QUICK FILTERS ──────────────────────────────────────────────────
window.applyQuickFilter = function (name) {
    if (!activeObj || activeObj.type !== 'image') return alert('Select an image layer.');
    const F = fabric.Image.filters;
    switch (name) {
        case 'grayscale': activeObj.filters.push(new F.Grayscale()); break;
        case 'sepia':     activeObj.filters.push(new F.Sepia()); break;
        case 'vintage':   activeObj.filters.push(new F.Sepia()); activeObj.filters.push(new F.Contrast({contrast:0.15})); break;
        case 'blur':      activeObj.filters.push(new F.Blur({blur:0.15})); break;
        case 'sharpen':   activeObj.filters.push(new F.Convolute({matrix:[0,-1,0,-1,5,-1,0,-1,0]})); break;
        case 'noise':     activeObj.filters.push(new F.Noise({noise:80})); break;
        case 'pixelate':  activeObj.filters.push(new F.Pixelate({blocksize:6})); break;
        case 'brighten':  activeObj.filters.push(new F.Brightness({brightness:0.15})); break;
        case 'darken':    activeObj.filters.push(new F.Brightness({brightness:-0.15})); break;
    }
    activeObj.applyFilters(); canvas.renderAll(); save();
};
window.removeAllFilters = function () {
    if (!activeObj || activeObj.type !== 'image') return;
    activeObj.filters = []; activeObj.applyFilters(); canvas.renderAll(); save();
};

// ── LAYERS PANEL ───────────────────────────────────────────────────
function refreshLayers() {
    if (!canvas) return;
    const objs = canvas.getObjects();
    let h = '';
    for (let i = objs.length-1; i >= 0; i--) {
        const o = objs[i];
        if (o._isMarquee) continue;
        const on = activeObj === o ? ' on' : '';
        const eye = o.visible !== false ? 'ph-eye' : 'ph-eye-closed';
        const icon = o.type==='i-text'?'text-t': o.type==='image'?'image': o.type==='path'?'path':'shapes';
        h += `<div class="li${on}" onclick="pickLayer(${i})">
            <i class="ph ${eye} eye" onclick="event.stopPropagation();togVis(${i})"></i>
            <div class="lthumb"><i class="ph ph-${icon}"></i></div>
            <span class="lname">${o.name||o.type}</span></div>`;
    }
    $layers().innerHTML = h || '<em class="muted" style="padding:12px">No layers</em>';
    if (activeObj && !activeObj._objects) {
        document.getElementById('l-opacity').value = Math.round((activeObj.opacity||1)*100);
        document.getElementById('blend-mode').value = activeObj.globalCompositeOperation || 'source-over';
    }
}

window.pickLayer = i => { if (!canvas) return; canvas.setActiveObject(canvas.item(i)); canvas.renderAll(); };
window.togVis = i => { const o=canvas.item(i); o.visible=!o.visible; canvas.renderAll(); refreshLayers(); };

window.addNewLayer = () => {
    if (!canvas) return;
    const r = new fabric.Rect({ left:0,top:0,width:canvas.width,height:canvas.height,fill:'transparent',selectable:false,evented:false,name:'Empty Layer',_id:Date.now() });
    canvas.add(r);
};
window.duplicateLayer = () => {
    if (!activeObj) return;
    activeObj.clone(c => { c.set({left:c.left+15,top:c.top+15,name:(c.name||'copy')+' copy',_id:Date.now()}); canvas.add(c); canvas.setActiveObject(c); canvas.renderAll(); });
};
window.deleteActive = () => {
    if (!activeObj) return;
    if (activeObj.type==='activeSelection') activeObj.forEachObject(o=>canvas.remove(o));
    else canvas.remove(activeObj);
    canvas.discardActiveObject(); canvas.renderAll();
};
window.bringForward = () => { if(activeObj){canvas.bringForward(activeObj);canvas.renderAll();refreshLayers();} };
window.sendBackward = () => { if(activeObj){canvas.sendBackwards(activeObj);canvas.renderAll();refreshLayers();} };
window.mergeDown = () => alert('Merge Down: flatten visible layers via Image > Flatten Image.');
window.flattenImage = () => {
    if (!canvas) return;
    const url = canvas.toDataURL({format:'png',quality:1});
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    fabric.Image.fromURL(url, img => { img.set({left:0,top:0,name:'Flattened',_id:Date.now()}); canvas.add(img); });
};
window.groupLayers = () => {
    if (!activeObj || activeObj.type!=='activeSelection') return alert('Select multiple layers first (Ctrl+click).');
    const group = activeObj.toGroup();
    group.name = 'Group'; canvas.renderAll(); refreshLayers();
};
window.toggleLock = () => {
    if (!activeObj) return;
    const locked = !activeObj.lockMovementX;
    activeObj.set({ lockMovementX:locked, lockMovementY:locked, lockScalingX:locked, lockScalingY:locked, lockRotation:locked });
    document.getElementById('lock-btn').className = locked ? 'ph ph-lock-key' : 'ph ph-lock-simple-open';
};

// ── PROPERTIES PANEL ───────────────────────────────────────────────
function refreshProps() {
    if (!activeObj) { $props().innerHTML = '<em class="muted">No selection</em>'; return; }
    let h = '<div class="prop-group">';
    h += `<label>Transform</label>
        <div class="prop-row">X:<input type="number" value="${Math.round(activeObj.left)}" onchange="activeObj.set('left',+this.value);canvas.renderAll()"> Y:<input type="number" value="${Math.round(activeObj.top)}" onchange="activeObj.set('top',+this.value);canvas.renderAll()"></div>
        <div class="prop-row">W:<input type="number" value="${Math.round(activeObj.width*(activeObj.scaleX||1))}" disabled> H:<input type="number" value="${Math.round(activeObj.height*(activeObj.scaleY||1))}" disabled></div>
        <div class="prop-row">Angle:<input type="number" value="${Math.round(activeObj.angle||0)}" onchange="activeObj.rotate(+this.value);canvas.renderAll()">°</div></div>`;

    if (activeObj.type === 'i-text') {
        h += `<div class="prop-group"><label>Text</label>
            <div class="prop-row">Color:<input type="color" value="${activeObj.fill||'#000'}" onchange="activeObj.set('fill',this.value);canvas.renderAll()"></div>
            <div class="prop-row">Size:<input type="number" value="${activeObj.fontSize}" onchange="activeObj.set('fontSize',+this.value);canvas.renderAll()"></div>
            <div class="prop-row">Font:<select onchange="activeObj.set('fontFamily',this.value);canvas.renderAll()">
                ${['Arial','Georgia','Courier New','Verdana','Impact','Comic Sans MS'].map(f=>`<option ${activeObj.fontFamily===f?'selected':''}>${f}</option>`).join('')}
            </select></div>
            <div class="prop-row" style="gap:4px">
                <button class="psbtn sec" style="padding:1px 6px" onclick="activeObj.set('fontWeight',activeObj.fontWeight==='bold'?'normal':'bold');canvas.renderAll()"><b>B</b></button>
                <button class="psbtn sec" style="padding:1px 6px" onclick="activeObj.set('fontStyle',activeObj.fontStyle==='italic'?'':'italic');canvas.renderAll()"><i>I</i></button>
                <button class="psbtn sec" style="padding:1px 6px" onclick="activeObj.set('underline',!activeObj.underline);canvas.renderAll()"><u>U</u></button>
            </div></div>`;
    }

    if (['rect','ellipse','triangle','polygon','path'].includes(activeObj.type)) {
        const isGrad = typeof activeObj.fill === 'object';
        h += `<div class="prop-group"><label>Shape</label>
            <div class="prop-row">Fill:${isGrad?'<span>Gradient</span>':`<input type="color" value="${activeObj.fill||'#000'}" onchange="activeObj.set('fill',this.value);canvas.renderAll()">`}</div>
            <div class="prop-row">Stroke:<input type="color" value="${activeObj.stroke||'#000'}" onchange="activeObj.set('stroke',this.value);canvas.renderAll()"> Width:<input type="number" value="${activeObj.strokeWidth||0}" style="width:40px" onchange="activeObj.set('strokeWidth',+this.value);canvas.renderAll()"></div>
            <div class="prop-row">Radius:<input type="number" value="${activeObj.rx||0}" style="width:40px" onchange="activeObj.set({rx:+this.value,ry:+this.value});canvas.renderAll()"></div></div>`;
    }

    if (activeObj.type === 'image') {
        h += `<div class="prop-group"><label>Image</label>
            <div class="prop-row"><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="showAdjustments('brightness')">Brightness/Contrast</button></div>
            <div class="prop-row"><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="showAdjustments('hue')">Hue/Saturation</button></div>
            <div class="prop-row"><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="removeAllFilters()">Remove Filters</button></div></div>`;
    }

    h += `<div class="prop-group"><label>Actions</label>
        <div class="prop-row"><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="flipHorizontal()">Flip H</button><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="flipVertical()">Flip V</button></div>
        <div class="prop-row"><button class="psbtn sec" style="font-size:10px;padding:2px 6px" onclick="activeObj.rotate((activeObj.angle||0)+90);canvas.renderAll()">Rotate 90°</button></div></div>`;

    $props().innerHTML = h;
}

// ── IMAGE TRANSFORMS ───────────────────────────────────────────────
window.flipHorizontal = () => { if(activeObj){activeObj.set('flipX',!activeObj.flipX);canvas.renderAll();save();}};
window.flipVertical   = () => { if(activeObj){activeObj.set('flipY',!activeObj.flipY);canvas.renderAll();save();}};
window.rotateCanvas   = deg => {
    if(!canvas) return;
    canvas.getObjects().forEach(o => {
        o.rotate((o.angle||0)+deg);
        const c = canvas.getCenter();
        const rad = (deg * Math.PI) / 180;
        const dx = o.left - c.left, dy = o.top - c.top;
        o.set({ left: c.left + dx*Math.cos(rad) - dy*Math.sin(rad), top: c.top + dx*Math.sin(rad) + dy*Math.cos(rad) });
        o.setCoords();
    });
    canvas.renderAll(); save();
};
window.resizeCanvas = () => {
    const w = prompt('New width:', canvas.width);
    const h = prompt('New height:', canvas.height);
    if(w && h) {
        canvas.setDimensions({width:+w,height:+h});
        document.getElementById('doc-wrap').style.width = w+'px';
        document.getElementById('doc-wrap').style.height = h+'px';
        canvas.renderAll(); save();
        $sizeLbl().textContent = `${w}×${h}`;
        $titleBar().textContent = `${w} × ${h} px`;
    }
};

// ── ZOOM VIEW ──────────────────────────────────────────────────────
window.zoomTo = function (level) {
    if (!canvas) return;
    if (level === 'fit') {
        const wrap = document.getElementById('workspace');
        level = Math.min((wrap.clientWidth-40)/canvas.width, (wrap.clientHeight-40)/canvas.height);
    }
    canvas.setViewportTransform([level,0,0,level,0,0]);
    canvas.renderAll();
    $zoomLbl().textContent = Math.round(level*100)+'%';
};

// ── COPY / PASTE ───────────────────────────────────────────────────
window.copyObj = () => { if(activeObj) activeObj.clone(c => { clipboard = c; }); };
window.pasteObj = () => {
    if(!clipboard || !canvas) return;
    clipboard.clone(c => { c.set({left:c.left+20,top:c.top+20,_id:Date.now(),evented:true}); canvas.add(c); canvas.setActiveObject(c); canvas.renderAll(); });
};
window.selectAll = () => { if(!canvas) return; const s = new fabric.ActiveSelection(canvas.getObjects(),{canvas}); canvas.setActiveObject(s); canvas.renderAll(); };
window.deselectAll = () => { if(!canvas) return; canvas.discardActiveObject(); canvas.renderAll(); };
window.swapColors = () => { const f=$fg(), b=$bg(), t=f.value; f.value=b.value; b.value=t; };

// ── EXPORT ─────────────────────────────────────────────────────────
window.exportAs = function (fmt) {
    if (!canvas) return alert('No document.');
    canvas.discardActiveObject(); canvas.renderAll();
    if (fmt === 'json') {
        const blob = new Blob([JSON.stringify(canvas.toJSON(['_id','name','globalCompositeOperation']))], {type:'application/json'});
        dl(URL.createObjectURL(blob), 'eml-studio-project.json'); return;
    }
    const url = canvas.toDataURL({ format: fmt==='jpg'?'jpeg':'png', quality:1 });
    dl(url, `eml-studio.${fmt}`);
};
function dl(url, name) { const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); }

// ── HISTORY ────────────────────────────────────────────────────────
function save() {
    if (!canvas || historyLock) return;
    history = history.slice(0, historyIdx+1);
    history.push(JSON.stringify(canvas.toJSON(['_id','name','globalCompositeOperation','selectable','evented'])));
    historyIdx++;
}
window.undo = () => {
    if (historyIdx > 0) { historyLock=true; historyIdx--; canvas.loadFromJSON(history[historyIdx],()=>{canvas.renderAll();refreshLayers();refreshProps();historyLock=false;}); }
};
window.redo = () => {
    if (historyIdx < history.length-1) { historyLock=true; historyIdx++; canvas.loadFromJSON(history[historyIdx],()=>{canvas.renderAll();refreshLayers();refreshProps();historyLock=false;}); }
};

// ── KEYBOARD ───────────────────────────────────────────────────────
function onKey(e) {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.code==='Space' && !isPanning) { e.preventDefault(); isPanning=true; setTool('hand'); return; }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const map = {v:'select',m:'marquee',l:'lasso',w:'wand',c:'crop',i:'eyedropper',b:'brush',e:'eraser',g:'bucket',p:'pen',t:'text',u:'shapes',h:'hand',z:'zoom',o:'dodge',x:null};
        const k = e.key.toLowerCase();
        if (k === 'x') { swapColors(); return; }
        if (map[k] !== undefined) { setTool(map[k]); return; }
    }

    if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if(k==='z'){e.preventDefault();undo();}
        if(k==='y'){e.preventDefault();redo();}
        if(k==='j'){e.preventDefault();duplicateLayer();}
        if(k==='c'){e.preventDefault();copyObj();}
        if(k==='v'){e.preventDefault();pasteObj();}
        if(k==='a'){e.preventDefault();selectAll();}
        if(k==='d'){e.preventDefault();deselectAll();}
        if(k==='n'){e.preventDefault();createNewDocument();}
        if(k==='o'){e.preventDefault();document.getElementById('file-input').click();}
        if(k==='e'){e.preventDefault();mergeDown();}
        if(k==='1'){e.preventDefault();zoomTo(1);}
        if(k==='0'){e.preventDefault();zoomTo('fit');}
        if(e.shiftKey && k==='s'){e.preventDefault();exportAs('png');}
    }

    if (e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); deleteActive(); }
}

function onKeyUp(e) {
    if (e.code==='Space' && isPanning) { isPanning=false; setTool('select'); }
}

// ── UTILS ──────────────────────────────────────────────────────────
function hexToRgba(hex, a) {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
}
