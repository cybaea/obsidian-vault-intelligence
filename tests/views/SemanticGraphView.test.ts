import { WorkspaceLeaf } from 'obsidian';
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
                on: vi.fn()
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
            return {
                getCamera: vi.fn().mockReturnValue({ animatedReset: vi.fn() }),
                kill: vi.fn(),
                on: vi.fn(),
                refresh: vi.fn(),
                setSetting: vi.fn()
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
        const sigmaCallConfig = callArgs[2] as { allowInvalidContainer: boolean };
        expect(sigmaCallConfig.allowInvalidContainer).toBe(true);
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
