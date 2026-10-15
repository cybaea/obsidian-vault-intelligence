import type { EdgeReducer, NodeReducer } from "sigma/types";

import Graph from "graphology";
import { ItemView, Menu, TFile, WorkspaceLeaf, debounce } from "obsidian";
import Sigma from "sigma";

import { UI_STRINGS, VIEW_TYPES } from "../constants";
import { GraphService } from "../services/GraphService";
import { IVaultIntelligencePlugin } from "../settings/types";
import { logger } from "../utils/logger";

/**
 * Rendering constants for the Semantic Galaxy view, targeting the sigma v4
 * settings, reducers, and per-item label display data API.
 */
const GRAPH_VIEW_CONSTANTS = {
    /** Padding between node or label and the hover backdrop, in pixels. */
    BACKDROP_PADDING: 2,
    /** Blur radius of the hover backdrop shadow, in pixels. */
    BACKDROP_SHADOW_BLUR: 8,
    /** Size multiplier applied to edges adjacent to the hovered node. */
    HOVER_EDGE_SIZE_BOOST: 1.5,
    /** Size multiplier applied to the hovered node. */
    HOVER_SIZE_BOOST: 1.8,
    /** Font family used when `--font-interface` cannot be resolved. */
    INTERFACE_FONT_FALLBACK: "Inter, sans-serif",
    /** Font weight used for node labels. */
    LABEL_FONT_WEIGHT: "600",
    /** Minimum on-screen node size (pixels) for its label to be rendered. */
    LABEL_RENDERED_SIZE_THRESHOLD: 2,
    /** Node label font size, in pixels. */
    LABEL_SIZE: 24,
    /** Maximum node label length before truncation with an ellipsis. */
    LABEL_TRUNCATION_LENGTH: 30
};

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
    private themeFontFamily: string = "";
    private wrapperEl!: HTMLElement;
    public attractionMultiplier: number = 1.0;

    /**
     * Sigma v4 node reducer. Applies theme colors, topic coloring, RAG context
     * dimming, hover emphasis, and per-item label styling. In v4, labels are
     * WebGL SDF text, so label font, size, and color are per-node display data,
     * and hidden labels are expressed with `labelVisibility` rather than
     * clearing the `label` value.
     */
    private readonly nodeReducer: NodeReducer = (node, data, attrs) => {
        const res = { ...data };

        // Per-item label styling (replaces the v3 labelColor/labelFont/labelSize settings)
        res.labelColor = this.themeColors.label || "#fff";
        res.labelFont = `${GRAPH_VIEW_CONSTANTS.LABEL_FONT_WEIGHT} ${this.themeFontFamily}`;
        res.labelSize = GRAPH_VIEW_CONSTANTS.LABEL_SIZE;

        // Core type-based coloring
        const nodeType = attrs.nodeType as string | undefined;
        res.color = this.themeColors[nodeType ?? ""] || this.themeColors.structural || "#888";

        // Topic Coloring Override
        const topics = attrs.topics as string[] | undefined;
        if (topics && topics.length > 0) {
            const topic = topics[0];
            if (topic && topic !== "default") {
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
            res.color = this.adjustAlpha(res.color, 0.2); // Dim others
            res.labelVisibility = "hidden"; // Hide labels for non-context nodes
        }

        // Interactive Node Hovering
        if (this.hoveredNode) {
            if (node === this.hoveredNode || this.graph.hasEdge(node, this.hoveredNode) || this.graph.hasEdge(this.hoveredNode, node)) {
                res.highlighted = true;
            } else {
                res.color = this.adjustAlpha(res.color, 0.2);
                res.labelVisibility = "hidden";
                res.highlighted = false;
            }
        }

        // --- Label Truncation ---
        if (res.label && !res.highlighted && res.label.length > GRAPH_VIEW_CONSTANTS.LABEL_TRUNCATION_LENGTH) {
            res.label = `${res.label.substring(0, GRAPH_VIEW_CONSTANTS.LABEL_TRUNCATION_LENGTH)}...`;
        }

        // --- Enhanced Hover State ---
        if (res.highlighted) {
            res.color = this.themeColors.highlight || "#ff0";
            res.size = (res.size || 5) * GRAPH_VIEW_CONSTANTS.HOVER_SIZE_BOOST; // Boost size on hover
            res.zIndex = 20;
            res.label = data.label; // Show full label
            // Force label display (replaces the v3 highlighted-label exemption)
            res.labelVisibility = "visible";
        }

        // --- Themed Hover Backdrop (replaces the v3 defaultDrawNodeHover box) ---
        if (node === this.hoveredNode) {
            res.backdropArea = "both";
            res.backdropColor = this.themeColors.background || "#000";
            res.backdropPadding = GRAPH_VIEW_CONSTANTS.BACKDROP_PADDING;
            res.backdropShadowBlur = GRAPH_VIEW_CONSTANTS.BACKDROP_SHADOW_BLUR;
            res.backdropShadowColor = this.themeColors.shadow || "rgba(0, 0, 0, 0.5)";
            res.backdropVisibility = "visible";
        }

        return res;
    };

    /**
     * Sigma v4 edge reducer. Applies theme colors, RAG context dimming, and
     * hover annotations. Edge label colour is per-item display data in v4; the
     * edge label font and size are not configurable and render at the default.
     */
    private readonly edgeReducer: EdgeReducer = (edge, data, attrs) => {
        const res = { ...data };
        const extremities = this.graph.extremities(edge);
        const u = extremities[0];
        const v = extremities[1];
        const edgeType = attrs.edgeType as string | undefined;

        // Edge labels inherit the theme label colour (replaces the v3 edgeLabelColor setting)
        res.labelColor = this.themeColors.label || "#fff";

        // Ensure semantic edges are subtle by default to prevent dominating the display
        if (edgeType === 'semantic') {
            res.color = this.adjustAlpha(this.themeColors.semantic || "#888", 0.4);
        } else {
            res.color = this.themeColors.edge || "#888";
        }

        // Dim edges not connected to global highlighted nodes
        if (this.contextPaths.size > 0) {
            if (!this.contextPaths.has(u) && !this.contextPaths.has(v)) {
                res.color = this.adjustAlpha(res.color, 0.1);
            }
        }

        // Local Neighborhood Edge Hover Annotations
        if (this.hoveredNode) {
            if (u === this.hoveredNode || v === this.hoveredNode) {
                // Show context label for the active edge
                if (edgeType === 'semantic') {
                    const score = attrs.score as number | undefined;
                    const scorePart = score ? ` (${Math.round(score * 100)}%)` : '';
                    res.label = `Semantic Match${scorePart}`;
                    res.color = this.themeColors.highlight || "#ff0";
                } else {
                    res.label = `Linked`;
                    res.color = this.themeColors.edge || "#888";
                }
                res.size = (res.size || 1) * GRAPH_VIEW_CONSTANTS.HOVER_EDGE_SIZE_BOOST;
                res.zIndex = 10;
            } else {
                // Dim edges safely away from hover
                res.color = this.adjustAlpha(res.color, 0.1);
                res.labelVisibility = "hidden";
            }
        }

        return res;
    };

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
        const sliderLabel = topBar.createSpan({ attr: { style: "font-size: var(--font-ui-small); width: 1.5em; text-align: right;" }, cls: "text-muted", text: this.attractionMultiplier.toFixed(1) });
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
            sliderLabel.setText(this.attractionMultiplier.toFixed(1));
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) void this.updateForFile(activeFile, true);
        });

        const reshuffleBtn = topBar.createEl("button", {
            attr: { title: "Reshuffle graph layout" },
            text: "Reshuffle"
        });
        reshuffleBtn.addEventListener("click", () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) void this.updateForFile(activeFile, true, true);
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
        // Sigma v4: reducers are constructor options, and the flat v3 display
        // settings moved into the nested `settings` object. Per-item label
        // styling (color, font, size) is applied by the reducers above.
        this.sigmaInstance = new Sigma(this.graph, this.wrapperEl, {
            edgeReducer: this.edgeReducer,
            nodeReducer: this.nodeReducer,
            settings: {
                allowInvalidContainer: true, // CRITICAL FIX: Prevents WebGL crash if tab is hidden (0x0)
                // CRITICAL FIX: v4 defaults to "positions" (sizes scale with zoom);
                // keep the v3 constant screen-space sizing.
                itemSizesReference: "screen",
                labelRenderedSizeThreshold: GRAPH_VIEW_CONSTANTS.LABEL_RENDERED_SIZE_THRESHOLD, // CRITICAL FIX: Render labels much earlier when zoomed out
                renderEdgeLabels: true,
                renderLabels: true
            }
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
            this.graphService.on("vault-intelligence:context-highlight", (...args: unknown[]) => {
                const paths = args[0] as string[];
                this.contextPaths = new Set(paths);
                this.sigmaInstance?.refresh();
            })
        );

        this.registerEvent(
            this.app.workspace.on("css-change", () => {
                if (this.sigmaInstance) {
                    this.resolveThemeColors();
                    // The reducers re-apply theme colors (and label colors) on refresh.
                    this.sigmaInstance.refresh();
                }
            })
        );

        // --- Restore Missing Sigma Event Listeners ---
        this.sigmaInstance.on("clickNode", (event) => {
            const file = this.app.vault.getAbstractFileByPath(event.node);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(file);
            }
        });

        this.sigmaInstance.on("enterNode", (event) => {
            const path = event.node;

            if (this.hoveredNode !== path) {
                this.hoveredNode = path;
                this.sigmaInstance?.refresh();
            }

            const file = this.app.vault.getAbstractFileByPath(path);

            // Sigma v4 event payloads are fully typed; MouseCoords.original
            // carries the native DOM event.
            const nativeEvent = event.event.original instanceof MouseEvent ? event.event.original : undefined;

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
                        // Sigma v4: reset animates back to the default camera state.
                        void this.sigmaInstance?.getCamera().reset({ duration: 500 });
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
            const tempEl = activeDocument.body.createDiv();
            // Apply the var to color, if invalid, it will fallback to empty string
            tempEl.style.color = `var(${cssVar})`;
            activeDocument.body.appendChild(tempEl);
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

        // Resolve the interface font family the same way. Sigma v4 renders
        // labels as WebGL SDF text, so CSS variables cannot be used directly
        // (the v3 code passed `var(--font-interface)` to a canvas font, which
        // silently never resolved).
        const getComputedFont = (cssVar: string, fallback: string) => {
            const tempEl = activeDocument.body.createDiv();
            tempEl.style.fontFamily = `var(${cssVar})`;
            activeDocument.body.appendChild(tempEl);
            const computedFont = getComputedStyle(tempEl).fontFamily;
            tempEl.remove();
            return computedFont || fallback;
        };

        this.themeFontFamily = getComputedFont("--font-interface", GRAPH_VIEW_CONSTANTS.INTERFACE_FONT_FALLBACK);
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
    updateForFile = debounce((...args: unknown[]) => {
        const file = args[0] as TFile | null;
        const force = (args[1] ?? false) as boolean;
        const ignorePositions = (args[2] ?? false) as boolean;

        if (!file || file.extension !== 'md') return;

        // Skip if same file unless forced
        if (!force && this.currentFilePath === file.path) return;

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
            if (!ignorePositions) {
                this.graph.forEachNode((node, attr) => {
                    existingPositions[node] = { x: attr.x as number, y: attr.y as number };
                });
            }

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
                        // Sigma v4: reset animates back to the default camera state.
                        void camera.reset({ duration: 500 });
                    }
                }
            } catch (e) {
                logger.error("[SemanticGraphView] Failed to update graph", e);
            }
        })();
    }, 150, true);

    async onClose() {
        await Promise.resolve();
        this.containerResizer?.disconnect();
        this.visibilityObserver?.disconnect();
        this.sigmaInstance?.kill();
        this.sigmaInstance = null;
    }
}
