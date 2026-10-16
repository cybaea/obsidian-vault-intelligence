# Using OpenAI-compatible endpoints (2026 Edition)

Vault Intelligence can reason against any server that speaks the OpenAI Chat Completions protocol: the Kilo Gateway, LM Studio, llama.cpp server, vLLM, OpenRouter, and the OpenAI API itself. This guide covers connecting, authenticating, and pairing embeddings, as of our October 2026 updates.

> [!NOTE]
> The OpenAI-compatible connection is separate from the Ollama connection. They speak different wire protocols, so pointing one at the other returns errors — and both connections can be active at the same time.

## 1. Connecting to a server

In settings, open **Connections** and either pick a preset or fill in the **OpenAI-compatible endpoint** manually. The base URL is everything up to (but excluding) the `/chat/completions` path:

| Server | Base URL |
| :--- | :--- |
| Kilo Gateway | `https://ai-gateway.kilo.ai/api/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp server | `http://localhost:8080/v1` |
| vLLM | `http://localhost:8000/v1` |

Most servers require an API key sent as an `Authorization: Bearer <your_api_key>` header. The **Connection preset** dropdown fills in the endpoint and a secure, keychain-backed header for common providers; the **OpenAI-compatible headers** editor handles any other header-based scheme, with a Secret toggle that stores values in your device keychain instead of your synced settings.

The **Test connection** button probes the server's `GET /models` list and reports Online, Offline, or "Unauthorized (check your API key)" when the server answered but rejected the credentials.

### Kilo Gateway walkthrough

1. In **Connections**, pick **Kilo.ai (OpenAI-compatible)** from the **Connection preset** dropdown.
2. Paste your key into the **Kilo API key** field. It is stored in the device keychain and sent as the Bearer header automatically.
3. Click **Test connection**. When the status shows Online, refresh the model list (the preset fetches it for you; use the **Refresh model list** button if you changed things manually) and pick a model in the Researcher settings.

## 2. Embeddings: know what your server offers

Embeddings for the Explorer are a separate setting from the reasoning model, and not every OpenAI-compatible server offers them:

- The Kilo Gateway and OpenRouter do not host embedding models at all.
- LM Studio, vLLM, llama.cpp, and the OpenAI API do offer `/embeddings`, and you can select them as the **Embedding provider** in the Explorer settings.

If your reasoning server has no embeddings, pair it with one of the other providers: Google Gemini or Voyage AI (cloud), Transformers.js (100% local, no server), or a local Ollama instance.

> [!WARNING]
> Changing the embedding provider or model triggers a full vault re-embedding on exit.

## 3. Selecting models

After a successful connection, models appear in every model dropdown under the **OpenAI-compatible** group. Model IDs carry the `openai-compat/` namespace prefix, and vendor slashes inside the name are preserved: the Kilo model `anthropic/claude-sonnet-4.5` becomes `openai-compat/anthropic/claude-sonnet-4.5`. When typing a custom model ID, enter it with the prefix.

If the dropdown shows no models, the server either did not respond to `GET /models` or requires authentication; check the headers and use **Test connection**.

## 4. Context budgets

OpenAI-compatible models use the same conservative default context budget as local models, because the plugin cannot know a remote model's context window from the protocol. If your gateway model supports a much larger context (for example a 200k-token model served by the Kilo Gateway), raise the budget for that specific model ID in the **Advanced → Model context overrides** setting instead of the global budget.

## 5. Capabilities and fallbacks

- **Tool calling** uses the OpenAI function-calling format natively, which the Kilo Gateway and mainstream local servers support.
- **Structured output** (used by the Gardener and other JSON replies) is requested with a `json_object` response format; servers that reject it fall back to a schema-in-prompt request, and markdown code fences around the JSON are stripped automatically.
- **Web grounding and native code execution** are not available through this connection; those features need a Gemini model.

## 6. Troubleshooting

- **401 Unauthorized**: the `Authorization` Bearer header is missing or the key is wrong. Re-enter it via the preset's API key field or the headers editor.
- **404 Not Found**: the base URL is wrong, or the server is not OpenAI-compatible. Do not point this connection at an Ollama server — that is a different protocol with different paths; use the Ollama connection instead.
- **Empty model list**: the server did not answer `GET /models`. Some proxies only expose it with authentication headers present.
- **"This endpoint does not offer embeddings"**: the server has no `/embeddings` route (the Kilo Gateway, for example). Pick a different embedding provider as described above.
- **Streaming cut short or no answer**: check the server console; local servers such as llama.cpp log request errors that the plugin surfaces as provider errors.