import { ItemView, WorkspaceLeaf, ButtonComponent, TextAreaComponent, Notice, MarkdownRenderer, Menu, TFile, TFolder } from "obsidian";
import VaultIntelligencePlugin from "../main";
import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { IEmbeddingService } from "../services/IEmbeddingService"; // Import Interface
import { AgentService, ChatMessage } from "../services/AgentService";
import { FileSuggest } from "./FileSuggest";

export const RESEARCH_CHAT_VIEW_TYPE = "research-chat-view";

export class ResearchChatView extends ItemView {
    plugin: VaultIntelligencePlugin;
    gemini: GeminiService;
    graphService: GraphService;
    embeddingService: IEmbeddingService; // Add property
    agent: AgentService;
    private messages: ChatMessage[] = [];

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
    }

    getViewType() {
        return RESEARCH_CHAT_VIEW_TYPE;
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
        header.createEl("h4", { text: "Researcher: chat with vault", cls: "chat-title" });

        new ButtonComponent(header)
            .setIcon("trash")
            .setTooltip("Clear chat")
            .onClick(() => {
                this.messages = [];
                void this.renderMessages();
                new Notice("Chat cleared");
            });

        // Chat History Area
        this.chatContainer = container.createDiv({ cls: "chat-container" });

        // Input Area
        const inputContainer = container.createDiv({ cls: "input-container" });

        this.inputComponent = new TextAreaComponent(inputContainer);
        this.inputComponent.inputEl.addClass("chat-input");
        this.inputComponent.setPlaceholder("Ask your vault...");

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
        this.addMessage("user", text);

        // Parse @-sign references
        const files: TFile[] = [];
        // Updated regex to be more lenient with characters and handle quoted strings better
        const mentionRegex = /@(?:"([^"]+)"|([^\s@.,!?;:]+))/g;
        let match;
        while ((match = mentionRegex.exec(text)) !== null) {
            const pathOrName = match[1] || match[2];
            if (pathOrName) {
                // First try direct path
                let abstractFile = this.app.vault.getAbstractFileByPath(pathOrName);

                // If not found, try resolving as a link (for files)
                if (!abstractFile) {
                    abstractFile = this.app.metadataCache.getFirstLinkpathDest(pathOrName, "");
                }

                if (abstractFile instanceof TFile) {
                    files.push(abstractFile);
                } else if (abstractFile instanceof TFolder) {
                    // Expand folder into files recursively
                    const folderPath = abstractFile.path;
                    const folderFiles = this.app.vault.getMarkdownFiles().filter(f =>
                        f.path.startsWith(folderPath + "/") || f.path === folderPath
                    );

                    if (folderFiles.length > 100) {
                        new Notice(`Folder "${abstractFile.name}" has too many files (${folderFiles.length}). Only the first 100 will be used as context.`);
                        files.push(...folderFiles.slice(0, 100));
                    } else {
                        files.push(...folderFiles);
                    }
                }
            }
        }

        try {
            const response = await this.agent.chat(this.messages, text, files);
            this.addMessage("model", response);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            new Notice(`Error: ${message}`);
            this.addMessage("model", `Error: ${message}`);
        }
    }

    private addMessage(role: "user" | "model" | "system", text: string, thought?: string) {
        this.messages.push({ role, text, thought });
        void this.renderMessages();
    }

    private async renderMessages() {
        if (!this.chatContainer) return;
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
            } else {
                contentDiv.setText(msg.text);
            }
        }

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}
