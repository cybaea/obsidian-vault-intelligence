import type Graph from 'graphology';
import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types';

import { TFile, WorkspaceLeaf } from 'obsidian';
import Sigma from 'sigma';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

import { GraphService } from '../../src/services/GraphService';
import { IVaultIntelligencePlugin } from '../../src/settings/types';
import { SemanticGraphView } from '../../src/views/SemanticGraphView';

vi.mock('obsidian', () => {
    class MockItemView {
        leaf: unknown;
        contentEl = {
            clientHeight: 100,
            clientWidth: 100,
            createDiv: vi.fn().mockReturnValue({
                addEventListener: vi.fn(),
                clientHeight: 100,
                clientWidth: 100,
                createEl: vi.fn().mockReturnValue({ 
                    addEventListener: vi.fn(), 
                    setCssStyles: vi.fn(),
                    setText: vi.fn()
                }),
                createSpan: vi.fn().mockReturnValue({ setCssStyles: vi.fn(), setText: vi.fn() }),
                setCssStyles: vi.fn()
            }),
            empty: vi.fn(),
            setCssStyles: vi.fn()
        };
        app = {
            vault: {
                getAbstractFileByPath: vi.fn()
            },
            workspace: {
                getActiveFile: vi.fn(),
                getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
                on: vi.fn(),
                trigger: vi.fn()
            }
        };
        constructor(leaf: unknown) {
            this.leaf = leaf;
        }
        registerEvent = vi.fn();
    }
    return {
        debounce: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
        ItemView: MockItemView,
        Menu: class {
            addItem = vi.fn();
            showAtMouseEvent = vi.fn();
        },
        TFile: class {},
        WorkspaceLeaf: class {}
    };
});

vi.mock('sigma', () => {
    return {
        default: vi.fn().mockImplementation(function() {
            // Sigma v4 camera API surface used by the view
            return {
                getCamera: vi.fn().mockReturnValue({ animate: vi.fn(), reset: vi.fn() }),
                kill: vi.fn(),
                on: vi.fn(),
                refresh: vi.fn()
            };
        })
    };
});

describe('SemanticGraphView Lifecycle', () => {
    let view: SemanticGraphView;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockGraphService: GraphService;
    let mockLeaf: WorkspaceLeaf;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLeaf = {} as WorkspaceLeaf;
        mockPlugin = {} as IVaultIntelligencePlugin;
        mockGraphService = {
            getSemanticSubgraph: vi.fn().mockResolvedValue({ order: 10 }),
            on: vi.fn()
        } as unknown as GraphService;
        
        view = new SemanticGraphView(mockLeaf, mockPlugin, mockGraphService);
        
        // Mock Observers
        globalThis.ResizeObserver = vi.fn().mockImplementation(function() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn(),
            };
        });
        
        globalThis.IntersectionObserver = vi.fn().mockImplementation(function() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn()
            };
        });

        vi.stubGlobal('document', {
            body: {
                appendChild: vi.fn(),
                createDiv: vi.fn().mockReturnValue({
                    remove: vi.fn(),
                    style: { color: '' }
                })
            }
        });
        
        vi.stubGlobal('getComputedStyle', vi.fn().mockReturnValue({ color: '#ffffff' }));
    });

    it('should initialize correctly without crashing on 0x0 container', async () => {
        // Mock container to be 0x0 size
        view.contentEl.createDiv = vi.fn().mockReturnValue({
            addEventListener: vi.fn(),
            clientHeight: 0,
            clientWidth: 0,
            createEl: vi.fn().mockReturnValue({ addEventListener: vi.fn() }),
            createSpan: vi.fn().mockReturnValue({ setCssStyles: vi.fn(), setText: vi.fn() }),
            setCssStyles: vi.fn()
        });
        
        await view.onOpen();
        
        expect(Sigma).toHaveBeenCalled();
        const callArgs = (Sigma as Mock).mock.calls[0];
        if (!callArgs) throw new Error("Sigma mock call missing");
        const sigmaCallConfig = callArgs[2] as {
            edgeReducer: unknown,
            nodeReducer: unknown,
            settings: { allowInvalidContainer: boolean, itemSizesReference: string, renderEdgeLabels: boolean }
        };
        // Sigma v4: reducers are constructor options and display settings are nested
        expect(sigmaCallConfig.settings.allowInvalidContainer).toBe(true);
        expect(sigmaCallConfig.settings.itemSizesReference).toBe('screen');
        expect(sigmaCallConfig.settings.renderEdgeLabels).toBe(true);
        expect(sigmaCallConfig.nodeReducer).toBeTypeOf('function');
        expect(sigmaCallConfig.edgeReducer).toBeTypeOf('function');
    });

    it('should handle IntersectionObserver visibility changes to resume updates', async () => {
        await view.onOpen();
        
        const IntersectionObserverMock = globalThis.IntersectionObserver as Mock;
        
        // Grab the intersection observer callback
        const ioCallArgs = IntersectionObserverMock.mock.calls[0];
        if (!ioCallArgs) throw new Error("IntersectionObserver mock call missing");
        const ioCallback = ioCallArgs[0] as (entries: Array<{ isIntersecting: boolean }>) => void;
        
        // Trigger visibility
        ioCallback([{ isIntersecting: true }]);
        
        const exposedView = view as unknown as { isVisible: boolean, sigmaInstance: { refresh: () => void } };
        expect(exposedView.isVisible).toBe(true);
        expect(exposedView.sigmaInstance.refresh).toHaveBeenCalled();
    });

    it('should clean up observers and sigma instance on close', async () => {
        await view.onOpen();
        await view.onClose();
        
        const exposedView = view as unknown as { containerResizer: { disconnect: () => void }, visibilityObserver: { disconnect: () => void }, sigmaInstance: unknown };
        expect(exposedView.containerResizer.disconnect).toHaveBeenCalled();
        expect(exposedView.visibilityObserver.disconnect).toHaveBeenCalled();
        // Since we killed sigma, the reference should be null
        expect(exposedView.sigmaInstance).toBeNull();
    });
});

/**
 * The view's reducers are sigma v4 `NodeReducer`/`EdgeReducer` class fields.
 * They only consume (key, data, attrs), so the exposed fields are typed with
 * this reduced three-argument signature for testing.
 */
type NodeReducer3 = (node: string, data: NodeDisplayData, attrs: Record<string, unknown>) => Partial<NodeDisplayData>;
type EdgeReducer3 = (edge: string, data: EdgeDisplayData, attrs: Record<string, unknown>) => Partial<EdgeDisplayData>;

const makeNodeData = (label: string): NodeDisplayData => ({
    color: '#666666',
    depth: 'nodes',
    highlighted: false,
    label,
    labelColor: '#000000',
    labelDepth: 'nodes',
    labelVisibility: 'auto',
    opacity: 1,
    size: 10,
    visibility: 'visible',
    x: 0,
    y: 0,
    zIndex: 0
});

const makeEdgeData = (): EdgeDisplayData => ({
    color: '#cccccc',
    depth: 'edges',
    label: '',
    labelColor: '#666666',
    labelDepth: 'edges',
    labelVisibility: 'auto',
    opacity: 1,
    size: 1,
    visibility: 'visible',
    zIndex: 0
});

describe('SemanticGraphView sigma v4 reducers', () => {
    let view: SemanticGraphView;
    let mockPlugin: IVaultIntelligencePlugin;
    let mockGraphService: GraphService;
    let mockLeaf: WorkspaceLeaf;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLeaf = {} as WorkspaceLeaf;
        mockPlugin = {} as IVaultIntelligencePlugin;
        mockGraphService = {
            getSemanticSubgraph: vi.fn().mockResolvedValue({ order: 10 }),
            on: vi.fn()
        } as unknown as GraphService;

        view = new SemanticGraphView(mockLeaf, mockPlugin, mockGraphService);

        globalThis.ResizeObserver = vi.fn().mockImplementation(function() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn(),
            };
        });

        globalThis.IntersectionObserver = vi.fn().mockImplementation(function() {
            return {
                disconnect: vi.fn(),
                observe: vi.fn(),
                unobserve: vi.fn()
            };
        });

        vi.stubGlobal('document', {
            body: {
                appendChild: vi.fn(),
                createDiv: vi.fn().mockReturnValue({
                    remove: vi.fn(),
                    style: { color: '' }
                })
            }
        });

        // Every theme color resolves to #ffffff, so reducer output is deterministic
        vi.stubGlobal('getComputedStyle', vi.fn().mockReturnValue({ color: '#ffffff' }));
    });

    it('should style node labels and colors via the node reducer', async () => {
        await view.onOpen();

        const exposedView = view as unknown as { nodeReducer: NodeReducer3 };
        const result = exposedView.nodeReducer('note.md', makeNodeData('Note'), { nodeType: 'center', topics: ['default'] });

        expect(result.color).toBe('#ffffff');
        expect(result.labelColor).toBe('#ffffff');
        // The interface font falls back when it cannot be resolved (mocked DOM)
        expect(result.labelFont).toBe('600 Inter, sans-serif');
        expect(result.labelSize).toBe(24);
    });

    it('should override node colors by topic', async () => {
        await view.onOpen();

        const exposedView = view as unknown as { nodeReducer: NodeReducer3 };
        const result = exposedView.nodeReducer('note.md', makeNodeData('Note'), { nodeType: 'semantic', topics: ['machine-learning'] });

        expect(result.color).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
    });

    it('should dim and hide labels of nodes outside the RAG context', async () => {
        await view.onOpen();

        const exposedView = view as unknown as { contextPaths: Set<string>, nodeReducer: NodeReducer3 };
        exposedView.contextPaths = new Set(['other.md']);

        const result = exposedView.nodeReducer('note.md', makeNodeData('Note'), { nodeType: 'structural' });

        expect(result.color).toBe('rgba(255, 255, 255, 0.2)');
        expect(result.labelVisibility).toBe('hidden');
    });

    it('should emphasize the hovered node with a themed backdrop', async () => {
        await view.onOpen();

        const exposedView = view as unknown as {
            graph: Graph,
            hoveredNode: string | null,
            nodeReducer: NodeReducer3
        };
        exposedView.graph.addNode('hovered.md', { x: 0, y: 0 });
        exposedView.hoveredNode = 'hovered.md';

        const longLabel = 'A'.repeat(40);
        const result = exposedView.nodeReducer('hovered.md', makeNodeData(longLabel), { nodeType: 'center' });

        expect(result.highlighted).toBe(true);
        expect(result.size).toBe(18); // 10 * 1.8 hover boost
        expect(result.zIndex).toBe(20);
        // The full label is shown even beyond the truncation length
        expect(result.label).toBe(longLabel);
        expect(result.labelVisibility).toBe('visible');
        expect(result.backdropVisibility).toBe('visible');
        expect(result.backdropColor).toBe('#ffffff');
    });

    it('should truncate long labels when not highlighted', async () => {
        await view.onOpen();

        const exposedView = view as unknown as { nodeReducer: NodeReducer3 };
        const result = exposedView.nodeReducer('note.md', makeNodeData('A'.repeat(40)), { nodeType: 'structural' });

        expect(result.label).toBe(`${'A'.repeat(30)}...`);
    });

    it('should annotate edges adjacent to the hovered node via the edge reducer', async () => {
        await view.onOpen();

        const exposedView = view as unknown as {
            edgeReducer: EdgeReducer3,
            graph: Graph,
            hoveredNode: string | null
        };
        exposedView.graph.addNode('a.md', { x: 0, y: 0 });
        exposedView.graph.addNode('b.md', { x: 0, y: 0 });
        exposedView.graph.addNode('c.md', { x: 0, y: 0 });
        const semanticKey = exposedView.graph.addEdge('a.md', 'b.md');
        const structuralKey = exposedView.graph.addEdge('a.md', 'c.md');
        exposedView.hoveredNode = 'a.md';

        const hoveredSemantic = exposedView.edgeReducer(semanticKey, makeEdgeData(), { edgeType: 'semantic', score: 0.85 });
        const hoveredStructural = exposedView.edgeReducer(structuralKey, makeEdgeData(), { edgeType: 'structural' });

        expect(hoveredSemantic.label).toBe('Semantic Match (85%)');
        expect(hoveredSemantic.color).toBe('#ffffff');
        expect(hoveredSemantic.size).toBe(1.5);
        expect(hoveredStructural.label).toBe('Linked');
        expect(hoveredStructural.labelColor).toBe('#ffffff');
    });

    it('should dim non-neighbor nodes while hovering', async () => {
        await view.onOpen();

        const exposedView = view as unknown as {
            graph: Graph,
            hoveredNode: string | null,
            nodeReducer: NodeReducer3
        };
        exposedView.graph.addNode('hovered.md', { x: 0, y: 0 });
        exposedView.graph.addNode('far.md', { x: 10, y: 10 });
        exposedView.hoveredNode = 'hovered.md';

        const result = exposedView.nodeReducer('far.md', makeNodeData('Far'), { nodeType: 'structural' });

        expect(result.color).toBe('rgba(255, 255, 255, 0.2)');
        expect(result.labelVisibility).toBe('hidden');
        expect(result.highlighted).toBe(false);
    });

    it('should dim edges outside the RAG context', async () => {
        await view.onOpen();

        const exposedView = view as unknown as {
            contextPaths: Set<string>,
            edgeReducer: EdgeReducer3,
            graph: Graph
        };
        exposedView.graph.addNode('a.md', { x: 0, y: 0 });
        exposedView.graph.addNode('b.md', { x: 0, y: 0 });
        const edgeKey = exposedView.graph.addEdge('a.md', 'b.md');
        exposedView.contextPaths = new Set(['other.md']);

        const result = exposedView.edgeReducer(edgeKey, makeEdgeData(), { edgeType: 'structural' });

        expect(result.color).toBe('rgba(255, 255, 255, 0.1)');
    });

    it('should dim edges away from the hovered node', async () => {
        await view.onOpen();

        const exposedView = view as unknown as {
            edgeReducer: EdgeReducer3,
            graph: Graph,
            hoveredNode: string | null
        };
        exposedView.graph.addNode('a.md', { x: 0, y: 0 });
        exposedView.graph.addNode('b.md', { x: 0, y: 0 });
        exposedView.graph.addNode('c.md', { x: 0, y: 0 });
        const edgeKey = exposedView.graph.addEdge('b.md', 'c.md');
        exposedView.hoveredNode = 'a.md';

        const result = exposedView.edgeReducer(edgeKey, makeEdgeData(), { edgeType: 'structural' });

        expect(result.labelVisibility).toBe('hidden');
        expect(result.color).toBe('rgba(255, 255, 255, 0.1)');
    });

    it('should open the clicked note', async () => {
        await view.onOpen();

        const tf = new TFile();
        (view.app.vault.getAbstractFileByPath as Mock).mockReturnValue(tf);
        const openFile = vi.fn();
        (view.app.workspace.getLeaf as Mock).mockReturnValue({ openFile });

        const onMock = (view as unknown as { sigmaInstance: { on: Mock } }).sigmaInstance.on;
        const clickHandler = onMock.mock.calls.find(c => c[0] === 'clickNode')?.[1] as (payload: { node: string }) => void;
        clickHandler({ node: 'note.md' });

        expect(openFile).toHaveBeenCalledWith(tf);
    });

    it('should trigger hover previews on node enter and clear on leave', async () => {
        // MouseEvent is unavailable in the node test environment
        class FakeMouseEvent { }
        vi.stubGlobal('MouseEvent', FakeMouseEvent);
        await view.onOpen();

        const tf = new TFile();
        (view.app.vault.getAbstractFileByPath as Mock).mockReturnValue(tf);

        const exposedView = view as unknown as {
            hoveredNode: string | null,
            sigmaInstance: { on: Mock }
        };
        const onMock = exposedView.sigmaInstance.on;
        const enterHandler = onMock.mock.calls.find(c => c[0] === 'enterNode')?.[1] as (payload: { event: { original: unknown }, node: string }) => void;
        const leaveHandler = onMock.mock.calls.find(c => c[0] === 'leaveNode')?.[1] as () => void;

        enterHandler({ event: { original: new FakeMouseEvent() }, node: 'note.md' });

        expect(exposedView.hoveredNode).toBe('note.md');
        expect(view.app.workspace.trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ linktext: 'note.md' }));

        leaveHandler();
        expect(exposedView.hoveredNode).toBeNull();
        vi.unstubAllGlobals();
    });

    it('should re-apply theme colors when the theme changes', async () => {
        await view.onOpen();

        const refresh = (view as unknown as { sigmaInstance: { refresh: Mock } }).sigmaInstance.refresh;
        refresh.mockClear();
        const workspaceOn = view.app.workspace.on as Mock;
        const cssHandler = workspaceOn.mock.calls.find(c => c[0] === 'css-change')?.[1] as () => void;

        cssHandler();

        expect(refresh).toHaveBeenCalled();
    });
});
