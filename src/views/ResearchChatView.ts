import { ItemView, WorkspaceLeaf, ButtonComponent, TextAreaComponent, Notice, MarkdownRenderer, Menu, TFile, setIcon, DropdownComponent, ToggleComponent, normalizePath } from "obsidian";

import { VIEW_TYPES } from "../constants";
import VaultIntelligencePlugin from "../main";
import { AgentService, ChatMessage } from "../services/AgentService";
import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { IEmbeddingService } from "../services/IEmbeddingService";
import { ModelRegistry } from "../services/ModelRegistry";
import { VaultSearchResult } from "../types/search";
import { FileSuggest } from "./FileSuggest";

export class ResearchChatView extends ItemView {
    plugin: VaultIntelligencePlugin;
    gemini: GeminiService;
    graphService: GraphService;
    embeddingService: IEmbeddingService;
    agent: AgentService;
    private messages: ChatMessage[] = [];
    private isThinking = false;
    private temporaryModelId: string | null = null;
    private temporaryWriteAccess: boolean | null = null;
    private lastRenderId = 0;

    chatContainer: HTMLElement;
    inputComponent: TextAreaComponent;
    inputHistory: string[] = [];
    historyIndex = -1;
    private currentDraft = "";

    constructor(
        leaf: WorkspaceLeaf,
        plugin: VaultIntelligencePlugin,
        gemini: GeminiService,
        graphService: GraphService,
        embeddingService: IEmbeddingService
    ) {
        super(leaf);
        this.plugin = plugin;
        this.gemini = gemini;
        this.graphService = graphService;
        this.embeddingService = embeddingService;

        this.agent = new AgentService(plugin.app, gemini, graphService, embeddingService, plugin.settings);
        this.icon = "message-circle";
    }

    getViewType() {
        return VIEW_TYPES.RESEARCH_CHAT;
    }

    getDisplayText() {
        return "Researcher";
    }

    async onClose() {
        await Promise.resolve();
    }

    async onOpen() {
        await Promise.resolve();
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("research-chat-view");

        const header = container.createDiv({ cls: "chat-header" });
        header.createEl("h4", { cls: "chat-title", text: "Researcher" });

        const controls = header.createDiv({ cls: "chat-controls" });

        const writeContainer = controls.createDiv({ cls: "control-item" });
        writeContainer.createSpan({ cls: "control-label", text: "Write" });
        new ToggleComponent(writeContainer)
            .setValue(this.temporaryWriteAccess ?? this.plugin.settings.enableAgentWriteAccess)
            .setTooltip("Enable agent write access for this chat.")
            .onChange((val) => {
                this.temporaryWriteAccess = val;
            });

        const modelContainer = controls.createDiv({ cls: "control-item" });
        const modelDropdown = new DropdownComponent(modelContainer);
        const chatModels = ModelRegistry.getChatModels();
        for (const m of chatModels) {
            modelDropdown.addOption(m.id, m.label);
        }
        modelDropdown.addOption("custom", "Custom...");

        const currentModel = this.temporaryModelId ?? this.plugin.settings.chatModel;
        const isPreset = chatModels.some(m => m.id === currentModel);
        modelDropdown.setValue(isPreset ? currentModel : "custom");

        modelDropdown.onChange((val) => {
            if (val === "custom") {
                new Notice("Custom models should be configured in settings.");
                modelDropdown.setValue(this.temporaryModelId ?? (isPreset ? currentModel : "custom"));
                return;
            }
            this.temporaryModelId = val;
        });

        new ButtonComponent(controls)
            .setIcon("rotate-ccw")
            .setTooltip("Reset to defaults")
            .onClick(() => {
                this.temporaryModelId = null;
                this.temporaryWriteAccess = null;
                void this.onOpen();
                new Notice("Research settings reset");
            });

        new ButtonComponent(controls)
            .setIcon("trash")
            .setTooltip("Clear chat")
            .onClick(() => {
                this.messages = [];
                this.temporaryModelId = null;
                this.temporaryWriteAccess = null;
                void this.onOpen();
                new Notice("Chat cleared");
            });

        this.chatContainer = container.createDiv({ cls: "chat-container" });

        const inputContainer = container.createDiv({ cls: "input-container" });
        this.inputComponent = new TextAreaComponent(inputContainer);
        this.inputComponent.inputEl.addClass("chat-input");
        this.inputComponent.setPlaceholder("Ask your vault... (use @ to link notes)");

        this.inputComponent.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void this.handleSubmit();
            } else if (e.key === "ArrowUp") {
                if (this.historyIndex < this.inputHistory.length - 1) {
                    if (this.historyIndex === -1) {
                        this.currentDraft = this.inputComponent.getValue();
                    }
                    this.historyIndex++;
                    const val = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
                    if (val !== undefined) this.inputComponent.setValue(val);
                    e.preventDefault();
                }
            } else if (e.key === "ArrowDown") {
                if (this.historyIndex > -1) {
                    this.historyIndex--;
                    if (this.historyIndex === -1) {
                        this.inputComponent.setValue(this.currentDraft);
                    } else {
                        const val = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
                        if (val !== undefined) this.inputComponent.setValue(val);
                    }
                    e.preventDefault();
                }
            }
        });

        const submitBtn = new ButtonComponent(inputContainer)
            .setButtonText("Send")
            .setCta()
            .onClick(() => {
                void this.handleSubmit();
            });
        submitBtn.buttonEl.addClass("submit-button");

        new FileSuggest(this.app, this.inputComponent.inputEl);

        void this.renderMessages();
    }

    private async handleSubmit() {
        const text = this.inputComponent.getValue().trim();
        if (!text) return;

        if (!this.inputHistory.includes(text)) {
            this.inputHistory.push(text);
        }
        this.historyIndex = -1;
        this.currentDraft = "";

        this.inputComponent.setValue("");
        this.isThinking = true;
        this.addMessage("user", text);

        // SPOTLIGHT: Call Reflex Search Immediately (Loop 1)
        try {
            const orchestrator = this.agent.getSearchOrchestrator();
            const reflexResults = await orchestrator.searchReflex(text, 5);
            if (reflexResults.length > 0) {
                this.addMessage("system", "", undefined, undefined, undefined, reflexResults);
            }
        } catch (e) {
            console.error("Spotlight Reflex failed", e);
        }

        try {
            const { cleanMessage, contextFiles, warnings } = await this.agent.prepareContext(text);

            if (warnings && warnings.length > 0) {
                warnings.forEach(w => new Notice(w));
                this.addMessage("model", `*System Note:* ${warnings.join("\n")}`);
            }

            const response = await this.agent.chat(this.messages, cleanMessage, contextFiles, {
                enableAgentWriteAccess: this.temporaryWriteAccess ?? undefined,
                enableCodeExecution: this.plugin.settings.enableCodeExecution,
                modelId: this.temporaryModelId ?? this.plugin.settings.chatModel
            });

            this.isThinking = false;
            this.addMessage("model", response.text, undefined, response.files, response.createdFiles);
        } catch (e: unknown) {
            this.isThinking = false;
            const message = e instanceof Error ? e.message : String(e);
            new Notice(`Error: ${message}`);
            this.addMessage("model", `Error: ${message}`);
        }
    }

    private addMessage(role: "user" | "model" | "system", text: string, thought?: string, contextFiles?: string[], createdFiles?: string[], spotlightResults?: VaultSearchResult[]) {
        this.messages.push({ contextFiles, createdFiles, role, spotlightResults, text, thought });
        void this.renderMessages();
    }

    private async renderMessages() {
        if (!this.chatContainer) return;

        const renderId = ++this.lastRenderId;
        this.chatContainer.empty();

        for (const msg of this.messages) {
            const msgDiv = this.chatContainer.createDiv({
                cls: `chat-message ${msg.role}`
            });

            // SPOTLIGHT RENDER
            if (msg.spotlightResults && msg.spotlightResults.length > 0) {
                const spotlightDiv = msgDiv.createDiv({ cls: "spotlight-container" });
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Proper noun 'Spotlight'
                spotlightDiv.createEl("h5", { text: "⚡ Spotlight candidates" });
                const list = spotlightDiv.createEl("ul");
                for (const res of msg.spotlightResults) {
                    const item = list.createEl("li");
                    item.createEl("a", {
                        cls: "spotlight-link",
                        href: "#",
                        text: res.path.split('/').pop()?.replace('.md', '') || res.path
                    }).addEventListener("click", () => {
                        void this.plugin.app.workspace.openLinkText(res.path, "", true);
                    });
                    item.createSpan({ cls: "spotlight-score", text: ` (${Math.round(res.score * 100)}%)` });
                }
                // Allow system messages to be JUST spotlight by continuing if text is empty
                if (!msg.text) continue;
            }

            msgDiv.addEventListener("contextmenu", (e) => {
                const menu = new Menu();
                menu.addItem((item) =>
                    item.setTitle("Copy message")
                        .setIcon("copy")
                        .onClick(() => {
                            void navigator.clipboard.writeText(msg.text);
                            new Notice("Message copied");
                        })
                );
                menu.showAtMouseEvent(e);
            });

            if (msg.thought) {
                const thoughtDiv = msgDiv.createDiv({ cls: "chat-thought" });
                thoughtDiv.setText(`Thought: ${msg.thought}`);
            }

            const contentDiv = msgDiv.createDiv();
            if (msg.role === "model" || msg.role === "system") {
                if (msg.text) {
                    await MarkdownRenderer.render(this.plugin.app, msg.text, contentDiv, "", this);
                }
                if (renderId !== this.lastRenderId) return;

                if (msg.createdFiles && msg.createdFiles.length > 0) {
                    const createdDetails = msgDiv.createEl("details", { cls: "context-details created-files" });
                    createdDetails.createEl("summary", { text: `Created ${msg.createdFiles.length} files` });
                    // (Simplified render for brevity, assuming standard rendering logic is acceptable or can be fully restored if crucial)
                    // Restoring full list rendering logic:
                    const list = createdDetails.createDiv({ cls: "context-file-list" });
                    for (const filePath of msg.createdFiles) {
                        const fileItem = list.createDiv({ cls: "context-file-item" });
                        setIcon(fileItem.createSpan({ cls: "context-file-icon" }), "file-plus");
                        fileItem.createSpan({ cls: "context-file-name", text: filePath });
                        fileItem.addEventListener("click", () => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(filePath));
                            if (file instanceof TFile) void this.plugin.app.workspace.getLeaf("tab").openFile(file);
                        });
                    }
                }

                if (msg.contextFiles && msg.contextFiles.length > 0) {
                    const details = msgDiv.createEl("details", { cls: "context-details" });
                    details.createEl("summary", { text: `Used ${msg.contextFiles.length} context files` });
                    const list = details.createDiv({ cls: "context-file-list" });
                    for (const filePath of msg.contextFiles) {
                        const fileItem = list.createDiv({ cls: "context-file-item" });
                        setIcon(fileItem.createSpan({ cls: "context-file-icon" }), "file-text");
                        fileItem.createSpan({ cls: "context-file-name", text: filePath });
                        fileItem.addEventListener("click", () => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile) void this.plugin.app.workspace.getLeaf().openFile(file);
                        });
                    }
                }

            } else {
                contentDiv.setText(msg.text);
            }
        }

        if (this.isThinking) {
            const thinkingDiv = this.chatContainer.createDiv({ cls: "chat-message thinking" });
            thinkingDiv.createDiv({ cls: "thinking-dots" });
        }

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}
