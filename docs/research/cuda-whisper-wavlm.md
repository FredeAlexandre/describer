# Can Whisper-tiny and WavLM run on CUDA, and at which dtype?

**Answer:** Yes, on Linux x64 Node via Transformers.js `device: "cuda"`, but only with **floating-point** ONNX graphs. `Xenova/whisper-tiny` has complete **fp16** and **fp32** encoder+decoder files; `Xenova/wavlm-base-plus-sv` has **fp32** only (no `_fp16` file on the Hub). The **q8** files this repo already caches (`*_quantized.onnx`) are dynamic-integer graphs (`ConvInteger`, `DynamicQuantizeLinear`, `MatMulInteger`). CUDA does not implement `ConvInteger` or `DynamicQuantizeLinear`, and its `MatMulInteger` kernel is **int8-only**, while those q8 graphs follow the CPU path that uses **uint8**. Pointing the cached q8 files at CUDA therefore does not run the quantized ops on GPU: session creation fails if CPU fallback is off, or the integer nodes stay on CPU (with host/device copies) if it is on. Weight files for a CUDA-viable pair are on the order of **~76 MiB (Whisper fp16) + ~384 MiB (WavLM fp32)**. No cited source publishes a measured peak-VRAM number for these two Xenova graphs.

This note does not change the product. ADR-0005 and ADR-0006 already pin these two model IDs; the Processor currently loads them at `dtype: "q8"` with no `device` (Node default: CPU).

## What the product already loads

ADR-0005 uses `Xenova/whisper-tiny` in-process via Transformers.js. ADR-0006 uses `Xenova/wavlm-base-plus-sv` on the same runtime. The Processor in `src/core/on-device-processor.ts` sets `dtype: "q8"` on both `pipeline(...)` and `AutoModelForXVector.from_pretrained(...)` and does not pass `device`.

Transformers.js Node defaults:

- Device: `cpu` when `device` is omitted (`selectDevice` in `@huggingface/transformers` 4.3.0, `src/utils/devices.js`).
- Dtype: `fp32` unless the device is `wasm`, which defaults to `q8` (`DEFAULT_DEVICE_DTYPE_MAPPING` in `src/utils/dtypes.js`). The Processor overrides dtype to `q8` explicitly.

The on-disk cache at `~/.cache/describer/whisper/` matches that override: only quantized ONNX files are present.

| Cached file | Bytes |
| --- | ---: |
| `Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx` | 10,124,910 |
| `Xenova/whisper-tiny/onnx/decoder_model_merged_quantized.onnx` | 30,727,765 |
| `Xenova/wavlm-base-plus-sv/onnx/model_quantized.onnx` | 101,683,453 |

Those sizes match the Hub listing for the same paths (see below).

## Hub ONNX files

Transformers.js maps `dtype` to a filename suffix (`DEFAULT_DTYPE_SUFFIX_MAPPING` in `src/utils/dtypes.js`):

| `dtype` | Suffix | File example |
| --- | --- | --- |
| `fp32` | *(empty)* | `encoder_model.onnx`, `model.onnx` |
| `fp16` | `_fp16` | `encoder_model_fp16.onnx` |
| `q8` | `_quantized` | `encoder_model_quantized.onnx` |
| `int8` | `_int8` | `encoder_model_int8.onnx` |
| `uint8` | `_uint8` | `encoder_model_uint8.onnx` |
| `q4` | `_q4` | `encoder_model_q4.onnx` |
| `q4f16` | `_q4f16` | `encoder_model_q4f16.onnx` |
| `bnb4` | `_bnb4` | `encoder_model_bnb4.onnx` |

`ModelRegistry.get_available_dtypes()` lists a dtype only if **every** required session file exists. Whisper is seq2seq: sessions are `encoder_model` + `decoder_model_merged` (`MODEL_SESSION_CONFIG` in `src/models/session_config.js`). WavLM-SV is a single `model` session.

Hub listing from `GET https://huggingface.co/api/models/<id>/tree/main/onnx` (bytes from the `size` field):

### `Xenova/whisper-tiny`

The model card is a Transformers.js ONNX export of [`openai/whisper-tiny`](https://huggingface.co/openai/whisper-tiny) (39 M parameters in the size table; Hub also reports 37.8 M). It does not discuss CUDA or VRAM.

Required pair for Transformers.js (encoder + merged decoder):

| `dtype` | Encoder bytes | Merged decoder bytes | Complete pair? |
| --- | ---: | ---: | --- |
| `fp32` | 32,909,539 | 118,579,599 | yes |
| `fp16` | 16,519,776 | 59,603,028 | yes |
| `q8` (`_quantized`) | 10,124,910 | 30,727,765 | yes |
| `uint8` | 10,079,602 | 30,727,961 | yes |
| `int8` | *missing* (`encoder_model_int8.onnx` is not on the Hub) | 30,727,931 | **no** |
| `q4` | 9,006,044 | 86,739,474 | yes |
| `q4f16` | 6,303,086 | 46,041,144 | yes |
| `bnb4` | 8,563,828 | 86,150,186 | yes |

Other encoder/decoder variants exist (`decoder_model.onnx`, `decoder_with_past_model.onnx`, and their quantizations). Transformers.js does not load those for the default Whisper sessions.

The Transformers.js dtype guide notes that Whisper is “extremely sensitive to quantization settings: especially of the encoder,” which is why per-module `dtype` maps exist. That is a quality warning, not a CUDA-capability claim.

### `Xenova/wavlm-base-plus-sv`

The model card is a Transformers.js ONNX export of [`microsoft/wavlm-base-plus-sv`](https://huggingface.co/microsoft/wavlm-base-plus-sv) (`WavLMForXVector`). It does not discuss CUDA, dtype, or VRAM. The Hub repo contains exactly two ONNX files:

| File | Bytes | Transformers.js `dtype` |
| --- | ---: | --- |
| `onnx/model.onnx` | 402,471,430 | `fp32` |
| `onnx/model_quantized.onnx` | 101,683,453 | `q8` |

There is **no** `model_fp16.onnx` (and no `_int8` / `_uint8` / `_q4` / `_q4f16` / `_bnb4` file). `dtype: "fp16"` on this model ID will look for `onnx/model_fp16.onnx` and fail to resolve the file.

## Transformers.js `dtype` / `device` pairing

Official docs treat `dtype` and `device` as independent `pipeline` / `from_pretrained` options ([Using quantized models (dtypes)](https://huggingface.co/docs/transformers.js/guides/dtypes), [Transformers.js index](https://huggingface.co/docs/transformers.js/en/index)). Examples pair them (for example `{ dtype: "q4", device: "webgpu" }`); there is no documented “cuda implies fp16” rule.

Library facts from `@huggingface/transformers` 4.3.0 (this repo’s dependency; it depends on `onnxruntime-node` 1.30.0):

1. `DEVICE_TYPES` includes `cuda`.
2. On Node Linux x64, `supportedDevices` is `['cuda', 'webgpu', 'cpu']` (`src/backends/onnx.js`). Other Node platforms do **not** push `cuda`.
3. `deviceToExecutionProviders('cuda')` returns `['cuda']` only (the `DEVICE_TO_EXECUTION_PROVIDER_MAPPING` value is the string `'cuda'`). `device: 'auto'` returns the full `supportedDevices` list; `device: 'gpu'` returns GPU-like entries (`webgpu`, `cuda`, `dml`, `webnn-gpu`).
4. `dtype` selects the ONNX filename suffix. It does **not** rewrite the graph or convert q8 → fp16. Passing `{ device: "cuda", dtype: "q8" }` loads `*_quantized.onnx` and asks ORT to run that graph on the CUDA EP.
5. Default dtype for `cuda` is `fp32` (only `wasm` defaults to `q8`).
6. `onnxruntime-node` documents CUDA as Linux x64 only, CUDA v12, with CUDA EP binaries installed by default (`onnxruntime-node` README, “CUDA EP Installation”). CUDA 11 is unsupported since ORT 1.22. If the CUDA shared library fails to load and the caller asked for `device: "cuda"` alone, session creation fails; Transformers.js only retries remaining providers when more than one was requested (`device: "auto"`).

The Xenova Whisper card’s current README example does not pass `dtype` or `device`. An older README revision listed `dtype: 'fp32'` with comment `Options: "fp32", "fp16", "q8", "q4"` ([commit 2d181e3](https://huggingface.co/Xenova/whisper-tiny/commit/2d181e37cdaac8df72e30238575ef4b4a381e6eb)); that list matches the files that still exist for the encoder+merged-decoder pair, minus the extra `uint8` / `q4f16` / `bnb4` files added later.

## ONNX Runtime CUDA limits vs the q8 graphs

ONNX Runtime publishes CUDA EP kernel registrations in [`docs/OperatorKernels.md`](https://github.com/microsoft/onnxruntime/blob/main/docs/OperatorKernels.md) (index: [Operator kernels](https://onnxruntime.ai/docs/reference/operators/OperatorKernels.html)). CUDA EP install/config is at [NVIDIA - CUDA](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).

Relevant CUDA `ai.onnx` kernels (current `main` doc):

| Op | On CUDA EP? | CUDA types that matter here |
| --- | --- | --- |
| `Conv` | yes | `float`, `float16`, `bfloat16`, `double` |
| `MatMul` / `Gemm` | yes | `float`, `float16`, `bfloat16`, `double` |
| `QuantizeLinear` / `DequantizeLinear` | yes | Q/DQ path; not the same as Xenova q8 |
| `MatMulInteger` | yes | **`int8` × `int8` → `int32` only** |
| `ConvInteger` | **no** | CPU EP: `int8` or `uint8` |
| `DynamicQuantizeLinear` | **no** | CPU EP: output `uint8` |

The cached q8 files contain those integer ops (byte-scan of the local ONNX protobufs):

| Graph | `ConvInteger` | `DynamicQuantizeLinear` | `MatMulInteger` |
| --- | --- | --- | --- |
| Whisper `encoder_model_quantized.onnx` | yes | yes | yes |
| Whisper `decoder_model_merged_quantized.onnx` | no | yes | yes |
| WavLM `model_quantized.onnx` | yes | yes | yes |

Hugging Face Optimum’s GPU guide states the same limit in product terms: “it is not possible to run quantized models on `CUDAExecutionProvider`” because Optimum dynamic quantization inserts `MatMulInteger` / `DynamicQuantizeLinear` nodes “that cannot be consumed by the CUDA execution provider” ([Accelerated inference on NVIDIA GPUs](https://huggingface.co/docs/optimum-onnx/en/onnxruntime/usage_guides/gpu)). CUDA later gained an **int8** `MatMulInteger` kernel; that does not cover Xenova q8 graphs, which follow the CPU `DynamicQuantizeLinear` contract (`uint8` activations). ORT maintainers describe that uint8/`cublasGemmEx` gap in [discussion #26735](https://github.com/microsoft/onnxruntime/discussions/26735).

A related Xenova conversion log for `whisper-tiny.en` recorded a JS e2e failure on the encoder int8 file: `Could not find an implementation for ConvInteger(10)` ([commit e1dd8ad](https://huggingface.co/Xenova/whisper-tiny.en/commit/e1dd8ad2870e83aaa789a7b558ce08e5fdab152e)). `Xenova/whisper-tiny` never published `encoder_model_int8.onnx`; its q8 encoder still contains `ConvInteger`.

## What fails if the quantized CPU files are pointed at CUDA

Passing `{ device: "cuda", dtype: "q8" }` (or leaving dtype at the Processor’s `q8` and only adding `device: "cuda"`) loads the same `*_quantized.onnx` files the cache already has, then sets ORT `executionProviders` to `['cuda']`.

Outcomes, from the kernel table and Optimum’s CUDA-quantization section:

1. **Missing CUDA EP binary / CUDA 12 stack.** `InferenceSession.create` fails while registering the provider (`OrtSessionOptionsAppendExecutionProvider_Cuda: Failed to load shared library`, as in Transformers.js [#1706](https://github.com/huggingface/transformers.js/pull/1706) / [#1708](https://github.com/huggingface/transformers.js/pull/1708)). Explicit `device: "cuda"` does not fall through to CPU.
2. **Graph assigned only to CUDA (CPU fallback disabled).** Session creation fails on the first op with no CUDA kernel. For these q8 files that is `ConvInteger` (Whisper encoder, WavLM) or `DynamicQuantizeLinear` (all three graphs). The typical ORT message is `Could not find an implementation for <Op>(<opset>) node with name '…'`.
3. **CPU EP still registered as fallback (ORT default in many bindings).** Session creation can succeed. CUDA runs the fp32 `Conv`/`MatMul` nodes it understands; integer nodes stay on CPU. Optimum and ORT issue [#12229](https://github.com/microsoft/onnxruntime/issues/12229) describe the result: extra host/device copies, quantized work on CPU, often *slower* and *more* memory than a pure fp32 CUDA graph. This is not “q8 on GPU.”
4. **Wrong dtype file for the Hub repo.** `dtype: "fp16"` on WavLM requests `onnx/model_fp16.onnx`, which does not exist. `dtype: "int8"` on Whisper requests `onnx/encoder_model_int8.onnx`, which does not exist.

CUDA-viable combinations that the Hub actually ships:

| Model | `device: "cuda"` + `dtype` | Loads | CUDA kernels cover the graph? |
| --- | --- | --- | --- |
| Whisper-tiny | `fp32` | `encoder_model.onnx` + `decoder_model_merged.onnx` | yes (`Conv`/`MatMul`/`Gemm` in float) |
| Whisper-tiny | `fp16` | `*_fp16.onnx` pair | yes (`Conv`/`MatMul`/`Gemm` in float16) |
| Whisper-tiny | `q8` | `*_quantized.onnx` pair | **no** (`ConvInteger` / `DynamicQuantizeLinear` / uint8 `MatMulInteger`) |
| WavLM-SV | `fp32` | `model.onnx` | yes |
| WavLM-SV | `fp16` | *file missing* | n/a |
| WavLM-SV | `q8` | `model_quantized.onnx` | **no** (same integer ops as Whisper encoder) |

Both models can therefore share one CUDA device **if Whisper is fp16 or fp32 and WavLM is fp32**. They cannot share a CUDA-accelerated q8 path using the files ADR-0005/0006 already use.

## VRAM order of magnitude

No model card, Transformers.js doc, or ORT CUDA page publishes a measured peak-VRAM figure for these two Xenova graphs.

What the sources do give:

- **Parameter counts.** Whisper tiny is 39 M in the OpenAI size table (37.8 M on the Hub card). WavLM-Base-Plus is cited as 95.1 M / 363 MB float on a Qualcomm export of the *non-SV* checkpoint; the SV ONNX `model.onnx` is 402,471,430 bytes, same order.
- **On-disk ONNX weights** (Hub `size`, which is the weight blob the CUDA EP must at least hold):

  | Combination | Weight files |
  | --- | ---: |
  | Whisper fp16 (encoder + merged decoder) | 76,122,804 bytes (~72.6 MiB) |
  | Whisper fp32 | 151,489,138 bytes (~144.5 MiB) |
  | WavLM fp32 | 402,471,430 bytes (~383.8 MiB) |
  | Both on CUDA (Whisper fp16 + WavLM fp32) | ~460 MiB |
  | Both on CUDA at fp32 | ~554 MiB |
  | q8 pair (not CUDA-viable) | ~136 MiB |

- **Arena.** CUDA EP `gpu_mem_limit` defaults to “max value of C++ `size_t`” (effectively unlimited). The docs note the limit applies only to the EP arena; “the total device memory usage may be higher.”

Activations for these small encoder/decoder graphs are not published. The only sourced bound is: **weights for a CUDA-viable pair are a few hundred MiB**, well below a 2 GiB card, before CUDA context and the unbounded arena.

## Sources

1. [Xenova/whisper-tiny model card](https://huggingface.co/Xenova/whisper-tiny) and [onnx/ tree API](https://huggingface.co/api/models/Xenova/whisper-tiny/tree/main/onnx)
2. [Xenova/wavlm-base-plus-sv model card](https://huggingface.co/Xenova/wavlm-base-plus-sv) and [onnx/ tree API](https://huggingface.co/api/models/Xenova/wavlm-base-plus-sv/tree/main/onnx)
3. [openai/whisper-tiny](https://huggingface.co/openai/whisper-tiny) (39 M / 37.8 M params)
4. [microsoft/wavlm-base-plus-sv](https://huggingface.co/microsoft/wavlm-base-plus-sv)
5. [Transformers.js — Using quantized models (dtypes)](https://huggingface.co/docs/transformers.js/guides/dtypes)
6. [Transformers.js index](https://huggingface.co/docs/transformers.js/en/index) (`device` / `dtype` options)
7. `@huggingface/transformers` 4.3.0: `src/utils/dtypes.js`, `src/utils/devices.js`, `src/backends/onnx.js`, `src/models/session.js`, `src/models/session_config.js`, `src/utils/model_registry/get_available_dtypes.js`
8. [onnxruntime-node README](https://github.com/microsoft/onnxruntime/blob/main/js/node/README.md) (CUDA v12, Linux x64)
9. [ONNX Runtime CUDA Execution Provider](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
10. [ONNX Runtime OperatorKernels.md](https://github.com/microsoft/onnxruntime/blob/main/docs/OperatorKernels.md) (CUDA vs CPU integer ops)
11. [Optimum — Accelerated inference on NVIDIA GPUs](https://huggingface.co/docs/optimum-onnx/en/onnxruntime/usage_guides/gpu) (quantized models vs `CUDAExecutionProvider`)
12. [ORT discussion #26735](https://github.com/microsoft/onnxruntime/discussions/26735) (CUDA `MatMulInteger` int8-only vs uint8 `DynamicQuantizeLinear`)
13. Local cache `~/.cache/describer/whisper/` (q8 files only; sizes match Hub)
14. ADR-0005, ADR-0006; `src/core/on-device-processor.ts` (`dtype: "q8"`, no `device`)
