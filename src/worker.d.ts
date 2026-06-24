// Type definitions for inline workers (esbuild-plugin-inline-worker)
declare module "*.worker" {
    class InlineWorker extends Worker {
        constructor(options?: WorkerOptions);
    }
    export default InlineWorker;
}

declare module "@huggingface/transformers/src/env.js" {
    import { env } from '@huggingface/transformers';
    export { env };
}

declare module "@huggingface/transformers/src/models/auto/tokenization_auto.js" {
    import { AutoTokenizer } from '@huggingface/transformers';
    export { AutoTokenizer };
}

declare module "@huggingface/transformers/src/models/auto/modeling_auto.js" {
    import { AutoModel } from '@huggingface/transformers';
    export { AutoModel };
}

declare module "@huggingface/transformers/src/utils/tensor.js" {
    import { Tensor } from '@huggingface/transformers';
    export { Tensor };
}

declare module "@huggingface/transformers/src/pipelines/feature-extraction.js" {
    import { FeatureExtractionPipeline } from '@huggingface/transformers';
    export { FeatureExtractionPipeline };
}
