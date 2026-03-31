import { GRAPH_CONSTANTS } from "../constants";
import { VaultIntelligenceSettings } from "../settings/types";
import { WorkerConfig } from "../types/graph";
import { logger } from "../utils/logger";
import { OntologyService } from "./OntologyService";
import { PersistenceManager } from "./PersistenceManager";
import { WorkerManager } from "./WorkerManager";

export class WorkerLifecycleManager {
    private workerManager: WorkerManager;
    private persistenceManager: PersistenceManager;
    private ontologyService: OntologyService;
    private settings: VaultIntelligenceSettings;

    // Persistence state
    private saveTimeout: number | undefined = undefined;
    private savePromise: Promise<void> | null = null;
    
    // Lifecycle states
    public isNodeRunning = false;

    constructor(
        workerManager: WorkerManager,
        persistenceManager: PersistenceManager,
        ontologyService: OntologyService,
        settings: VaultIntelligenceSettings
    ) {
        this.workerManager = workerManager;
        this.persistenceManager = persistenceManager;
        this.ontologyService = ontologyService;
        this.settings = settings;
    }

    public async initializeWorker(forceWipe = false): Promise<boolean> {
        try {
            const config = this.buildWorkerConfig();
            await this.workerManager.initializeWorker(config);
            await this.persistenceManager.ensureGitignore();

            const needsForcedScan = await this.loadState();
            this.isNodeRunning = true;
            logger.info("[WorkerLifecycleManager] Worker Initialized.");
            
            return forceWipe || needsForcedScan;
        } catch (error) {
            logger.error("[WorkerLifecycleManager] Initialization failed:", error);
            throw new Error("Failed to initialize vault intelligence graph sync");
        }
    }

    private buildWorkerConfig(): WorkerConfig {
        const { dimension, id: modelId } = this.workerManager.activeModel;
        const activeModelId = modelId || this.settings.embeddingModel;
        const activeDimension = dimension || this.settings.embeddingDimension;

        return {
            agentLanguage: this.settings.agentLanguage,
            authorName: this.settings.authorName,
            chatModel: this.settings.chatModel,
            contextAwareHeaderProperties: this.settings.contextAwareHeaderProperties,
            embeddingChunkSize: this.settings.embeddingChunkSize,
            embeddingDimension: activeDimension,
            embeddingModel: activeModelId,
            implicitFolderSemantics: this.settings.implicitFolderSemantics,
            indexingDelayMs: this.settings.indexingDelayMs || GRAPH_CONSTANTS.DEFAULT_INDEXING_DELAY_MS,
            minSimilarityScore: this.settings.minSimilarityScore ?? 0.5,
            ontologyPath: this.settings.ontologyPath,
            sanitizedModelId: this.persistenceManager.getSanitizedModelId(activeModelId, activeDimension),
            semanticEdgeThickness: this.settings.semanticEdgeThickness || 0.5,
            semanticGraphNodeLimit: this.settings.semanticGraphNodeLimit || 250,
            structuralEdgeThickness: this.settings.structuralEdgeThickness || 1.0
        };
    }

    public async updateConfig(settings: VaultIntelligenceSettings) {
        this.settings = { ...settings };
        const api = this.workerManager.getApi();
        if (api) {
            await api.updateConfig({
                agentLanguage: settings.agentLanguage,
                authorName: settings.authorName,
                chatModel: settings.chatModel,
                contextAwareHeaderProperties: settings.contextAwareHeaderProperties,
                implicitFolderSemantics: settings.implicitFolderSemantics,
                indexingDelayMs: settings.indexingDelayMs,
                minSimilarityScore: settings.minSimilarityScore,
                ontologyPath: settings.ontologyPath,
                semanticEdgeThickness: settings.semanticEdgeThickness,
                semanticGraphNodeLimit: settings.semanticGraphNodeLimit,
                structuralEdgeThickness: settings.structuralEdgeThickness
            });
        }
    }
    
    public requestSave() {
        if (this.saveTimeout) return;
        this.saveTimeout = requestIdleCallback(() => {
            this.saveTimeout = undefined;
            void this.saveState();
        }, { timeout: GRAPH_CONSTANTS.IDLE_SAVE_TIMEOUT_MS });
    }

    public cancelPendingSave() {
        if (this.saveTimeout !== undefined) {
            cancelIdleCallback(this.saveTimeout);
            this.saveTimeout = undefined;
        }
    }

    public async saveState() {
        if (this.savePromise) return this.savePromise;
        const { dimension, id: modelId } = this.workerManager.activeModel;
        if (!dimension || !modelId) return;

        this.savePromise = this.workerManager.executeQuery(async (api) => {
            try {
                const stateBuffer = await api.saveIndex();
                await this.persistenceManager.saveState(stateBuffer, modelId, dimension);
            } catch (error) {
                logger.error("[WorkerLifecycleManager] Save failed:", error);
            } finally {
                this.savePromise = null;
            }
        });
        return this.savePromise;
    }
    
    public async loadState(): Promise<boolean> {
        const { dimension, id: modelId } = this.workerManager.activeModel;
        if (!dimension || !modelId) return false;

        const stateData = await this.persistenceManager.loadState(modelId, dimension);
        if (!stateData) return true; // Start fresh, needs scan

        return await this.workerManager.executeMutation(async (api) => {
            try {
                const success = await api.loadIndex(stateData);
                return !success;
            } catch (error) {
                logger.error("[WorkerLifecycleManager] Load failed:", error);
                return true;
            }
        });
    }

    public async shutdownWorker(): Promise<void> {
        this.cancelPendingSave();
        this.isNodeRunning = false;
        
        try {
            await this.workerManager.waitForIdle();
            await this.saveState();
        } catch (e) {
            logger.error("[WorkerLifecycleManager] Error during shutdown", e);
        } finally {
            this.workerManager.terminate();
        }
    }
    
    public async commitRestart(forceWipe = false): Promise<boolean> {
        this.cancelPendingSave();
        
        const { dimension: oldDimension, id: oldModelId } = this.workerManager.activeModel;
        if (oldDimension && oldModelId && !forceWipe) {
            await this.saveState();
        }

        this.workerManager.terminate();
        
        // Return whether we need a forced scan after restart
        return await this.initializeWorker(forceWipe);
    }
}
