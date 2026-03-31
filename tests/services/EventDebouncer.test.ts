/* eslint-disable eslint-comments/disable-enable-pair -- Test file does not require enable pairs */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Mocking internal services for tests requires any */
/* eslint-disable @typescript-eslint/no-unsafe-return -- Mocking internal services for tests requires any */
/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- Mocking TFile requires casting */
import { Events, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventDebouncer } from '../../src/services/EventDebouncer';

describe('EventDebouncer', () => {
    let debouncer: EventDebouncer;
    let mockApp: any;
    let mockVaultManager: any;
    let mockEventBus: Events;
    let mockSettings: any;
    let onChunkReady: any;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getActiveFile: vi.fn(),
            },
        };

        mockVaultManager = {
            getFileByPath: vi.fn(),
            onDelete: vi.fn(),
            onModify: vi.fn(),
            onRename: vi.fn(),
        };

        mockEventBus = new Events();
        mockSettings = {
            excludedFolders: [],
            indexingDelayMs: 10,
        };

        onChunkReady = vi.fn().mockResolvedValue(undefined);

        debouncer = new EventDebouncer(
            mockApp,
            mockVaultManager,
            mockEventBus,
            () => mockSettings,
            onChunkReady
        );

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('should debounce file updates', async () => {
        const mockFile = { path: 'test.md', stat: { size: 100 } } as unknown as TFile;
        mockApp.workspace.getActiveFile.mockReturnValue(null);

        (debouncer as any).debounceUpdate('test.md', mockFile);

        expect(onChunkReady).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();
        expect(onChunkReady).toHaveBeenCalledWith([mockFile]);
    });

    it('should handle active file updates with different delay', async () => {
        const mockFile = { path: 'active.md', stat: { size: 100 } } as unknown as TFile;
        mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

        (debouncer as any).debounceUpdate('active.md', mockFile);

        await vi.runAllTimersAsync();
        expect(onChunkReady).toHaveBeenCalledWith([mockFile]);
    });

    it('should buffer updates when paused (backpressure)', async () => {
        const mockFile = { path: 'test.md', stat: { size: 100 } } as unknown as TFile;
        
        debouncer.pause();
        await debouncer.processBatch([mockFile]);

        expect(onChunkReady).not.toHaveBeenCalled();

        debouncer.resume();
        expect(onChunkReady).toHaveBeenCalledWith([mockFile]);
    });

    it('should chunk large batches', async () => {
        const files: TFile[] = [];
        for (let i = 0; i < 60; i++) {
            files.push({ path: `file${i}.md`, stat: { size: 100 } } as unknown as TFile);
        }

        await debouncer.processBatch(files);

        // Should be called twice: once for first 50, then for remaining 10
        expect(onChunkReady).toHaveBeenCalledTimes(2);
        expect(onChunkReady.mock.calls[0][0].length).toBe(50);
        expect(onChunkReady.mock.calls[1][0].length).toBe(10);
    });

    it('should chunk by size', async () => {
        const largeFile = { path: 'large.md', stat: { size: 6 * 1024 * 1024 } } as unknown as TFile; // 6MB
        const smallFile = { path: 'small.md', stat: { size: 100 } } as unknown as TFile;

        await debouncer.processBatch([largeFile, smallFile]);

        expect(onChunkReady).toHaveBeenCalledTimes(2);
    });

    it('should identify excluded paths', () => {
        mockSettings.excludedFolders = ['excluded/'];
        
        expect(debouncer.isPathExcluded('excluded/file.md')).toBe(true);
        expect(debouncer.isPathExcluded('safe/file.md')).toBe(false);
        expect(debouncer.isPathExcluded('.vault-intelligence/config.json')).toBe(true);
    });

    it('should flush pending updates', async () => {
        const mockFile = { path: 'test.md', stat: { size: 100 } } as unknown as TFile;
        (debouncer as any).pendingBackgroundUpdates.set('test.md', mockFile);

        await debouncer.flushPending();

        expect(onChunkReady).toHaveBeenCalledWith([mockFile]);
        expect((debouncer as any).pendingBackgroundUpdates.size).toBe(0);
    });
});
