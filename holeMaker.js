// Golf Hole Maker - Visual editor for creating hole layouts
// Uses Fabric.js for canvas manipulation
// All measurements in METERS (game will handle yards conversion for UI display)

// Par-based canvas dimensions
const PAR_CONFIGS = {
    3: { width: 200, height: 300 },  // Par 3: max 300m
    4: { width: 200, height: 475 },  // Par 4: max 475m
    5: { width: 200, height: 600 }   // Par 5: max 600m
};

let CANVAS_WIDTH = 200;
let CANVAS_HEIGHT = 475; // Default to par 4
const GRID_SIZE = 50; // meters per grid square

// Suggested zones (visual guides) - dynamically calculated based on canvas height
let TEE_ZONE_START = 425; // Bottom 50m for tee
const GREEN_ZONE_END = 100; // Top 100m for green (y=0 to y=100)

const SURFACE_COLORS = {
    tee: '#ecf0f1',
    fairway: '#27ae60',
    green: '#16a085',
    rough_light: '#95a5a6',
    rough_medium: '#7f8c8d',
    rough_heavy: '#5a6978',
    bunker: '#f1c40f',
    water: '#3498db'
};

const holeMaker = {
    canvas: null,
    currentSurface: null,  // No surface selected by default
    shapes: [],
    currentPoints: [],
    isDrawing: false,
    showGrid: true,
    showGuides: true,
    selectedShape: null,
    activePolygon: null,  // Our own selection tracking, bypassing Fabric
    objects: [], // Array to store trees/bushes
    objectPlacementMode: false,

    init() {
        // Set initial dimensions based on par 4
        this.updateCanvasDimensions(4);

        // Get container width
        const containerWidth = document.getElementById('canvas-container').clientWidth - 24; // subtract padding
        const scale = containerWidth / CANVAS_WIDTH;

        // Initialize Fabric canvas
        this.canvas = new fabric.Canvas('canvas', {
            width: containerWidth,
            height: CANVAS_HEIGHT * scale,
            backgroundColor: '#1a252f',
            selection: true,
            preserveObjectStacking: true
        });

        // Store scale for coordinate conversion
        this.scale = scale;

        // Draw grid and guides
        this.drawGrid();
        this.drawGuides();

        // Event listeners
        this.canvas.on('mouse:down', (e) => this.onMouseDown(e));
        this.canvas.on('mouse:move', (e) => this.onMouseMove(e));
        this.canvas.on('mouse:up', (e) => this.onMouseUp(e));
        this.canvas.on('mouse:dblclick', (e) => this.onDoubleClick(e));
        this.canvas.on('selection:created', (e) => this.onSelectionChange(e));
        this.canvas.on('selection:updated', (e) => this.onSelectionChange(e));
        this.canvas.on('selection:cleared', (e) => {
            this.selectedShape = null;
            // If we have an activePolygon, re-select it immediately
            if (this.activePolygon) {
                setTimeout(() => {
                    this.canvas.setActiveObject(this.activePolygon);
                    this.canvas.requestRenderAll();
                }, 0);
            }
        });

        // Right-click to close polygon
        this.canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.isDrawing && this.currentPoints.length >= 3) {
                this.closePolygon();
            }
        });

        // ESC key to cancel drawing or deselect
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isDrawing) {
                    this.cancelDrawing();
                } else if (this.activePolygon || this.canvas.getActiveObject()) {
                    this.activePolygon = null; // Clear our tracking
                    this.canvas.discardActiveObject();
                    this.canvas.requestRenderAll();
                }
            }
        });

        console.log('Hole Maker initialized');
    },

    drawGrid() {
        if (!this.showGrid) return;

        const gridGroup = [];
        const scale = this.scale;

        // Vertical lines
        for (let x = 0; x <= CANVAS_WIDTH; x += GRID_SIZE) {
            const line = new fabric.Line([x * scale, 0, x * scale, CANVAS_HEIGHT * scale], {
                stroke: '#2c5f3f',
                strokeWidth: x % (GRID_SIZE * 2) === 0 ? 2 : 1,
                selectable: false,
                evented: false
            });
            gridGroup.push(line);
        }

        // Horizontal lines
        for (let y = 0; y <= CANVAS_HEIGHT; y += GRID_SIZE) {
            const line = new fabric.Line([0, y * scale, CANVAS_WIDTH * scale, y * scale], {
                stroke: '#2c5f3f',
                strokeWidth: y % (GRID_SIZE * 2) === 0 ? 2 : 1,
                selectable: false,
                evented: false
            });
            gridGroup.push(line);
        }

        gridGroup.forEach(line => this.canvas.add(line));
        this.canvas.sendToBack(...gridGroup);
    },

    drawGuides() {
        if (!this.showGuides) return;

        const scale = this.scale;

        // Tee zone (bottom 50m) - light gray overlay
        const teeZone = new fabric.Rect({
            left: 0,
            top: TEE_ZONE_START * scale,
            width: CANVAS_WIDTH * scale,
            height: (CANVAS_HEIGHT - TEE_ZONE_START) * scale,
            fill: 'rgba(236, 240, 241, 0.1)',
            selectable: false,
            evented: false
        });
        this.canvas.add(teeZone);

        const teeLabel = new fabric.Text('TEE ZONE', {
            left: (CANVAS_WIDTH / 2) * scale,
            top: (TEE_ZONE_START + 20) * scale,
            fontSize: 16 * scale,
            fill: '#ecf0f1',
            selectable: false,
            evented: false,
            originX: 'center'
        });
        this.canvas.add(teeLabel);

        // Green zone (top 100m) - light teal overlay
        const greenZone = new fabric.Rect({
            left: 0,
            top: 0,
            width: CANVAS_WIDTH * scale,
            height: GREEN_ZONE_END * scale,
            fill: 'rgba(22, 160, 133, 0.1)',
            selectable: false,
            evented: false
        });
        this.canvas.add(greenZone);

        const greenLabel = new fabric.Text('GREEN ZONE', {
            left: (CANVAS_WIDTH / 2) * scale,
            top: 50 * scale,
            fontSize: 16 * scale,
            fill: '#16a085',
            selectable: false,
            evented: false,
            originX: 'center'
        });
        this.canvas.add(greenLabel);

        // Distance markers on the side
        const maxDist = Math.ceil(CANVAS_HEIGHT / 100) * 100;
        for (let dist = 0; dist <= maxDist; dist += 100) {
            if (dist > CANVAS_HEIGHT) break;
            const y = (CANVAS_HEIGHT - dist) * scale; // Flip Y (0 at top, bottom at height)
            const marker = new fabric.Text(`${dist}m`, {
                left: 5 * scale,
                top: y - (8 * scale),
                fontSize: 12 * scale,
                fill: '#95a5a6',
                selectable: false,
                evented: false
            });
            this.canvas.add(marker);
        }
    },

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.redrawAll();
    },

    toggleGuides() {
        this.showGuides = !this.showGuides;
        this.redrawAll();
    },

    redrawAll() {
        this.canvas.clear();
        if (this.showGrid) {
            this.drawGrid();
        }
        if (this.showGuides) {
            this.drawGuides();
        }
        // Redraw all shapes
        this.shapes.forEach(shape => this.canvas.add(shape.polygon));
        // Redraw all objects (trees/bushes)
        this.objects.forEach(obj => this.canvas.add(obj.visual));
        this.canvas.renderAll();
    },

    updateCanvasDimensions(par) {
        const config = PAR_CONFIGS[par];
        CANVAS_WIDTH = config.width;
        CANVAS_HEIGHT = config.height;
        TEE_ZONE_START = CANVAS_HEIGHT - 50; // Always bottom 50m

        // Update UI
        document.getElementById('canvasDimensions').innerHTML =
            `<strong>Canvas:</strong> ${CANVAS_WIDTH}m wide × ${CANVAS_HEIGHT}m long`;
        document.getElementById('teeZoneInfo').innerHTML =
            `<strong>Tee Zone:</strong> Bottom 50m (${TEE_ZONE_START}m-${CANVAS_HEIGHT}m)`;
    },

    onParChange() {
        const par = parseInt(document.getElementById('holePar').value);

        // Update dimensions
        this.updateCanvasDimensions(par);

        // Recalculate scale
        const containerWidth = document.getElementById('canvas-container').clientWidth - 24;
        this.scale = containerWidth / CANVAS_WIDTH;

        // Resize canvas
        this.canvas.setWidth(containerWidth);
        this.canvas.setHeight(CANVAS_HEIGHT * this.scale);

        // Redraw everything
        this.redrawAll();
    },

    selectSurface(type, event) {
        // Cancel any active drawing when switching surface types
        if (this.isDrawing) {
            this.cancelDrawing();
        }

        this.currentSurface = type;

        // Update UI
        document.querySelectorAll('.surface-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        if (event && event.target) {
            event.target.classList.add('active');
        } else {
            // Default selection (no event)
            const btn = document.querySelector(`.surface-btn[data-surface="${type}"]`);
            if (btn) btn.classList.add('active');
        }
    },

    snapToEdges(x, y) {
        const SNAP_DISTANCE = 5 * this.scale; // 5 meters snap threshold
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        let snappedX = x;
        let snappedY = y;

        // Constrain to canvas bounds
        snappedX = Math.max(0, Math.min(canvasWidth, x));
        snappedY = Math.max(0, Math.min(canvasHeight, y));

        // Snap to canvas edges if close
        if (Math.abs(snappedX) < SNAP_DISTANCE) snappedX = 0;
        if (Math.abs(snappedX - canvasWidth) < SNAP_DISTANCE) snappedX = canvasWidth;
        if (Math.abs(snappedY) < SNAP_DISTANCE) snappedY = 0;
        if (Math.abs(snappedY - canvasHeight) < SNAP_DISTANCE) snappedY = canvasHeight;

        // Snap to vertices of other shapes (only if within threshold)
        let minDistance = SNAP_DISTANCE;
        let snapVertex = null;

        this.shapes.forEach(shape => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach(point => {
                    const dx = point.x - snappedX;
                    const dy = point.y - snappedY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < minDistance) {
                        minDistance = distance;
                        snapVertex = { x: point.x, y: point.y };
                    }
                });
            }
        });

        // Only apply vertex snap if we found one within threshold
        if (snapVertex && minDistance < SNAP_DISTANCE) {
            snappedX = snapVertex.x;
            snappedY = snapVertex.y;
        }

        return { x: snappedX, y: snappedY };
    },

    onMouseDown(e) {
        // Handle object placement mode
        if (this.objectPlacementMode) {
            const pointer = this.canvas.getPointer(e.e);
            this.placeObject(pointer.x, pointer.y);
            return;
        }

        if (e.target && e.target !== this.canvas) {
            // Clicked on existing object - track it as our active polygon
            if (e.target.type === 'polygon') {
                this.activePolygon = e.target;
                // Re-select it in Fabric to show vertex controls
                this.canvas.setActiveObject(e.target);
                this.canvas.requestRenderAll();
            }
            return;
        }

        // Clicked on empty canvas
        // Check if a surface type is selected
        if (!this.currentSurface) {
            // No surface selected - do nothing (use ESC to deselect)
            return;
        }

        // Surface type is selected - handle drawing
        if (!this.isDrawing) {
            this.isDrawing = true;
            this.currentPoints = [];
        }

        const pointer = this.canvas.getPointer(e.e);

        // Constrain to canvas bounds and snap to edges
        const snappedPoint = this.snapToEdges(pointer.x, pointer.y);
        this.currentPoints.push(snappedPoint);

        // Draw point marker
        const circle = new fabric.Circle({
            left: snappedPoint.x,
            top: snappedPoint.y,
            radius: 4,
            fill: '#3498db',
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false
        });
        this.canvas.add(circle);

        // Draw line from previous point
        if (this.currentPoints.length > 1) {
            const prev = this.currentPoints[this.currentPoints.length - 2];
            const line = new fabric.Line([prev.x, prev.y, snappedPoint.x, snappedPoint.y], {
                stroke: SURFACE_COLORS[this.currentSurface],
                strokeWidth: 2,
                selectable: false,
                evented: false
            });
            this.canvas.add(line);
        }

        this.canvas.renderAll();
    },

    onDoubleClick(e) {
        // If we have an active polygon, add a point to it at the double-click location
        if (this.activePolygon) {
            const pointer = this.canvas.getPointer(e.e);
            this.addPointToPolygon(this.activePolygon, pointer.x, pointer.y);
        }
    },

    onMouseMove(e) {
        const pointer = this.canvas.getPointer(e.e);
        const metersX = pointer.x / this.scale;
        const metersY = pointer.y / this.scale;

        document.getElementById('mousePos').textContent =
            `Mouse: ${metersX.toFixed(0)}m, ${metersY.toFixed(0)}m`;
    },

    onMouseUp(e) {
        // Currently not used, but could be for drag operations
    },

    closePolygon() {
        if (this.currentPoints.length < 3) {
            alert('Need at least 3 points to create a shape');
            return;
        }

        // Check for single tee/green constraint
        if (this.currentSurface === 'tee') {
            const existingTee = this.shapes.find(s => s.type === 'tee');
            if (existingTee) {
                alert('Only one tee box is allowed. Delete the existing tee first.');
                this.cancelDrawing();
                return;
            }
        }

        if (this.currentSurface === 'green') {
            const existingGreen = this.shapes.find(s => s.type === 'green');
            if (existingGreen) {
                alert('Only one green is allowed. Delete the existing green first.');
                this.cancelDrawing();
                return;
            }
        }

        // Remove temporary markers
        const objects = this.canvas.getObjects();
        objects.forEach(obj => {
            if (obj.selectable === false) {
                this.canvas.remove(obj);
            }
        });

        // Create polygon from points with editable vertices
        const polygon = new fabric.Polygon(this.currentPoints, {
            fill: SURFACE_COLORS[this.currentSurface],
            stroke: '#2c3e50',
            strokeWidth: 2,
            opacity: 0.7,
            objectCaching: false,
            transparentCorners: false,
            cornerColor: '#3498db',
            cornerSize: 12,
            hasBorders: false,  // Remove selection border
            hasControls: true,  // Keep controls enabled for vertex editing
            hasRotatingPoint: false,
            lockRotation: true,
            selectable: true,
            evented: true,
            perPixelTargetFind: true
        });

        // Hide default transform controls (but allow custom vertex controls)
        polygon.setControlsVisibility({
            mt: false, mb: false, ml: false, mr: false,
            bl: false, br: false, tl: false, tr: false,
            mtr: false
        });

        this.enablePolygonEditing(polygon);

        this.canvas.add(polygon);

        // Store shape data
        const shapeData = {
            id: Date.now(),
            type: this.currentSurface,
            polygon: polygon,
            points: JSON.parse(JSON.stringify(this.currentPoints))
        };

        this.shapes.push(shapeData);

        // Reset drawing state and deselect surface type
        this.isDrawing = false;
        this.currentPoints = [];
        this.currentSurface = null;

        // Deselect the surface button in UI
        document.querySelectorAll('.surface-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Update layers list and recalculate hole length
        this.updateLayersList();
        this.calculateHoleLength();

        this.canvas.renderAll();
    },

    cancelDrawing() {
        if (!this.isDrawing) return;

        // Remove all temporary drawing markers and lines
        const objects = this.canvas.getObjects();
        objects.forEach(obj => {
            if (obj.selectable === false) {
                this.canvas.remove(obj);
            }
        });

        // Reset drawing state
        this.isDrawing = false;
        this.currentPoints = [];

        // Redraw grid and guides
        this.redrawAll();
    },

    enablePolygonEditing(polygon) {
        // Add control points at each vertex for editing
        const points = polygon.points;
        const self = this;

        polygon.controls = points.reduce((acc, point, index) => {
            acc['p' + index] = new fabric.Control({
                positionHandler: (dim, finalMatrix, fabricObject) => {
                    const x = fabricObject.points[index].x - fabricObject.pathOffset.x;
                    const y = fabricObject.points[index].y - fabricObject.pathOffset.y;
                    return fabric.util.transformPoint(
                        { x, y },
                        fabric.util.multiplyTransformMatrices(
                            fabricObject.canvas.viewportTransform,
                            fabricObject.calcTransformMatrix()
                        )
                    );
                },
                actionHandler: (eventData, transform, x, y) => {
                    const polygon = transform.target;
                    const currentControl = polygon.controls[polygon.__corner];
                    const mouseLocalPosition = polygon.toLocalPoint(new fabric.Point(x, y), 'center', 'center');
                    const polygonBaseSize = polygon._getNonTransformedDimensions();
                    const size = polygon._getTransformedDimensions(0, 0);
                    let finalPointPosition = {
                        x: (mouseLocalPosition.x * polygonBaseSize.x) / size.x + polygon.pathOffset.x,
                        y: (mouseLocalPosition.y * polygonBaseSize.y) / size.y + polygon.pathOffset.y
                    };

                    // Apply snap to edges and boundary constraints
                    const snapped = self.snapToEdges(finalPointPosition.x, finalPointPosition.y);
                    polygon.points[index] = snapped;

                    return true;
                },
                mouseUpHandler: (eventData, transform) => {
                    const polygon = transform.target;

                    // Force polygon to recalculate its path offset and dimensions
                    polygon._calcDimensions();
                    polygon.setCoords();
                    polygon.dirty = true;
                    self.canvas.requestRenderAll();

                    // Recalculate hole length if editing tee or green
                    const shapeData = self.shapes.find(s => s.polygon === polygon);
                    if (shapeData && (shapeData.type === 'tee' || shapeData.type === 'green')) {
                        self.calculateHoleLength();
                    }

                    return true;
                },
                cornerSize: 12,
                cornerStyle: 'circle',
                pointIndex: index
            });
            return acc;
        }, {});

        this.canvas.requestRenderAll();
    },

    addPointToPolygon(polygon, x, y) {
        // Convert canvas coordinates to polygon coordinate space
        const localPoint = polygon.toLocalPoint(new fabric.Point(x, y), 'center', 'center');
        const polygonBaseSize = polygon._getNonTransformedDimensions();
        const size = polygon._getTransformedDimensions(0, 0);
        const newPoint = {
            x: (localPoint.x * polygonBaseSize.x) / size.x + polygon.pathOffset.x,
            y: (localPoint.y * polygonBaseSize.y) / size.y + polygon.pathOffset.y
        };

        // Find closest edge to insert the point
        const points = polygon.points;
        let minDist = Infinity;
        let insertIndex = 0;

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];

            // Calculate distance from point to line segment
            const dist = this.pointToSegmentDistance(newPoint, p1, p2);
            if (dist < minDist) {
                minDist = dist;
                insertIndex = i + 1;
            }
        }

        // Insert the new point
        points.splice(insertIndex, 0, newPoint);

        // Re-enable editing to update controls
        this.enablePolygonEditing(polygon);
        this.canvas.requestRenderAll();
    },

    pointToSegmentDistance(point, segStart, segEnd) {
        const dx = segEnd.x - segStart.x;
        const dy = segEnd.y - segStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            const pdx = point.x - segStart.x;
            const pdy = point.y - segStart.y;
            return Math.sqrt(pdx * pdx + pdy * pdy);
        }

        let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const closestX = segStart.x + t * dx;
        const closestY = segStart.y + t * dy;
        const distX = point.x - closestX;
        const distY = point.y - closestY;

        return Math.sqrt(distX * distX + distY * distY);
    },

    toggleObjectPlacementMode() {
        // Cancel any active drawing when entering object placement mode
        if (this.isDrawing && !this.objectPlacementMode) {
            this.cancelDrawing();
        }

        this.objectPlacementMode = !this.objectPlacementMode;
        const btn = document.getElementById('objectModeText');

        if (this.objectPlacementMode) {
            btn.textContent = 'Cancel (Place Objects)';
            btn.parentElement.style.background = '#e74c3c';
            this.canvas.defaultCursor = 'crosshair';
        } else {
            btn.textContent = 'Place Objects';
            btn.parentElement.style.background = '';
            this.canvas.defaultCursor = 'default';
        }
    },

    placeObject(x, y) {
        const type = document.getElementById('objectType').value;
        const size = document.getElementById('objectSize').value;

        // Convert from scaled pixels to meters
        const metersX = x / this.scale;
        const metersZ = y / this.scale;

        // Create visual marker
        const color = type === 'tree' ? '#2d5016' : '#3a6b1f';
        const radius = size === 'small' ? 3 : size === 'medium' ? 5 : 7;

        const circle = new fabric.Circle({
            left: x,
            top: y,
            radius: radius * this.scale,
            fill: color,
            stroke: '#000',
            strokeWidth: 1,
            originX: 'center',
            originY: 'center',
            selectable: true,
            hasControls: false,
            hasBorders: true,
            borderColor: '#3498db'
        });

        // Store object data
        const objData = {
            type,
            size,
            x: parseFloat(metersX.toFixed(2)),
            z: parseFloat(metersZ.toFixed(2)),
            visual: circle
        };

        this.objects.push(objData);
        this.canvas.add(circle);

        // Allow deletion
        circle.on('selected', () => {
            this.selectedObject = objData;
        });

        this.canvas.renderAll();
    },

    updateLayersList() {
        const list = document.getElementById('layersList');
        list.innerHTML = '';

        this.shapes.forEach((shape, index) => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            if (this.selectedShape === shape.polygon) {
                item.classList.add('active');
            }

            item.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="layer-color" style="background: ${SURFACE_COLORS[shape.type]}"></div>
                    <span>${shape.type.toUpperCase()} #${index + 1}</span>
                </div>
                <span style="font-size: 11px;">${shape.points.length} pts</span>
            `;

            item.onclick = () => {
                this.canvas.setActiveObject(shape.polygon);
                this.canvas.renderAll();
            };

            list.appendChild(item);
        });

        // Auto-calculate hole length
        this.calculateHoleLength();
    },

    calculateHoleLength() {
        const tee = this.shapes.find(s => s.type === 'tee');
        const green = this.shapes.find(s => s.type === 'green');

        if (!tee || !green) {
            document.getElementById('holeLength').value = '-';
            return;
        }

        // Calculate tee center (convert from scaled pixels to meters)
        const teePoints = tee.polygon.points;
        const teeMinX = Math.min(...teePoints.map(p => p.x)) / this.scale;
        const teeMaxX = Math.max(...teePoints.map(p => p.x)) / this.scale;
        const teeMinY = Math.min(...teePoints.map(p => p.y)) / this.scale;
        const teeMaxY = Math.max(...teePoints.map(p => p.y)) / this.scale;
        const teeCenterX = (teeMinX + teeMaxX) / 2;
        const teeCenterY = (teeMinY + teeMaxY) / 2;

        // Calculate green center (flag position)
        const greenPoints = green.polygon.points;
        const greenMinX = Math.min(...greenPoints.map(p => p.x)) / this.scale;
        const greenMaxX = Math.max(...greenPoints.map(p => p.x)) / this.scale;
        const greenMinY = Math.min(...greenPoints.map(p => p.y)) / this.scale;
        const greenMaxY = Math.max(...greenPoints.map(p => p.y)) / this.scale;
        const greenCenterX = (greenMinX + greenMaxX) / 2;
        const greenCenterY = (greenMinY + greenMaxY) / 2;

        // Calculate distance in meters
        const dx = greenCenterX - teeCenterX;
        const dy = greenCenterY - teeCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        document.getElementById('holeLength').value = `${distance.toFixed(1)}m`;
    },

    onSelectionChange(e) {
        this.selectedShape = e.selected ? e.selected[0] : null;
        this.updateLayersList();
    },

    deleteSelected() {
        const active = this.canvas.getActiveObject();
        if (!active) {
            alert('No shape selected');
            return;
        }

        // Remove from canvas
        this.canvas.remove(active);

        // Remove from shapes array
        this.shapes = this.shapes.filter(shape => shape.polygon !== active);

        // Remove from objects array if it's an object
        this.objects = this.objects.filter(obj => obj.visual !== active);

        this.updateLayersList();
        this.calculateHoleLength();
        this.canvas.renderAll();
    },

    clearCanvas() {
        if (!confirm('Clear all shapes?')) return;

        this.shapes = [];
        this.isDrawing = false;
        this.currentPoints = [];
        this.redrawAll();
        this.updateLayersList(); // Updates calculated length
    },

    convertPointsToMeters(points) {
        // Convert canvas coordinates to meters (round to 2 decimals)
        // Divide by scale to get actual meters
        return points.map(p => ({
            x: parseFloat((p.x / this.scale).toFixed(2)),
            z: parseFloat((p.y / this.scale).toFixed(2))
        }));
    },

    exportJSON() {
        const holeName = document.getElementById('holeName').value || 'custom_hole_01';
        const par = parseInt(document.getElementById('holePar').value) || 4;

        // Get auto-calculated length from tee to green
        const lengthText = document.getElementById('holeLength').value;
        const lengthMeters = lengthText === '-' ? 0 : parseFloat(lengthText);

        const layout = {
            name: holeName,
            par: par,
            lengthMeters: lengthMeters,
            background: {
                vertices: [
                    { x: -100, z: -30 },
                    { x: 100, z: -30 },
                    { x: 100, z: 400 },
                    { x: -100, z: 400 }
                ],
                surface: "OUT_OF_BOUNDS"
            }
        };

        // Group shapes by type
        const tee = this.shapes.find(s => s.type === 'tee');
        const fairway = this.shapes.find(s => s.type === 'fairway');
        const green = this.shapes.find(s => s.type === 'green');
        const rough = this.shapes.find(s => s.type === 'rough');
        const bunkers = this.shapes.filter(s => s.type === 'bunker');
        const water = this.shapes.filter(s => s.type === 'water');

        // Add tee (calculate center and dimensions)
        if (tee) {
            const points = tee.polygon.points;
            const minX = Math.min(...points.map(p => p.x));
            const maxX = Math.max(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            const maxY = Math.max(...points.map(p => p.y));

            const centerX = parseFloat(((minX + maxX) / 2).toFixed(2));
            const centerZ = parseFloat(((minY + maxY) / 2).toFixed(2));
            const width = parseFloat((maxX - minX).toFixed(2));
            const depth = parseFloat((maxY - minY).toFixed(2));

            layout.tee = {
                center: { x: centerX, z: centerZ },
                width: width,
                depth: depth,
                surface: "TEE"
            };
        }

        // Add fairway
        if (fairway) {
            const metersPoints = this.convertPointsToMeters(fairway.polygon.points);
            layout.fairway = {
                controlPoints: metersPoints,
                surface: "FAIRWAY"
            };
        }

        // Add green
        if (green) {
            const metersPoints = this.convertPointsToMeters(green.polygon.points);
            layout.green = {
                controlPoints: metersPoints,
                surface: "GREEN"
            };
        }

        // Add rough
        if (rough) {
            const metersPoints = this.convertPointsToMeters(rough.polygon.points);
            layout.rough = {
                vertices: metersPoints,
                surface: "THICK_ROUGH"
            };
        }

        // Add bunkers
        if (bunkers.length > 0) {
            layout.bunkers = bunkers.map(bunker => ({
                controlPoints: this.convertPointsToMeters(bunker.polygon.points),
                surface: "BUNKER"
            }));
        }

        // Add water
        if (water.length > 0) {
            layout.waterHazards = water.map(w => ({
                surface: "WATER",
                controlPoints: this.convertPointsToMeters(w.polygon.points)
            }));
        }

        // Add objects (trees/bushes)
        if (this.objects.length > 0) {
            layout.obstacles = this.objects.map(obj => ({
                type: obj.type,
                size: obj.size,
                x: obj.x,
                z: obj.z
            }));
        }

        const json = JSON.stringify(layout, null, 2);
        document.getElementById('jsonOutput').value = json;

        console.log('Exported hole layout:', layout);
    },

    previewHole() {
        // Validate that hole has required elements
        const tee = this.shapes.find(s => s.type === 'tee');
        const green = this.shapes.find(s => s.type === 'green');

        if (!tee) {
            alert('Cannot preview: Hole must have a tee box. Please create a tee box first.');
            return;
        }

        if (!green) {
            alert('Cannot preview: Hole must have a green. Please create a green first.');
            return;
        }

        // Coming soon message
        alert('Preview feature coming soon! This will allow you to view the hole in 3D before playing it.');
    },

    importJSON() {
        const jsonText = document.getElementById('jsonOutput').value;
        if (!jsonText) {
            alert('Paste JSON into the text area first');
            return;
        }

        try {
            const layout = JSON.parse(jsonText);

            // Clear existing
            this.clearCanvas();

            // Set hole info
            if (layout.name) document.getElementById('holeName').value = layout.name;
            if (layout.par) document.getElementById('holePar').value = layout.par;
            if (layout.lengthMeters) document.getElementById('holeLength').value = layout.lengthMeters;

            // Helper to convert meters (from JSON) to canvas coordinates
            const metersToCanvas = (point) => ({
                x: point.x,
                y: point.z
            });

            // Import tee
            if (layout.tee && layout.tee.center) {
                const c = metersToCanvas({ x: layout.tee.center.x, z: layout.tee.center.z });
                const hw = layout.tee.width / 2;
                const hd = layout.tee.depth / 2;

                this.currentPoints = [
                    { x: c.x - hw, y: c.y - hd },
                    { x: c.x + hw, y: c.y - hd },
                    { x: c.x + hw, y: c.y + hd },
                    { x: c.x - hw, y: c.y + hd }
                ];
                this.currentSurface = 'tee';
                this.closePolygon();
            }

            // Import fairway
            if (layout.fairway && layout.fairway.controlPoints) {
                this.currentPoints = layout.fairway.controlPoints.map(metersToCanvas);
                this.currentSurface = 'fairway';
                this.closePolygon();
            }

            // Import green
            if (layout.green && layout.green.controlPoints) {
                this.currentPoints = layout.green.controlPoints.map(metersToCanvas);
                this.currentSurface = 'green';
                this.closePolygon();
            }

            // Import rough
            if (layout.rough && layout.rough.vertices) {
                this.currentPoints = layout.rough.vertices.map(metersToCanvas);
                this.currentSurface = 'rough';
                this.closePolygon();
            }

            // Import bunkers
            if (layout.bunkers) {
                layout.bunkers.forEach(bunker => {
                    if (bunker.controlPoints) {
                        this.currentPoints = bunker.controlPoints.map(metersToCanvas);
                        this.currentSurface = 'bunker';
                        this.closePolygon();
                    }
                });
            }

            // Import water
            if (layout.waterHazards) {
                layout.waterHazards.forEach(water => {
                    if (water.controlPoints) {
                        this.currentPoints = water.controlPoints.map(metersToCanvas);
                        this.currentSurface = 'water';
                        this.closePolygon();
                    }
                });
            }

            console.log('Imported hole layout');
        } catch (e) {
            alert('Invalid JSON: ' + e.message);
        }
    }
};

// Initialize when page loads
window.addEventListener('load', () => {
    holeMaker.init();
});
