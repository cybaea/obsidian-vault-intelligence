import { VaultIntelligenceSettings, IVaultIntelligencePlugin } from "../settings/types";
import { EmbeddingPriority, IEmbeddingClient, IProvider } from "../types/providers";
import { logger } from "../utils/logger";
import { GeminiProvider } from "./GeminiProvider";
import { LocalEmbeddingService } from "./LocalEmbeddingService";
import { OllamaProvider } from "./OllamaProvider";

/**
 * Handles routing of embedding requests to either local (WASM) or remote (Gemini) providers.
 */
export class RoutingEmbeddingService implements IEmbeddingClient, IProvider {

    private localService: LocalEmbeddingService;
    private geminiService: GeminiProvider;
    private ollamaService: OllamaProvider;
    private settings: VaultIntelligenceSettings;

    constructor(plugin: IVaultIntelligencePlugin, gemini: GeminiProvider, settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.localService = new LocalEmbeddingService(plugin, settings);
        this.geminiService = gemini;
        this.ollamaService = new OllamaProvider(settings, plugin.app);
    }

    public async initialize(): Promise<void> {
        if (this.settings.embeddingModel.startsWith('local/')) {
            await this.localService.initialize();
        }
    }

    public async terminate(): Promise<void> {
        await this.localService.terminate();
        if (this.ollamaService.terminate) {
            await this.ollamaService.terminate();
        }
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    private get currentService(): IEmbeddingClient {
        const model = this.settings.embeddingModel;
        if (model.startsWith('ollama/')) {
            return this.ollamaService;
        }
        if (model.startsWith('local/')) {
            return this.localService;
        }
        return this.geminiService;
    }

    async embedQuery(text: string, priority?: EmbeddingPriority): Promise<{ vector: number[], tokenCount: number }> {
        logger.debug(`[RoutingEmbeddingService] Routing query to ${this.modelName}`);
        return this.currentService.embedQuery(text, priority);
    }

    async embedDocument(text: string, title?: string, priority?: EmbeddingPriority): Promise<{ vectors: number[][], tokenCount: number }> {
        logger.debug(`[RoutingEmbeddingService] Routing document to ${this.modelName}`);
        return this.currentService.embedDocument(text, title, priority);
    }

    async embedChunks(texts: string[], title?: string, priority?: EmbeddingPriority): Promise<{ tokenCount: number; vectors: number[][] }> {
        if (this.currentService.embedChunks) {
            return this.currentService.embedChunks(texts, title, priority);
        }
        // Fallback for providers that don't implement batching
        const vectors: number[][] = [];
        let totalTokens = 0;
        for (const t of texts) {
            const res = await this.currentService.embedDocument(t, title, priority);
            vectors.push(res.vectors[0] || []);
            totalTokens += res.tokenCount;
        }
        return { tokenCount: totalTokens, vectors };
    }

    updateConfiguration() {
        if (this.localService.updateConfiguration) {
            this.localService.updateConfiguration();
        }
    }

    public async forceRedownload(): Promise<void> {
        if (this.settings.embeddingModel.startsWith('local/')) {
            await this.localService.forceRedownload();
        }
    }
}
