# Agent Support

We are working on expanding the support for local embedding models for this Obsidian plugin. We are currently using Transformer.js from HuggingFace.

First, we want to change the default embedding models to include:

1. Small: [MinishLab/potion-base-8M](https://huggingface.co/minishlab/potion-base-8M) - this is an ultralight Static Embedding (Model2Vec) model.
    - Why it wins: In 2026, this is the go-to for "smaller computing devices." It distils the knowledge of a large transformer into a static look-up table. It is orders of magnitude faster than any Transformer model because it removes the heavy self-attention layers entirely.

2. Balanced: [Xenova/bge-small-en-v1.5](https://huggingface.co/Xenova/bge-small-en-v1.5) - this is a small BGE model / BERT transformer.
    - Why it wins: The BGE (BAAI General Embedding) family replaced MiniLM as the efficiency king. It offers significantly better retrieval performance on the MTEB leaderboard. The v1.5 variants are robust and well-supported in Transformers.js.
    - Max context: 512 tokens
    - Approx. word count: 350 - 400 words
    - Behavior on overflow: Silent Truncation (ignores the rest)

3. Advanced: [Xenova/nomic-embed-text-v1.5](https://huggingface.co/Xenova/nomic-embed-text-v1.5) - Matryoshka Representation Learning (MRL) model.
    - Why it wins: his model supports Matryoshka embeddings. This means you can run the model once but purely slice the output vector (e.g., take the first 64 or 128 dimensions instead of the full 768) to save storage and compute during the similarity search phase, without retraining.
    - Max context: 8,192 tokens **but** for our browser based implementation it is safer to treat it as having a 2,048 limit for performance consistency.
    - Approx. word count: 6,000 words, but see above.
    - Behaviour on overflow: Silent Truncation

The last two models are quantized models: we need to be sure we download the correct version (and that we handle Model2Vec models without quantized versions correctly).

The small `MinishLab/potion-base-8M` model is the default model for this plugin.

We should also allow for the user to specify their own model identifier in the settings, using the HuggingFace model identifier format. We need to ensure it is a ONNX compatible model and we need to handle quantized and non-quantized models gracefully.

I **think** the tests for compatibility on the user selected model must include:

1. It has ONNX weights: The repository must contain .onnx files (specifically model_quantized.onnx for the web/edge).
2. It has a Tokenizer: It must have tokenizer.json or tokenizer_config.json.
3. It uses a Supported Architecture: The model type (in config.json) must be implemented in Transformers.js (e.g., bert, mpnet, nomic_bert).

Here is a draft for code to validate the model (IMPORTANT: Modify as needed and this is not tested):

```typescript
async function validateModel(modelId: string) {
    const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;
    
    // Step 1: Check for the Config (Architecture)
    const configUrl = `${baseUrl}/config.json`;
    const configResp = await fetch(configUrl);
    
    if (!configResp.ok) {
        return { valid: false, reason: "Model repository not found or missing config.json" };
    }
    
    const config = await configResp.json();
    // Common supported architectures in Transformers.js
    const supportedArchs = ['BertModel', 'NomicBertModel', 'MPNetModel', 'RobertaModel', 'DistilBertModel', 'XLM_RoBERTaModel'];
    // config.architectures is an array, e.g. ["NomicBertModel"]
    const isSupportedArch = config.architectures?.some((arch: string) => supportedArchs.includes(arch));
    
    if (!isSupportedArch) {
        return { 
            valid: false, 
            reason: `Unsupported architecture: ${config.architectures?.join(', ')}. Currently supporting: BERT, NomicBERT, MPNet, etc.` 
        };
    }

    // Step 2: Check for ONNX Files
    // Transformers.js usually looks for 'onnx/model_quantized.onnx' or just 'model_quantized.onnx'
    // For 99% of web-ready models (like Xenova's), it's in an 'onnx' subfolder.
    const filePathsToCheck = [
        'onnx/model_quantized.onnx', // Standard location for Xenova models
        'model_quantized.onnx',      // Root location (rare but possible)
        'onnx/model.onnx',           // Unquantized (Standard location)
        'model.onnx'                 // Unquantized (Root)
    ];

    let hasOnnx = false;
    for (const path of filePathsToCheck) {
        // We use a HEAD request to check existence without downloading the file
        const resp = await fetch(`${baseUrl}/${path}`, { method: 'HEAD' });
        if (resp.ok) {
            hasOnnx = true;
            break;
        }
    }

    if (!hasOnnx) {
        return { 
            valid: false, 
            reason: "No ONNX weights found. Please use a 'Xenova/' version of this model or one with an 'onnx' folder." 
        };
    }

    return { valid: true };
}
```

We will still support the Gemini embedding model.


## Changes to make

This is an **incomplete** list of changes to make:

1. Change the current model selection to be a dropdown of the three models listed above and a custom model option.
2. If custom model is selected, show a text input for the model identifier. Validate the model identifier using a function similar in spirit to the function above. If it is invalid, show an error message.
3. Make sure that we use the right tokeniser for the model.
4. Make sure we store the model identifier in the `data/index.json` file so we can re-embed the documents when it changes.
5. Make sure we re-embed the documents when the model changes in the settings.
6. Add a button to re-embed the documents.
7. Add a button to re-download the model. If it has changed, we should re-embed the documents.

## Testing

We should test the following to ensure the plugin works as expected:

1. `npm run lint` completes with no errors and warnings.
2. `npm run build` completes with no errors and warnings.
3. The console log in the DevTools of the Obsidian instance shows no errors or warnings.
    - We start Obsidian with `flatpak run md.obsidian.Obsidian --remote-debugging-port=9223 --remote-allow-origins=*` (or a random port number instead of 9223 in this example).
    - Google Antigravity can connect to the remote debugging port and read the console log.
4. The console log in the DevTools of the Obsidian instance shows no errors when we:
    - Build the plugin which will automatically reload it in the Obsidian instance.
    - Open the plugin settings.
    - Open the plugin settings and change the model. This should trigger a re-embedding of the documents.
5. Add additional tests for the entire UI and process flow.


