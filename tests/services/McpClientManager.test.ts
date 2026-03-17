import { App } from "obsidian";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { McpClientManager } from "../../src/services/McpClientManager";
import { VaultIntelligenceSettings, DEFAULT_SETTINGS, MCPServerConfig } from "../../src/settings/types";

// Mock global crypto for testing environment
const mockCryptoSubtle = {
    digest: vi.fn().mockImplementation(() => {
        return new Uint8Array([1, 2, 3, 4, 5]).buffer;
    })
};

Object.defineProperty(globalThis, 'crypto', {
    value: { subtle: mockCryptoSubtle },
});

// Mock localStorage
const mockLocalStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
};

Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
});

describe('McpClientManager', () => {
    let mockApp: App;
    let mockSettings: VaultIntelligenceSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockApp = {
            // Mock necessary app properties
        } as unknown as App;

        mockSettings = {
            ...DEFAULT_SETTINGS,
            mcpServers: []
        };
    });

    it('should calculate trust hash correctly for stdio servers', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const serverConfig = {
            args: ['index.js', '--flag'],
            command: 'node',
            enabled: true,
            env: '{"VAR": "test"}',
            id: 'test-server',
            name: 'Test Server',
            requireExplicitConfirmation: true,
            type: 'stdio' as const
        };

        // Note: this casts to access the private method for unit testing purposes
        const managerWithInternal = manager as unknown as { generateTrustHash(config: MCPServerConfig): Promise<string> };
        const hash = await managerWithInternal.generateTrustHash(serverConfig);
        
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
        expect(mockCryptoSubtle.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    });

    it('should correctly evaluate trust state (stdio is untrusted initially, sse and streamable_http are trusted)', () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const stdioConfig = { id: 'test-1', type: 'stdio' as const } as MCPServerConfig;
        const sseConfig = { id: 'test-2', type: 'sse' as const } as MCPServerConfig;
        const streamableHttpConfig = { id: 'test-3', type: 'streamable_http' as const } as MCPServerConfig;
        
        const stdioState = manager.checkTrustState(stdioConfig);
        expect(stdioState.trusted).toBe(false);

        const sseState = manager.checkTrustState(sseConfig);
        expect(sseState.trusted).toBe(true);

        const streamableHttpState = manager.checkTrustState(streamableHttpConfig);
        expect(streamableHttpState.trusted).toBe(true);
    });

    it('should block remote connections if SSRF protection is triggered', async () => {
        mockSettings.allowLocalNetworkAccess = false;
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const sseConfig = { id: 'test-sse-ssrf', name: 'Test SSRF SSE', type: 'sse' as const, url: 'http://127.0.0.1:8000' } as MCPServerConfig;
        const streamableHttpConfig = { id: 'test-http-ssrf', name: 'Test SSRF HTTP', type: 'streamable_http' as const, url: 'http://localhost:8000' } as MCPServerConfig;
        
        // Note: this casts to access the private method for unit testing purposes
        const managerWithInternal = manager as unknown as { 
            connectServer(config: MCPServerConfig): Promise<void>; 
            connections: Map<string, { status: string; errorMessage?: string; }>;
        };
        
        await managerWithInternal.connectServer(sseConfig);
        let connection = managerWithInternal.connections.get(sseConfig.id);
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Connection blocked by Local Network Access security settings');
        
        await managerWithInternal.connectServer(streamableHttpConfig);
        connection = managerWithInternal.connections.get(streamableHttpConfig.id);
        expect(connection?.status).toBe('error');
        expect(connection?.errorMessage).toContain('Connection blocked by Local Network Access security settings');
    });
});
