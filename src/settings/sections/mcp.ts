import { Setting, ButtonComponent, ToggleComponent } from "obsidian";

import { SettingsTabContext } from "../SettingsTabContext";
import { MCPServerConfig } from "../types";

export function renderMcpSettings({ containerEl, plugin }: SettingsTabContext): void {
    containerEl.empty();
    
    containerEl.createEl("h3", { text: 'External ' + 'MCP' + ' servers' });
    containerEl.createEl("p", { 
        text: "Connect external model context protocol (" + "MCP" + ") servers to allow AI models to perform external actions, such as fetching weather, reading databases, or integrating with other tools. Caution: Avoid storing plaintext secrets in the environment variables; future versions will support Secure Storage interpolation." 
    });

    const listContainer = containerEl.createDiv("mcp-server-list");
    listContainer.setCssProps({ "margin-bottom": "2em" });
    
    const renderList = () => {
        listContainer.empty();
        const servers = plugin.settings.mcpServers || [];
        
        if (servers.length === 0) {
            listContainer.createEl("em", { text: 'No ' + 'MCP' + ' servers configured.' });
        } else {
            servers.forEach((server, index) => {
                const serverDiv = listContainer.createDiv("mcp-server-item");
                serverDiv.setCssProps({ "border": "1px solid var(--background-modifier-border)", "border-radius": "8px", "margin-bottom": "1em", "padding": "1em" });
                
                const headerRow = serverDiv.createDiv("mcp-server-header");
                headerRow.setCssProps({ "align-items": "center", "display": "flex", "justify-content": "space-between", "margin-bottom": "0.5em" });
                
                const title = headerRow.createEl("h4", { text: server.name || "Unnamed Server" });
                title.setCssProps({ "margin": "0" });
                
                // Status indicator
                const mcpManager = plugin.mcpClientManager as { connections?: Map<string, { status: string }> };
                const connection = mcpManager.connections ? mcpManager.connections.get(server.id) : undefined;
                let status = 'disabled';
                if (connection) status = connection.status;
                else if (server.enabled) status = 'disconnected';
                
                const statusBadge = headerRow.createSpan("mcp-status");
                statusBadge.textContent = status.toUpperCase();
                statusBadge.setCssProps({ "border-radius": "4px", "font-size": "0.8em", "margin-left": "10px", "padding": "2px 6px" });
                if (status === 'connected') statusBadge.setCssProps({ "background-color": "var(--interactive-success)" });
                else if (status === 'error' || status === 'untrusted') statusBadge.setCssProps({ "background-color": "var(--interactive-error)" });
                else statusBadge.setCssProps({ "background-color": "var(--background-modifier-border)" });
                
                new ToggleComponent(headerRow)
                    .setValue(server.enabled)
                    .onChange(async (v) => {
                        if (plugin.settings.mcpServers && plugin.settings.mcpServers[index]) plugin.settings.mcpServers[index].enabled = v;
                        await plugin.saveSettings(false);
                        renderList(); // re-render to reflect disabled state logic if needed
                    });
                
                const detailsRow = serverDiv.createDiv("mcp-server-details");
                detailsRow.createEl("p", { cls: "setting-item-description", text: `Type: ${server.type === 'stdio' ? 'Stdio (Local Process)' : 'SSE (Remote URL)'}` });
                
                const errMessage = (connection as { errorMessage?: string })?.errorMessage;
                if (status === 'error' && errMessage) {
                    const err = detailsRow.createEl("p", { cls: "setting-item-description", text: `Error: ${errMessage}` });
                    err.setCssProps({ "color": "var(--text-error)" });
                }
                
                const btnRow = serverDiv.createDiv("mcp-server-actions");
                btnRow.setCssProps({ "margin-top": "1em" });
                
                new ButtonComponent(btnRow)
                    .setButtonText("Edit")
                    .onClick(() => {
                        renderEditor(server, index);
                    });
                    
                new ButtonComponent(btnRow)
                    .setButtonText("Remove")
                    .setWarning()
                    .onClick(async () => {
                        plugin.settings.mcpServers.splice(index, 1);
                        await plugin.saveSettings(false);
                        renderList();
                    });
            });
        }
    };

    const renderEditor = (server: MCPServerConfig | null, index: number = -1) => {
        containerEl.empty();
        containerEl.createEl("h3", { text: server ? 'Edit ' + 'MCP' + ' server' : 'Add ' + 'MCP' + ' server' });
        
        let currentConfig: MCPServerConfig = server ? JSON.parse(JSON.stringify(server)) as MCPServerConfig : {
            enabled: true,
            id: crypto.randomUUID(),
            name: "",
            requireExplicitConfirmation: true,
            type: "stdio",
        };

        new Setting(containerEl)
            .setName("Server name")
            .setDesc('A friendly name for this server (e.g., ' + '"GitHub" + " info)")')
            .addText(text => text
                .setValue(currentConfig.name)
                .onChange(v => currentConfig.name = v)
            );

        new Setting(containerEl)
            .setName("Connection type")
            .setDesc("Stdio runs a local binary. " + "SSE" + " connects to a remote " + "URL" + ".")
            .addDropdown(drop => drop
                .addOptions({ "sse": "SSE URL (remote)", "stdio": "Stdio (desktop only)" })
                .setValue(currentConfig.type)
                .onChange(v => {
                    currentConfig.type = v as "stdio" | "sse";
                    renderEditor(currentConfig, index); // re-render fields
                })
            );

        if (currentConfig.type === "stdio") {
            const cmdSetting = new Setting(containerEl)
                .setName("Command")
                .setDesc("Absolute path to the executable (e.g. /usr/local/bin/python or /opt/homebrew/bin/node). Avoid wrappers like 'npx' or relative paths.")
                .addText(text => text
                    .setValue(currentConfig.command || "")
                    .onChange(v => currentConfig.command = v)
                );
            // Highlight warning
            cmdSetting.descEl.setCssProps({ "color": "var(--text-warning)" });

            new Setting(containerEl)
                .setName("Arguments")
                .setDesc("Enter arguments line by line (one argument per line). Avoids command-line string escaping issues.")
                .addTextArea(text => {
                    text.setValue((currentConfig.args || []).join('\n'));
                    text.onChange(v => {
                        currentConfig.args = v.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    });
                    text.inputEl.rows = 3;
                    return text;
                });

            const envSetting = new Setting(containerEl)
                .setName("Environment variables")
                .setDesc("Provide as valid JSON: {\"TOKEN\": \"value\"}. WARNING: Do NOT put plaintext secrets here if you sync your vault across untrusted devices. They will be merged with your system environment.")
                .addTextArea(text => {
                    text.setValue(currentConfig.env || "");
                    text.onChange(v => currentConfig.env = v);
                    text.inputEl.rows = 4;
                    return text;
                });
            envSetting.descEl.setCssProps({ "color": "var(--text-warning)" });
        } else {
            new Setting(containerEl)
                .setName('SSE ' + 'URL')
                .setDesc('The full HTTP(S) url of the ' + 'SSE' + ' endpoint.')
                .addText(text => text
                    .setValue(currentConfig.url || "")
                    .onChange(v => currentConfig.url = v)
                );
        }

        new Setting(containerEl)
            .setName("Require explicit confirmation")
            .setDesc("If on, you will be prompted to confirm every execution of this server's tools. Turn off only for explicitly safe, read-only tools.")
            .addToggle(toggle => toggle
                .setValue(currentConfig.requireExplicitConfirmation)
                .onChange(v => currentConfig.requireExplicitConfirmation = v)
            );

        const btnRow = containerEl.createDiv();
        btnRow.setCssProps({ "display": "flex", "gap": "1em", "margin-top": "2em" });

        new ButtonComponent(btnRow)
            .setButtonText("Cancel")
            .onClick(() => {
                renderMcpSettings({ app: plugin.app, containerEl, plugin }); // Go back
            });

        new ButtonComponent(btnRow)
            .setButtonText("Save")
            .setCta()
            .onClick(async () => {
                if (!plugin.settings.mcpServers) plugin.settings.mcpServers = [];
                
                if (index >= 0) {
                    plugin.settings.mcpServers[index] = currentConfig;
                } else {
                    plugin.settings.mcpServers.push(currentConfig);
                }
                await plugin.saveSettings(false);
                renderMcpSettings({ app: plugin.app, containerEl, plugin }); // Go back
            });
    };

    renderList();

    if ((plugin.settings.mcpServers || []).length > 0) {
        containerEl.createEl("br");
    }

    new ButtonComponent(containerEl)
        .setButtonText('Add ' + 'MCP' + ' server')
        .setCta()
        .onClick(() => {
            renderEditor(null);
        });
}
