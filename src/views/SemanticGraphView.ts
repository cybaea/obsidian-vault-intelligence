import Graph from "graphology";
import { Events, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import Sigma from "sigma";

import { UI_STRINGS, VIEW_TYPES } from "../constants";
import { GraphService } from "../services/GraphService";
import { IVaultIntelligencePlugin } from "../settings/types";

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
    private themeColors: Record<string, string> = {};

    constructor(leaf: WorkspaceLeaf, plugin: IVaultIntelligencePlugin, graphService: GraphService) {
        super(leaf);
        this.plugin = plugin;
        this.graphService = graphService;
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
        // Container setup
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("semantic-graph-container");
        container.setCssStyles({
            backgroundColor: "transparent",
            height: "100%",
            overflow: "hidden",
            position: "relative",
            width: "100%"
        });

        // Initialize Sigma with the graphology instance
        this.sigmaInstance = new Sigma(this.graph, container, {
            defaultEdgeType: "line",
            defaultNodeType: "circle",
            labelColor: { color: "#888" },
            labelFont: "inherit",
            labelSize: 12,
            labelWeight: "normal",
            renderLabels: true
        });

        // Initialize theme colors and reducers
        this.resolveThemeColors();

        // Container resize observer to keep WebGL viewport matched
        this.containerResizer = new ResizeObserver(() => {
            if (this.isVisible) this.sigmaInstance?.refresh();
        });
        this.containerResizer.observe(container);

        // Visibility observer to pause/resume rendering and updates
        this.visibilityObserver = new IntersectionObserver(([entry]) => {
            this.isVisible = entry?.isIntersecting ?? false;
            if (this.isVisible && this.pendingUpdatePath) {
                const file = this.app.vault.getAbstractFileByPath(this.pendingUpdatePath);
                if (file instanceof TFile) {
                    void this.updateForFile(file);
                }
                this.pendingUpdatePath = null;
            }
        });
        this.visibilityObserver.observe(this.containerEl);

        // --- Sigma Event Handlers ---

        this.sigmaInstance.on("clickNode", (event) => {
            const path = event.node;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                // Focus the file in the workspace
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(file);
            }
        });

        this.sigmaInstance.on("enterNode", (event) => {
            const path = event.node;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                // Trigger native Obsidian hover preview
                const payload = {
                    event: (event as unknown as { event: MouseEvent }).event, // Sigma v3 original event
                    hoverParent: container,
                    linktext: path,
                    source: VIEW_TYPES.SEMANTIC_GRAPH,
                    sourcePath: this.currentFilePath || "",
                    targetEl: null
                };
                (this.app.workspace as Events).trigger("hover-link", payload);
            }
        });

        this.sigmaInstance.on("clickStage", () => {
            if (this.contextPaths.size > 0) {
                this.contextPaths.clear();
                this.sigmaInstance?.refresh();
            }
        });

        // --- Custom Event Listeners ---

        // Visual RAG: Highlight relevant files from AI response
        this.registerEvent(
            this.graphService.on("vault-intelligence:context-highlight", (paths: string[]) => {
                this.contextPaths = new Set(paths);
                this.sigmaInstance?.refresh();
            })
        );

        // Obsidian theme change listener
        this.registerEvent(
            this.app.workspace.on("css-change", () => {
                this.resolveThemeColors();
                this.sigmaInstance?.refresh();
            })
        );

        // Sync with active file on first open
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) void this.updateForFile(activeFile);
    }

    /**
     * Resolves Obsidian CSS variables into absolute colors for Sigma WebGL shaders.
     */
    private resolveThemeColors() {
        const dummy = document.createElement("div");
        this.containerEl.appendChild(dummy);

        const getRGB = (varName: string) => {
            dummy.style.color = `var(${varName})`;
            return getComputedStyle(dummy).color;
        };

        this.themeColors = {
            center: getRGB("--text-accent"),
            edge: getRGB("--divider-color"),
            highlight: getRGB("--interactive-accent"),
            semantic: getRGB("--text-faint"),
            structural: getRGB("--text-muted")
        };

        this.containerEl.removeChild(dummy);

        // Apply visual logic via Sigma reducers (state-driven rendering)
        this.sigmaInstance?.setSetting("nodeReducer", (node, data) => {
            const res = { ...data };
            const type = data.nodeType as string;

            // Core type-based coloring
            res.color = this.themeColors[type] || this.themeColors.structural;

            // Visual RAG Highlighting logic
            if (this.contextPaths.size > 0) {
                if (this.contextPaths.has(node)) {
                    res.color = this.themeColors.highlight;
                    res.size = ((res.size as number) || 5) * 1.5;
                    res.zIndex = 10;
                } else {
                    res.color = this.adjustAlpha(res.color as string, 0.2); // Dim others
                    res.label = ""; // Hide labels for non-context nodes
                }
            }

            return res;
        });

        this.sigmaInstance?.setSetting("edgeReducer", (edge, data) => {
            const res = { ...data };
            res.color = this.themeColors.edge;

            // Dim edges not connected to highlighted nodes
            if (this.contextPaths.size > 0) {
                const [u, v] = this.graph.extremities(edge);
                if (!this.contextPaths.has(u) && !this.contextPaths.has(v)) {
                    res.color = this.adjustAlpha(res.color as string, 0.1);
                }
            }
            return res;
        });
    }

    /**
     * Helper to dim colors for background nodes.
     */
    private adjustAlpha(color: string, alpha: number): string {
        // Simple regex to inject alpha into rgb/rgba
        if (color.startsWith("rgba")) {
            return color.replace(/[\d.]+\)$/g, `${alpha})`);
        }
        return color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
    }

    /**
     * Updates the graph view for a specific file.
     * Includes debouncing, race protection, and smart panning.
     */
    async updateForFile(file: TFile | null) {
        if (!file || file.extension !== 'md') return;

        this.lastUpdateId++;
        const myUpdateId = this.lastUpdateId;

        // Don't update if hidden (tab in background)
        if (!this.isVisible) {
            this.pendingUpdatePath = file.path;
            return;
        }

        this.currentFilePath = file.path;

        // Smart Pan: If node already exists, instantly animate camera to it
        if (this.graph.hasNode(file.path)) {
            const camera = this.sigmaInstance?.getCamera();
            const pos = this.graph.getNodeAttributes(file.path);
            if (camera && pos) {
                void camera.animate({ x: pos.x as number, y: pos.y as number }, { duration: 600 });
            }
        }

        // Fetch new subgraph from worker
        // We pass current node positions to the worker so it can "seed" the force layout,
        // preventing graph rotation/drifting and maintaining mental maps.
        const existingPositions: Record<string, { x: number, y: number }> = {};
        this.graph.forEachNode((node, attr) => {
            existingPositions[node] = { x: attr.x as number, y: attr.y as number };
        });

        try {
            const sub = await this.graphService.getSemanticSubgraph(file.path, myUpdateId, existingPositions);

            // Verify we are still on the same update request (debounce/concurrency)
            if (this.lastUpdateId !== myUpdateId) return;

            // Atomic graph swap
            this.graph.clear();
            this.graph.import(sub);
            this.sigmaInstance?.refresh();
        } catch (e) {
            console.error("[SemanticGraphView] Failed to update graph", e);
        }
    }

    async onClose() {
        await Promise.resolve();
        this.containerResizer?.disconnect();
        this.visibilityObserver?.disconnect();
        this.sigmaInstance?.kill();
        this.sigmaInstance = null;
    }
}
