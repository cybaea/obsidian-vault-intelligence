import { IEmbeddingService, EmbeddingPriority } from "./IEmbeddingService";
import { LocalEmbeddingService } from "./LocalEmbeddingService";
import { GeminiEmbeddingService } from "./GeminiEmbeddingService";
import { VaultIntelligenceSettings } from "../settings/types";
import { Plugin } from "obsidian";
import { GeminiService } from "./GeminiService";
import { logger } from "../utils/logger";

export class RoutingEmbeddingService implements IEmbeddingService {
    private localService: LocalEmbeddingService;
    private geminiService: GeminiEmbeddingService;
    private settings: VaultIntelligenceSettings;

    constructor(plugin: Plugin, gemini: GeminiService, settings: VaultIntelligenceSettings) {
        this.settings = settings;
        this.localService = new LocalEmbeddingService(plugin, settings);
        this.geminiService = new GeminiEmbeddingService(gemini, settings);
    }

    public async initialize() {
        // We only initialize the local service if it's the current provider
        // or we can let it initialize on demand.
        if (this.settings.embeddingProvider === 'local') {
            await this.localService.initialize();
        }
    }

    get modelName(): string {
        return this.settings.embeddingModel;
    }

    get dimensions(): number {
        return this.settings.embeddingDimension;
    }

    private get currentService(): IEmbeddingService {
        if (this.settings.embeddingProvider === 'local') {
            return this.localService;
        }
        return this.geminiService;
    }

    async embedQuery(text: string, priority?: EmbeddingPriority): Promise<number[]> {
        logger.debug(`[RoutingEmbeddingService] Routing query to ${this.settings.embeddingProvider}`);
        return this.currentService.embedQuery(text, priority);
    }

    async embedDocument(text: string, title?: string, priority?: EmbeddingPriority): Promise<number[][]> {
        logger.debug(`[RoutingEmbeddingService] Routing document to ${this.settings.embeddingProvider}`);
        return this.currentService.embedDocument(text, title, priority);
    }

    updateConfiguration() {
        this.localService.updateConfiguration();
        // GeminiEmbeddingService doesn't have updateConfiguration yet but it uses settings directly
    }

    public terminate() {
        this.localService.terminate();
    }
}
