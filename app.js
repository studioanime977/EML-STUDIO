// Global Scope
let canvas = null;
let currentTool = 'select';
let activeObject = null;
let historyStack = [];
let historyIndex = -1;
let isPanning = false;

// UI Elements
const colorFg = document.getElementById('primary-color');
const colorBg = document.getElementById('secondary-color');
const layersList = document.getElementById('layers-list');
const optionsBar = document.getElementById('tool-options');
const propPanel = document.getElementById('properties-panel');

document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});

function setupUI() {
    // Left Toolbar Setup
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = e.currentTarget.dataset.tool;
            setTool(tool);
        });
    });

    // Color Pickers
    colorFg.addEventListener('change', () => updateBrushColor());
    
    // File upload binding
    document.getElementById('upload-img').addEventListener('change', handleImageUpload);
    
    // Global Keyboard shortcuts
    window.addEventListener('keydown', handleKeyMap);
    window.addEventListener('keyup', handleKeyUp);
}

window.swapColors = function() {
    const temp = colorFg.value;
    colorFg.value = colorBg.value;
    colorBg.value = temp;
    updateBrushColor();
}

window.createNewDocument = function(w = 1200, h = 800) {
    document.getElementById('welcome-modal').style.display = 'none';
    const container = document.getElementById('canvas-document');
    container.style.display = 'block';
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    
    // Init canvas
    canvas = new fabric.Canvas('ps-canvas', {
        width: w,
        height: h,
        preserveObjectStacking: true,
        backgroundColor: '#ffffff'
    });
    
    saveState(); // initial state
    
    // Events
    canvas.on('object:added', () => { updateLayers(); saveState(); });
    canvas.on('object:modified', () => { updateLayers(); updateProperties(); saveState(); });
    canvas.on('object:removed', () => { updateLayers(); saveState(); });
    canvas.on('selection:created', (e) => { activeObject = e.selected[0]; updateLayers(); updateProperties(); });
    canvas.on('selection:updated', (e) => { activeObject = e.selected[0]; updateLayers(); updateProperties(); });
    canvas.on('selection:cleared', () => { activeObject = null; updateLayers(); updateProperties(); });
    
    setupCanvasPanZoom();
    setTool('select');
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    if(!canvas) {
        // If no document exists, create one with image size approx
        const imgObj = new Image();
        imgObj.src = URL.createObjectURL(file);
        imgObj.onload = () => {
            let w = imgObj.width;
            let h = imgObj.height;
            // Cap at a reasonable workspace size
            if(w > 1920) { h = (h*1920)/w; w = 1920; }
            createNewDocument(w, h);
            addFabricImage(file);
        };
    } else {
        addFabricImage(file);
    }
    e.target.value = ''; // reset
}

function addFabricImage(file) {
    const reader = new FileReader();
    reader.onload = (f) => {
        fabric.Image.fromURL(f.target.result, (img) => {
            // scale if larger than canvas
            if(img.width > canvas.width) img.scaleToWidth(canvas.width * 0.9);
            img.set({
                left: canvas.width/2,
                top: canvas.height/2,
                originX: 'center',
                originY: 'center',
                name: file.name || 'Capa Imagen',
                id: Date.now()
            });
            canvas.add(img);
            canvas.setActiveObject(img);
        });
    };
    reader.readAsDataURL(file);
}

// ---------------- Tools Logic ----------------
function setTool(toolName) {
    if(!canvas) return;
    currentTool = toolName;
    
    // Visual update
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tool="${toolName}"]`).classList.add('active');
    
    // Reset canvas modes
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.forEachObject(o => o.selectable = true);
    
    // Options bar dynamic update
    let optionsHtml = '';
    
    switch(toolName) {
        case 'select':
            optionsHtml = `<i class="ph ph-cursor options-tool-icon"></i><span class="options-label">Auto-Select: Capa</span>`;
            canvas.defaultCursor = 'default';
            break;
            
        case 'brush':
            optionsHtml = `
                <i class="ph ph-paint-brush-broad options-tool-icon"></i>
                <span class="options-label">Tamaño:</span>
                <input type="range" id="brush-size" min="1" max="150" value="15" style="width: 100px;">
                <span id="brush-size-val" style="margin-right:15px; color:#ddd;">15px</span>
            `;
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            updateBrushColor();
            canvas.freeDrawingBrush.width = 15;
            break;
            
        case 'eraser':
            optionsHtml = `
                <i class="ph ph-eraser options-tool-icon"></i>
                <span class="options-label">Tamaño:</span>
                <input type="range" id="eraser-size" min="1" max="150" value="30" style="width: 100px;">
                <span style="color:#aaa; font-size:10px;">(Simulado pintando blanco)</span>
            `;
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = canvas.backgroundColor || '#ffffff';
            canvas.freeDrawingBrush.width = 30;
            break;
            
        case 'text':
            optionsHtml = `<i class="ph ph-text-t options-tool-icon"></i><span class="options-label">Haz clic en el lienzo para añadir texto.</span>`;
            canvas.defaultCursor = 'text';
            break;
            
        case 'shapes':
            optionsHtml = `<i class="ph ph-rectangle options-tool-icon"></i>
                           <span class="options-label">Forma:</span>
                           <select id="shape-type" style="background:#535353; color:#fff; border:1px solid #333; padding:2px; height:22px;">
                                <option value="rect">Rectángulo</option>
                                <option value="circle">Elipse</option>
                           </select>`;
            canvas.defaultCursor = 'crosshair';
            canvas.selection = false;
            canvas.forEachObject(o => o.selectable = false);
            break;
            
        case 'hand':
            optionsHtml = `<i class="ph ph-hand-palm options-tool-icon"></i><span class="options-label">Arrastra para paneo.</span>`;
            canvas.defaultCursor = 'grab';
            canvas.selection = false;
            canvas.forEachObject(o => o.selectable = false);
            break;
            
        default:
             optionsHtml = `<i class="ph ph-wrench options-tool-icon"></i><span class="options-label">Herramienta no implementada aún en la versión Web.</span>`;
    }
    
    optionsBar.innerHTML = optionsHtml;
    bindOptionsEvents(toolName);
}

function bindOptionsEvents(toolName) {
    if(toolName === 'brush') {
        const bs = document.getElementById('brush-size');
        const bsv = document.getElementById('brush-size-val');
        bs.addEventListener('input', (e) => {
            canvas.freeDrawingBrush.width = parseInt(e.target.value);
            bsv.innerText = e.target.value + 'px';
        });
    }
    if(toolName === 'eraser') {
        document.getElementById('eraser-size').addEventListener('input', (e) => {
            canvas.freeDrawingBrush.width = parseInt(e.target.value);
        });
    }
}

function updateBrushColor() {
    if(canvas && currentTool === 'brush') {
        canvas.freeDrawingBrush.color = colorFg.value;
    }
}

// ---------------- Canvas Interaction / Panning / Zooming / Drawing ----------------
function setupCanvasPanZoom() {
    canvas.on('mouse:wheel', function(opt) {
        if(opt.e.altKey || currentTool === 'zoom') {
            var delta = opt.e.deltaY;
            var zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.1) zoom = 0.1;
            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        }
    });

    let isDragging = false;
    let lastPosX, lastPosY;
    let shapeStart = null;
    let tempShape = null;

    canvas.on('mouse:down', function(opt) {
        var evt = opt.e;
        if (currentTool === 'hand' || evt.altKey || isPanning) {
            isDragging = true;
            canvas.defaultCursor = 'grabbing';
            lastPosX = evt.clientX;
            lastPosY = evt.clientY;
        } 
        else if (currentTool === 'shapes') {
            const pointer = canvas.getPointer(evt);
            shapeStart = { x: pointer.x, y: pointer.y };
            const shapeType = document.getElementById('shape-type').value;
            
            if(shapeType === 'rect') {
                tempShape = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, fill: colorFg.value, id: Date.now(), name: 'Rectángulo' });
            } else {
                tempShape = new fabric.Ellipse({ left: pointer.x, top: pointer.y, rx: 0, ry: 0, fill: colorFg.value, id: Date.now(), name: 'Elipse' });
            }
            canvas.add(tempShape);
        }
        else if (currentTool === 'text' && !activeObject) {
            const pointer = canvas.getPointer(evt);
            const text = new fabric.IText('Texto Nuevo', {
                left: pointer.x, top: pointer.y, fontFamily: 'Arial', fill: colorFg.value, fontSize: 40, name: 'Capa Texto', id: Date.now()
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            setTool('select');
        }
    });

    canvas.on('mouse:move', function(opt) {
        if (isDragging) {
            var e = opt.e;
            var vpt = this.viewportTransform;
            vpt[4] += e.clientX - lastPosX;
            vpt[5] += e.clientY - lastPosY;
            this.requestRenderAll();
            lastPosX = e.clientX;
            lastPosY = e.clientY;
        }
        else if (currentTool === 'shapes' && tempShape) {
            const pointer = canvas.getPointer(opt.e);
            if(tempShape.type === 'rect') {
                tempShape.set({
                    width: Math.abs(pointer.x - shapeStart.x),
                    height: Math.abs(pointer.y - shapeStart.y),
                    left: Math.min(pointer.x, shapeStart.x),
                    top: Math.min(pointer.y, shapeStart.y)
                });
            } else if (tempShape.type === 'ellipse') {
                tempShape.set({
                    rx: Math.abs(pointer.x - shapeStart.x)/2,
                    ry: Math.abs(pointer.y - shapeStart.y)/2,
                    left: Math.min(pointer.x, shapeStart.x),
                    top: Math.min(pointer.y, shapeStart.y)
                });
            }
            canvas.renderAll();
        }
    });

    canvas.on('mouse:up', function(opt) {
        if(isDragging) {
            isDragging = false;
            canvas.defaultCursor = currentTool === 'hand' ? 'grab' : 'default';
        }
        if(currentTool === 'shapes' && tempShape) {
            if(tempShape.width === 0 && tempShape.type === 'rect') canvas.remove(tempShape);
            tempShape = null;
        }
    });
}

// ---------------- Layers Panel ----------------
function updateLayers() {
    if(!canvas) return;
    const objects = canvas.getObjects();
    let html = '';
    
    // Top layer first
    for(let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        const isActive = activeObject === obj ? 'active' : '';
        const eyeIcon = obj.visible !== false ? 'ph-eye' : 'ph-eye-closed';
        const name = obj.name || (obj.type === 'image' ? 'Capa' : obj.type);
        const typeIcon = obj.type === 'i-text' ? 'text-t' : (obj.type === 'image' ? 'image' : 'shape-polygon');
        
        html += `
            <div class="layer-item ${isActive}" onclick="selectLayer(${i})">
                <i class="ph ${eyeIcon} layer-eye" onclick="event.stopPropagation(); toggleVisibility(${i})"></i>
                <div class="layer-thumb">
                    <i class="ph ph-${typeIcon}" style="font-size:18px; color:#666;"></i>
                </div>
                <span class="layer-name">${name}</span>
            </div>
        `;
    }
    
    layersList.innerHTML = html;
    
    if(activeObject) {
        document.getElementById('layer-opacity-val').value = Math.round(activeObject.opacity * 100);
        document.getElementById('layer-blend-mode').value = activeObject.globalCompositeOperation || 'source-over';
    }
}

window.selectLayer = function(index) {
    if(!canvas) return;
    canvas.setActiveObject(canvas.item(index));
    setTool('select');
}

window.toggleVisibility = function(index) {
    const obj = canvas.item(index);
    obj.visible = !obj.visible;
    canvas.renderAll();
    updateLayers();
}

window.addNewEmptyLayer = function() {
    alert("Para dibujar, selecciona el pincel (B). Fabric genera vectores listados como capas individuales automáticamente.");
};

window.duplicateLayer = function() {
    if(activeObject) {
        activeObject.clone((cloned) => {
            canvas.discardActiveObject();
            cloned.set({
                left: cloned.left + 20,
                top: cloned.top + 20,
                name: cloned.name + ' copia',
                evented: true,
                id: Date.now()
            });
            if (cloned.type === 'activeSelection') {
                cloned.canvas = canvas;
                cloned.forEachObject(function(obj) { canvas.add(obj); });
                cloned.setCoords();
            } else {
                canvas.add(cloned);
            }
            canvas.setActiveObject(cloned);
            canvas.requestRenderAll();
        });
    }
}

window.deleteActive = function() {
    if(activeObject) {
         if (activeObject.type === 'activeSelection') {
            activeObject.forEachObject(function(obj) { canvas.remove(obj); });
        } else {
            canvas.remove(activeObject);
        }
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }
};

document.getElementById('layer-opacity-val').addEventListener('input', (e) => {
    if(activeObject) {
        activeObject.set('opacity', e.target.value / 100);
        canvas.renderAll();
    }
});

document.getElementById('layer-blend-mode').addEventListener('change', (e) => {
    if(activeObject) {
        let val = e.target.value;
        if(val === 'normal') val = 'source-over';
        activeObject.set('globalCompositeOperation', val);
        canvas.renderAll();
    }
});

// ---------------- Properties Panel ----------------
function updateProperties() {
    if(!activeObject) {
        propPanel.innerHTML = '<div class="empty-selection text-center" style="color:#aaa; font-style:italic; padding: 20px;">Sin selección</div>';
        return;
    }
    
    let html = '<div class="prop-form">';
    // Dimensiones
    html += `
        <div class="prop-row"><span class="prop-label">Ancho:</span><input type="number" class="prop-input" value="${Math.round(activeObject.width * activeObject.scaleX)}" disabled> px</div>
        <div class="prop-row"><span class="prop-label">Alto:</span><input type="number" class="prop-input" value="${Math.round(activeObject.height * activeObject.scaleY)}" disabled> px</div>
        <div class="prop-row"><span class="prop-label">Ángulo:</span><input type="number" class="prop-input" value="${Math.round(activeObject.angle || 0)}" disabled> °</div>
    `;
    
    if(activeObject.type === 'i-text') {
        html += `
            <div style="height:1px; background:var(--ps-divider); margin:10px 0;"></div>
            <div class="prop-row"><span class="prop-label">Color:</span><input type="color" id="prop-text-color" value="${activeObject.fill}"></div>
            <div class="prop-row"><span class="prop-label">Tamaño pt:</span><input type="number" class="prop-input" id="prop-text-size" value="${activeObject.fontSize}"></div>
        `;
    }
    
    if(activeObject.type === 'rect' || activeObject.type === 'ellipse' || activeObject.type === 'path') {
        html += `
             <div style="height:1px; background:var(--ps-divider); margin:10px 0;"></div>
             <div class="prop-row"><span class="prop-label">Relleno:</span><input type="color" id="prop-shape-fill" value="${activeObject.fill || '#000000'}"></div>
        `;
    }
    
    html += '</div>';
    propPanel.innerHTML = html;
    
    if(document.getElementById('prop-text-color')) {
        document.getElementById('prop-text-color').addEventListener('input', e => { activeObject.set('fill', e.target.value); canvas.renderAll(); });
        document.getElementById('prop-text-size').addEventListener('input', e => { activeObject.set('fontSize', parseInt(e.target.value)); canvas.renderAll(); });
    }
    if(document.getElementById('prop-shape-fill')) {
        document.getElementById('prop-shape-fill').addEventListener('input', e => { activeObject.set('fill', e.target.value); canvas.renderAll(); });
    }
}

// ---------------- Filters Logic ----------------
window.applyFilter = function(filterName) {
    if(!activeObject || activeObject.type !== 'image') {
        alert("Paso 1: Selecciona una capa tipo Imagen haciendo click.\nPaso 2: Ve a Filtro > Aplicar.");
        return;
    }
    
    if(!fabric.Image.filters) return;
    
    switch(filterName) {
        case 'grayscale':
            activeObject.filters.push(new fabric.Image.filters.Grayscale());
            break;
        case 'noise':
            activeObject.filters.push(new fabric.Image.filters.Noise({ noise: 100 }));
            break;
        case 'blur':
            activeObject.filters.push(new fabric.Image.filters.Blur({ blur: 0.2 })); // simple blur
            break;
    }
    
    activeObject.applyFilters();
    canvas.renderAll();
    saveState();
}

// ---------------- History / Undo-Redo ----------------
let isHistoryUpdate = false;
function saveState() {
    if(!canvas || isHistoryUpdate) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(JSON.stringify(canvas.toJSON(['id', 'name', 'globalCompositeOperation', 'selectable'])));
    historyIndex++;
}

window.undo = function() {
    if(historyIndex > 0) {
        isHistoryUpdate = true;
        historyIndex--;
        canvas.loadFromJSON(historyStack[historyIndex], () => {
            canvas.renderAll();
            updateLayers();
            updateProperties();
            isHistoryUpdate = false;
        });
    }
}

window.redo = function() {
    if(historyIndex < historyStack.length - 1) {
        isHistoryUpdate = true;
        historyIndex++;
        canvas.loadFromJSON(historyStack[historyIndex], () => {
             canvas.renderAll();
             updateLayers();
             updateProperties();
             isHistoryUpdate = false;
        });
    }
}

// ---------------- Export ----------------
window.downloadImage = function() {
    if(!canvas) {
        alert("Crea un documento primero.");
        return;
    }
    canvas.discardActiveObject();
    canvas.renderAll();
    
    const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1
    });
    
    const link = document.createElement('a');
    link.download = 'EML-STUDIO-Clon.png';
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ---------------- Shortcuts ----------------
function handleKeyMap(e) {
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Spacebar to pan
    if(e.code === 'Space' && !isPanning) {
        e.preventDefault();
        isPanning = true;
        setTool('hand');
    }
    
    // Tools
    if(!e.ctrlKey && !e.altKey && !e.shiftKey) {
        switch(e.key.toLowerCase()) {
            case 'v': setTool('select'); break;
            case 'b': setTool('brush'); break;
            case 'e': setTool('eraser'); break;
            case 't': setTool('text'); break;
            case 'u': setTool('shapes'); break;
            case 'h': setTool('hand'); break;
        }
    }
    
    if(e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if(e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    if(e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); duplicateLayer(); }
    if(e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); createNewDocument(); }
    if(e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); document.getElementById('upload-img').click(); }
    if(e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); downloadImage(); }
    
    if(e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteActive();
    }
}

function handleKeyUp(e) {
    if(e.code === 'Space' && isPanning) {
        isPanning = false;
        setTool('select'); // return to default
    }
}
