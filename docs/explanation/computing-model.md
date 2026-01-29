# Why Gemini? (The Computing Model)

Vault Intelligence uses Google Gemini 3 for reasoning. This architectural choice balances privacy, performance, and accessibility.

## Reasoning on the Cloud, Searching on Device

We use a hybrid computing model to ensure your vault remains private while giving you access to state-of-the-art intelligence.

- Local Indexing: Your notes are indexed entirely on your machine. The Vector Search and graph analysis happen locally in Obsidian.
- Cloud Reasoning: Once the relevant snippets of your notes are identified locally, they are sent to the Gemini API for synthesis and reasoning.

## Rationale for an API Key

_1. Performance on all devices_

High-end AI models require massive GPU memory (VRAM). By using Gemini via API, you get elite-level reasoning even on older laptops or mobile devices without draining your battery or slowing down your workspace.

_2. Multilingual fluency_

Gemini is natively trained on dozens of languages. It can synthesize connections between your notes across different languages with a level of nuance that local "small" models cannot yet match.

_3. Privacy through isolation_

Unlike web-based AI tools, Vault Intelligence does not "upload your vault" to the cloud.

- Only the specific contexts identified by your local search are sent to the API.
- Data sent to the API is strictly used for your response; it is not used to train Google's models.
- You control your key and your usage directly.

## Comparison: Local vs Cloud

| Feature | Local Models (ONNX) | Cloud Models (Gemini) |
| :--- | :--- | :--- |
| Privacy | Complete | High (Context-only) |
| Speed | Fast (No latency) | Dynamic (Network dependent) |
| Reasoning Power | Limited (Summary only) | Extreme (Synthesis, Logic) |
| Hardware Cost | High (Needs modern GPU) | Zero |
| Battery Life | Heavier | Minimal |

By default, we use local models for search (indexing) and cloud models for reasoning (chat/gardener). This gives you the speed of local search with the power of modern AI.
