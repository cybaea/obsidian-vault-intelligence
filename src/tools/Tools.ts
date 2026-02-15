import { requestUrl } from "obsidian";

import { GeminiService } from "../services/GeminiService";
import { GraphService } from "../services/GraphService";
import { isExternalUrl } from "../utils/url";

export interface Tool {
    description: string;
    execute(args: Record<string, unknown>): Promise<string>;
    name: string;
}

export class VaultSearchTool implements Tool {
    name = "vault_search";
    description = "Search the user's personal vault for information. Args: { query: string }";
    graphService: GraphService;
    gemini: GeminiService;

    constructor(graphService: GraphService, gemini: GeminiService) {
        this.graphService = graphService;
        this.gemini = gemini;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string | undefined;
        if (!query) return "Error: No query provided.";

        const results = await this.graphService.search(query, 3); // Top 3

        if (results.length === 0) return "No relevant documents found in vault.";

        // Retrieve content
        // Note: vectorStore stores path, we need to read content.
        // But VectorStore is in services, we need app access. 
        // We can pass app or make VectorStore read it. 
        // VectorStore.indexFile reads it. 
        // Let's assume we can read via plugin app reference in VectorStore or here. 
        // Ideally VectorStore should have a 'read' method or we use the plugin app.
        // Since we are in src/tools, we might not have direct app access unless passed.
        // Let's refactor to make sure we have access.

        // For now, return paths. real content reading needs App.
        return `Found documents: ${results.map(r => r.path).join(", ")}`;
    }
}

export class WebSearchTool implements Tool {
    name = "google_search";
    description = "Search the web for live information. Args: { query: string }";

    // This might just be a flag for Gemini Grounding, but if we want manual control:
    execute(_args: Record<string, unknown>): Promise<string> {
        return Promise.resolve("Use the built-in Google Search Grounding capability of the model instead.");
    }
}

export class UrlReaderTool implements Tool {
    name = "read_url";
    description = "Read the content of a specific URL. Args: { url: string }";

    async execute(args: Record<string, unknown>): Promise<string> {
        const urlString = args.url as string | undefined;
        if (!urlString) return "Error: No URL provided.";

        if (!isExternalUrl(urlString)) {
            return "Error: Access to local network, private IP addresses, or restricted protocols is strictly forbidden for security reasons.";
        }

        try {
            const response = await requestUrl({ url: urlString });
            // Simple HTML to text or just return raw up to limit
            return response.text.substring(0, 5000) + "... (truncated)";
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return `Error reading URL: ${message}`;
        }
    }
}
