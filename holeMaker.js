// Golf Hole Maker - Visual editor for creating hole layouts
// Uses Fabric.js for canvas manipulation
// All measurements in METERS (game will handle yards conversion for UI display)

import { courseManager } from './src/courseManager.js';

// Par-based canvas dimensions
const PAR_CONFIGS = {
    3: { width: 100, minHeight: 125, maxHeight: 325 },  // Par 3: min 125m, max 325m
    4: { width: 100, minHeight: 300, maxHeight: 500 },  // Par 4: min 300m, max 500m
    5: { width: 100, minHeight: 500, maxHeight: 625 }   // Par 5: min 500m, max 625m
};

let CANVAS_WIDTH = 100;
let CANVAS_HEIGHT = 500; // Default to par 4
const GRID_SIZE = 25; // meters per grid square

// Suggested zones (visual guides) - dynamically calculated based on canvas height
let TEE_ZONE_START = 425; // Bottom 50m for tee
let GREEN_ZONE_START = 0; // Top of green zone (y coordinate)
let GREEN_ZONE_END = 225; // Bottom of green zone (y coordinate)

const SURFACE_COLORS = {
    tee: '#ecf0f1',
    fairway: '#27ae60',
    green: '#9ACD32',  // Yellow-green for better distinction
    rough_light: '#95a5a6',
    rough_medium: '#7f8c8d',
    rough_heavy: '#5a6978',
    bunker: '#D2B48C',  // Tan/sand color for bunker
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
    showVertices: true,
    selectedShape: null,
    activePolygon: null,  // Our own selection tracking, bypassing Fabric
    objects: [], // Array to store trees/bushes
    objectPlacementMode: false,
    teeBoxPlacementMode: false,
    flagPlacementMode: false,
    teeBox: null, // Store the tee box object
    flagPositions: [], // Store flag positions (max 4)
    vertexMarkers: [], // Store vertex marker circles

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
        this.canvas.on('object:moving', (e) => this.updateVertexMarkers());
        this.canvas.on('object:modified', (e) => {
            // This fires when moving the whole shape or editing vertices is complete
            this.onObjectMoved(e);
        });
        this.canvas.on('selection:cleared', (e) => {
            this.selectedShape = null;
            // Disabled re-selection to prevent interference with smooth dragging
            // if (this.activePolygon && !this.canvas._currentTransform) {
            //     setTimeout(() => {
            //         this.canvas.setActiveObject(this.activePolygon);
            //         this.canvas.requestRenderAll();
            //     }, 0);
            // }
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
            fontSize: 7 * scale,
            fill: 'rgba(236, 240, 241, 0.5)',
            selectable: false,
            evented: false,
            originX: 'center'
        });
        this.canvas.add(teeLabel);

        // Green zone - light teal overlay
        const greenZone = new fabric.Rect({
            left: 0,
            top: GREEN_ZONE_START * scale,
            width: CANVAS_WIDTH * scale,
            height: (GREEN_ZONE_END - GREEN_ZONE_START) * scale,
            fill: 'rgba(22, 160, 133, 0.1)',
            selectable: false,
            evented: false
        });
        this.canvas.add(greenZone);

        const greenLabel = new fabric.Text('GREEN ZONE', {
            left: (CANVAS_WIDTH / 2) * scale,
            top: (GREEN_ZONE_START + (GREEN_ZONE_END - GREEN_ZONE_START) / 2) * scale,
            fontSize: 7 * scale,
            fill: 'rgba(22, 160, 133, 0.5)',
            selectable: false,
            evented: false,
            originX: 'center'
        });
        this.canvas.add(greenLabel);

        // Distance markers on the side (every 25m)
        const maxDist = Math.ceil(CANVAS_HEIGHT / 25) * 25;
        for (let dist = 0; dist <= maxDist; dist += 25) {
            if (dist > CANVAS_HEIGHT) break;
            const y = (CANVAS_HEIGHT - dist) * scale; // Flip Y (0 at top, bottom at height)
            const marker = new fabric.Text(`${dist}m`, {
                left: 3 * scale,
                top: y - (5 * scale),
                fontSize: 6 * scale,
                fill: 'rgba(149, 165, 166, 0.6)',
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

    toggleVertices() {
        this.showVertices = !this.showVertices;
        this.updateVertexMarkers();
    },

    updateVertexMarkers() {
        // Remove existing vertex markers
        this.vertexMarkers.forEach(marker => this.canvas.remove(marker));
        this.vertexMarkers = [];

        if (!this.showVertices) {
            this.canvas.requestRenderAll();
            return;
        }

        // Add vertex markers for all polygons
        this.shapes.forEach(shape => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach(point => {
                    // Convert to absolute canvas coordinates
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    const marker = new fabric.Circle({
                        left: absPoint.x,
                        top: absPoint.y,
                        radius: 3,
                        fill: '#e74c3c',
                        stroke: '#c0392b',
                        strokeWidth: 1,
                        originX: 'center',
                        originY: 'center',
                        selectable: false,
                        evented: true,
                        hoverCursor: 'pointer'
                    });

                    // Store reference to parent polygon
                    marker.parentPolygon = shape.polygon;

                    // Add click handler to select the parent polygon
                    marker.on('mousedown', (options) => {
                        // Stop event propagation to prevent Fabric's selection box
                        if (options.e) {
                            options.e.stopPropagation();
                            options.e.preventDefault();
                        }

                        this.activePolygon = shape.polygon;
                        this.canvas.setActiveObject(shape.polygon);
                        this.canvas.requestRenderAll();

                        // Return false to prevent further event handling
                        return false;
                    });

                    this.vertexMarkers.push(marker);
                    this.canvas.add(marker);
                });
            }
        });

        this.canvas.requestRenderAll();
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

    updateCanvasDimensions(par, height = null, width = null) {
        const config = PAR_CONFIGS[par];
        CANVAS_WIDTH = width || config.width;
        CANVAS_HEIGHT = height || config.maxHeight; // Use provided height or max
        TEE_ZONE_START = CANVAS_HEIGHT - 50; // Always bottom 50m

        // Calculate green zone proportionally based on actual canvas height
        // Green zone should be in the top portion, accounting for par requirements
        const maxCanvasHeight = config.maxHeight;
        if (par === 3) {
            // Par 3: green at 100m-300m from tee
            GREEN_ZONE_START = Math.max(0, CANVAS_HEIGHT - 300);
            GREEN_ZONE_END = Math.max(GREEN_ZONE_START + 25, CANVAS_HEIGHT - 100);
        } else if (par === 4) {
            // Par 4: green at 250m-475m from tee
            GREEN_ZONE_START = Math.max(0, CANVAS_HEIGHT - 475);
            GREEN_ZONE_END = Math.max(GREEN_ZONE_START + 25, CANVAS_HEIGHT - 250);
        } else { // par === 5
            // Par 5: green at 375m-600m from tee
            GREEN_ZONE_START = Math.max(0, CANVAS_HEIGHT - 600);
            GREEN_ZONE_END = Math.max(GREEN_ZONE_START + 25, CANVAS_HEIGHT - 375);
        }

        // Update UI
        document.getElementById('canvasDimensions').innerHTML =
            `<strong>Canvas:</strong> ${CANVAS_WIDTH}m wide × ${CANVAS_HEIGHT}m long`;
        document.getElementById('teeZoneInfo').innerHTML =
            `<strong>Tee Zone:</strong> Bottom 50m (${TEE_ZONE_START}m-${CANVAS_HEIGHT}m)`;
    },

    onParChange() {
        const par = parseInt(document.getElementById('holePar').value);
        const config = PAR_CONFIGS[par];

        // Update height input constraints
        const heightInput = document.getElementById('canvasHeight');
        heightInput.min = config.minHeight;
        heightInput.max = config.maxHeight;
        heightInput.value = config.maxHeight; // Reset to max on par change

        document.getElementById('heightConstraints').textContent =
            `Min: ${config.minHeight}m, Max: ${config.maxHeight}m`;

        // Update dimensions
        this.updateCanvasDimensions(par, config.maxHeight);

        // Recalculate scale
        const containerWidth = document.getElementById('canvas-container').clientWidth - 24;
        this.scale = containerWidth / CANVAS_WIDTH;

        // Resize canvas
        this.canvas.setWidth(containerWidth);
        this.canvas.setHeight(CANVAS_HEIGHT * this.scale);

        // Redraw everything
        this.redrawAll();
    },

    onCanvasSizeChange() {
        const par = parseInt(document.getElementById('holePar').value);
        const config = PAR_CONFIGS[par];

        // Get and constrain width (50m - 150m)
        let width = parseInt(document.getElementById('canvasWidth').value);
        if (width < 50) {
            width = 50;
            document.getElementById('canvasWidth').value = width;
        } else if (width > 150) {
            width = 150;
            document.getElementById('canvasWidth').value = width;
        }

        // Get and constrain height
        let height = parseInt(document.getElementById('canvasHeight').value);
        if (height < config.minHeight) {
            height = config.minHeight;
            document.getElementById('canvasHeight').value = height;
        } else if (height > config.maxHeight) {
            height = config.maxHeight;
            document.getElementById('canvasHeight').value = height;
        }

        // Update dimensions with new width and height
        this.updateCanvasDimensions(par, height, width);

        // Recalculate scale
        const containerWidth = document.getElementById('canvas-container').clientWidth - 24;
        this.scale = containerWidth / CANVAS_WIDTH;
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

        // Change cursor to indicate drawing mode
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.hoverCursor = 'crosshair';
    },

    snapToEdges(x, y) {
        const SNAP_DISTANCE = 2.5 * this.scale; // 2.5 meters snap threshold
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
        // DISABLED - causes performance issues during dragging
        // let minDistance = SNAP_DISTANCE;
        // let snapVertex = null;

        // this.shapes.forEach(shape => {
        //     if (shape.polygon && shape.polygon.points) {
        //         shape.polygon.points.forEach(point => {
        //             const dx = point.x - snappedX;
        //             const dy = point.y - snappedY;
        //             const distance = Math.sqrt(dx * dx + dy * dy);

        //             if (distance < minDistance) {
        //                 minDistance = distance;
        //                 snapVertex = { x: point.x, y: point.y };
        //             }
        //         });
        //     }
        // });

        // // Only apply vertex snap if we found one within threshold
        // if (snapVertex && minDistance < SNAP_DISTANCE) {
        //     snappedX = snapVertex.x;
        //     snappedY = snapVertex.y;
        // }

        return { x: snappedX, y: snappedY };
    },

    snapToVertices(x, y) {
        // First snap to edges
        const edgeSnapped = this.snapToEdges(x, y);

        // Then check for nearby vertices
        const SNAP_DISTANCE = 2.5 * this.scale;
        let minDistance = SNAP_DISTANCE;
        let snapVertex = null;

        this.shapes.forEach(shape => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach(point => {
                    // Convert to absolute canvas coordinates
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    const dx = absPoint.x - edgeSnapped.x;
                    const dy = absPoint.y - edgeSnapped.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < minDistance) {
                        minDistance = distance;
                        snapVertex = { x: absPoint.x, y: absPoint.y };
                    }
                });
            }
        });

        // Return vertex snap if found, otherwise edge snap
        if (snapVertex && minDistance < SNAP_DISTANCE) {
            return snapVertex;
        }
        return edgeSnapped;
    },

    onObjectMoved(e) {
        const target = e.target;
        console.log('onObjectMoved called, target:', target, 'type:', target?.type);

        // Handle tee box movement (it's a rect, not polygon)
        if (target && target.type === 'rect' && this.teeBox && target === this.teeBox.visual) {
            console.log('Tee box moved, updating stored position');
            // Convert visual position back to meters
            const metersX = target.left / this.scale;
            const metersZ = CANVAS_HEIGHT - (target.top / this.scale);
            this.teeBox.x = metersX;
            this.teeBox.z = metersZ;
            console.log(`Tee box position updated to: x=${metersX.toFixed(2)}m, z=${metersZ.toFixed(2)}m`);
            this.calculateHoleLength();
            return;
        }

        // Handle polygon movement
        if (!target || target.type !== 'polygon') {
            this.updateVertexMarkers();
            return;
        }

        const polygon = target;

        const SNAP_DISTANCE = 2.5 * this.scale;
        let snapped = false;
        console.log('Checking snapping, SNAP_DISTANCE:', SNAP_DISTANCE, 'vertices:', polygon.points.length);

        // Check each vertex for snapping
        polygon.points.forEach((point, index) => {
            // Convert to absolute canvas coordinates
            const absPoint = fabric.util.transformPoint(
                { x: point.x - polygon.pathOffset.x, y: point.y - polygon.pathOffset.y },
                polygon.calcTransformMatrix()
            );

            // Check snap to edges
            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            let snapX = absPoint.x;
            let snapY = absPoint.y;

            console.log(`Vertex ${index} at (${absPoint.x}, ${absPoint.y}), canvas: ${canvasWidth}x${canvasHeight}`);

            if (Math.abs(snapX) < SNAP_DISTANCE) {
                console.log('  Snapping to left edge');
                snapX = 0;
            }
            if (Math.abs(snapX - canvasWidth) < SNAP_DISTANCE) {
                console.log('  Snapping to right edge');
                snapX = canvasWidth;
            }
            if (Math.abs(snapY) < SNAP_DISTANCE) {
                console.log('  Snapping to top edge');
                snapY = 0;
            }
            if (Math.abs(snapY - canvasHeight) < SNAP_DISTANCE) {
                console.log('  Snapping to bottom edge');
                snapY = canvasHeight;
            }

            // Check snap to other vertices
            let minDistance = SNAP_DISTANCE;
            let snapVertex = null;

            this.shapes.forEach(shape => {
                if (shape.polygon && shape.polygon !== polygon && shape.polygon.points) {
                    shape.polygon.points.forEach(otherPoint => {
                        const absOtherPoint = fabric.util.transformPoint(
                            { x: otherPoint.x - shape.polygon.pathOffset.x, y: otherPoint.y - shape.polygon.pathOffset.y },
                            shape.polygon.calcTransformMatrix()
                        );

                        const dx = absOtherPoint.x - snapX;
                        const dy = absOtherPoint.y - snapY;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        if (distance < minDistance) {
                            minDistance = distance;
                            snapVertex = absOtherPoint;
                        }
                    });
                }
            });

            // Apply snap if found
            if (snapVertex && minDistance < SNAP_DISTANCE) {
                console.log(`  Snapping to vertex at (${snapVertex.x}, ${snapVertex.y}), distance: ${minDistance}`);
                snapX = snapVertex.x;
                snapY = snapVertex.y;
                snapped = true;
            } else if (snapX !== absPoint.x || snapY !== absPoint.y) {
                console.log(`  Edge snap applied`);
                snapped = true;
            }

            // Convert back to local coordinates if snapped
            if (snapped) {
                const invertedTransform = fabric.util.invertTransform(polygon.calcTransformMatrix());
                const localSnapPoint = fabric.util.transformPoint({ x: snapX, y: snapY }, invertedTransform);
                polygon.points[index] = {
                    x: localSnapPoint.x + polygon.pathOffset.x,
                    y: localSnapPoint.y + polygon.pathOffset.y
                };
            }
        });

        if (snapped) {
            console.log('Snapping applied, updating polygon');
            polygon._calcDimensions();
            polygon.setCoords();
            polygon.dirty = true;
            this.canvas.requestRenderAll();
        } else {
            console.log('No snapping occurred');
        }

        this.updateVertexMarkers();
    },

    onMouseDown(e) {
        // Handle tee box placement mode
        if (this.teeBoxPlacementMode) {
            const pointer = this.canvas.getPointer(e.e);
            this.placeTeeBox(pointer.x, pointer.y);
            return;
        }

        // Handle flag placement mode
        if (this.flagPlacementMode) {
            const pointer = this.canvas.getPointer(e.e);
            this.placeFlag(pointer.x, pointer.y);
            return;
        }

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

        // Constrain to canvas bounds, snap to edges, and snap to vertices
        const snappedPoint = this.snapToVertices(pointer.x, pointer.y);
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

        // Reset cursor to default
        this.canvas.defaultCursor = 'default';
        this.canvas.hoverCursor = 'move';

        // Update layers list and recalculate hole length
        this.updateLayersList();
        this.calculateHoleLength();
        this.updateVertexMarkers();

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
        this.currentSurface = null;

        // Deselect surface buttons
        document.querySelectorAll('.surface-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Reset cursor to default
        this.canvas.defaultCursor = 'default';
        this.canvas.hoverCursor = 'move';

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

                    // Convert to absolute canvas coordinates for snapping
                    const absPoint = fabric.util.transformPoint(
                        { x: finalPointPosition.x - polygon.pathOffset.x, y: finalPointPosition.y - polygon.pathOffset.y },
                        polygon.calcTransformMatrix()
                    );

                    // Apply snap to edges and boundary constraints in absolute coordinates
                    const snappedAbs = self.snapToEdges(absPoint.x, absPoint.y);

                    // Convert back to local polygon coordinates
                    const invertedTransform = fabric.util.invertTransform(polygon.calcTransformMatrix());
                    const snappedLocal = fabric.util.transformPoint(snappedAbs, invertedTransform);
                    polygon.points[index] = {
                        x: snappedLocal.x + polygon.pathOffset.x,
                        y: snappedLocal.y + polygon.pathOffset.y
                    };

                    return true;
                },
                mouseUpHandler: (eventData, transform) => {
                    const polygon = transform.target;

                    // Snap to nearby vertices after drag completes
                    // We need to compare in absolute canvas coordinates, not local polygon coordinates
                    const SNAP_DISTANCE = 2.5 * self.scale;
                    const point = polygon.points[index];

                    // Convert current point to absolute canvas coordinates
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - polygon.pathOffset.x, y: point.y - polygon.pathOffset.y },
                        polygon.calcTransformMatrix()
                    );

                    let minDistance = SNAP_DISTANCE;
                    let snapToAbsPoint = null;

                    self.shapes.forEach(shape => {
                        if (shape.polygon && shape.polygon !== polygon && shape.polygon.points) {
                            shape.polygon.points.forEach(otherPoint => {
                                // Convert other point to absolute canvas coordinates
                                const absOtherPoint = fabric.util.transformPoint(
                                    { x: otherPoint.x - shape.polygon.pathOffset.x, y: otherPoint.y - shape.polygon.pathOffset.y },
                                    shape.polygon.calcTransformMatrix()
                                );

                                const dx = absOtherPoint.x - absPoint.x;
                                const dy = absOtherPoint.y - absPoint.y;
                                const distance = Math.sqrt(dx * dx + dy * dy);

                                if (distance < minDistance) {
                                    minDistance = distance;
                                    snapToAbsPoint = absOtherPoint; // Store the absolute point
                                }
                            });
                        }
                    });

                    // Apply snap if found nearby vertex
                    // Convert absolute snap point back to current polygon's local coordinates
                    if (snapToAbsPoint && minDistance < SNAP_DISTANCE) {
                        const invertedTransform = fabric.util.invertTransform(polygon.calcTransformMatrix());
                        const localSnapPoint = fabric.util.transformPoint(snapToAbsPoint, invertedTransform);
                        polygon.points[index] = {
                            x: localSnapPoint.x + polygon.pathOffset.x,
                            y: localSnapPoint.y + polygon.pathOffset.y
                        };
                    }

                    // Remove duplicate points (same coordinates)
                    const EPSILON = 0.001; // Small tolerance for floating point comparison
                    const uniquePoints = [];
                    polygon.points.forEach((point, i) => {
                        const isDuplicate = uniquePoints.some(uniquePoint =>
                            Math.abs(uniquePoint.x - point.x) < EPSILON &&
                            Math.abs(uniquePoint.y - point.y) < EPSILON
                        );
                        if (!isDuplicate) {
                            uniquePoints.push(point);
                        }
                    });

                    // Only update if we removed duplicates and still have at least 3 points
                    if (uniquePoints.length !== polygon.points.length && uniquePoints.length >= 3) {
                        polygon.points = uniquePoints;

                        // Update stored points in shapes array
                        const shapeData = self.shapes.find(s => s.polygon === polygon);
                        if (shapeData) {
                            shapeData.points = JSON.parse(JSON.stringify(uniquePoints));
                        }

                        // Regenerate controls with new point count
                        self.enablePolygonEditing(polygon);
                    }

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

                    // Update vertex markers if visible
                    self.updateVertexMarkers();

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
        this.updateVertexMarkers();
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

    toggleTeeBoxPlacement() {
        // Cancel any active drawing
        if (this.isDrawing && !this.teeBoxPlacementMode) {
            this.cancelDrawing();
        }

        // Turn off object placement mode if active
        if (this.objectPlacementMode) {
            this.toggleObjectPlacementMode();
        }

        this.teeBoxPlacementMode = !this.teeBoxPlacementMode;
        const btn = document.getElementById('teeBoxModeText');

        if (this.teeBoxPlacementMode) {
            btn.textContent = 'Cancel';
            btn.parentElement.style.background = '#e74c3c';
            this.canvas.defaultCursor = 'crosshair';
        } else {
            btn.textContent = 'Place Tee Box';
            btn.parentElement.style.background = '';
            this.canvas.defaultCursor = 'default';
        }
    },

    placeTeeBox(x, y) {
        // Remove existing tee box if any
        if (this.teeBox && this.teeBox.visual) {
            this.canvas.remove(this.teeBox.visual);
        }

        // Convert from scaled pixels to meters (flip y-axis)
        const metersX = x / this.scale;
        const metersZ = CANVAS_HEIGHT - (y / this.scale);

        // Create 10m x 10m tee box (rectangle)
        const teeBoxSize = 10;
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: teeBoxSize * this.scale,
            height: teeBoxSize * this.scale,
            fill: SURFACE_COLORS.tee,
            stroke: '#bdc3c7',
            strokeWidth: 2,
            opacity: 0.8,
            originX: 'center',
            originY: 'center',
            selectable: true,
            hasControls: true,
            hasBorders: true,
            borderColor: '#3498db',
            lockRotation: true
        });

        this.teeBox = {
            x: metersX,
            z: metersZ,
            width: teeBoxSize,
            height: teeBoxSize,
            visual: rect
        };

        this.canvas.add(rect);

        // Turn off placement mode after placing
        this.teeBoxPlacementMode = false;
        document.getElementById('teeBoxModeText').textContent = 'Place Tee Box';
        document.getElementById('teeBoxModeText').parentElement.style.background = '';
        this.canvas.defaultCursor = 'default';

        this.calculateHoleLength();
    },

    toggleFlagPlacement() {
        // Cancel any active drawing
        if (this.isDrawing && !this.flagPlacementMode) {
            this.cancelDrawing();
        }

        // Turn off other placement modes
        if (this.teeBoxPlacementMode) {
            this.toggleTeeBoxPlacement();
        }
        if (this.objectPlacementMode) {
            this.toggleObjectPlacementMode();
        }

        this.flagPlacementMode = !this.flagPlacementMode;
        const btn = document.getElementById('flagModeText');

        if (this.flagPlacementMode) {
            btn.textContent = 'Cancel';
            btn.parentElement.style.background = '#e74c3c';
            this.canvas.defaultCursor = 'crosshair';
        } else {
            btn.textContent = 'Place Flag Position';
            btn.parentElement.style.background = '';
            this.canvas.defaultCursor = 'default';
        }
    },

    placeFlag(x, y) {
        // Check max limit
        if (this.flagPositions.length >= 4) {
            alert('Maximum 4 flag positions allowed');
            this.flagPlacementMode = false;
            document.getElementById('flagModeText').textContent = 'Place Flag Position';
            document.getElementById('flagModeText').parentElement.style.background = '';
            this.canvas.defaultCursor = 'default';
            return;
        }

        // Convert from scaled pixels to meters (flip y-axis)
        const metersX = x / this.scale;
        const metersZ = CANVAS_HEIGHT - (y / this.scale);

        // Create flag marker (small red circle with number)
        const flagNumber = this.flagPositions.length + 1;

        const circle = new fabric.Circle({
            left: x,
            top: y,
            radius: 4,
            fill: '#e74c3c',
            stroke: '#c0392b',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: true,
            hasControls: false,
            hasBorders: true,
            borderColor: '#3498db'
        });

        const text = new fabric.Text(flagNumber.toString(), {
            left: x,
            top: y,
            fontSize: 10,
            fill: '#fff',
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false
        });

        const group = new fabric.Group([circle, text], {
            left: x,
            top: y,
            selectable: true,
            hasControls: false,
            hasBorders: true
        });

        this.flagPositions.push({
            number: flagNumber,
            x: metersX,
            z: metersZ,
            visual: group
        });

        this.canvas.add(group);
        this.updateFlagCount();

        // Exit flag placement mode after placing
        this.flagPlacementMode = false;
        document.getElementById('flagModeText').textContent = 'Place Flag Position';
        document.getElementById('flagModeText').parentElement.style.background = '';
        this.canvas.defaultCursor = 'default';
    },

    updateFlagCount() {
        document.getElementById('flagCount').textContent = `Flags placed: ${this.flagPositions.length}/4`;
    },

    toggleObjectPlacementMode() {
        // Cancel any active drawing when entering object placement mode
        if (this.isDrawing && !this.objectPlacementMode) {
            this.cancelDrawing();
        }

        // Turn off tee box placement mode if active
        if (this.teeBoxPlacementMode) {
            this.toggleTeeBoxPlacement();
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

        // Convert from scaled pixels to meters (flip y-axis)
        const metersX = x / this.scale;
        const metersZ = CANVAS_HEIGHT - (y / this.scale);

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

        // Add shapes
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

        // Add tee box
        if (this.teeBox && this.teeBox.visual) {
            const item = document.createElement('div');
            item.className = 'layer-item';
            if (this.canvas.getActiveObject() === this.teeBox.visual) {
                item.classList.add('active');
            }

            item.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="layer-color" style="background: ${SURFACE_COLORS.tee}"></div>
                    <span>TEE BOX</span>
                </div>
                <span style="font-size: 11px;">10×10m</span>
            `;

            item.onclick = () => {
                this.canvas.setActiveObject(this.teeBox.visual);
                this.canvas.renderAll();
            };

            list.appendChild(item);
        }

        // Add objects (trees/bushes)
        this.objects.forEach((obj, index) => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            if (this.canvas.getActiveObject() === obj.visual) {
                item.classList.add('active');
            }

            const icon = obj.type === 'tree' ? '🌳' : '🌿';
            const color = obj.type === 'tree' ? '#2d5016' : '#3a6b1f';

            item.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="layer-color" style="background: ${color}"></div>
                    <span>${icon} ${obj.type.toUpperCase()} (${obj.size})</span>
                </div>
                <span style="font-size: 11px;">${obj.x.toFixed(1)}, ${obj.z.toFixed(1)}</span>
            `;

            item.onclick = () => {
                this.canvas.setActiveObject(obj.visual);
                this.canvas.renderAll();
            };

            list.appendChild(item);
        });

        // Add flags
        this.flagPositions.forEach((flag, index) => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            if (this.canvas.getActiveObject() === flag.visual) {
                item.classList.add('active');
            }

            item.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="layer-color" style="background: #e74c3c"></div>
                    <span>🚩 FLAG #${flag.number}</span>
                </div>
                <span style="font-size: 11px;">${flag.x.toFixed(1)}, ${flag.z.toFixed(1)}</span>
            `;

            item.onclick = () => {
                this.canvas.setActiveObject(flag.visual);
                this.canvas.renderAll();
            };

            list.appendChild(item);
        });

        // Auto-calculate hole length
        this.calculateHoleLength();
    },

    calculateHoleLength() {
        const green = this.shapes.find(s => s.type === 'green');

        if (!this.teeBox || !green) {
            document.getElementById('holeLength').value = '-';
            return;
        }

        // Tee center is already stored in meters (with flipped z-axis) in this.teeBox
        const teeCenterX = this.teeBox.x;
        const teeCenterZ = this.teeBox.z;

        // Calculate green center (flag position)
        // Green points are in canvas coordinates, need to flip y-axis when converting to meters
        const greenPoints = green.polygon.points;
        const greenMinX = Math.min(...greenPoints.map(p => p.x)) / this.scale;
        const greenMaxX = Math.max(...greenPoints.map(p => p.x)) / this.scale;
        const greenMinY = Math.min(...greenPoints.map(p => p.y)) / this.scale;
        const greenMaxY = Math.max(...greenPoints.map(p => p.y)) / this.scale;
        const greenCenterX = (greenMinX + greenMaxX) / 2;
        const greenCenterY_canvas = (greenMinY + greenMaxY) / 2;
        const greenCenterZ = CANVAS_HEIGHT - greenCenterY_canvas; // Flip y-axis to get z in meters

        // Calculate distance in meters
        const dx = greenCenterX - teeCenterX;
        const dz = greenCenterZ - teeCenterZ;
        const distance = Math.sqrt(dx * dx + dz * dz);

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

        // Remove from flagPositions array if it's a flag
        this.flagPositions = this.flagPositions.filter(flag => flag.visual !== active);
        this.updateFlagCount();

        this.updateLayersList();
        this.calculateHoleLength();
        this.updateVertexMarkers(); // Update vertex markers after deletion
        this.canvas.renderAll();
    },

    clearCanvas() {
        if (!confirm('Clear all shapes?')) return;

        this.shapes = [];
        this.objects = [];
        this.flagPositions = [];
        this.teeBox = null;
        this.isDrawing = false;
        this.currentPoints = [];

        // Clear the current hole ID so next save creates a new hole
        courseManager.currentHoleId = null;
        console.log('Cleared canvas and reset hole ID');

        this.redrawAll();
        this.updateLayersList(); // Updates calculated length
        this.updateFlagCount();
    },

    convertPointsToMeters(points, polygon = null) {
        // If polygon provided, convert points to absolute canvas coordinates first
        // (this accounts for any transforms like left/top/angle/scale when polygon is moved)
        let absolutePoints = points;
        if (polygon) {
            const transform = polygon.calcTransformMatrix();
            absolutePoints = points.map(p => {
                const localPoint = {
                    x: p.x - polygon.pathOffset.x,
                    y: p.y - polygon.pathOffset.y
                };
                return fabric.util.transformPoint(localPoint, transform);
            });
        }

        // Convert canvas coordinates to meters (round to 2 decimals)
        // Flip y-axis: canvas y=0 (top) should be z=CANVAS_HEIGHT (far), canvas y=CANVAS_HEIGHT (bottom) should be z=0 (tee)
        return absolutePoints.map(p => ({
            x: parseFloat((p.x / this.scale).toFixed(2)),
            z: parseFloat((CANVAS_HEIGHT - (p.y / this.scale)).toFixed(2))
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
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT,
            background: {
                vertices: [
                    { x: -30, z: -30 },
                    { x: CANVAS_WIDTH + 30, z: -30 },
                    { x: CANVAS_WIDTH + 30, z: CANVAS_HEIGHT + 30 },
                    { x: -30, z: CANVAS_HEIGHT + 30 }
                ],
                surface: "OUT_OF_BOUNDS"
            }
        };

        // Group shapes by type
        const fairways = this.shapes.filter(s => s.type === 'fairway');
        const green = this.shapes.find(s => s.type === 'green');
        const roughLight = this.shapes.filter(s => s.type === 'rough_light');
        const roughMedium = this.shapes.filter(s => s.type === 'rough_medium');
        const roughHeavy = this.shapes.filter(s => s.type === 'rough_heavy');
        const bunkers = this.shapes.filter(s => s.type === 'bunker');
        const water = this.shapes.filter(s => s.type === 'water');

        // Add tee box (new placement-based system)
        if (this.teeBox) {
            layout.tee = {
                center: {
                    x: parseFloat(this.teeBox.x.toFixed(2)),
                    z: parseFloat(this.teeBox.z.toFixed(2))
                },
                width: parseFloat(this.teeBox.width.toFixed(2)),
                depth: parseFloat(this.teeBox.height.toFixed(2)),
                surface: "TEE"
            };
        }

        // Add fairways (support multiple)
        if (fairways.length > 0) {
            layout.fairways = fairways.map(fairway => ({
                controlPoints: this.convertPointsToMeters(fairway.polygon.points, fairway.polygon),
                surface: "FAIRWAY"
            }));
        }

        // Add green
        if (green) {
            const metersPoints = this.convertPointsToMeters(green.polygon.points, green.polygon);
            layout.green = {
                controlPoints: metersPoints,
                surface: "GREEN"
            };
        }

        // Add light rough
        if (roughLight.length > 0) {
            layout.lightRough = roughLight.map(rough => ({
                vertices: this.convertPointsToMeters(rough.polygon.points, rough.polygon),
                surface: "LIGHT_ROUGH"
            }));
        }

        // Add medium rough
        if (roughMedium.length > 0) {
            layout.mediumRough = roughMedium.map(rough => ({
                vertices: this.convertPointsToMeters(rough.polygon.points, rough.polygon),
                surface: "MEDIUM_ROUGH"
            }));
        }

        // Add heavy/thick rough
        if (roughHeavy.length > 0) {
            layout.thickRough = roughHeavy.map(rough => ({
                vertices: this.convertPointsToMeters(rough.polygon.points, rough.polygon),
                surface: "THICK_ROUGH"
            }));
        }

        // Add bunkers
        if (bunkers.length > 0) {
            layout.bunkers = bunkers.map(bunker => ({
                controlPoints: this.convertPointsToMeters(bunker.polygon.points, bunker.polygon),
                surface: "BUNKER"
            }));
        }

        // Add water
        if (water.length > 0) {
            layout.waterHazards = water.map(w => ({
                surface: "WATER",
                controlPoints: this.convertPointsToMeters(w.polygon.points, w.polygon)
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

        // Add flag positions
        if (this.flagPositions.length > 0) {
            layout.flagPositions = this.flagPositions.map(flag => ({
                number: flag.number,
                x: parseFloat(flag.x.toFixed(2)),
                z: parseFloat(flag.z.toFixed(2))
            }));
        }

        const json = JSON.stringify(layout, null, 2);
        document.getElementById('jsonOutput').value = json;

        console.log('Exported hole layout:', layout);
    },

    previewHole() {
        // Validate that hole has required elements
        if (!this.teeBox) {
            alert('Cannot preview: Hole must have a tee box. Please place a tee box first.');
            return;
        }

        const green = this.shapes.find(s => s.type === 'green');
        if (!green) {
            alert('Cannot preview: Hole must have a green. Please create a green first.');
            return;
        }

        if (this.flagPositions.length === 0) {
            alert('Cannot preview: Hole must have at least one flag position. Please place a flag on the green.');
            return;
        }

        // Export the current hole layout
        this.exportJSON();

        // Get the exported JSON
        const jsonText = document.getElementById('jsonOutput').value;

        // Store in localStorage for the game to pick up
        localStorage.setItem('previewHoleData', jsonText);

        // Open the game in a new tab so user can return to hole maker
        window.open('index.html', '_blank');
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
            if (layout.par) {
                document.getElementById('holePar').value = layout.par;
                this.onParChange(); // Update par-based dimensions
            }

            // Restore canvas dimensions if available
            if (layout.canvasWidth && layout.canvasHeight) {
                document.getElementById('canvasWidth').value = layout.canvasWidth;
                document.getElementById('canvasHeight').value = layout.canvasHeight;
                this.onCanvasSizeChange(); // Update canvas size
            }

            if (layout.lengthMeters) document.getElementById('holeLength').value = layout.lengthMeters;

            // Helper to convert meters (from JSON) to canvas coordinates
            // Flip y-axis: z=0 (tee) should be canvas y=CANVAS_HEIGHT (bottom), z=CANVAS_HEIGHT (far) should be canvas y=0 (top)
            const metersToCanvas = (point) => ({
                x: point.x * this.scale,
                y: (CANVAS_HEIGHT - point.z) * this.scale
            });

            // Import tee box (new placement-based system)
            if (layout.tee && layout.tee.center) {
                const canvasPos = metersToCanvas(layout.tee.center);
                this.placeTeeBox(canvasPos.x, canvasPos.y);
            }

            // Import fairways (support multiple)
            if (layout.fairways && Array.isArray(layout.fairways)) {
                layout.fairways.forEach(fairway => {
                    this.currentPoints = fairway.controlPoints.map(metersToCanvas);
                    this.currentSurface = 'fairway';
                    this.closePolygon();
                });
            } else if (layout.fairway && layout.fairway.controlPoints) {
                // Legacy single fairway support
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

            // Import light rough
            if (layout.lightRough) {
                layout.lightRough.forEach(rough => {
                    if (rough.vertices) {
                        this.currentPoints = rough.vertices.map(metersToCanvas);
                        this.currentSurface = 'rough_light';
                        this.closePolygon();
                    }
                });
            }

            // Import medium rough
            if (layout.mediumRough) {
                layout.mediumRough.forEach(rough => {
                    if (rough.vertices) {
                        this.currentPoints = rough.vertices.map(metersToCanvas);
                        this.currentSurface = 'rough_medium';
                        this.closePolygon();
                    }
                });
            }

            // Import thick rough (legacy 'rough' key for backwards compatibility)
            if (layout.thickRough) {
                layout.thickRough.forEach(rough => {
                    if (rough.vertices) {
                        this.currentPoints = rough.vertices.map(metersToCanvas);
                        this.currentSurface = 'rough_heavy';
                        this.closePolygon();
                    }
                });
            } else if (layout.rough && layout.rough.vertices) {
                // Legacy support for old 'rough' format
                this.currentPoints = layout.rough.vertices.map(metersToCanvas);
                this.currentSurface = 'rough_heavy';
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

            // Import objects (trees/bushes)
            if (layout.obstacles) {
                layout.obstacles.forEach(obj => {
                    const x = obj.x * this.scale;
                    const z = (CANVAS_HEIGHT - obj.z) * this.scale;

                    const color = obj.type === 'tree' ? '#2d5016' : '#3a6b1f';
                    const radius = obj.size === 'small' ? 3 : obj.size === 'medium' ? 5 : 7;

                    const circle = new fabric.Circle({
                        left: x,
                        top: z,
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

                    this.objects.push({
                        type: obj.type,
                        size: obj.size,
                        x: obj.x,
                        z: obj.z,
                        visual: circle
                    });

                    this.canvas.add(circle);
                });
            }

            // Import flag positions
            if (layout.flagPositions) {
                layout.flagPositions.forEach(flag => {
                    const x = flag.x * this.scale;
                    const z = (CANVAS_HEIGHT - flag.z) * this.scale;

                    const circle = new fabric.Circle({
                        left: x,
                        top: z,
                        radius: 4,
                        fill: '#e74c3c',
                        stroke: '#c0392b',
                        strokeWidth: 2,
                        originX: 'center',
                        originY: 'center',
                        selectable: true,
                        hasControls: false,
                        hasBorders: true,
                        borderColor: '#3498db'
                    });

                    const text = new fabric.Text(flag.number.toString(), {
                        left: x,
                        top: z,
                        fontSize: 10,
                        fill: '#fff',
                        originX: 'center',
                        originY: 'center',
                        selectable: false,
                        evented: false
                    });

                    const group = new fabric.Group([circle, text], {
                        left: x,
                        top: z,
                        selectable: true,
                        hasControls: false,
                        hasBorders: true
                    });

                    this.flagPositions.push({
                        number: flag.number,
                        x: flag.x,
                        z: flag.z,
                        visual: group
                    });

                    this.canvas.add(group);
                });

                this.updateFlagCount();
            }

            // Bring tee box to front so it's selectable above all surfaces
            if (this.teeBox && this.teeBox.visual) {
                this.canvas.bringToFront(this.teeBox.visual);
            }

            // Update layers list to show all imported objects
            this.updateLayersList();
            this.calculateHoleLength();

            console.log('Imported hole layout');
        } catch (e) {
            alert('Invalid JSON: ' + e.message);
        }
    },

    // Cloud Save/Load Functions (using courseManager module)
    async updateAuthStatus() {
        const statusDiv = document.getElementById('authStatus');

        if (courseManager.isAuthenticated()) {
            statusDiv.textContent = `Signed in as: ${courseManager.getUsername()}`;
            statusDiv.style.color = '#2ecc71';
        } else {
            statusDiv.textContent = 'Not signed in';
            statusDiv.style.color = '#95a5a6';
        }
    },

    async saveHoleToCloud() {
        if (!courseManager.isAuthenticated()) {
            alert('Please sign in first to save holes to the cloud.');
            return;
        }

        if (!this.teeBox) {
            alert('Cannot save: Hole must have a tee box');
            return;
        }

        const green = this.shapes.find(s => s.type === 'green');
        if (!green) {
            alert('Cannot save: Hole must have a green');
            return;
        }

        // Generate hole data
        this.exportJSON();
        const jsonText = document.getElementById('jsonOutput').value;
        const holeData = JSON.parse(jsonText);

        try {
            const isUpdate = !!courseManager.currentHoleId;
            const result = await courseManager.saveHole(holeData);
            const action = isUpdate ? 'updated' : 'saved';
            alert(`✅ Hole "${holeData.name}" ${action} successfully!`);
        } catch (error) {
            console.error('Error saving hole:', error);
            alert(`❌ Error saving hole: ${error.message}`);
        }
    },

    async showLoadHolesDialog() {
        if (!courseManager.isAuthenticated()) {
            alert('Please sign in first to load holes from the cloud.');
            return;
        }

        const dialog = document.getElementById('loadHolesDialog');
        const listDiv = document.getElementById('savedHolesList');

        listDiv.innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';
        dialog.style.display = 'block';

        try {
            const holes = await courseManager.listHoles();

            if (holes.length === 0) {
                listDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #95a5a6;">No saved holes yet</div>';
                return;
            }

            listDiv.innerHTML = holes.map(hole => `
                <div style="background: #34495e; padding: 12px; margin-bottom: 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; margin-bottom: 4px;">${hole.name}</div>
                        <div style="font-size: 11px; color: #95a5a6;">Par ${hole.par} • ${hole.lengthMeters}m</div>
                        <div style="font-size: 10px; color: #7f8c8d;">Updated: ${new Date(hole.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button onclick="holeMaker.loadHoleFromCloud('${hole.holeId}')" style="background: #3498db; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Load</button>
                        <button onclick="holeMaker.deleteHoleFromCloud('${hole.holeId}')" style="background: #e74c3c; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button>
                    </div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Error loading holes:', error);
            listDiv.innerHTML = `<div style="text-align: center; padding: 20px; color: #e74c3c;">Error: ${error.message}</div>`;
        }
    },

    hideLoadHolesDialog() {
        document.getElementById('loadHolesDialog').style.display = 'none';
    },

    async loadHoleFromCloud(holeId) {
        try {
            const hole = await courseManager.loadHole(holeId);

            // Load the hole data into the editor
            document.getElementById('jsonOutput').value = JSON.stringify(hole.holeData, null, 2);
            this.importJSON();
            this.hideLoadHolesDialog();

            // Store the holeId so we can update instead of creating new when saving
            console.log(`Loaded hole with ID: ${holeId}`);

            alert(`✅ Loaded "${hole.holeData.name}"`);

        } catch (error) {
            console.error('Error loading hole:', error);
            alert(`❌ Error loading hole: ${error.message}`);
        }
    },

    async deleteHoleFromCloud(holeId) {
        if (!confirm('Are you sure you want to delete this hole? This cannot be undone.')) {
            return;
        }

        try {
            await courseManager.deleteHole(holeId);
            alert('✅ Hole deleted successfully');
            this.showLoadHolesDialog(); // Refresh the list
        } catch (error) {
            console.error('Error deleting hole:', error);
            alert(`❌ Error deleting hole: ${error.message}`);
        }
    }
};

// Make holeMaker accessible globally for inline event handlers
window.holeMaker = holeMaker;

// Initialize when page loads
window.addEventListener('load', () => {
    holeMaker.init();
    holeMaker.updateAuthStatus();
});
