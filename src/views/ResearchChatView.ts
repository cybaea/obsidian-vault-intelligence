import { ItemView, WorkspaceLeaf, ButtonComponent, TextAreaComponent, DropdownComponent, setIcon, Notice, MarkdownRenderer, Menu } from "obsidian";
import VaultIntelligencePlugin from "../main";
import { GeminiService } from "../services/GeminiService";
import { VectorStore } from "../services/VectorStore";
import { AgentService } from "../services/AgentService";
import { logger } from "../utils/logger";

export const RESEARCH_CHAT_VIEW_TYPE = "research-chat-view";

interface ChatMessage {
    role: "user" | "model" | "system";
    text: string;
    thought?: string; // For showing reasoning
}

export class ResearchChatView extends ItemView {
    plugin: VaultIntelligencePlugin;
    gemini: GeminiService;
    vectorStore: VectorStore;
    agent: AgentService;
    messages: ChatMessage[] = [];

    chatContainer: HTMLElement;
    inputComponent: TextAreaComponent;

    constructor(leaf: WorkspaceLeaf, plugin: VaultIntelligencePlugin, gemini: GeminiService, vectorStore: VectorStore) {
        super(leaf);
        this.plugin = plugin;
        this.gemini = gemini;
        this.vectorStore = vectorStore;
        this.agent = new AgentService(plugin.app, gemini, vectorStore);
    }

    getViewType() {
        return RESEARCH_CHAT_VIEW_TYPE;
    }

    getDisplayText() {
        return "Research Agent";
    }

    async onOpen() {
        this.containerEl.addClass("research-chat-view");

        const padding = this.containerEl.createDiv({ cls: "nav-header" });
        padding.style.padding = "10px";
        padding.style.display = "flex";
        padding.style.justifyContent = "space-between";
        padding.style.alignItems = "center";

        const title = padding.createEl("h4", { text: "Research Chat" });
        title.style.margin = "0";

        // Action Buttons
        const actionsDiv = padding.createDiv();

        new ButtonComponent(actionsDiv)
            .setIcon("trash")
            .setTooltip("Clear Context")
            .onClick(() => {
                this.clearChat();
            });

        // Chat History Area
        this.chatContainer = this.containerEl.createDiv();
        this.chatContainer.style.height = "calc(100% - 150px)";
        this.chatContainer.style.overflowY = "auto";
        this.chatContainer.style.padding = "10px";
        this.chatContainer.style.display = "flex";
        this.chatContainer.style.flexDirection = "column";
        this.chatContainer.style.gap = "10px";

        // Input Area
        const inputContainer = this.containerEl.createDiv();
        inputContainer.style.padding = "10px";
        inputContainer.style.borderTop = "1px solid var(--background-modifier-border)";

        this.inputComponent = new TextAreaComponent(inputContainer);
        this.inputComponent.inputEl.style.width = "100%";
        this.inputComponent.inputEl.style.minHeight = "60px";
        this.inputComponent.setPlaceholder("Ask your vault...");

        // Submit on Enter (Shift+Enter for newline)
        this.inputComponent.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSubmit();
            }
        });

        const submitBtn = new ButtonComponent(inputContainer)
            .setButtonText("Send")
            .setCta()
            .onClick(() => this.handleSubmit());
        submitBtn.buttonEl.style.marginTop = "5px";
        submitBtn.buttonEl.style.width = "100%";
    }

    private clearChat() {
        this.messages = [];
        this.renderMessages();
        new Notice("Chat context cleared.");
    }

    private async handleSubmit() {
        const text = this.inputComponent.getValue().trim();
        if (!text) return;

        this.inputComponent.setValue("");
        this.addMessage("user", text);

        // Placeholder for real logic
        const thought = "Thinking...";
        // Convert internal history to agent history format
        const agentHistory = this.messages
            .filter(m => m.role !== "system" && m.text !== text) // exclude current msg and system
            .map(m => ({ role: m.role, text: m.text }));

        try {
            const response = await this.agent.chat(agentHistory, text);
            this.addMessage("model", response); // Thought not easily exposed by Gemini SDK yet without parsing
        } catch (e: any) {
            this.addMessage("model", "Error: " + e.message);
        }
    }

    private addMessage(role: "user" | "model", text: string, thought?: string) {
        this.messages.push({ role, text, thought });
        this.renderMessages();
    }

    private async renderMessages() {
        this.chatContainer.empty();

        for (const msg of this.messages) {
            const msgDiv = this.chatContainer.createDiv({ cls: `chat-message ${msg.role}` });
            msgDiv.style.alignSelf = msg.role === "user" ? "flex-end" : "flex-start";
            msgDiv.style.backgroundColor = msg.role === "user" ? "var(--interactive-accent)" : "var(--background-secondary)";
            msgDiv.style.color = msg.role === "user" ? "var(--text-on-accent)" : "var(--text-normal)";
            msgDiv.style.padding = "8px 12px";
            msgDiv.style.borderRadius = "8px";
            msgDiv.style.maxWidth = "80%";
            msgDiv.style.userSelect = "text"; // Explicit inline style for selection
            (msgDiv.style as any).webkitUserSelect = "text";

            msgDiv.addEventListener("contextmenu", (e) => {
                const menu = new Menu();

                menu.addItem((item) =>
                    item
                        .setTitle("Select All")
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
                        .setTitle("Copy Message")
                        .setIcon("copy")
                        .onClick(() => {
                            navigator.clipboard.writeText(msg.text);
                            new Notice("Message copied to clipboard.");
                        })
                );

                menu.addSeparator();

                menu.addItem((item) =>
                    item
                        .setTitle("Copy Entire Chat")
                        .setIcon("copy")
                        .onClick(() => {
                            const history = this.messages
                                .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
                                .join("\n\n");
                            navigator.clipboard.writeText(history);
                            new Notice("Entire chat history copied.");
                        })
                );

                menu.showAtMouseEvent(e);
            });

            if (msg.thought) {
                const thoughtDiv = msgDiv.createDiv();
                thoughtDiv.style.fontSize = "0.8em";
                thoughtDiv.style.opacity = "0.7";
                thoughtDiv.style.fontStyle = "italic";
                thoughtDiv.style.marginBottom = "4px";
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
