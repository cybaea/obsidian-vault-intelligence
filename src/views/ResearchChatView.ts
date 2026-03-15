import { ButtonComponent, Component, DropdownComponent, Events, ItemView, MarkdownRenderer, Menu, Notice, TFile, TextAreaComponent, ToggleComponent, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";

import { UI_STRINGS, VIEW_TYPES } from "../constants";
import VaultIntelligencePlugin from "../main";
import { AgentService, ChatMessage } from "../services/AgentService";
import { GraphService } from "../services/GraphService";
import { ModelRegistry } from "../services/ModelRegistry";
import { ProviderRegistry } from "../services/ProviderRegistry";
import { IEmbeddingClient, ToolCall, ToolResult } from "../types/providers";
import { VaultSearchResult } from "../types/search";
import { FileSuggest } from "./FileSuggest";

export class ResearchChatView extends ItemView {
    plugin: VaultIntelligencePlugin;
    providerRegistry: ProviderRegistry;
    graphService: GraphService;
    embeddingService: IEmbeddingClient;
    agent: AgentService;
    private messages: ChatMessage[] = [];
    private isThinking = false;
    private currentAbortController: AbortController | null = null;
    private temporaryModelId: string | null = null;
    private temporaryWriteAccess: boolean | null = null;
    private lastRenderId = 0;
    private stopButton: ButtonComponent | null = null;

    chatContainer: HTMLElement;
    inputComponent: TextAreaComponent;
    inputHistory: string[] = [];
    historyIndex = -1;
    private currentDraft = "";

    constructor(
        leaf: WorkspaceLeaf,
        plugin: VaultIntelligencePlugin,
        providerRegistry: ProviderRegistry,
        graphService: GraphService,
        embeddingService: IEmbeddingClient
    ) {
        super(leaf);
        this.plugin = plugin;
        this.providerRegistry = providerRegistry;
        this.graphService = graphService;
        this.embeddingService = embeddingService;

        this.agent = new AgentService(plugin.app, providerRegistry, graphService, embeddingService, plugin.settings);
        this.icon = "message-circle";
    }

    getViewType() {
        return VIEW_TYPES.RESEARCH_CHAT;
    }

    getDisplayText() {
        return "Researcher";
    }

    async onClose() {
        this.currentAbortController?.abort();
        this.currentAbortController = null;
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
        this.populateModelDropdown(modelDropdown);

        modelDropdown.onChange((val) => {
            if (val === "custom") {
                new Notice("Custom models should be configured in settings.");
                const chatModels = ModelRegistry.getChatModels();
                const currentModel = this.temporaryModelId ?? this.plugin.settings.chatModel;
                const isPreset = chatModels.some(m => m.id === currentModel);
                modelDropdown.setValue(this.temporaryModelId ?? (isPreset ? currentModel : "custom"));
                return;
            }
            this.temporaryModelId = val;
        });

        this.registerEvent(
            (this.plugin.app.workspace as Events).on('vault-intelligence:models-updated', () => {
                this.populateModelDropdown(modelDropdown);
            })
        );

        new ButtonComponent(controls)
            .setIcon("rotate-ccw")
            .setTooltip("Reset to defaults")
            .onClick(() => {
                this.temporaryModelId = null;
                this.temporaryWriteAccess = null;
                void this.onOpen();
                new Notice("Research settings reset");
            });

        this.stopButton = new ButtonComponent(controls)
            .setIcon("square")
            .setTooltip("Stop generation")
            .onClick(() => {
                if (this.currentAbortController) {
                    this.currentAbortController.abort();
                    this.currentAbortController = null;
                    new Notice("Generation stopped");
                    this.isThinking = false;
                    void this.renderMessages();
                }
            });
        this.stopButton.buttonEl.hide();

        new ButtonComponent(controls)
            .setIcon("trash")
            .setTooltip("Clear chat")
            .onClick(() => {
                this.currentAbortController?.abort();
                this.messages = [];
                this.isThinking = false;
                void this.renderMessages();
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

        try {
            const reflexResults = await this.agent.reflexSearch(text, 5);
            if (reflexResults.length > 0) {
                this.addMessage("system", "", undefined, undefined, undefined, reflexResults);
            }
        } catch (e) {
            console.error("Spotlight Reflex failed", e);
        }

        try {
            const activeModelId = this.temporaryModelId ?? this.plugin.settings.chatModel;
            const { cleanMessage, contextFiles, warnings } = await this.agent.prepareContext(text, activeModelId);

            if (warnings && warnings.length > 0) {
                warnings.forEach((w: string) => new Notice(w));
                this.addMessage("model", `${UI_STRINGS.RESEARCHER_SYSTEM_NOTE_PREFIX}${warnings.join("\n")}`);
            }

            this.currentAbortController = new AbortController();
            this.stopButton?.buttonEl.show();

            const stream = this.agent.chatStream(this.messages, cleanMessage, contextFiles, {
                enableAgentWriteAccess: this.temporaryWriteAccess ?? undefined,
                enableCodeExecution: this.plugin.settings.enableCodeExecution,
                modelId: this.temporaryModelId ?? this.plugin.settings.chatModel,
                signal: this.currentAbortController.signal
            });

            const modelMsg = this.addMessage("model", "");
            await this.renderMessages(); 

            let messageContainer = this.chatContainer.lastElementChild as HTMLElement;
            let lastMessageNode = messageContainer?.querySelector('.chat-content') as HTMLElement;
            let thoughtNode = messageContainer?.querySelector('.chat-thought') as HTMLElement;

            if (lastMessageNode) lastMessageNode.addClass('is-streaming'); 
            
            let lastStatus = "";
            let lastRenderTime = 0;
            let renderInProgress = false;
            let streamingComponent: Component | null = null;

            const updateStreamingUI = async (force = false) => {
                const now = Date.now();
                if (!force && (renderInProgress || now - lastRenderTime < 100)) return;
                
                renderInProgress = true;
                try {
                    // 1. Unload previous streaming artifacts to prevent memory leaks
                    if (streamingComponent) {
                        streamingComponent.unload();
                    }
                    
                    // 2. Create a fresh sandbox for this render step
                    streamingComponent = new Component();
                    streamingComponent.load();

                    const tempEl = document.createElement('div');
                    
                    // 3. Render into the temporary component, NOT `this`
                    await MarkdownRenderer.render(this.plugin.app, modelMsg.text, tempEl, "", streamingComponent);
                    
                    if (lastMessageNode) {
                        // 4. Optimization: Use replaceChildren instead of manual while loop
                        lastMessageNode.replaceChildren(...Array.from(tempEl.childNodes));
                        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
                    }
                    lastRenderTime = Date.now();
                } finally {
                    renderInProgress = false;
                }
            };

            for await (const chunk of stream) {
                if (this.currentAbortController?.signal.aborted) break;

                if (chunk.text) {
                    modelMsg.text += chunk.text;
                    void updateStreamingUI();
                }
                if (chunk.status && chunk.status !== lastStatus) {
                    lastStatus = chunk.status;
                    modelMsg.thought = lastStatus; 
                    
                    if (messageContainer) {
                        if (!thoughtNode) {
                            thoughtNode = messageContainer.createDiv({ cls: "chat-thought" });
                            messageContainer.insertBefore(thoughtNode, lastMessageNode);
                        }
                        thoughtNode.setText(`Thought: ${lastStatus}`);
                        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
                    }
                }
                if (chunk.isDone) {
                    modelMsg.contextFiles = chunk.files;
                    modelMsg.createdFiles = chunk.createdFiles;
                    if (chunk.files && chunk.files.length > 0) {
                        this.graphService.trigger("vault-intelligence:context-highlight", chunk.files);
                    }
                }
                if (chunk.toolCalls) {
                    modelMsg.toolCalls = chunk.toolCalls;
                }
                if (chunk.toolResults) {
                    this.addMessage("tool", "", undefined, undefined, undefined, undefined, undefined, chunk.toolResults);
                    await this.renderMessages(); 
                    
                    messageContainer = this.chatContainer.children[this.chatContainer.children.length - 2] as HTMLElement; 
                    if (messageContainer) {
                        lastMessageNode = messageContainer.querySelector('.chat-content') as HTMLElement;
                        thoughtNode = messageContainer.querySelector('.chat-thought') as HTMLElement;
                        if (lastMessageNode) lastMessageNode.addClass('is-streaming');
                    }
                }
                if (chunk.rawContent) {
                    modelMsg.rawContent = chunk.rawContent;
                }
            }

            // 5. When the stream is entirely finished, clean up the sandbox
            if (streamingComponent) {
                (streamingComponent as Component).unload();
                streamingComponent = null;
            }

            modelMsg.thought = undefined;
            this.isThinking = false;
            this.stopButton?.buttonEl.hide();
            this.currentAbortController = null;
            void this.renderMessages();

        } catch (error: unknown) {
            this.isThinking = false;
            this.stopButton?.buttonEl.hide();
            
            // Check for intentional abortion
            if (this.currentAbortController?.signal.aborted) {
                this.currentAbortController = null;
                void this.renderMessages();
                return;
            }
            
            this.currentAbortController = null;
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Error: ${message}`);
            this.addMessage("model", `Error: ${message}`);
        }
    }

    private addMessage(
        role: "user" | "model" | "system" | "tool", 
        text: string, 
        thought?: string, 
        contextFiles?: string[], 
        createdFiles?: string[], 
        spotlightResults?: VaultSearchResult[],
        toolCalls?: ToolCall[],
        toolResults?: ToolResult[],
        rawContent?: unknown[]
    ) {
        const msg: ChatMessage = { contextFiles, createdFiles, rawContent, role, spotlightResults, text, thought, toolCalls, toolResults };
        this.messages.push(msg);
        void this.renderMessages();
        return msg;
    }

    private async renderMessages() {
        if (!this.chatContainer) return;

        const renderId = ++this.lastRenderId;
        this.chatContainer.empty();

        for (const msg of this.messages) {
            const msgDiv = this.chatContainer.createDiv({
                cls: `chat-message ${msg.role}`
            });

            if (msg.spotlightResults && msg.spotlightResults.length > 0) {
                const spotlightDiv = msgDiv.createDiv({ cls: "spotlight-container" });
                spotlightDiv.createEl("h5", { text: UI_STRINGS.RESEARCHER_SPOTLIGHT_HEADER });
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

            const contentDiv = msgDiv.createDiv({ cls: "chat-content" });
            if (msg.role === "model" || msg.role === "system") {
                if (msg.text) {
                    await MarkdownRenderer.render(this.plugin.app, msg.text, contentDiv, "", this);
                }
                if (renderId !== this.lastRenderId) return;

                if (msg.createdFiles && msg.createdFiles.length > 0) {
                    const createdDetails = msgDiv.createEl("details", { cls: "context-details created-files" });
                    createdDetails.createEl("summary", { text: `Created ${msg.createdFiles.length} files` });
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

    private populateModelDropdown(modelDropdown: DropdownComponent) {
        const selectEl = modelDropdown.selectEl;
        selectEl.innerHTML = '';
        
        const chatModels = ModelRegistry.getChatModels();
        const hasApiKey = !!this.plugin.settings.googleApiKey;
        const hasOllama = !!this.plugin.settings.ollamaEndpoint;
        const canUseChat = hasApiKey || hasOllama;

        if (!canUseChat) {
            modelDropdown.addOption('none', 'Configure provider to enable selection...');
            modelDropdown.setDisabled(true);
            return;
        }

        const googleModels = chatModels.filter(m => m.provider === 'gemini');
        const ollamaModels = chatModels.filter(m => m.provider === 'ollama');

        if (googleModels.length > 0) {
            const group = selectEl.createEl('optgroup', { attr: { label: 'Cloud (Gemini)' } });
            for (const m of googleModels) {
                group.createEl('option', { text: m.label, value: m.id });
            }
        }

        if (ollamaModels.length > 0) {
            const group = selectEl.createEl('optgroup', { attr: { label: 'Local (Ollama)' } });
            for (const m of ollamaModels) {
                group.createEl('option', { text: m.label, value: m.id });
            }
        } else if (this.plugin.settings.ollamaEndpoint) {
            const group = selectEl.createEl('optgroup', { attr: { label: 'Local (Ollama)' } });
            group.createEl('option', {
                attr: { disabled: 'true' },
                text: 'No models found',
                value: 'none'
            });
        }

        selectEl.createEl('option', { text: 'Custom model string...', value: 'custom' });

        const currentModel = this.temporaryModelId ?? this.plugin.settings.chatModel;
        const isPreset = chatModels.some(m => m.id === currentModel);
        modelDropdown.setValue(isPreset ? currentModel : "custom");

        for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options.item(i);
            if (opt && opt.value !== 'custom' && opt.value !== 'none') opt.title = opt.value;
        }
    }

}
