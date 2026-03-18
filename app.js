// app.js
let canvas;
let currentTool = 'select';
let activeObject = null;

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    setupEventListeners();
    updateLayersPanel();
});

function initCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    canvas = new fabric.Canvas('editor-canvas', {
        width: wrapper.clientWidth - 40,
        height: wrapper.clientHeight - 40,
        preserveObjectStacking: true, // Keep stacking order when selecting
        selection: true
    });

    // Handle resize
    window.addEventListener('resize', () => {
        canvas.setWidth(wrapper.clientWidth - 40);
        canvas.setHeight(wrapper.clientHeight - 40);
        canvas.renderAll();
    });

    // Handle selection events
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelectionCleared);
    canvas.on('object:modified', updateLayersPanel);
}

function handleSelection(e) {
    activeObject = e.selected[0];
    updatePropertiesPanel();
    updateLayersPanel();
}

function handleSelectionCleared() {
    activeObject = null;
    updatePropertiesPanel();
    updateLayersPanel();
}

// Event Listeners
function setupEventListeners() {
    // File upload
    document.getElementById('upload-image').addEventListener('change', handleImageUpload);
    
    // Tools
    document.getElementById('btn-select').addEventListener('click', () => setTool('select'));
    document.getElementById('btn-text').addEventListener('click', addTextObject);
    document.getElementById('btn-rotate').addEventListener('click', rotateObject);
    document.getElementById('btn-filters').addEventListener('click', showFiltersPanel);
    document.getElementById('btn-crop').addEventListener('click', () => {
        setTool('crop');
        alert('Para hacer zoom y encuadrar imagen usa las flechas de manipulación (escalado) en el objeto.');
    });
    
    // Download
    document.getElementById('btn-download').addEventListener('click', downloadImage);
    
    // Catch keyboard delete
    window.addEventListener('keydown', (e) => {
        if((e.key === 'Delete' || e.key === 'Backspace') && activeObject && e.target.tagName !== 'INPUT') {
            const index = canvas.getObjects().indexOf(activeObject);
            if(index !== -1) {
                window.deleteLayer(index);
            }
        }
    });
}

// Set active tool visually and functionally
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    
    const btnId = `btn-${tool}`;
    const btn = document.getElementById(btnId);
    if(btn) btn.classList.add('active');
    
    // Reset properties panel if needed
    if(tool === 'select' && activeObject) {
         updatePropertiesPanel();
    }
}

// Upload Image
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(f) {
        const data = f.target.result;
        fabric.Image.fromURL(data, function(img) {
            // Scale if too large
            const maxWidth = canvas.width * 0.8;
            const maxHeight = canvas.height * 0.8;
            if (img.width > maxWidth || img.height > maxHeight) {
                const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
                img.scale(scale);
            }
            
            // Name layer
            img.set({
                name: file.name,
                left: canvas.width / 2,
                top: canvas.height / 2,
                originX: 'center',
                originY: 'center',
                id: Date.now()
            });

            canvas.add(img);
            canvas.setActiveObject(img);
            
            // Hide welcome message
            document.getElementById('welcome-message').classList.add('hidden');
            
            updateLayersPanel();
        });
    };
    reader.readAsDataURL(file);
    // Reset input
    e.target.value = '';
}

// Add Text
function addTextObject() {
    const text = new fabric.IText('Doble clic para editar', {
        left: canvas.width / 2,
        top: canvas.height / 2,
        originX: 'center',
        originY: 'center',
        fontFamily: 'Inter',
        fontSize: 40,
        fill: '#ffffff',
        name: 'Texto',
        id: Date.now()
    });
    
    canvas.add(text);
    canvas.setActiveObject(text);
    
    document.getElementById('welcome-message').classList.add('hidden');
    updateLayersPanel();
    setTool('select');
}

// Rotate
function rotateObject() {
    setTool('rotate');
    if (activeObject) {
        let currentAngle = activeObject.angle || 0;
        activeObject.rotate(currentAngle + 90);
        canvas.renderAll();
        updatePropertiesPanel();
    } else {
        // If nothing selected, try to select first image and rotate
        const objects = canvas.getObjects();
        if(objects.length > 0) {
            canvas.setActiveObject(objects[0]);
            rotateObject();
        } else {
            alert("Sube una imagen o selecciona un elemento para rotar");
        }
    }
}

// Properties Panel Logic
function updatePropertiesPanel() {
    const panel = document.getElementById('properties-content');
    
    if (!activeObject) {
        panel.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-mouse-left"></i>
                <p>Selecciona un elemento en el lienzo para editar sus propiedades</p>
            </div>
        `;
        return;
    }

    if (activeObject.type === 'i-text') {
        renderTextProperties(panel, activeObject);
    } else if (activeObject.type === 'image') {
        renderImageProperties(panel, activeObject);
    } else {
        panel.innerHTML = `<div style="padding: 15px;">Elemento seleccionado (${activeObject.type})</div>`;
    }
}

function renderTextProperties(panel, textObj) {
    panel.innerHTML = `
        <div style="padding: 15px; display: flex; flex-direction: column; gap: 15px;">
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Color</label>
                <input type="color" id="text-color" value="${textObj.fill}" style="width: 100%; height: 35px; border: none; border-radius: 4px; cursor: pointer; background: transparent;">
            </div>
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Tamaño de fuente</label>
                <input type="range" id="text-size" min="10" max="200" value="${textObj.fontSize}" style="width: 100%;">
            </div>
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Opacidad</label>
                <input type="range" id="obj-opacity" min="0" max="1" step="0.1" value="${textObj.opacity}" style="width: 100%;">
            </div>
        </div>
    `;

    document.getElementById('text-color').addEventListener('input', (e) => {
        textObj.set('fill', e.target.value);
        canvas.renderAll();
    });

    document.getElementById('text-size').addEventListener('input', (e) => {
        textObj.set('fontSize', parseInt(e.target.value));
        canvas.renderAll();
    });
    
    document.getElementById('obj-opacity').addEventListener('input', (e) => {
        textObj.set('opacity', parseFloat(e.target.value));
        canvas.renderAll();
    });
}

function renderImageProperties(panel, imgObj) {
    panel.innerHTML = `
        <div style="padding: 15px; display: flex; flex-direction: column; gap: 15px;">
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Opacidad</label>
                <input type="range" id="obj-opacity" min="0" max="1" step="0.1" value="${imgObj.opacity}" style="width: 100%;">
            </div>
            <button id="btn-show-filters" class="btn-primary" style="width: 100%;">Ajustes de Color</button>
        </div>
    `;
    
    document.getElementById('obj-opacity').addEventListener('input', (e) => {
        imgObj.set('opacity', parseFloat(e.target.value));
        canvas.renderAll();
    });
    
    document.getElementById('btn-show-filters').addEventListener('click', () => {
        showFiltersPanel();
    });
}

function showFiltersPanel() {
    setTool('filters');
    const panel = document.getElementById('properties-content');
    
    if (!activeObject || activeObject.type !== 'image') {
        panel.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-image-square"></i>
                <p>Selecciona una imagen en el lienzo para aplicar filtros</p>
            </div>
        `;
        return;
    }
    
    panel.innerHTML = `
        <div style="padding: 15px; display: flex; flex-direction: column; gap: 15px;">
            <p style="font-size: 13px; font-weight: 500;">Filtros de Imagen</p>
            
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Brillo</label>
                <input type="range" id="filter-brightness" min="-0.5" max="0.5" step="0.05" value="0" style="width: 100%;">
            </div>
            
            <div>
                <label style="display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">Contraste</label>
                <input type="range" id="filter-contrast" min="-0.5" max="0.5" step="0.05" value="0" style="width: 100%;">
            </div>
            
            <button id="btn-grayscale" class="btn-primary" style="width: 100%; background: #333;">Filtro Blanco y Negro</button>
            <button id="btn-reset-filters" class="btn-primary" style="width: 100%; background: #d9534f;">Volver al original</button>
        </div>
    `;
    
    if(!fabric.Image.filters) {
       panel.innerHTML += "<p style='font-size:10px; color:red;'>Esta versión no soporta filtros complejos.</p>";
       return;
    }

    const applyFilter = (index, filter) => {
        activeObject.filters[index] = filter;
        activeObject.applyFilters();
        canvas.renderAll();
    };

    document.getElementById('filter-brightness').addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if(val === 0) {
            applyFilter(0, null);
        } else {
            applyFilter(0, new fabric.Image.filters.Brightness({ brightness: val }));
        }
    });

    document.getElementById('filter-contrast').addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if(val === 0) {
            applyFilter(1, null);
        } else {
             applyFilter(1, new fabric.Image.filters.Contrast({ contrast: val }));
        }
    });
    
    document.getElementById('btn-grayscale').addEventListener('click', () => {
        applyFilter(2, new fabric.Image.filters.Grayscale());
    });
    
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        activeObject.filters = [];
        activeObject.applyFilters();
        document.getElementById('filter-brightness').value = 0;
        document.getElementById('filter-contrast').value = 0;
        canvas.renderAll();
    });
}

// Layers Panel
function updateLayersPanel() {
    const layersList = document.getElementById('layers-list');
    const objects = canvas.getObjects();
    
    if (objects.length === 0) {
        layersList.innerHTML = `<div class="empty-state"><p>No hay capas activas</p></div>`;
        return;
    }
    
    let html = '';
    // Front layers top
    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        const isActive = activeObject === obj ? 'active' : '';
        const icon = obj.type === 'i-text' ? 'ph-text-t' : 'ph-image';
        const name = obj.name || (obj.type === 'i-text' ? 'Texto' : 'Imagen');
        
        html += `
            <div class="layer-item ${isActive}" onclick="selectLayer(${i})">
                <div class="layer-info">
                    <i class="ph ${icon}"></i>
                    <span>${name}</span>
                </div>
                <div class="layer-actions">
                    <button class="icon-btn" onclick="event.stopPropagation(); moveLayerUp(${i})" title="Traer al frente">
                        <i class="ph ph-caret-up"></i>
                    </button>
                    <button class="icon-btn" onclick="event.stopPropagation(); moveLayerDown(${i})" title="Enviar atrás">
                        <i class="ph ph-caret-down"></i>
                    </button>
                    <button class="icon-btn" style="color: #ff4d4f;" onclick="event.stopPropagation(); deleteLayer(${i})" title="Eliminar capa">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    layersList.innerHTML = html;
}

window.selectLayer = function(index) {
    const obj = canvas.item(index);
    if(obj) {
        canvas.setActiveObject(obj);
        canvas.renderAll();
    }
};

window.deleteLayer = function(index) {
    const obj = canvas.item(index);
    if(obj) {
        canvas.remove(obj);
        canvas.discardActiveObject();
        if(canvas.getObjects().length === 0) {
            document.getElementById('welcome-message').classList.remove('hidden');
        }
        updateLayersPanel();
        updatePropertiesPanel();
    }
};

window.moveLayerUp = function(index) {
    const obj = canvas.item(index);
    if(obj) {
        canvas.bringForward(obj);
        canvas.renderAll();
        updateLayersPanel();
    }
};

window.moveLayerDown = function(index) {
    const obj = canvas.item(index);
    if(obj) {
        canvas.sendBackwards(obj);
        canvas.renderAll();
        updateLayersPanel();
    }
};

// Export Image without watermark
function downloadImage() {
    const objects = canvas.getObjects();
    if (objects.length === 0) {
        alert("Agrega una imagen o texto antes de descargar.");
        return;
    }
    
    // Deselect active object to hide bounds selection
    canvas.discardActiveObject();
    canvas.renderAll();

    // To prevent downloading the whole empty canvas, we calculate the bounding box of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objects.forEach(obj => {
        const bound = obj.getBoundingRect();
        if(bound.left < minX) minX = bound.left;
        if(bound.top < minY) minY = bound.top;
        if(bound.left + bound.width > maxX) maxX = bound.left + bound.width;
        if(bound.top + bound.height > maxY) maxY = bound.top + bound.height;
    });

    if (minX === Infinity) return; // Fail safe

    // Add small padding
    const padding = 20;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width, maxX + padding);
    maxY = Math.min(canvas.height, maxY + padding);

    const width = maxX - minX;
    const height = maxY - minY;

    const exportDataUrl = canvas.toDataURL({
        format: 'png',
        quality: 1,
        multiplier: 2, // High resolution
        left: minX,
        top: minY,
        width: width,
        height: height
    });
    
    const link = document.createElement('a');
    link.download = 'eml-studio-export.png';
    link.href = exportDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
