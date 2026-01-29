import { MarkdownRenderChild, ButtonComponent, setIcon, TFile, TFolder, Notice, App } from "obsidian";

import { GardenerPlan } from "../services/GardenerService";
import { GardenerStateService } from "../services/GardenerStateService";
import { MetadataManager } from "../services/MetadataManager";
import { OntologyService } from "../services/OntologyService";
import { logger } from "../utils/logger";

/**
 * Renderer for the 'gardener-plan' code block.
 * Provides an interactive UI to review and apply vault hygiene suggestions.
 */
export class GardenerPlanRenderer extends MarkdownRenderChild {
    private app: App;
    private plan: GardenerPlan;
    private metadataManager: MetadataManager;
    private ontology: OntologyService;
    private state: GardenerStateService;
    private selectedActions: Set<number> = new Set();

    constructor(
        app: App,
        containerEl: HTMLElement,
        plan: GardenerPlan,
        metadataManager: MetadataManager,
        ontology: OntologyService,
        state: GardenerStateService
    ) {
        super(containerEl);
        this.app = app;
        this.plan = plan;
        this.metadataManager = metadataManager;
        this.ontology = ontology;
        this.state = state;

        // Default all to selected
        this.plan.actions.forEach((_, i) => this.selectedActions.add(i));
    }

    onload() {
        void this.render();
    }

    private excludedValues: Map<number, Set<string>> = new Map();

    private async render() {
        this.containerEl.empty();
        await Promise.resolve(); // satisfying async lint
        this.containerEl.addClass("gardener-plan-ui");

        // Header
        const header = this.containerEl.createDiv({ cls: "gardener-header" });
        const titleContainer = header.createDiv({ cls: "gardener-title-container" });
        setIcon(titleContainer.createSpan({ cls: "gardener-icon" }), "sprout");
        titleContainer.createEl("h3", { cls: "gardener-title", text: `Gardener Plan: ${this.plan.date}` });

        // Loading State
        if (this.plan.loading) {
            this.containerEl.createEl("p", { cls: "gardener-summary", text: this.plan.summary });
            const loadingContainer = this.containerEl.createDiv({ cls: "gardener-loading-container" });
            loadingContainer.createDiv({ cls: "gardener-progress-bar" });
            loadingContainer.createEl("p", { cls: "gardener-loading-text", text: "Analyzing vault. This may take a few seconds." });
            return;
        }

        // Error State
        if (this.plan.error) {
            this.containerEl.createEl("pre", { cls: "gardener-error", text: `Error: ${this.plan.error}` });
            return;
        }

        this.containerEl.createEl("p", { cls: "gardener-summary", text: this.plan.summary });

        // Actions List
        const actionsContainer = this.containerEl.createDiv({ cls: "gardener-actions-list" });

        this.plan.actions.forEach((action, index) => {
            const actionCard = actionsContainer.createDiv({ cls: "gardener-action-card" });

            const actionHeader = actionCard.createDiv({ cls: "action-header" });

            // Checkbox for selection
            const checkboxContainer = actionHeader.createDiv({ cls: "action-checkbox-container" });
            const checkbox = checkboxContainer.createEl("input", { cls: "action-checkbox", type: "checkbox" });
            checkbox.checked = this.selectedActions.has(index);
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) this.selectedActions.add(index);
                else this.selectedActions.delete(index);
            });

            const iconType = this.getIconForAction(action.action);
            void setIcon(actionHeader.createSpan({ cls: "action-type-icon" }), iconType);

            // Clickable File Path
            const fileLink = actionHeader.createEl("a", { cls: "action-file-path interactive-link", text: action.filePath });
            fileLink.addEventListener("click", (e) => {
                e.preventDefault();
                void this.app.workspace.openLinkText(action.filePath, "/", true);
            });

            const changesList = actionCard.createDiv({ cls: "action-changes" });
            for (const change of action.changes) {
                const changeItem = changesList.createDiv({ cls: "change-item" });
                changeItem.createSpan({ cls: "change-field", text: change.field });
                void setIcon(changeItem.createSpan({ cls: "change-arrow" }), "arrow-right");

                const valuesContainer = changeItem.createDiv({ cls: "change-values-container" });
                const values = Array.isArray(change.newValue) ? change.newValue : [change.newValue];

                for (const val of values) {
                    const valueStr = String(val);
                    const isLink = valueStr.match(/\[+([^\]]+)\]+\(\/?([^)]+)\)/);

                    const valueWrapper = valuesContainer.createDiv({ cls: "change-value-wrapper" });

                    if (isLink && isLink[1] && isLink[2]) {
                        const linkName = isLink[1].replace(/[[\]]/g, "").trim();
                        const linkPath = decodeURIComponent(isLink[2]);

                        const valueSpan = valueWrapper.createEl("a", { cls: "change-value interactive-link", text: linkName });
                        valueSpan.addEventListener("click", (e) => {
                            e.preventDefault();
                            void this.app.workspace.openLinkText(linkPath, "/", true);
                        });

                        // Exclusion Cross
                        const removeIcon = valueWrapper.createSpan({ cls: "remove-value-icon" });
                        void setIcon(removeIcon, "x");
                        removeIcon.addEventListener("click", () => {
                            let excluded = this.excludedValues.get(index);
                            if (!excluded) {
                                excluded = new Set();
                                this.excludedValues.set(index, excluded);
                            }
                            if (excluded.has(valueStr)) {
                                excluded.delete(valueStr);
                                valueWrapper.removeClass("is-excluded");
                            } else {
                                excluded.add(valueStr);
                                valueWrapper.addClass("is-excluded");
                            }
                        });

                        if (this.excludedValues.get(index)?.has(valueStr)) {
                            valueWrapper.addClass("is-excluded");
                        }

                        // Safety Whitelist Check for Topics
                        if (change.field === "topics") {
                            const isValid = this.ontology.validateTopic(valueStr);
                            if (!isValid) {
                                valueSpan.addClass("invalid-topic");
                                const warningIcon = valueWrapper.createSpan({ cls: "tag-warning" });
                                void setIcon(warningIcon, "alert-triangle");
                                warningIcon.setAttribute("title", `New topic: '${linkName}' will be created with a definition.`);
                            }
                        }
                    } else {
                        valueWrapper.createSpan({ cls: "change-value", text: valueStr });

                        const removeIcon = valueWrapper.createSpan({ cls: "remove-value-icon" });
                        setIcon(removeIcon, "x");
                        removeIcon.addEventListener("click", () => {
                            let excluded = this.excludedValues.get(index);
                            if (!excluded) {
                                excluded = new Set();
                                this.excludedValues.set(index, excluded);
                            }
                            if (excluded.has(valueStr)) {
                                excluded.delete(valueStr);
                                valueWrapper.removeClass("is-excluded");
                            } else {
                                excluded.add(valueStr);
                                valueWrapper.addClass("is-excluded");
                            }
                        });

                        if (this.excludedValues.get(index)?.has(valueStr)) {
                            valueWrapper.addClass("is-excluded");
                        }
                    }
                }
            }

            actionCard.createEl("p", { cls: "action-rationale", text: action.rationale });
        });

        // Footer / Apply Button
        const footer = this.containerEl.createDiv({ cls: "gardener-footer" });
        const applyBtn = new ButtonComponent(footer)
            .setButtonText("Apply selected actions")
            .setCta()
            .onClick(async () => {
                await this.applySelectedActions(applyBtn);
            });
    }

    private getIconForAction(action: string): string {
        switch (action) {
            case "update_topics": return "book";
            case "update_tags": return "tag";
            case "update_metadata": return "database";
            case "rename_file": return "pencil";
            default: return "help-circle";
        }
    }

    private async applySelectedActions(button: ButtonComponent) {
        if (this.selectedActions.size === 0) {
            new Notice("No actions selected.");
            return;
        }

        button.setDisabled(true);
        button.setButtonText("Applying...");

        let successCount = 0;
        let failCount = 0;

        const actionIndices = Array.from(this.selectedActions).sort();
        for (const index of actionIndices) {
            const action = this.plan.actions[index];
            if (!action) continue;

            const file = this.app.vault.getAbstractFileByPath(action.filePath);
            if (file instanceof TFile) {
                try {
                    // 1. Pre-process topics: create new ones if needed (Async)
                    for (const change of action.changes) {
                        if (change.field === "topics" && Array.isArray(change.newValue)) {
                            const value = change.newValue;
                            const excluded = this.excludedValues.get(index);
                            const topicsToApply = excluded ? value.filter(v => !excluded.has(String(v))) : value;

                            for (const topicLink of topicsToApply) {
                                const match = String(topicLink).match(/\[+([^\]]+)\]+\(\/?([^)]+)\)/);
                                if (match && match[2]) {
                                    const path = decodeURIComponent(match[2]);
                                    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
                                        // Topic doesn't exist, create it!
                                        const definition = this.plan.newTopicDefinitions?.find(d => d.topicLink === String(topicLink))?.definition || "No definition provided.";

                                        // Ensure folders exist (recursive-ish)
                                        const folderPath = path.substring(0, path.lastIndexOf('/'));
                                        if (folderPath && !(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
                                            const folders = folderPath.split('/');
                                            let currentPath = "";
                                            for (const folder of folders) {
                                                currentPath = currentPath ? `${currentPath}/${folder}` : folder;
                                                if (!(this.app.vault.getAbstractFileByPath(currentPath) instanceof TFolder)) {
                                                    await this.app.vault.createFolder(currentPath);
                                                }
                                            }
                                        }

                                        await this.app.vault.create(path, `# ${match[1]}\n\n${definition}`);
                                        logger.info(`Automatically created topic: ${path}`);
                                    }
                                }
                            }
                        }
                    }

                    // 2. Update frontmatter (Safe)
                    await this.metadataManager.updateFrontmatter(file, (fm: Record<string, unknown>) => {
                        for (const change of action.changes) {
                            let value = change.newValue;
                            if (Array.isArray(value)) {
                                const excluded = this.excludedValues.get(index);
                                if (excluded) {
                                    value = value.filter(v => !excluded.has(String(v)));
                                }
                            } else {
                                if (this.excludedValues.get(index)?.has(String(value))) {
                                    continue; // Skip single value if excluded
                                }
                            }
                            fm[change.field] = value;
                        }
                    });
                    successCount++;
                    // Record successful update in state
                    await this.state.recordUpdate(action.filePath);
                } catch (e) {
                    logger.error(`Failed to apply action to ${action.filePath}`, e);
                    failCount++;
                }
            } else {
                failCount++;
                logger.warn(`File not found for action: ${action.filePath}`);
            }
        }

        // Record skips for any action NOT selected (closing the feedback loop)
        for (let i = 0; i < this.plan.actions.length; i++) {
            if (!this.selectedActions.has(i)) {
                const action = this.plan.actions[i];
                if (action) {
                    await this.state.recordSkip(action.filePath);
                }
            }
        }

        if (failCount === 0) {
            new Notice(`Gardener: applied ${successCount} changes successfully.`);
            button.setButtonText("Applied");
        } else {
            new Notice(`Gardener: done with issues. ${successCount} success, ${failCount} failed.`);
            button.setButtonText("Done (with errors)");
            button.setDisabled(false);
        }
    }
}
