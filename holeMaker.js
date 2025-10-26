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
    highlightMarkers: [], // Store highlight markers for area-selected vertices
    selectedPointIndicator: null, // Blue ring indicator for point selected from list
    currentAreaPoints: null, // Store area-selected points for refresh
    currentVertexHeight: 0, // Current height for next vertex (meters)
    selectedVertex: null, // Currently selected vertex for editing {polygon, pointIndex}
    selectedTeeBox: false, // Flag for when tee box is selected for height editing
    areaSelectionMode: false, // Ctrl+drag to select area
    areaSelectionStart: null, // Starting point of area selection
    areaSelectionRect: null, // Visual rectangle for area selection

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
        // Intercept at native DOM level to catch Ctrl/Cmd before Fabric.js does
        this.canvas.upperCanvasEl.addEventListener('mousedown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (!this.teeBoxPlacementMode && !this.flagPlacementMode && !this.objectPlacementMode && !this.isDrawing) {
                    // Block Fabric.js completely
                    e.stopImmediatePropagation();
                    e.preventDefault();

                    // Start area selection
                    this.startAreaSelection(e);
                    return false;
                }
            }
        }, true); // Use capture phase to intercept before Fabric

        this.canvas.on('mouse:down', (e) => this.onMouseDown(e));
        this.canvas.on('mouse:move', (e) => this.onMouseMove(e));
        this.canvas.on('mouse:up', (e) => this.onMouseUp(e));
        this.canvas.on('mouse:dblclick', (e) => this.onDoubleClick(e));
        this.canvas.on('selection:created', (e) => this.onSelectionChange(e));
        this.canvas.on('selection:updated', (e) => this.onSelectionChange(e));
        this.canvas.on('mouse:down', (e) => {
            // Check if a vertex marker was clicked (prioritize over shape selection)
            if (e.target && e.target.parentPolygon) {
                // This is a vertex marker - handle it
                this.selectVertex(e.target.parentPolygon, e.target.pointIndex);
                this.activePolygon = e.target.parentPolygon;
                this.canvas.setActiveObject(e.target.parentPolygon);
                e.e?.stopPropagation();
                e.e?.preventDefault();
                return false;
            }

            // Check if tee box was clicked
            if (e.target && e.target === this.teeBox?.visual) {
                this.selectTeeBox();
            }
        });
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

    onHeightChange(value) {
        this.currentVertexHeight = parseFloat(value);
        document.getElementById('heightValue').textContent = `${value}m`;
    },

    selectVertex(polygon, pointIndex) {
        this.selectedVertex = { polygon, pointIndex };
        this.selectedTeeBox = false; // Clear tee box selection

        // Get current height of selected vertex
        const point = polygon.points[pointIndex];
        const currentHeight = point.height !== undefined ? point.height : 0;

        // Update UI
        document.getElementById('heightSlider').value = currentHeight;
        document.getElementById('heightValue').textContent = `${currentHeight.toFixed(1)}m`;
        document.getElementById('heightHelpText').textContent = `Editing vertex height (currently ${currentHeight.toFixed(1)}m)`;
        document.getElementById('updateHeightBtn').textContent = 'Update Selected Vertex Height';
        document.getElementById('updateHeightBtn').style.display = 'block';

        // Show nearby points
        this.showNearbyPoints(polygon, pointIndex);

        console.log(`Selected vertex ${pointIndex} with height ${currentHeight}m`);
    },

    selectVertexWithoutChangingList(polygon, pointIndex) {
        this.selectedVertex = { polygon, pointIndex };
        this.selectedTeeBox = false; // Clear tee box selection

        // Get current height of selected vertex
        const point = polygon.points[pointIndex];
        const currentHeight = point.height !== undefined ? point.height : 0;

        // Update UI (but don't change the points list)
        document.getElementById('heightSlider').value = currentHeight;
        document.getElementById('heightValue').textContent = `${currentHeight.toFixed(1)}m`;
        document.getElementById('heightHelpText').textContent = `Editing vertex height (currently ${currentHeight.toFixed(1)}m)`;
        document.getElementById('updateHeightBtn').textContent = 'Update Selected Vertex Height';
        document.getElementById('updateHeightBtn').style.display = 'block';

        // Add a visual indicator on the canvas for the selected point
        this.addSelectedPointIndicator(polygon, pointIndex);

        // Update the "SELECTED" label in the list
        this.updateSelectedLabelInList(polygon, pointIndex);

        console.log(`Selected vertex ${pointIndex} from list with height ${currentHeight}m`);
    },

    updateSelectedLabelInList(selectedPolygon, selectedPointIndex) {
        // Find the currently selected vertex in the shapes array
        let selectedShapeIndex = -1;
        this.shapes.forEach((shape, idx) => {
            if (shape.polygon === selectedPolygon) {
                selectedShapeIndex = idx;
            }
        });

        // Update all point divs in the list
        const list = document.getElementById('pointDetailsList');
        const pointDivs = list.children;

        // First pass: Remove ALL existing "SELECTED" labels and reset styles
        Array.from(pointDivs).forEach((div) => {
            const labelArea = div.querySelector('div[style*="justify-content: space-between"]');
            if (labelArea) {
                // Remove all spans that contain "SELECTED"
                const spans = labelArea.querySelectorAll('span');
                spans.forEach(span => {
                    if (span.textContent.includes('SELECTED')) {
                        span.remove();
                    }
                });
            }
            // Reset background and border
            div.style.background = '#1a252f';
            div.style.border = '1px solid #34495e';
        });

        // Second pass: Add "SELECTED" label to the correct point
        Array.from(pointDivs).forEach((div) => {
            const deleteBtn = div.querySelector('button[onclick*="deletePoint"]');
            if (deleteBtn) {
                const onclickAttr = deleteBtn.getAttribute('onclick');
                const match = onclickAttr.match(/deletePoint\((\d+),\s*(\d+)\)/);
                if (match) {
                    const shapeIdx = parseInt(match[1]);
                    const pointIdx = parseInt(match[2]);

                    // Check if this is the selected point
                    if (shapeIdx === selectedShapeIndex && pointIdx === selectedPointIndex) {
                        const labelArea = div.querySelector('div[style*="justify-content: space-between"]');
                        if (labelArea) {
                            const selectedLabel = document.createElement('span');
                            selectedLabel.style.color = '#3498db';
                            selectedLabel.textContent = '● SELECTED';
                            labelArea.appendChild(selectedLabel);
                        }

                        // Highlight background and border
                        div.style.background = '#2c3e50';
                        div.style.border = '2px solid #3498db';
                    }
                }
            }
        });
    },

    addSelectedPointIndicator(polygon, pointIndex) {
        // Remove any existing selected point indicator
        if (this.selectedPointIndicator) {
            this.canvas.remove(this.selectedPointIndicator);
        }

        const point = polygon.points[pointIndex];
        const absPoint = fabric.util.transformPoint(
            { x: point.x - polygon.pathOffset.x, y: point.y - polygon.pathOffset.y },
            polygon.calcTransformMatrix()
        );

        // Create a pulsing blue ring around the selected point
        this.selectedPointIndicator = new fabric.Circle({
            left: absPoint.x,
            top: absPoint.y,
            radius: 10,
            fill: 'rgba(52, 152, 219, 0.2)', // Blue with transparency
            stroke: '#3498db', // Bright blue
            strokeWidth: 4,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false
        });

        this.canvas.add(this.selectedPointIndicator);
        this.canvas.bringToFront(this.selectedPointIndicator);
        this.canvas.requestRenderAll();
    },

    selectTeeBox() {
        this.selectedTeeBox = true;
        this.selectedVertex = null; // Clear vertex selection
        this.currentAreaPoints = null; // Clear area selection

        const currentHeight = this.teeBox.y !== undefined ? this.teeBox.y : 0;

        // Update UI
        document.getElementById('heightSlider').value = currentHeight;
        document.getElementById('heightValue').textContent = `${currentHeight.toFixed(1)}m`;
        document.getElementById('heightHelpText').textContent = `Editing tee box height (currently ${currentHeight.toFixed(1)}m)`;
        document.getElementById('updateHeightBtn').textContent = 'Update Tee Box Height';
        document.getElementById('updateHeightBtn').style.display = 'block';

        // Clear highlight markers and point details panel
        if (this.highlightMarkers) {
            this.highlightMarkers.forEach(marker => this.canvas.remove(marker));
            this.highlightMarkers = [];
        }
        if (this.selectedPointIndicator) {
            this.canvas.remove(this.selectedPointIndicator);
            this.selectedPointIndicator = null;
        }
        document.getElementById('pointDetailsPanel').style.display = 'none';

        this.canvas.requestRenderAll();

        console.log(`Selected tee box with height ${currentHeight}m`);
    },

    deselectVertex() {
        this.selectedVertex = null;
        this.selectedTeeBox = false;
        this.currentAreaPoints = null;
        document.getElementById('heightHelpText').textContent = 'Set height for next vertex (-10m to +10m)';
        document.getElementById('updateHeightBtn').textContent = 'Update Selected Vertex Height';
        document.getElementById('updateHeightBtn').style.display = 'none';
        document.getElementById('pointDetailsPanel').style.display = 'none';

        // Clear highlight markers
        if (this.highlightMarkers) {
            this.highlightMarkers.forEach(marker => this.canvas.remove(marker));
            this.highlightMarkers = [];
        }

        // Clear selected point indicator
        if (this.selectedPointIndicator) {
            this.canvas.remove(this.selectedPointIndicator);
            this.selectedPointIndicator = null;
        }

        this.canvas.requestRenderAll();
    },

    showNearbyPoints(selectedPolygon, selectedPointIndex) {
        const panel = document.getElementById('pointDetailsPanel');
        const list = document.getElementById('pointDetailsList');

        panel.style.display = 'block';
        list.innerHTML = '';

        // Update the header and help text to show context
        const header = panel.querySelector('h2');
        if (header) {
            header.textContent = '🔍 Nearby Points';
        }
        const helpDiv = panel.querySelector('div[style*="font-size: 11px"]');
        if (helpDiv) {
            helpDiv.textContent = 'Vertices within 2m of selected point';
        }

        // Get selected point position
        const selectedPoint = selectedPolygon.points[selectedPointIndex];
        const absSelectedPoint = fabric.util.transformPoint(
            { x: selectedPoint.x - selectedPolygon.pathOffset.x, y: selectedPoint.y - selectedPolygon.pathOffset.y },
            selectedPolygon.calcTransformMatrix()
        );

        // Convert to meters for distance calculation
        const selectedX = absSelectedPoint.x / this.scale;
        const selectedZ = CANVAS_HEIGHT - (absSelectedPoint.y / this.scale);

        const SEARCH_RADIUS = 2; // meters
        const nearbyPoints = [];

        // Find all points within 2m
        this.shapes.forEach((shape, shapeIndex) => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach((point, pointIdx) => {
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    const pointX = absPoint.x / this.scale;
                    const pointZ = CANVAS_HEIGHT - (absPoint.y / this.scale);

                    const dx = pointX - selectedX;
                    const dz = pointZ - selectedZ;
                    const distance = Math.sqrt(dx * dx + dz * dz);

                    if (distance <= SEARCH_RADIUS) {
                        nearbyPoints.push({
                            shape,
                            shapeIndex,
                            pointIndex: pointIdx,
                            point,
                            distance,
                            x: pointX,
                            z: pointZ,
                            height: point.height !== undefined ? point.height : 0,
                            isSelected: shape.polygon === selectedPolygon && pointIdx === selectedPointIndex
                        });
                    }
                });
            }
        });

        // Sort by distance
        nearbyPoints.sort((a, b) => a.distance - b.distance);

        // Display points
        nearbyPoints.forEach(item => {
            const pointDiv = document.createElement('div');
            pointDiv.style.cssText = `
                background: ${item.isSelected ? '#2c3e50' : '#1a252f'};
                padding: 8px;
                margin-bottom: 6px;
                border-radius: 4px;
                border: ${item.isSelected ? '2px solid #3498db' : '1px solid #34495e'};
                font-size: 11px;
            `;

            const heightNormalized = (item.height + 10) / 20;
            const hue = heightNormalized * 240;
            const heightColor = `hsl(${hue}, 80%, 50%)`;

            pointDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 10px; height: 10px; background: ${SURFACE_COLORS[item.shape.type]}; border-radius: 50%;"></div>
                        <strong style="color: #ecf0f1;">${item.shape.type.toUpperCase()}</strong>
                    </div>
                    ${item.isSelected ? '<span style="color: #3498db;">● SELECTED</span>' : ''}
                </div>
                <div style="color: #95a5a6; margin-bottom: 4px;">
                    Point #${item.pointIndex + 1} • ${item.distance.toFixed(2)}m away
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color: #ecf0f1;">Height: </span>
                        <span style="color: ${heightColor}; font-weight: bold;">${item.height.toFixed(1)}m</span>
                    </div>
                    <button onclick="holeMaker.deletePoint(${item.shapeIndex}, ${item.pointIndex})"
                            style="background: #e74c3c; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
                        Delete
                    </button>
                </div>
                <div style="color: #7f8c8d; font-size: 10px; margin-top: 4px;">
                    x: ${item.x.toFixed(1)}m, z: ${item.z.toFixed(1)}m
                </div>
            `;

            list.appendChild(pointDiv);
        });

        if (nearbyPoints.length === 0) {
            list.innerHTML = '<div style="color: #95a5a6; font-size: 11px; padding: 10px; text-align: center;">No points found</div>';
        }
    },

    deletePoint(shapeIndex, pointIndex) {
        const shape = this.shapes[shapeIndex];
        if (!shape || !shape.polygon) return;

        // Need at least 3 points for a polygon
        if (shape.polygon.points.length <= 3) {
            alert('Cannot delete point: Polygon must have at least 3 points');
            return;
        }

        // Remove the polygon from canvas temporarily
        this.canvas.remove(shape.polygon);

        // Remove point from polygon
        shape.polygon.points.splice(pointIndex, 1);

        // Update stored points
        if (shape.points) {
            shape.points.splice(pointIndex, 1);
        }

        // Recreate the polygon with the updated points
        const newPolygon = new fabric.Polygon(shape.polygon.points, {
            fill: shape.polygon.fill,
            stroke: shape.polygon.stroke,
            strokeWidth: shape.polygon.strokeWidth,
            opacity: shape.polygon.opacity,
            objectCaching: false,
            transparentCorners: false,
            cornerColor: '#3498db',
            cornerSize: 12,
            hasBorders: false,
            hasControls: true,
            hasRotatingPoint: false,
            lockRotation: true,
            selectable: true,
            evented: true,
            perPixelTargetFind: true
        });

        // Preserve height data on new polygon points
        newPolygon.points.forEach((point, idx) => {
            if (shape.polygon.points[idx] && shape.polygon.points[idx].height !== undefined) {
                point.height = shape.polygon.points[idx].height;
            }
        });

        // Hide default transform controls
        newPolygon.setControlsVisibility({
            mt: false, mb: false, ml: false, mr: false,
            bl: false, br: false, tl: false, tr: false,
            mtr: false
        });

        // Enable polygon editing
        this.enablePolygonEditing(newPolygon);

        // Replace old polygon with new one
        shape.polygon = newPolygon;
        this.canvas.add(newPolygon);

        console.log(`Deleted point #${pointIndex} from ${shape.type.toUpperCase()} #${shapeIndex + 1}`);

        // Refresh UI
        this.canvas.requestRenderAll();
        this.updateVertexMarkers();
        this.deselectVertex();
        this.exportJSON();
    },

    updateSelectedVertexHeight() {
        // Handle tee box height update
        if (this.selectedTeeBox && this.teeBox) {
            const newHeight = this.currentVertexHeight;
            this.teeBox.y = newHeight;
            console.log(`holeMaker: Updated tee box height to ${newHeight}m, teeBox:`, this.teeBox);
            this.exportJSON(); // Make sure JSON is updated
            this.deselectVertex();
            return;
        }

        // Handle vertex height update
        if (!this.selectedVertex) {
            console.warn('No vertex selected');
            return;
        }

        const { polygon, pointIndex } = this.selectedVertex;
        const newHeight = this.currentVertexHeight;

        // Get the XZ position of the selected vertex
        const selectedPoint = polygon.points[pointIndex];
        const targetX = selectedPoint.x;
        const targetY = selectedPoint.y;
        const SNAP_THRESHOLD = 2.5 * this.scale; // Same threshold used for snapping

        // Convert selected point to absolute canvas coordinates
        const absTargetPoint = fabric.util.transformPoint(
            { x: selectedPoint.x - polygon.pathOffset.x, y: selectedPoint.y - polygon.pathOffset.y },
            polygon.calcTransformMatrix()
        );

        let updatedCount = 0;

        // Update ALL vertices at the same position (across all polygons)
        this.shapes.forEach(shape => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach((point, idx) => {
                    // Convert point to absolute canvas coordinates
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    // Check if this point is at the same XZ position (within snap threshold)
                    const dx = absPoint.x - absTargetPoint.x;
                    const dy = absPoint.y - absTargetPoint.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq < SNAP_THRESHOLD * SNAP_THRESHOLD) {
                        // Update height on the polygon point
                        point.height = newHeight;

                        // Update in stored shape data
                        if (shape.points && shape.points[idx]) {
                            shape.points[idx].height = newHeight;
                        }

                        updatedCount++;
                    }
                });
            }
        });

        console.log(`Updated ${updatedCount} vertex/vertices at this position to height ${newHeight}m`);

        // Refresh vertex markers to show new colors/sizes
        this.updateVertexMarkers();

        // Update the highlight markers and list to reflect new height
        if (this.highlightMarkers && this.highlightMarkers.length > 0) {
            // We're in area selection mode - keep the selection and update the list
            this.refreshAreaSelectionList(polygon, pointIndex, newHeight);
        } else {
            // Normal vertex selection mode - deselect after update
            this.deselectVertex();
        }
    },

    refreshAreaSelectionList(selectedPolygon, selectedPointIndex, newHeight) {
        // Find the point in the list and update its displayed height
        const list = document.getElementById('pointDetailsList');
        if (!list) return;

        // Update vertex markers with new colors
        this.updateVertexMarkers();

        // Update highlight markers with new positions (in case terrain height changed)
        this.highlightSelectedVertices(this.currentAreaPoints || []);

        // Update the selected point indicator
        this.addSelectedPointIndicator(selectedPolygon, selectedPointIndex);

        // Update the "SELECTED" label
        this.updateSelectedLabelInList(selectedPolygon, selectedPointIndex);

        // Update the point list display with new heights
        // Re-render the list to show updated height values
        const pointDivs = list.children;
        Array.from(pointDivs).forEach((div) => {
            const deleteBtn = div.querySelector('button[onclick*="deletePoint"]');
            if (deleteBtn) {
                const onclickAttr = deleteBtn.getAttribute('onclick');
                const match = onclickAttr.match(/deletePoint\((\d+),\s*(\d+)\)/);
                if (match) {
                    const shapeIdx = parseInt(match[1]);
                    const pointIdx = parseInt(match[2]);

                    const shape = this.shapes[shapeIdx];
                    if (shape && shape.polygon && shape.polygon.points[pointIdx]) {
                        const point = shape.polygon.points[pointIdx];
                        const currentHeight = point.height !== undefined ? point.height : 0;

                        // Update the height display in the div
                        const heightSpan = div.querySelector('span[style*="font-weight: bold"]');
                        if (heightSpan) {
                            const heightNormalized = (currentHeight + 10) / 20;
                            const hue = heightNormalized * 240;
                            const heightColor = `hsl(${hue}, 80%, 50%)`;
                            heightSpan.style.color = heightColor;
                            heightSpan.textContent = `${currentHeight.toFixed(1)}m`;
                        }
                    }
                }
            }
        });

        console.log('Refreshed area selection list with updated heights');
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
                shape.polygon.points.forEach((point, idx) => {
                    // Convert to absolute canvas coordinates
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    // Get height if stored, default to 0
                    const height = point.height !== undefined ? point.height : 0;
                    const heightNormalized = (height + 10) / 20; // Map -10 to 10 → 0 to 1
                    const radius = 3 + heightNormalized * 4; // 3px to 7px based on height
                    const hue = heightNormalized * 240; // 0 (red) to 240 (blue)
                    const color = `hsl(${hue}, 80%, 50%)`;

                    const marker = new fabric.Circle({
                        left: absPoint.x,
                        top: absPoint.y,
                        radius: radius,
                        fill: color,
                        stroke: '#fff',
                        strokeWidth: 1.5,
                        originX: 'center',
                        originY: 'center',
                        selectable: false,
                        evented: true,
                        hoverCursor: 'pointer',
                        hasControls: false,
                        hasBorders: false
                    });

                    // Store reference to parent polygon and point index
                    marker.parentPolygon = shape.polygon;
                    marker.pointIndex = idx;
                    marker.shapeRef = shape;

                    // Add click handler to select this vertex for height editing
                    marker.on('mousedown', (options) => {
                        // Stop event propagation to prevent Fabric's selection box
                        if (options.e) {
                            options.e.stopPropagation();
                            options.e.preventDefault();
                        }

                        // Select this vertex for editing
                        this.selectVertex(shape.polygon, idx);

                        // Also select the polygon in Fabric (but don't let it interfere)
                        this.activePolygon = shape.polygon;
                        this.canvas.setActiveObject(shape.polygon);
                        this.canvas.requestRenderAll();

                        // Return false to prevent further event handling
                        return false;
                    });

                    this.vertexMarkers.push(marker);
                    this.canvas.add(marker);
                    this.canvas.bringToFront(marker); // Ensure markers are always on top
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

    startAreaSelection(nativeEvent) {
        // Get pointer position (allow selecting slightly outside canvas bounds)
        const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
        let x = nativeEvent.clientX - rect.left;
        let y = nativeEvent.clientY - rect.top;

        // Allow selection to extend 50px outside canvas for easier corner selection
        const SELECTION_MARGIN = 50;
        x = Math.max(-SELECTION_MARGIN, Math.min(this.canvas.width + SELECTION_MARGIN, x));
        y = Math.max(-SELECTION_MARGIN, Math.min(this.canvas.height + SELECTION_MARGIN, y));

        this.areaSelectionMode = true;
        this.areaSelectionStart = { x, y };
        this.canvas.selection = false;

        // Make all objects non-interactive
        this.canvas.forEachObject(obj => {
            obj.evented = false;
            obj.selectable = false;
        });

        // Create visual rectangle
        this.areaSelectionRect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: 'rgba(52, 152, 219, 0.2)',
            stroke: '#3498db',
            strokeWidth: 2,
            selectable: false,
            evented: false
        });
        this.canvas.add(this.areaSelectionRect);
        this.canvas.renderAll();
    },

    onMouseDown(e) {
        // Area selection is now handled by native DOM listener
        // This handler only deals with other interactions now

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
        snappedPoint.height = this.currentVertexHeight; // Store height with the point
        this.currentPoints.push(snappedPoint);

        // Draw point marker with size/color based on height
        const heightNormalized = (this.currentVertexHeight + 10) / 20; // Map -10 to 10 → 0 to 1
        const radius = 3 + heightNormalized * 5; // 3px to 8px based on height
        const hue = heightNormalized * 240; // 0 (red) to 240 (blue)
        const color = `hsl(${hue}, 80%, 50%)`;

        const circle = new fabric.Circle({
            left: snappedPoint.x,
            top: snappedPoint.y,
            radius: radius,
            fill: color,
            stroke: '#fff',
            strokeWidth: 1,
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

        // Update area selection rectangle
        if (this.areaSelectionMode && this.areaSelectionRect && this.areaSelectionStart) {
            // Allow pointer to extend outside canvas for easier corner selection
            const SELECTION_MARGIN = 50;
            let x = pointer.x;
            let y = pointer.y;
            x = Math.max(-SELECTION_MARGIN, Math.min(this.canvas.width + SELECTION_MARGIN, x));
            y = Math.max(-SELECTION_MARGIN, Math.min(this.canvas.height + SELECTION_MARGIN, y));

            const width = x - this.areaSelectionStart.x;
            const height = y - this.areaSelectionStart.y;

            if (width < 0) {
                this.areaSelectionRect.set({ left: x, width: -width });
            } else {
                this.areaSelectionRect.set({ left: this.areaSelectionStart.x, width: width });
            }

            if (height < 0) {
                this.areaSelectionRect.set({ top: y, height: -height });
            } else {
                this.areaSelectionRect.set({ top: this.areaSelectionStart.y, height: height });
            }

            this.canvas.requestRenderAll();
        }
    },

    onMouseUp(e) {
        // Handle area selection completion
        if (this.areaSelectionMode && this.areaSelectionRect) {
            this.completeAreaSelection();
            return;
        }
    },

    completeAreaSelection() {
        if (!this.areaSelectionRect || !this.areaSelectionStart) return;

        const rect = this.areaSelectionRect;
        // Expand selection bounds by a small margin to catch points near edges
        const POINT_MARGIN = 10; // Give 10px extra margin for catching points
        const left = rect.left - POINT_MARGIN;
        const top = rect.top - POINT_MARGIN;
        const right = rect.left + rect.width + POINT_MARGIN;
        const bottom = rect.top + rect.height + POINT_MARGIN;

        // Find all points within the rectangle
        const pointsInArea = [];

        this.shapes.forEach((shape, shapeIndex) => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach((point, pointIdx) => {
                    const absPoint = fabric.util.transformPoint(
                        { x: point.x - shape.polygon.pathOffset.x, y: point.y - shape.polygon.pathOffset.y },
                        shape.polygon.calcTransformMatrix()
                    );

                    if (absPoint.x >= left && absPoint.x <= right && absPoint.y >= top && absPoint.y <= bottom) {
                        const pointX = absPoint.x / this.scale;
                        const pointZ = CANVAS_HEIGHT - (absPoint.y / this.scale);

                        pointsInArea.push({
                            shape,
                            shapeIndex,
                            pointIndex: pointIdx,
                            point,
                            x: pointX,
                            z: pointZ,
                            height: point.height !== undefined ? point.height : 0
                        });
                    }
                });
            }
        });

        // Remove selection rectangle
        this.canvas.remove(this.areaSelectionRect);
        this.areaSelectionRect = null;
        this.areaSelectionStart = null;
        this.areaSelectionMode = false;

        // Re-enable selection and interaction
        this.canvas.selection = true;
        this.canvas.forEachObject(obj => {
            // Re-enable for shapes, but not vertex markers
            if (obj.type === 'polygon' || obj.type === 'rect') {
                if (!obj.parentPolygon) {
                    obj.evented = true;
                    obj.selectable = true;
                }
            }
            // Vertex markers should stay evented but not selectable
            if (obj.parentPolygon) {
                obj.evented = true;
                obj.selectable = false;
            }
        });

        // Sort points by location to group those at the same position together
        pointsInArea.sort((a, b) => {
            // First sort by X coordinate
            const xDiff = a.x - b.x;
            if (Math.abs(xDiff) > 0.1) return xDiff;

            // Then by Z coordinate if X is similar
            const zDiff = a.z - b.z;
            if (Math.abs(zDiff) > 0.1) return zDiff;

            // Finally by height if position is the same
            return a.height - b.height;
        });

        // Show points in panel
        if (pointsInArea.length > 0) {
            this.showAreaSelectedPoints(pointsInArea);
        } else {
            alert('No points found in selected area');
        }

        this.canvas.requestRenderAll();
    },

    showAreaSelectedPoints(points) {
        const panel = document.getElementById('pointDetailsPanel');
        const list = document.getElementById('pointDetailsList');

        panel.style.display = 'block';
        list.innerHTML = '';

        // Store points for later refresh
        this.currentAreaPoints = points;

        // Update the header and help text to show context
        const header = panel.querySelector('h2');
        if (header) {
            header.textContent = '🔍 Selected Area Points';
        }
        const helpDiv = panel.querySelector('div[style*="font-size: 11px"]');
        if (helpDiv) {
            helpDiv.textContent = `${points.length} vertices in selected area`;
        }

        // Update height help text
        document.getElementById('heightHelpText').textContent = `${points.length} points in selected area`;

        // Highlight selected vertices on canvas
        this.highlightSelectedVertices(points);

        // Display points
        points.forEach(item => {
            const pointDiv = document.createElement('div');
            pointDiv.style.cssText = `
                background: #1a252f;
                padding: 8px;
                margin-bottom: 6px;
                border-radius: 4px;
                border: 1px solid #34495e;
                font-size: 11px;
                cursor: pointer;
            `;

            const heightNormalized = (item.height + 10) / 20;
            const hue = heightNormalized * 240;
            const heightColor = `hsl(${hue}, 80%, 50%)`;

            pointDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 10px; height: 10px; background: ${SURFACE_COLORS[item.shape.type]}; border-radius: 50%;"></div>
                        <strong style="color: #ecf0f1;">${item.shape.type.toUpperCase()}</strong>
                    </div>
                </div>
                <div style="color: #95a5a6; margin-bottom: 4px;">
                    Point #${item.pointIndex + 1}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color: #ecf0f1;">Height: </span>
                        <span style="color: ${heightColor}; font-weight: bold;">${item.height.toFixed(1)}m</span>
                    </div>
                    <button onclick="holeMaker.deletePoint(${item.shapeIndex}, ${item.pointIndex})"
                            style="background: #e74c3c; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
                        Delete
                    </button>
                </div>
                <div style="color: #7f8c8d; font-size: 10px; margin-top: 4px;">
                    x: ${item.x.toFixed(1)}m, z: ${item.z.toFixed(1)}m
                </div>
            `;

            // Click to select this point
            pointDiv.onclick = (ev) => {
                if (ev.target.tagName !== 'BUTTON') {
                    // Select the vertex but don't trigger showNearbyPoints
                    this.selectVertexWithoutChangingList(item.shape.polygon, item.pointIndex);
                    this.canvas.setActiveObject(item.shape.polygon);
                    this.canvas.requestRenderAll();
                }
            };

            list.appendChild(pointDiv);
        });

        console.log(`Found ${points.length} points in selected area`);
    },

    highlightSelectedVertices(points) {
        // Remove any existing highlight markers
        if (this.highlightMarkers) {
            this.highlightMarkers.forEach(marker => this.canvas.remove(marker));
        }
        this.highlightMarkers = [];

        // Create highlight markers for selected points
        points.forEach(item => {
            const absPoint = fabric.util.transformPoint(
                { x: item.point.x - item.shape.polygon.pathOffset.x, y: item.point.y - item.shape.polygon.pathOffset.y },
                item.shape.polygon.calcTransformMatrix()
            );

            // Create a larger, glowing circle around the selected vertex
            const highlight = new fabric.Circle({
                left: absPoint.x,
                top: absPoint.y,
                radius: 8,
                fill: 'rgba(255, 215, 0, 0.3)', // Gold with transparency
                stroke: '#FFD700', // Gold
                strokeWidth: 3,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false
            });

            this.highlightMarkers.push(highlight);
            this.canvas.add(highlight);
        });

        this.canvas.requestRenderAll();
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

        // Multiple greens are now allowed for creating slopes with different heights
        // (removed single green restriction)

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

        // Preserve height data on polygon points (Fabric.js might strip custom properties)
        polygon.points.forEach((point, idx) => {
            if (this.currentPoints[idx] && this.currentPoints[idx].height !== undefined) {
                point.height = this.currentPoints[idx].height;
            }
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

                    // Preserve existing height when dragging
                    const existingHeight = polygon.points[index].height;
                    polygon.points[index] = {
                        x: snappedLocal.x + polygon.pathOffset.x,
                        y: snappedLocal.y + polygon.pathOffset.y,
                        height: existingHeight !== undefined ? existingHeight : 0
                    };

                    return true;
                },
                mouseUpHandler: (eventData, transform) => {
                    if (!transform || !transform.target) {
                        return true; // Exit gracefully if transform is invalid
                    }
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
                    let snapToHeight = null; // Store height of snap target

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
                                    snapToHeight = otherPoint.height; // Store the height of the snap target
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
                            y: localSnapPoint.y + polygon.pathOffset.y,
                            height: snapToHeight !== undefined ? snapToHeight : (polygon.points[index].height !== undefined ? polygon.points[index].height : 0)
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

    placeTeeBox(x, y, heightValue = null) {
        // Remove existing tee box if any
        if (this.teeBox && this.teeBox.visual) {
            this.canvas.remove(this.teeBox.visual);
        }

        // Convert from scaled pixels to meters (flip y-axis)
        const metersX = x / this.scale;
        const metersZ = CANVAS_HEIGHT - (y / this.scale);

        // Use provided height or current height slider value
        const teeHeight = heightValue !== null ? heightValue : this.currentVertexHeight;

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
            y: teeHeight,
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

        // Get terrain height at this position by checking all shapes
        let terrainHeight = 0;
        for (const shape of this.shapes) {
            if (shape.polygon && shape.polygon.points) {
                // Check if point is inside this polygon
                if (this.isPointInPolygon(metersX, metersZ, shape.polygon.points)) {
                    // Get height using simple interpolation from nearest vertices
                    terrainHeight = this.getHeightAtPoint(metersX, metersZ, shape.polygon.points);
                    break;
                }
            }
        }

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
            y: terrainHeight,
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
        const greens = this.shapes.filter(s => s.type === 'green');

        if (!this.teeBox || greens.length === 0) {
            document.getElementById('holeLength').value = '-';
            return;
        }

        // Tee center is already stored in meters (with flipped z-axis) in this.teeBox
        const teeCenterX = this.teeBox.x;
        const teeCenterZ = this.teeBox.z;

        // Calculate combined green center from all green polygons
        // Green points are in canvas coordinates, need to flip y-axis when converting to meters
        let allGreenPoints = [];
        greens.forEach(green => {
            allGreenPoints = allGreenPoints.concat(green.polygon.points);
        });

        const greenMinX = Math.min(...allGreenPoints.map(p => p.x)) / this.scale;
        const greenMaxX = Math.max(...allGreenPoints.map(p => p.x)) / this.scale;
        const greenMinY = Math.min(...allGreenPoints.map(p => p.y)) / this.scale;
        const greenMaxY = Math.max(...allGreenPoints.map(p => p.y)) / this.scale;
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

    startNewHole() {
        if (!confirm('Start a new hole? This will clear all current work.')) return;

        // Clear all data
        this.shapes = [];
        this.objects = [];
        this.flagPositions = [];
        this.teeBox = null;
        this.isDrawing = false;
        this.currentPoints = [];

        // Reset form fields
        document.getElementById('holeName').value = 'custom_hole_01';
        document.getElementById('holePar').value = 4;
        document.getElementById('holeLength').value = '-';
        document.getElementById('jsonOutput').value = '';

        // Clear the current hole ID so next save creates a new hole
        courseManager.currentHoleId = null;

        // Reset canvas dimensions to par 4 default
        this.onParChange();

        console.log('Started new hole');

        this.redrawAll();
        this.updateLayersList();
        this.updateFlagCount();
        this.deselectVertex();
    },

    clearCanvas() {
        if (!confirm('Clear all shapes and objects? (Hole settings will be kept)')) return;

        this.shapes = [];
        this.objects = [];
        this.flagPositions = [];
        this.teeBox = null;
        this.isDrawing = false;
        this.currentPoints = [];

        console.log('Cleared canvas');

        this.redrawAll();
        this.updateLayersList();
        this.updateFlagCount();
        this.deselectVertex();
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
                const transformed = fabric.util.transformPoint(localPoint, transform);
                // Preserve height data
                transformed.height = p.height;
                return transformed;
            });
        }

        // Convert canvas coordinates to meters (round to 2 decimals)
        // Flip y-axis: canvas y=0 (top) should be z=CANVAS_HEIGHT (far), canvas y=CANVAS_HEIGHT (bottom) should be z=0 (tee)
        return absolutePoints.map(p => {
            const result = {
                x: parseFloat((p.x / this.scale).toFixed(2)),
                z: parseFloat((CANVAS_HEIGHT - (p.y / this.scale)).toFixed(2))
            };
            // Add y (height) if present, default to 0
            if (p.height !== undefined) {
                result.y = parseFloat(p.height.toFixed(2));
            } else {
                result.y = 0;
            }
            return result;
        });
    },

    exportJSON() {
        const holeName = document.getElementById('holeName').value || 'custom_hole_01';
        const par = parseInt(document.getElementById('holePar').value) || 4;

        // Get auto-calculated length from tee to green
        const lengthText = document.getElementById('holeLength').value;
        const lengthMeters = lengthText === '-' ? 0 : parseFloat(lengthText);

        // Check if hole has any elevation changes
        let hasElevation = false;

        // Check all shape vertices for non-zero heights
        this.shapes.forEach(shape => {
            if (shape.polygon && shape.polygon.points) {
                shape.polygon.points.forEach(point => {
                    if (point.height !== undefined && Math.abs(point.height) > 0.01) {
                        hasElevation = true;
                    }
                });
            }
        });

        // Also check tee box height
        if (this.teeBox && this.teeBox.y !== undefined && Math.abs(this.teeBox.y) > 0.01) {
            hasElevation = true;
        }

        const layout = {
            name: holeName,
            par: par,
            lengthMeters: lengthMeters,
            hasElevation: hasElevation,
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT
            // Background removed - see how it looks without it
            // background: {
            //     vertices: [
            //         { x: -30, z: -30 },
            //         { x: CANVAS_WIDTH + 30, z: -30 },
            //         { x: CANVAS_WIDTH + 30, z: CANVAS_HEIGHT + 30 },
            //         { x: -30, z: CANVAS_HEIGHT + 30 }
            //     ],
            //     surface: "OUT_OF_BOUNDS"
            // }
        };

        // Group shapes by type
        const fairways = this.shapes.filter(s => s.type === 'fairway');
        const greens = this.shapes.filter(s => s.type === 'green'); // Support multiple greens
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
                    y: parseFloat((this.teeBox.y !== undefined ? this.teeBox.y : 0).toFixed(2)),
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

        // Add greens (support multiple for creating slopes)
        if (greens.length > 0) {
            layout.greens = greens.map(green => ({
                controlPoints: this.convertPointsToMeters(green.polygon.points, green.polygon),
                surface: "GREEN"
            }));
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
                y: parseFloat((flag.y !== undefined ? flag.y : 0).toFixed(2)),
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

        const greens = this.shapes.filter(s => s.type === 'green');
        if (greens.length === 0) {
            alert('Cannot preview: Hole must have at least one green. Please create a green first.');
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
            const metersToCanvas = (point) => {
                const canvasPoint = {
                    x: point.x * this.scale,
                    y: (CANVAS_HEIGHT - point.z) * this.scale
                };
                // Preserve height if present
                if (point.y !== undefined) {
                    canvasPoint.height = point.y;
                }
                return canvasPoint;
            };

            // Import tee box (new placement-based system)
            if (layout.tee && layout.tee.center) {
                const canvasPos = metersToCanvas(layout.tee.center);
                const teeHeight = layout.tee.center.y !== undefined ? layout.tee.center.y : 0;
                this.placeTeeBox(canvasPos.x, canvasPos.y, teeHeight);
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

            // Import greens (support multiple for creating slopes)
            if (layout.greens && Array.isArray(layout.greens)) {
                layout.greens.forEach(green => {
                    if (green.controlPoints) {
                        this.currentPoints = green.controlPoints.map(metersToCanvas);
                        this.currentSurface = 'green';
                        this.closePolygon();
                    }
                });
            } else if (layout.green && layout.green.controlPoints) {
                // Legacy single green support
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
                        y: flag.y !== undefined ? flag.y : 0,
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
        const saveOfficialBtn = document.getElementById('saveOfficialBtn');

        if (courseManager.isAuthenticated()) {
            const username = courseManager.getUsername();
            const isAdmin = courseManager.isAdmin();

            // Debug: Check localStorage
            const playerData = localStorage.getItem('golfGamePlayer');
            console.log('='.repeat(60));
            console.log('🔍 HOLEMAKER AUTH DEBUG:');
            console.log('Username:', username);
            console.log('isAdmin() returns:', isAdmin);
            console.log('localStorage data:', playerData ? JSON.parse(playerData) : 'null');
            console.log('='.repeat(60));

            // Display username with (Admin) suffix if admin
            const displayText = isAdmin ? `${username} (Admin)` : username;
            statusDiv.textContent = `Signed in as: ${displayText}`;
            statusDiv.style.color = '#2ecc71';

            // Log admin status for debugging
            if (isAdmin) {
                console.log('='.repeat(60));
                console.log('✅ ADMIN ACCESS ENABLED');
                console.log('User:', username);
                console.log('='.repeat(60));
            }

            // Show "Save as Official" button only for admins
            if (isAdmin) {
                saveOfficialBtn.style.display = 'block';
            } else {
                saveOfficialBtn.style.display = 'none';
                console.log('ℹ️ Not an admin - "Save as Official Hole" button hidden');
            }
        } else {
            statusDiv.textContent = 'Not signed in';
            statusDiv.style.color = '#95a5a6';
            saveOfficialBtn.style.display = 'none';
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

        const greens = this.shapes.filter(s => s.type === 'green');
        if (greens.length === 0) {
            alert('Cannot save: Hole must have at least one green');
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
    },

    async saveAsOfficialHole() {
        if (!courseManager.isAdmin()) {
            alert('Admin access required to save official holes.');
            return;
        }

        if (!this.teeBox) {
            alert('Cannot save: Hole must have a tee box');
            return;
        }

        const greens = this.shapes.filter(s => s.type === 'green');
        if (greens.length === 0) {
            alert('Cannot save: Hole must have at least one green');
            return;
        }

        // Generate hole data
        this.exportJSON();
        const jsonText = document.getElementById('jsonOutput').value;
        const holeData = JSON.parse(jsonText);

        try {
            const isUpdate = !!courseManager.currentOfficialHoleId;
            const result = await courseManager.saveOfficialHole(holeData);
            const action = isUpdate ? 'updated' : 'saved';
            alert(`✅ Official hole "${holeData.name}" ${action} successfully!`);
        } catch (error) {
            console.error('Error saving official hole:', error);
            alert(`❌ Error saving official hole: ${error.message}`);
        }
    },

    // Helper function to check if a point is inside a polygon
    isPointInPolygon(x, z, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, zi = points[i].y;
            const xj = points[j].x, zj = points[j].y;

            const intersect = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    // Helper function to get interpolated height at a point within a polygon
    getHeightAtPoint(x, z, points) {
        if (!points || points.length < 3) return 0;

        // Find the three nearest vertices to use for interpolation
        const distances = points.map((p, idx) => ({
            index: idx,
            dist: Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - z, 2)),
            height: p.height !== undefined ? p.height : 0
        }));

        distances.sort((a, b) => a.dist - b.dist);

        // Use inverse distance weighting from the 3 nearest points
        const nearest = distances.slice(0, 3);
        let totalWeight = 0;
        let weightedHeight = 0;

        for (const pt of nearest) {
            if (pt.dist < 0.01) {
                // Point is essentially at a vertex
                return pt.height;
            }
            const weight = 1 / pt.dist;
            totalWeight += weight;
            weightedHeight += weight * pt.height;
        }

        return totalWeight > 0 ? weightedHeight / totalWeight : 0;
    }
};

// Make holeMaker accessible globally for inline event handlers
window.holeMaker = holeMaker;

// Initialize when page loads
window.addEventListener('load', async () => {
    // Import playerManager to ensure auth state is fresh
    const { playerManager } = await import('./src/playerManager.js');

    // Re-verify auth with server to get latest admin status
    await playerManager.init();

    holeMaker.init();
    holeMaker.updateAuthStatus();
});
