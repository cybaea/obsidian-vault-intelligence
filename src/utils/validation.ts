import { requestUrl } from "obsidian";
import { logger } from "./logger";

export interface ValidationResult {
    valid: boolean;
    reason?: string;
    recommendedDims?: number;
}

interface HFConfig {
    architectures?: string[];
    hidden_size?: number;
    d_model?: number;
    dim?: number;
}

export async function validateModel(modelId: string): Promise<ValidationResult> {
    const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;

    // Step 1: Check for the Config (Architecture)
    const configUrl = `${baseUrl}/config.json`;

    try {
        const configResp = await requestUrl({ url: configUrl });

        if (configResp.status !== 200) {
            return { valid: false, reason: "Model repository not found or missing config.json" };
        }

        const config = configResp.json as HFConfig;
        // Common supported architectures in Transformers.js
        const supportedArchs = ['BertModel', 'NomicBertModel', 'MPNetModel', 'RobertaModel', 'DistilBertModel', 'XLM_RoBERTaModel'];
        // config.architectures is an array, e.g. ["NomicBertModel"]
        const architectures = config.architectures || [];
        const isSupportedArch = architectures.some((arch) => supportedArchs.includes(arch));

        if (!isSupportedArch) {
            return {
                valid: false,
                reason: `Unsupported architecture: ${architectures.join(', ')}. Currently supporting: BERT, NomicBERT, MPNet, etc.`
            };
        }

        // Guess dimensions from config
        const dims: number | undefined = config.hidden_size || config.d_model || config.dim;

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
            // We use a HEAD request (or simple GET with Obsidian's requestUrl) to check existence 
            // requestUrl doesn't strictly support HEAD with clean output in all cases, but we can try just checking 404
            try {
                // We just want to know if it exists. 
                // Since we can't easily do a pure HEAD without downloading body in some environments,
                // we'll try to rely on the fact that if we request it, a 200 means it exists.
                // However, downloading 20MB just to check is bad.
                // Obsidian requestUrl supports method 'HEAD'.
                const resp = await requestUrl({ url: `${baseUrl}/${path}`, method: 'HEAD' });
                if (resp.status === 200) {
                    hasOnnx = true;
                    break;
                }
            } catch (e) {
                // 404 throws an error in requestUrl? verify behavior.
                // Usually it just returns status.
                logger.debug(`[Validator] Check failed for ${path}`, e);
            }
        }

        if (!hasOnnx) {
            return {
                valid: false,
                reason: "No ONNX weights found. Please use a 'Xenova/' version of this model or one with an 'onnx' folder."
            };
        }

        return { valid: true, recommendedDims: dims };

    } catch (e) {
        logger.error("Validation error", e);
        return { valid: false, reason: "Network error or invalid model ID." };
    }
}
