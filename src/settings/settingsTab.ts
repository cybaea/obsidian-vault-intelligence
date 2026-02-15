import { App, PluginSettingTab, Plugin, ButtonComponent } from "obsidian";

import { renderAdvancedSettings } from "./sections/advanced";
import { renderConnectionSettings } from "./sections/connections";
import { renderExplorerSettings } from "./sections/explorer";
import { renderGardenerSettings } from "./sections/gardener";
import { renderResearcherSettings } from "./sections/researcher";
import { renderStorageSettings } from "./sections/storage";
import { SettingsTabContext } from "./SettingsTabContext";
import { IVaultIntelligencePlugin } from "./types";

type TabId = "connections" | "researcher" | "explorer" | "gardener" | "storage" | "advanced";

interface TabDefinition {
    id: TabId;
    label: string;
    render: (context: SettingsTabContext) => void;
}

export class VaultIntelligenceSettingTab extends PluginSettingTab {
    plugin: IVaultIntelligencePlugin;
    private tabContentMap: Map<TabId, HTMLElement> = new Map();
    private tabButtons: Map<TabId, ButtonComponent> = new Map();
    private lastActiveTabId: TabId | null = null;

    constructor(app: App, plugin: IVaultIntelligencePlugin) {
        // We cast to 'Plugin' because the parent class expects the strict Obsidian Plugin type,
        // but we know our interface is compatible at runtime.
        super(app, plugin as unknown as Plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("vi-settings-tab-root");

        const tabs: TabDefinition[] = [
            { id: "connections", label: "Connection", render: renderConnectionSettings },
            { id: "researcher", label: "Researcher", render: renderResearcherSettings },
            { id: "explorer", label: "Explorer", render: renderExplorerSettings },
            { id: "gardener", label: "Gardener", render: renderGardenerSettings },
            { id: "storage", label: "Storage", render: renderStorageSettings as (context: SettingsTabContext) => void },
            { id: "advanced", label: "Advanced", render: renderAdvancedSettings },
        ];

        const navEl = containerEl.createDiv("vi-settings-tabs-nav");
        const contentWrapper = containerEl.createDiv("vi-settings-tabs-content");

        // Clear maps on re-display
        this.tabContentMap.clear();
        this.tabButtons.clear();

        tabs.forEach((tab) => {
            const btn = new ButtonComponent(navEl)
                .setButtonText(tab.label)
                .onClick(() => this.activateTab(tab.id, tabs, contentWrapper));

            this.tabButtons.set(tab.id, btn);
        });

        // Activate last active tab or default to first
        const initialTab = this.lastActiveTabId && tabs.some(t => t.id === this.lastActiveTabId)
            ? this.lastActiveTabId
            : "connections";
        this.activateTab(initialTab, tabs, contentWrapper);
    }

    override hide(): void {
        void this.plugin.graphSyncOrchestrator.commitConfigChange();
        super.hide();
    }

    private activateTab(id: TabId, tabs: TabDefinition[], contentWrapper: HTMLElement): void {
        const definition = tabs.find(t => t.id === id);
        if (!definition) return;

        // Lazy load content if it doesn't exist
        if (!this.tabContentMap.has(id)) {
            const tabContainer = contentWrapper.createDiv("vi-settings-tab");
            const context: SettingsTabContext = {
                app: this.app,
                containerEl: tabContainer,
                plugin: this.plugin
            };
            definition.render(context);
            this.tabContentMap.set(id, tabContainer);
        }

        // Deactivate previous tab
        if (this.lastActiveTabId && this.lastActiveTabId !== id) {
            this.tabContentMap.get(this.lastActiveTabId)?.removeClass("is-active");
            const prevBtn = this.tabButtons.get(this.lastActiveTabId);
            if (prevBtn) {
                prevBtn.buttonEl.removeClass("is-active");
                prevBtn.removeCta();
            }
        }

        // Activate new tab
        this.tabContentMap.get(id)?.addClass("is-active");
        const activeBtn = this.tabButtons.get(id);
        if (activeBtn) {
            activeBtn.buttonEl.addClass("is-active");
            activeBtn.setCta();
        }

        this.lastActiveTabId = id;
    }
}

