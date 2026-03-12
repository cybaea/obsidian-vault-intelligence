import { VaultIntelligenceSettings, IVaultIntelligencePlugin } from "../settings/types";
import { EmbeddingPriority, IEmbeddingClient, IModelProvider } from "../types/providers";
import { logger } from "../utils/logger";
import { GeminiProvider } from "./GeminiProvider";
import { LocalEmbeddingService } from "./LocalEmbeddingService";

/**
 * Handles routing of embedding requests to either local (WASM) or remote (Gemini) providers.
 */
export class RoutingEmbeddingService implements IEmbeddingClient, IModelProvider {
    public readonly supportsTools = false;
    public readonly supportsStructuredOutput = false;
    public readonly supportsWebGrounding = false;
    public supportsCodeExecution = false;

    private localService: LocalEmbeddingService;
    private geminiService: GeminiProvider;
    private settings: VaultIntelligenceSettings;

    constructor(plugin: IVaultIntelligencePlugin, gemini: GeminiProvider, settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.localService = new LocalEmbeddingService(plugin, settings);
        this.geminiService = gemini;
    }

    public async initialize(): Promise<void> {
        // We only initialize the local service if it's the current provider
        if (this.settings.embeddingProvider === 'local') {
            await this.localService.initialize();
        }
    }

    public async terminate(): Promise<void> {
        // Safely kill local service workers on shutdown
        await this.localService.terminate();
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    private get currentService(): IEmbeddingClient {
        if (this.settings.embeddingProvider === 'local') {
            return this.localService;
        }
        return this.geminiService;
    }

    async embedQuery(text: string, priority?: EmbeddingPriority): Promise<{ vector: number[], tokenCount: number }> {
        logger.debug(`[RoutingEmbeddingService] Routing query to ${this.settings.embeddingProvider} (${this.modelName})`);
        return this.currentService.embedQuery(text, priority);
    }

    async embedDocument(text: string, title?: string, priority?: EmbeddingPriority): Promise<{ vectors: number[][], tokenCount: number }> {
        logger.debug(`[RoutingEmbeddingService] Routing document to ${this.settings.embeddingProvider} (${this.modelName})`);
        return this.currentService.embedDocument(text, title, priority);
    }

    updateConfiguration() {
        if (this.localService.updateConfiguration) {
            this.localService.updateConfiguration();
        }
    }

    public async forceRedownload(): Promise<void> {
        if (this.settings.embeddingProvider === 'local') {
            await this.localService.forceRedownload();
        }
    }
}
