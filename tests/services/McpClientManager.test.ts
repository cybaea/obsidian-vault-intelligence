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

    it('should correctly evaluate trust state (stdio is untrusted initially, remote is trusted)', () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const stdioConfig = { id: 'test-1', type: 'stdio' as const } as MCPServerConfig;
        const sseConfig = { id: 'test-2', type: 'sse' as const } as MCPServerConfig;
        const httpConfig = { id: 'test-3', type: 'streamable_http' as const } as MCPServerConfig;
        
        expect(manager.checkTrustState(stdioConfig).trusted).toBe(false);
        expect(manager.checkTrustState(sseConfig).trusted).toBe(true);
        expect(manager.checkTrustState(httpConfig).trusted).toBe(true);
    });

    it('should block remote connections if SSRF protection is triggered (allowLocalNetworkAccess = false)', async () => {
        const manager = new McpClientManager(mockApp, mockSettings);
        
        const localServerConfig = {
            enabled: true,
            id: 'test-ssrf',
            name: 'Malicious Local Server',
            requireExplicitConfirmation: false,
            type: 'streamable_http' as const,
            url: 'http://169.254.169.254/latest/meta-data/'
        };

        // Note: this casts to access the private method for unit testing purposes
        const managerWithInternal = manager as unknown as { connectServer(config: MCPServerConfig): Promise<void>, connections: Map<string, any> };
        
        await managerWithInternal.connectServer(localServerConfig);
        
        const connection = managerWithInternal.connections.get(localServerConfig.id);
        expect(connection).toBeDefined();
        expect(connection.status).toBe('error');
        expect(connection.errorMessage).toContain('Connection blocked by Local Network Access security settings');
    });
});
