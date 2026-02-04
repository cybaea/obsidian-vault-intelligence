import { ItemView, WorkspaceLeaf, ButtonComponent, TextAreaComponent, Notice, MarkdownRenderer, Menu, TFile, setIcon, DropdownComponent, ToggleComponent, normalizePath } from "obsidian";

import { VIEW_TYPES } from "../constants";
import VaultIntelligencePlugin from "../main";
import { AgentService, ChatMessage } from "../services/AgentService";
import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { IEmbeddingService } from "../services/IEmbeddingService"; // Import Interface
import { ModelRegistry } from "../services/ModelRegistry";
import { FileSuggest } from "./FileSuggest";

export class ResearchChatView extends ItemView {
    plugin: VaultIntelligencePlugin;
    gemini: GeminiService;
    graphService: GraphService;
    embeddingService: IEmbeddingService; // Add property
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

    // Update Constructor
    constructor(
        leaf: WorkspaceLeaf,
        plugin: VaultIntelligencePlugin,
        gemini: GeminiService,
        graphService: GraphService,
        embeddingService: IEmbeddingService // Add argument
    ) {
        super(leaf);
        this.plugin = plugin;
        this.gemini = gemini;
        this.graphService = graphService;
        this.embeddingService = embeddingService;

        // Pass embeddingService to Agent
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
        // Nothing to cleanup
    }

    async onOpen() {
        await Promise.resolve();
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("research-chat-view");

        const header = container.createDiv({ cls: "chat-header" });
        header.createEl("h4", { cls: "chat-title", text: "Researcher" });

        const controls = header.createDiv({ cls: "chat-controls" });

        // Write Access Toggle
        const writeContainer = controls.createDiv({ cls: "control-item" });
        writeContainer.createSpan({ cls: "control-label", text: "Write" });
        new ToggleComponent(writeContainer)
            .setValue(this.temporaryWriteAccess ?? this.plugin.settings.enableAgentWriteAccess)
            .setTooltip("Enable agent write access for this chat. Allows the agent to create and modify notes (requires manual confirmation).")
            .onChange((val) => {
                this.temporaryWriteAccess = val;
            });

        // Model Dropdown
        const modelContainer = controls.createDiv({ cls: "control-item" });
        const modelDropdown = new DropdownComponent(modelContainer);
        const chatModels = ModelRegistry.getChatModels();
        for (const m of chatModels) {
            modelDropdown.addOption(m.id, m.label);
        }
        modelDropdown.addOption("custom", "Custom...");

        // Add tooltips to each option (model ID)
        for (let i = 0; i < modelDropdown.selectEl.options.length; i++) {
            const opt = modelDropdown.selectEl.options.item(i);
            if (opt && opt.value !== "custom") opt.title = opt.value;
        }

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

        // Reset Button
        new ButtonComponent(controls)
            .setIcon("rotate-ccw")
            .setTooltip("Reset to default settings")
            .onClick(() => {
                this.temporaryModelId = null;
                this.temporaryWriteAccess = null;
                void this.onOpen(); // Re-render header
                new Notice("Research settings reset to defaults");
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

        // Chat History Area
        this.chatContainer = container.createDiv({ cls: "chat-container" });

        // Input Area
        const inputContainer = container.createDiv({ cls: "input-container" });

        this.inputComponent = new TextAreaComponent(inputContainer);
        this.inputComponent.inputEl.addClass("chat-input");
        this.inputComponent.setPlaceholder("Ask your vault... (use @ to link notes)");

        // Submit on Enter (Shift+Enter for newline)
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
                    const historicalValue = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
                    if (historicalValue !== undefined) {
                        this.inputComponent.setValue(historicalValue);
                    }
                    e.preventDefault();
                }
            } else if (e.key === "ArrowDown") {
                if (this.historyIndex > -1) {
                    this.historyIndex--;
                    if (this.historyIndex === -1) {
                        this.inputComponent.setValue(this.currentDraft);
                    } else {
                        const historicalValue = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
                        if (historicalValue !== undefined) {
                            this.inputComponent.setValue(historicalValue);
                        }
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

        // File Autocomplete
        new FileSuggest(this.app, this.inputComponent.inputEl);

        void this.renderMessages();
    }

    private async handleSubmit() {
        const text = this.inputComponent.getValue().trim();
        if (!text) return;

        // Save history
        if (!this.inputHistory.includes(text)) {
            this.inputHistory.push(text);
        }
        this.historyIndex = -1;
        this.currentDraft = "";

        this.inputComponent.setValue("");
        this.isThinking = true;
        this.addMessage("user", text);

        try {
            // 1. Prepare Context (Delegated to Service)
            const { cleanMessage, contextFiles, warnings } = await this.agent.prepareContext(text);

            // Display any warnings from context preparation (e.g. folder limits)
            if (warnings && warnings.length > 0) {
                warnings.forEach(w => new Notice(w));
                this.addMessage("model", `*System Note:* ${warnings.join("\n")}`);
            }

            // 2. Execute Chat
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

    private addMessage(role: "user" | "model" | "system", text: string, thought?: string, contextFiles?: string[], createdFiles?: string[]) {
        this.messages.push({ contextFiles, createdFiles, role, text, thought });
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

            msgDiv.addEventListener("contextmenu", (e) => {
                const menu = new Menu();

                menu.addItem((item) =>
                    item
                        .setTitle("Select all")
                        .setIcon("select-all")
                        .onClick(() => {
                            const range = document.createRange();
                            range.selectNodeContents(msgDiv);
                            const selection = window.getSelection();
                            selection?.removeAllRanges();
                            selection?.addRange(range);
                        })
                );

                menu.addItem((item) =>
                    item
                        .setTitle("Copy message")
                        .setIcon("copy")
                        .onClick(() => {
                            void navigator.clipboard.writeText(msg.text);
                            new Notice("Message copied to clipboard");
                        })
                );

                menu.addItem((item) =>
                    item
                        .setTitle("Copy as HTML")
                        .setIcon("code")
                        .onClick(() => {
                            void navigator.clipboard.writeText(msgDiv.innerHTML);
                            new Notice("HTML copied to clipboard");
                        })
                );

                menu.addSeparator();

                menu.addItem((item) =>
                    item
                        .setTitle("Copy entire chat")
                        .setIcon("copy")
                        .onClick(() => {
                            const history = this.messages
                                .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
                                .join("\n\n");
                            void navigator.clipboard.writeText(history);
                            new Notice("Entire chat history copied.");
                        })
                );

                menu.showAtMouseEvent(e);
            });

            if (msg.thought) {
                const thoughtDiv = msgDiv.createDiv({ cls: "chat-thought" });
                thoughtDiv.setText(`Thought: ${msg.thought}`);
            }

            const contentDiv = msgDiv.createDiv();
            if (msg.role === "model") {
                await MarkdownRenderer.render(this.plugin.app, msg.text, contentDiv, "", this);
                if (renderId !== this.lastRenderId) return;

                if (msg.createdFiles && msg.createdFiles.length > 0) {
                    const createdDetails = msgDiv.createEl("details", { cls: "context-details created-files" });
                    createdDetails.createEl("summary", { text: `Created ${msg.createdFiles.length} ${msg.createdFiles.length === 1 ? "document" : "documents"}` });

                    const list = createdDetails.createDiv({ cls: "context-file-list" });

                    for (const filePath of msg.createdFiles) {
                        const fileItem = list.createDiv({ cls: "context-file-item" });

                        // Icon
                        const iconSpan = fileItem.createSpan({ cls: "context-file-icon" });
                        setIcon(iconSpan, "file-plus");

                        // Name
                        fileItem.createSpan({ cls: "context-file-name", text: filePath });

                        // Click to open
                        fileItem.addEventListener("click", () => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(filePath));
                            if (file instanceof TFile) {
                                void this.plugin.app.workspace.getLeaf("tab").openFile(file);
                            } else {
                                new Notice(`File not found: ${filePath}`);
                            }
                        });

                        // Drag to link
                        fileItem.setAttribute("draggable", "true");
                        fileItem.addEventListener("dragstart", (e) => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile && e.dataTransfer) {
                                e.dataTransfer.setData("text/plain", `[[${file.name}]]`);
                                e.dataTransfer.setData("obsidian/app-link", `obsidian://open?vault=${encodeURIComponent(this.plugin.app.vault.getName())}&file=${encodeURIComponent(file.path)}`);
                                e.dataTransfer.effectAllowed = "copyLink";
                            }
                        });
                    }
                }

                if (msg.contextFiles && msg.contextFiles.length > 0) {
                    const details = msgDiv.createEl("details", { cls: "context-details" });
                    details.createEl("summary", { text: `Used ${msg.contextFiles.length} context documents` });

                    const list = details.createDiv({ cls: "context-file-list" });

                    for (const filePath of msg.contextFiles) {
                        const fileItem = list.createDiv({ cls: "context-file-item" });

                        // Icon
                        const iconSpan = fileItem.createSpan({ cls: "context-file-icon" });
                        setIcon(iconSpan, "file-text");

                        // Name
                        fileItem.createSpan({ cls: "context-file-name", text: filePath });

                        // Click to open
                        fileItem.addEventListener("click", () => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile) {
                                void this.plugin.app.workspace.getLeaf().openFile(file);
                            } else {
                                new Notice(`File not found: ${filePath}`);
                            }
                        });

                        // Drag to link
                        fileItem.setAttribute("draggable", "true");
                        fileItem.addEventListener("dragstart", (e) => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile && e.dataTransfer) {
                                e.dataTransfer.setData("text/plain", `[[${file.name}]]`);
                                e.dataTransfer.setData("obsidian/app-link", `obsidian://open?vault=${encodeURIComponent(this.plugin.app.vault.getName())}&file=${encodeURIComponent(file.path)}`);
                                e.dataTransfer.effectAllowed = "copyLink";
                            }
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
