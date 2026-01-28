# Getting started with Vault Intelligence

Transform your Obsidian vault into an active research partner in 5 minutes.

## 1. Install

Please use BRAT for installation:

1.  Install the BRAT plugin from the Community Plugins store.
2.  Open Settings > BRAT > Beta Plugin List.
3.  Click Add Beta plugin and enter: `https://github.com/cybaea/obsidian-vault-intelligence`
4.  Click Add Plugin.
5.  Go to Settings > Community plugins and ensure Vault Intelligence is enabled.

## 2. Connect intelligence

You need an API key to power the AI reasoning. [Why an API key?](../explanation/computing-model.md)

1.  Get a free API key from [Google AI Studio](https://aistudio.google.com/).
2.  In Obsidian, go to Settings > Vault Intelligence.
3.  Paste your key into the Google API key field.

## 3. Your first chat

Let's see the magic immediately.

1.  Click the Vault Intelligence icon <span class="vi-doc-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-brain-circuit"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/></svg></span> in the left ribbon to open the Researcher sidebar.
    
    ![The Obsidian Sidebar highlighting the Vault Intelligence brain circuit icon](/images/screenshots/obsidian-sidebar-icon.png)

2.  Click the Agent dropdown and select Researcher.
3.  Type this exact query (or pick a topic relevant to your notes):

    > "What is the most interesting connection between my notes on [Topic A] and [Topic B]?"

    _(Replace [Topic A]/[Topic B] with real topics from your vault, eg "Gardening" and "Recipes")_

### What just happened?

-   It read your notes: The agent found relevant files without you searching for keywords.
-   It reasoned: It didn't just copy text; it understood the relationship between the concepts.
-   It answered: You got a synthesized answer, cited with links to your source files.

    ![A chat response showing citations as clickable links](/images/screenshots/researcher-citations.png)


## Next steps

Now that you are connected, try a specific workflow:

-   [Chat with specific documents](../how-to/researcher-workflows.md)
-   [Analyse data with Python](../how-to/data-analysis.md)
-   [Clean up your vault structure](../how-to/maintain-vault.md)
