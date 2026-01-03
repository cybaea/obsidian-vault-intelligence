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

### Case Study: Personal Finance

**Setup:** You have a note named `Monthly Expenses` containing a Markdown table of transactions (Date, Category, Amount).

**Prompt:**
> "Read `@Monthly Expenses`. First, calculate the standard deviation of my 'Groceries' transactions to measure volatility. Then, group the data by month to find the total Q4 spend and forecast my January total based on the trend."

**Why this works:** The agent writes code to parse your table into a dataframe, runs the statistical functions (which an LLM cannot guess accurately), and interprets the result in context.

### More Examples

* **Quantified Self:** "Extract my weight logs from all notes in the `@Journals/2025` folder. Plot a trend line and calculate the average weekly rate of change."
* **Project Management:** "Look at `@Project Beta`. Sum the total estimated hours. If I work 6 hours a day with a 15% buffer for delays, what is the realistic completion date?"
* **Logic Puzzles:** "Solve this logic puzzle: If A implies B, and B implies C, but C is false, what is A?"


