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
    private contextPaths: Set<string> = new Set();
    private themeColors: Record<string, string> = {};
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: IVaultIntelligencePlugin, graphService: GraphService) {
        super(leaf);
        this.plugin = plugin;
        this.graphService = graphService;

        // Auto-refresh graph when a background index finishes
        this.registerEvent(
            this.graphService.on('graph:index-updated', () => {
                const file = this.app.workspace.getActiveFile();
                void this.updateForFile(file, true); // Force repaint
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

    private wrapperEl: HTMLElement;

    async onOpen() {
        await Promise.resolve();

        // 1. Strict Obsidian Flexbox Container
        this.contentEl.empty();
        this.contentEl.setCssStyles({
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "0"
        });

        this.wrapperEl = this.contentEl.createDiv({ cls: "semantic-graph-wrapper" });
        this.wrapperEl.setCssStyles({
            backgroundColor: "transparent",
            flex: "1 1 auto",
            height: "100%",
            position: "relative",
            width: "100%"
        });

        // 2. Observer: Initialize Sigma ONLY when container has dimensions
        this.containerResizer = new ResizeObserver(() => {
            if (this.wrapperEl.clientWidth > 0 && this.wrapperEl.clientHeight > 0) {
                if (!this.sigmaInstance) {
                    console.debug(`[SemanticGraphView] Container ready (${this.wrapperEl.clientWidth}x${this.wrapperEl.clientHeight}). Initializing WebGL.`);
                    this.initSigma();
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) void this.updateForFile(activeFile, true);
                } else {
                    this.sigmaInstance.refresh();
                }
            }
        });
        this.containerResizer.observe(this.wrapperEl);

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
                    this.sigmaInstance.refresh();
                }
            })
        );
    }

    private initSigma() {
        this.sigmaInstance = new Sigma(this.graph, this.wrapperEl, {
            defaultEdgeType: "line",
            defaultNodeType: "circle",
            labelColor: { color: "#888" },
            labelFont: "inherit",
            labelSize: 12,
            labelWeight: "normal",
            renderLabels: true
        });

        this.resolveThemeColors();

        this.sigmaInstance.on("clickNode", (event) => {
            const nodeEvent = event as { node: string };
            const file = this.app.vault.getAbstractFileByPath(nodeEvent.node);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(file);
            }
        });

        this.sigmaInstance.on("enterNode", (event) => {
            const nodeEvent = event as unknown as { event: MouseEvent; node: string };
            const file = this.app.vault.getAbstractFileByPath(nodeEvent.node);
            if (file instanceof TFile) {
                (this.app.workspace as Events).trigger("hover-link", {
                    event: nodeEvent.event,
                    hoverParent: this.wrapperEl,
                    linktext: nodeEvent.node,
                    source: VIEW_TYPES.SEMANTIC_GRAPH,
                    sourcePath: this.currentFilePath || "",
                    targetEl: null
                });
            }
        });

        this.sigmaInstance.on("clickStage", () => {
            if (this.contextPaths.size > 0) {
                this.contextPaths.clear();
                this.sigmaInstance?.refresh();
            }
        });
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
            center: getComputedColor("--text-accent", "rgb(100, 100, 255)"),
            edge: getComputedColor("--background-modifier-border", "rgb(100, 100, 100)"),
            highlight: getComputedColor("--interactive-accent", "rgb(255, 200, 0)"),
            semantic: getComputedColor("--text-faint", "rgb(150, 150, 150)"),
            structural: getComputedColor("--text-muted", "rgb(200, 200, 200)")
        };

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

            // Optional: apply different styles based on edgeType if needed in the future
            // const edgeType = data.edgeType as string; 

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
        if (!color) return `rgba(150, 150, 150, ${alpha})`;
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
                    const sub = await this.graphService.getSemanticSubgraph(file.path, myUpdateId, existingPositions);

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

                    // Center the camera on the active node!
                    if (this.graph.hasNode(file.path)) {
                        const pos = this.graph.getNodeAttributes(file.path);
                        const camera = this.sigmaInstance?.getCamera();
                        if (camera && pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
                            // Animate if we already had a position, otherwise instantly snap
                            if (existingPositions[file.path]) {
                                void camera.animate({ ratio: 1.2, x: pos.x, y: pos.y }, { duration: 500 });
                            } else {
                                camera.setState({ ratio: 1.2, x: pos.x, y: pos.y });
                            }
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
        this.sigmaInstance?.kill();
        this.sigmaInstance = null;
    }
}
