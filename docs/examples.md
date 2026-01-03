# Example Prompts

Get the most out of Vault Intelligence with these advanced prompts.

## 🧠 Reasoning & Synthesis

* "Synthesize my last 5 years of journals. How has my perspective on [Topic] changed?"
* "Compare the arguments in `@Note A` and `@Note B`. Where do they disagree?"
* "Read `@Project Alpha` and draft a pre-mortem. What are the likely failure modes?"
* "Create a summary of all notes in the `@Meetings` folder related to 'Client X'."


## 🕵️ Grounding & Fact Checking

* "What do I know about [Company X] in my notes? Verify if this information is still current against Google Search."
* "I wrote that [Event] happened in 2021. Is that factually correct?"
* "Find the latest stock price for AAPL and update my note @'Tech Portfolio'."

## 🧮 Computational Solver (Python)

*Requires 'Enable code execution' to be ON.*

The true power of the solver is **analyzing your own data**. The agent can extract tables, lists, or CSV data from your notes and run real Python analysis on them.

### Personal Finance & Data

* **Context:** You have a note called `Monthly Expenses` with a markdown table of costs.
* **Prompt:** "Read `@Monthly Expenses`. Calculate the standard deviation of my grocery spending and forecast next month's total using a linear trend."

### Health & Quantified Self

* **Context:** You log your weight or run times in your `Daily Journal` notes.
* **Prompt:** "Extract my weight logs from all notes in the `@Journals/2025` folder. Plot a trend line and tell me the average weekly rate of change."

### Project Estimation

* **Context:** You have a project note with a list of tasks and estimated hours.
* **Prompt:** "Look at `@Project Beta`. Sum the total estimated hours. If I work 6 hours a day with a 15% buffer for delays, what is the realistic completion date?"

### Vault Analytics

* **Prompt:** "Analyze the creation dates of all notes in `@Inbox`. Create a bar chart showing which days of the week I am most productive."
