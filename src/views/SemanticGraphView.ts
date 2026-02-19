import Graph from "graphology";
import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import Sigma from "sigma";

import { UI_STRINGS, VIEW_TYPES } from "../constants";
import { GraphService } from "../services/GraphService";
import { IVaultIntelligencePlugin } from "../settings/types";

interface SigmaHoverData {
    color: string;
    label?: string | null;
    size: number;
    x: number;
    y: number;
}

interface SigmaHoverSettings {
    labelColor: { attribute?: string; color?: string };
    labelFont: string;
    labelSize: number;
    labelWeight: string;
}

/**
 * Semantic Galaxy View: High-performance WebGL graph of vault relationships.
 * Uses Sigma.js and Graphology.
 */
export class SemanticGraphView extends ItemView {
    private sigmaInstance: Sigma | null = null;
    private graph: Graph = new Graph({ type: 'undirected' });
    private lastUpdateId = 0;
    private currentFilePath: string | null = null;
    private plugin: IVaultIntelligencePlugin;
    private graphService: GraphService;
    private containerResizer: ResizeObserver | null = null;
    private visibilityObserver: IntersectionObserver | null = null;
    private isVisible = false;
    private pendingUpdatePath: string | null = null;
    private contextPaths: Set<string> = new Set();
    private hoveredNode: string | null = null;
    private themeColors: Record<string, string> = {};
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private wrapperEl!: HTMLElement;
    public attractionMultiplier: number = 1.0;

    constructor(leaf: WorkspaceLeaf, plugin: IVaultIntelligencePlugin, graphService: GraphService) {
        super(leaf);
        this.plugin = plugin;
        this.graphService = graphService;

        // Auto-refresh graph when a background index finishes
        this.registerEvent(
            this.graphService.on('graph:index-updated', () => {
                const file = this.app.workspace.getActiveFile();
                void this.updateForFile(file, true);
            })
        );
        this.registerEvent(
            this.graphService.on('graph:index-ready', () => {
                const file = this.app.workspace.getActiveFile();
                void this.updateForFile(file, true);
            })
        );
    }

    getViewType(): string {
        return VIEW_TYPES.SEMANTIC_GRAPH;
    }

    getDisplayText(): string {
        return UI_STRINGS.SEMANTIC_GRAPH_TITLE;
    }

    getIcon(): string {
        return "network";
    }



    async onOpen() {
        await Promise.resolve();
        // Reset path to ensure updateForFile doesn't return early if view is reused
        this.currentFilePath = null;

        // 1. Strict Obsidian Flexbox Container
        this.contentEl.empty();
        this.contentEl.setCssStyles({
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "0"
        });

        // Top Bar Controls
        const topBar = this.contentEl.createDiv({ cls: "semantic-graph-controls" });
        topBar.setCssStyles({
            alignItems: "center",
            borderBottom: "1px solid var(--background-modifier-border)",
            display: "flex",
            flexShrink: "0",
            gap: "var(--size-4-2)",
            justifyContent: "flex-end",
            padding: "var(--size-4-1) var(--size-4-2)"
        });

        topBar.createSpan({ attr: { style: "font-size: var(--font-ui-small);" }, cls: "text-muted", text: "Attraction" });
        const slider = topBar.createEl("input", {
            attr: {
                max: "5.0",
                min: "0.1",
                step: "0.1",
                title: "Adjust how strongly similar notes pull together",
            },
            type: "range"
        });
        slider.value = this.attractionMultiplier.toString();

        slider.addEventListener("input", (e) => {
            this.attractionMultiplier = parseFloat((e.target as HTMLInputElement).value);
        });

        slider.addEventListener("change", () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) void this.updateForFile(activeFile, true);
        });

        this.wrapperEl = this.contentEl.createDiv({ cls: "semantic-graph-wrapper" });
        this.wrapperEl.setCssStyles({
            backgroundColor: "transparent",
            flex: "1 1 auto",
            height: "100%",
            position: "relative",
            width: "100%"
        });

        // Initialize theme colors and reducers
        this.resolveThemeColors();

        // Initialize Sigma with the graphology instance
        this.sigmaInstance = new Sigma(this.graph, this.wrapperEl, {
            allowInvalidContainer: true, // CRITICAL FIX: Prevents WebGL crash if tab is hidden (0x0)
            defaultEdgeType: "line",
            defaultNodeType: "circle",
            edgeLabelColor: { color: this.themeColors.label || "#fff" }, // Brighter text for dark mode
            edgeLabelFont: "var(--font-interface)",
            edgeLabelSize: 18, // Extra large size for easy reading on all resolutions
            labelColor: { color: this.themeColors.label || "#fff" }, // Use normal text color for better contrast
            labelFont: "var(--font-interface)",
            labelRenderedSizeThreshold: 2, // CRITICAL FIX: Render labels much earlier when zoomed out
            labelSize: 24, // Significantly larger text per user request
            labelWeight: "600", // Semi-bold for readability
            renderEdgeLabels: true,
            renderLabels: true
        });

        // Container resize observer to keep WebGL viewport matched
        this.containerResizer = new ResizeObserver(() => {
            // Only refresh if the container has dimensions (prevents 0x0 crash)
            if (this.wrapperEl.clientWidth > 0 && this.wrapperEl.clientHeight > 0) {
                this.sigmaInstance?.refresh();
            }
        });
        this.containerResizer.observe(this.wrapperEl);

        // Visibility observer to resolve the "hidden tab" update deadlock
        this.visibilityObserver = new IntersectionObserver((entries) => {
            const isIntersecting = entries[0]?.isIntersecting;
            this.isVisible = !!isIntersecting;
            if (this.isVisible) {
                this.sigmaInstance?.refresh();
                if (this.pendingUpdatePath) {
                    const file = this.app.vault.getAbstractFileByPath(this.pendingUpdatePath);
                    this.pendingUpdatePath = null;
                    if (file instanceof TFile) void this.updateForFile(file, true);
                }
            }
        });
        this.visibilityObserver.observe(this.contentEl);

        this.registerEvent(
            this.graphService.on("vault-intelligence:context-highlight", (paths: string[]) => {
                this.contextPaths = new Set(paths);
                this.sigmaInstance?.refresh();
            })
        );

        this.registerEvent(
            this.app.workspace.on("css-change", () => {
                if (this.sigmaInstance) {
                    this.resolveThemeColors();
                    this.sigmaInstance.setSetting("labelColor", { color: this.themeColors.label || "#fff" });
                    this.sigmaInstance.setSetting("edgeLabelColor", { color: this.themeColors.label || "#fff" });
                    this.sigmaInstance.refresh();
                }
            })
        );

        // --- Restore Missing Sigma Event Listeners ---
        this.sigmaInstance.on("clickNode", (event) => {
            const nodeEvent = event as { node: string };
            const file = this.app.vault.getAbstractFileByPath(nodeEvent.node);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(file);
            }
        });

        this.sigmaInstance.on("enterNode", (event) => {
            // Sigma v3 event payload extraction
            const nodeEvent = event as unknown as { event: { original?: MouseEvent } | MouseEvent; node: string };
            const path = nodeEvent.node;

            if (this.hoveredNode !== path) {
                this.hoveredNode = path;
                this.sigmaInstance?.refresh();
            }

            const file = this.app.vault.getAbstractFileByPath(path);

            let nativeEvent: MouseEvent | undefined;
            if (nodeEvent.event && 'original' in nodeEvent.event) {
                nativeEvent = (nodeEvent.event as { original: MouseEvent }).original;
            } else if (nodeEvent.event instanceof MouseEvent) {
                nativeEvent = nodeEvent.event;
            }

            if (file instanceof TFile && nativeEvent) {
                // Trigger native Obsidian hover preview
                const payload = {
                    event: nativeEvent,
                    hoverParent: this.wrapperEl,
                    linktext: path,
                    source: VIEW_TYPES.SEMANTIC_GRAPH,
                    sourcePath: this.currentFilePath || "",
                    targetEl: null
                };
                this.app.workspace.trigger("hover-link", payload);
            }
        });

        this.sigmaInstance.on("leaveNode", () => {
            if (this.hoveredNode) {
                this.hoveredNode = null;
                this.sigmaInstance?.refresh();
            }
        });

        this.sigmaInstance.on("clickStage", () => {
            if (this.contextPaths.size > 0) {
                this.contextPaths.clear();
                this.sigmaInstance?.refresh();
            }
        });

        // Add Context Menu for User Controls (Fit, Centre)
        this.wrapperEl.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            const configMenu = new Menu();

            configMenu.addItem((item) => {
                item.setTitle("Centre on active note")
                    .setIcon("crosshair")
                    .onClick(() => {
                        const activeFile = this.app.workspace.getActiveFile();
                        if (activeFile) void this.updateForFile(activeFile, true);
                    });
            });

            configMenu.addItem((item) => {
                item.setTitle("Fit graph to view")
                    .setIcon("maximize")
                    .onClick(() => {
                        void this.sigmaInstance?.getCamera().animatedReset({ duration: 500 });
                    });
            });

            configMenu.showAtMouseEvent(event);
        });

        // Sync with active file on first open if visible
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            if (this.contentEl.clientWidth > 0) {
                void this.updateForFile(activeFile);
            } else {
                this.pendingUpdatePath = activeFile.path;
            }
        }
    }


    /**
     * Resolves Obsidian CSS variables into absolute colors for Sigma WebGL shaders.
     */
    private resolveThemeColors() {
        // Robust color resolution
        const getComputedColor = (cssVar: string, fallback: string) => {
            const tempEl = document.body.createDiv();
            // Apply the var to color, if invalid, it will fallback to empty string
            tempEl.style.color = `var(${cssVar})`;
            document.body.appendChild(tempEl);
            const computedColor = getComputedStyle(tempEl).color;
            tempEl.remove();
            // If the computed color is empty or transparent, use fallback
            return computedColor && computedColor !== 'rgba(0, 0, 0, 0)' && computedColor !== 'transparent' ? computedColor : fallback;
        };

        this.themeColors = {
            background: getComputedColor("--background-primary", "rgb(255, 255, 255)"),
            center: getComputedColor("--text-accent", "rgb(100, 100, 255)"),
            edge: getComputedColor("--background-modifier-border", "rgb(100, 100, 100)"),
            highlight: getComputedColor("--interactive-accent", "rgb(255, 200, 0)"),
            label: getComputedColor("--text-normal", "rgb(255, 255, 255)"),
            semantic: getComputedColor("--text-faint", "rgb(150, 150, 150)"),
            shadow: getComputedColor("--background-modifier-box-shadow", "rgba(0, 0, 0, 0.5)"),
            structural: getComputedColor("--text-muted", "rgb(200, 200, 200)")
        };

        // Apply updated label color to settings
        this.sigmaInstance?.setSetting("labelColor", { color: this.themeColors.label || "#888" });
        this.sigmaInstance?.setSetting("defaultDrawNodeHover", this.drawCustomNodeHover.bind(this));

        // Apply visual logic via Sigma reducers (state-driven rendering)
        this.sigmaInstance?.setSetting("nodeReducer", (node, data) => {
            const res = { ...data };
            const type = data.nodeType as string;

            // Core type-based coloring
            res.color = this.themeColors[type] || this.themeColors.structural || "#888";

            // Topic Coloring Override
            if (data.topics && Array.isArray(data.topics) && data.topics.length > 0) {
                const topic = data.topics[0] as string;
                if (topic !== "default") {
                    // Generate a stable color based on string hash
                    let hashStr = 0;
                    for (let i = 0; i < topic.length; i++) {
                        hashStr = topic.charCodeAt(i) + ((hashStr << 5) - hashStr);
                    }
                    const hue = Math.abs(hashStr) % 360;
                    res.color = `hsl(${hue}, 65%, 55%)`; // Vibrant but readable
                }
            }

            // Visual RAG Highlighting logic
            if (this.contextPaths.size > 0 && !this.contextPaths.has(node)) {
                res.color = this.adjustAlpha(res.color as string, 0.2); // Dim others
                res.label = undefined; // Hide labels for non-context nodes
            }

            // Interactive Node Hovering
            if (this.hoveredNode) {
                if (node === this.hoveredNode || this.graph.hasEdge(node, this.hoveredNode) || this.graph.hasEdge(this.hoveredNode, node)) {
                    res.highlighted = true;
                } else {
                    res.color = this.adjustAlpha(res.color as string, 0.2);
                    res.label = undefined;
                    res.highlighted = false;
                }
            }

            // --- Label Truncation ---
            if (res.label && !res.highlighted) {
                const lbl = res.label as string;
                if (lbl.length > 30) {
                    res.label = lbl.substring(0, 30) + '...';
                }
            }

            // --- Enhanced Hover State ---
            if (res.highlighted) {
                res.color = this.themeColors.highlight || "#ff0";
                res.size = ((res.size as number) || 5) * 1.8; // Boost size on hover
                res.zIndex = 20;
                res.label = data.label as string | undefined; // Safe cast, show full label
            }

            return res;
        });

        this.sigmaInstance?.setSetting("edgeReducer", (edge, data) => {
            const res = { ...data };
            const extremities = this.graph.extremities(edge);
            const u = extremities[0];
            const v = extremities[1];

            // Ensure semantic edges glow
            if (data.edgeType === 'semantic') {
                res.color = this.adjustAlpha(this.themeColors.highlight || "#ff0", 0.5);
            } else {
                res.color = this.themeColors.edge || "#888";
            }

            // Dim edges not connected to global highlighted nodes
            if (this.contextPaths.size > 0) {
                if (!this.contextPaths.has(u) && !this.contextPaths.has(v)) {
                    res.color = this.adjustAlpha(res.color as string, 0.1);
                }
            }

            // Local Neighborhood Edge Hover Annotations
            if (this.hoveredNode) {
                if (u === this.hoveredNode || v === this.hoveredNode) {
                    // Show context label for the active edge
                    if (data.edgeType === 'semantic') {
                        const scorePart = data.score ? ` (${Math.round((data.score as number) * 100)}%)` : '';
                        res.label = `Semantic Match${scorePart}`;
                        res.color = this.themeColors.highlight;
                    } else {
                        res.label = `Linked`;
                        res.color = this.themeColors.edge;
                    }
                    res.size = (res.size as number || 1) * 1.5;
                    res.zIndex = 10;
                } else {
                    // Dim edges safely away from hover
                    res.color = this.adjustAlpha(res.color as string, 0.1);
                    res.label = undefined;
                }
            }

            return res;
        });
    }

    /**
     * Helper to dim colors for background nodes.
     */
    private adjustAlpha(color: string, alpha: number): string {
        if (!color) return `rgba(150, 150, 150, ${alpha})`;

        // Handle Hex colors
        if (color.startsWith('#')) {
            let hex = color.substring(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        if (color.startsWith("rgba")) {
            return color.replace(/[\d.]+\)$/g, `${alpha})`);
        }
        if (color.startsWith("rgb")) {
            return color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
        }
        return color; // Fallback
    }

    /**
     * Updates the graph view for a specific file.
     * Includes debouncing, race protection, and smart panning.
     */
    updateForFile(file: TFile | null, force = false) {
        if (!file || file.extension !== 'md') return;

        // Skip if same file unless forced
        if (!force && this.currentFilePath === file.path) return;

        if (this.updateTimer) clearTimeout(this.updateTimer);

        this.updateTimer = setTimeout(() => {
            void (async () => {
                this.lastUpdateId++;
                const myUpdateId = this.lastUpdateId;

                this.currentFilePath = file.path;

                // Smart Pan: If node already exists, instantly animate camera to it
                if (this.graph.hasNode(file.path)) {
                    const camera = this.sigmaInstance?.getCamera();
                    const pos = this.graph.getNodeAttributes(file.path);
                    if (camera && pos) {
                        void camera.animate({ ratio: 1.2, x: pos.x as number, y: pos.y as number }, { duration: 600 });
                    }
                }

                // Fetch new subgraph from worker
                const existingPositions: Record<string, { x: number, y: number }> = {};
                this.graph.forEachNode((node, attr) => {
                    existingPositions[node] = { x: attr.x as number, y: attr.y as number };
                });

                try {
                    const sub = await this.graphService.getSemanticSubgraph(file.path, myUpdateId, existingPositions, this.attractionMultiplier);

                    // Verify we are still on the same update request
                    if (this.lastUpdateId !== myUpdateId) return;

                    // Ignore empty aborts safely
                    if (!sub || sub.order === 0) {
                        if (this.graph.order === 0) this.sigmaInstance?.refresh();
                        return;
                    }

                    // Atomic graph swap
                    this.graph.clear();
                    this.graph.import(sub);

                    // 3. Safety Guard: Fix any NaN coordinates generated by FA2 math
                    this.graph.forEachNode((n, a) => {
                        if (typeof a.x !== 'number' || Number.isNaN(a.x)) this.graph.setNodeAttribute(n, 'x', Math.random() * 100);
                        if (typeof a.y !== 'number' || Number.isNaN(a.y)) this.graph.setNodeAttribute(n, 'y', Math.random() * 100);
                    });

                    // Only refresh if the container is visible (has width)
                    if (this.wrapperEl.clientWidth > 0) {
                        this.sigmaInstance?.refresh();
                    }

                    // Smart Camera: Always fit view to gracefully show the newly revealed clusters
                    if (this.graph.hasNode(file.path)) {
                        const camera = this.sigmaInstance?.getCamera();
                        if (camera) {
                            void camera.animatedReset({ duration: 500 });
                        }
                    }
                } catch (e) {
                    console.error("[SemanticGraphView] Failed to update graph", e);
                }
            })();
        }, 150);
    }

    async onClose() {
        await Promise.resolve();
        this.containerResizer?.disconnect();
        this.visibilityObserver?.disconnect();
        this.sigmaInstance?.kill();
        this.sigmaInstance = null;
    }

    private drawCustomNodeHover(context: CanvasRenderingContext2D, data: SigmaHoverData, settings: SigmaHoverSettings) {
        const PADDING = 2;
        const size = settings.labelSize;
        const font = settings.labelFont;
        const weight = settings.labelWeight;

        context.font = `${weight} ${size}px ${font}`;
        // Set the style for the hover box background
        context.fillStyle = this.themeColors.background || "#000";
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        context.shadowBlur = 8;
        context.shadowColor = this.themeColors.shadow || "rgba(0,0,0,0.5)";

        if (typeof data.label === "string") {
            const textWidth = context.measureText(data.label).width;
            const boxWidth = Math.round(textWidth + 5);
            const boxHeight = Math.round(size + 2 * PADDING);
            const radius = Math.max(data.size, size / 2) + PADDING;

            const angleRadian = Math.asin(boxHeight / 2 / radius);
            const xDeltaCoord = Math.sqrt(Math.abs(Math.pow(radius, 2) - Math.pow(boxHeight / 2, 2)));

            context.beginPath();
            context.moveTo(data.x + xDeltaCoord, data.y + boxHeight / 2);
            context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
            context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
            context.lineTo(data.x + xDeltaCoord, data.y - boxHeight / 2);
            context.arc(data.x, data.y, radius, angleRadian, -angleRadian);
            context.closePath();
            context.fill();
        } else {
            context.beginPath();
            context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2);
            context.closePath();
            context.fill();
        }

        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        context.shadowBlur = 0;

        // And finally we draw the label text using the correct color
        if (data.label) {
            context.fillStyle = settings.labelColor.color || this.themeColors.label || "#000";
            context.fillText(data.label, data.x + data.size + 3, data.y + size / 3);
        }
    }
}
