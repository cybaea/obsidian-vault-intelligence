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

1.  Click the robot icon in the left ribbon to open the Researcher sidebar.
    
    ![The Obsidian Sidebar highlighting the Vault Intelligence robot icon](/images/screenshots/obsidian-sidebar-icon.png)

    > [!NOTE] Screenshot Needed
    > Capture the Obsidian left ribbon, highlighting the Vault Intelligence (robot) icon.
2.  Click the Agent dropdown and select Researcher.
3.  Type this exact query (or pick a topic relevant to your notes):

    > "What is the most interesting connection between my notes on [Topic A] and [Topic B]?"

    _(Replace [Topic A]/[Topic B] with real topics from your vault, eg "Gardening" and "Recipes")_

### What just happened?

-   It read your notes: The agent found relevant files without you searching for keywords.
-   It reasoned: It didn't just copy text; it understood the relationship between the concepts.
-   It answered: You got a synthesized answer, cited with links to your source files.

    ![A chat response showing citations as clickable links](/images/screenshots/researcher-citations.png)

    > [!NOTE] Screenshot Needed
    > Capture a successful Researcher chat response that clearly shows citations and links to vault source files.

## Next steps

Now that you are connected, try a specific workflow:

-   [Chat with specific documents](../how-to/researcher-workflows.md)
-   [Analyse data with Python](../how-to/data-analysis.md)
-   [Clean up your vault structure](../how-to/maintain-vault.md)
