# AMD GPU path on Linux for Transformers.js / onnxruntime-node

Question: for an AMD GPU on Linux, does the stack ADR-0005 already chose (`@huggingface/transformers` ^4.3.0, which pins `onnxruntime-node` 1.30.0) have a supported way to run Whisper and WavLM on the GPU — ROCm, Vulkan, DirectML, or none? What would “driver available” mean on Fedora for that path?

**Answer:** the official Node binding has one AMD-reachable GPU path on Linux x64: **experimental WebGPU**, which ONNX Runtime implements with Dawn and dispatches to **Vulkan**. There is **no ROCm**, **no DirectML**, and **no Vulkan execution provider** in this npm stack. CUDA is present on Linux x64 and is NVIDIA-only. Default inference in Node is **CPU**.

## Stack under test

| Piece | Version / fact | Source |
| --- | --- | --- |
| `@huggingface/transformers` | 4.3.0 (this checkout’s lock / `node_modules`) | [`package.json` of the installed package](https://www.npmjs.com/package/@huggingface/transformers/v/4.3.0) |
| `onnxruntime-node` | 1.30.0, a direct dependency of Transformers.js 4.3.0 | Transformers.js 4.3.0 `package.json` (`"onnxruntime-node": "1.30.0"`) |
| Node runtime used by ADR-0005 | Node / Electron **main**, not the browser | [ADR-0005](../adr/0005-local-whisper-stt.md) |
| Models | Whisper (`Xenova/whisper-tiny`), WavLM-SV (`Xenova/wavlm-base-plus-sv`) | [ADR-0005](../adr/0005-local-whisper-stt.md), [ADR-0006](../adr/0006-local-wavlm-diarization.md) |

In Node, Transformers.js loads `onnxruntime-node`, not `onnxruntime-web` ([`src/backends/onnx.js`](https://github.com/huggingface/transformers.js) in 4.3.0: “When running in node, we use `onnxruntime-node`”). GPU work therefore has to be an execution provider **compiled into that Node binary**, not Chromium’s `navigator.gpu`.

## Transformers.js device list (4.3.0)

`DEVICE_TYPES` in `@huggingface/transformers` 4.3.0 is:

`auto`, `gpu`, `cpu`, `wasm`, `webgpu`, `cuda`, `dml`, `coreml`, `webnn`, `webnn-npu`, `webnn-gpu`, `webnn-cpu`.

There is **no** `rocm`, **no** `migraphx`, **no** `vulkan`. Mapping to ONNX Runtime EPs (`src/backends/onnx.js`):

| Device | EP |
| --- | --- |
| `cpu` | `cpu` |
| `webgpu` | `webgpu` |
| `cuda` | `cuda` |
| `dml` | `dml` |
| `coreml` | `coreml` |
| `gpu` | intersection of supported devices with `{webgpu, cuda, dml, webnn-gpu}` |

On Node Linux x64, Transformers.js **registers** `cuda`, then `webgpu`, then `cpu`. Default when `device` is omitted is **`cpu`** (`src/utils/devices.js`: `DEFAULT_DEVICE` is `cpu` in Node; `src/backends/onnx.js`: `defaultDevices = ['cpu']`).

`device: 'gpu'` on Linux x64 therefore becomes **`['cuda', 'webgpu']`** (CUDA first). That order is NVIDIA-oriented; it is not an AMD selector.

Hugging Face documents `device: 'webgpu'` as the GPU switch, including an ASR example with Whisper ([WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu)). Transformers.js v4’s release notes state the new C++ WebGPU runtime runs in Node, Bun, and Deno as well as browsers ([Transformers.js v4 blog, 2026-02-09](https://huggingface.co/blog/transformersjs-v4)).

## What `onnxruntime-node` 1.30.0 actually ships on Linux x64

Official prebuilt matrix ([`js/node/README.md` at tag `v1.30.0`](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md)):

| EP | Linux x64 | Notes in that README |
| --- | --- | --- |
| CPU | yes | bundled |
| WebGPU | yes | **experimental** (footnote \[1\]) |
| DirectML | no | Windows only in the same table |
| CUDA | yes | CUDA v12; downloaded at install, not bundled |
| CoreML | no | macOS only |

The same README’s later “GPU Support” paragraph still says Linux x64 can use CUDA and TensorRT and that WebGPU/DML are Windows. That paragraph contradicts the table above and the binary (below). Treat the **table + the installed files + `listSupportedBackends()`** as current.

Installed `bin/napi-v6/linux/x64/` for 1.30.0:

- `onnxruntime_binding.node`, `libonnxruntime.so.1` (core; WebGPU is **bundled** here)
- `libonnxruntime_providers_cuda.so`, `libonnxruntime_providers_tensorrt.so`, `libonnxruntime_providers_shared.so` (CUDA/TensorRT plugin, pulled from NuGet `Microsoft.ML.OnnxRuntime.Gpu.Linux` 1.30.0 by the postinstall script)
- **no** `libonnxruntime_providers_webgpu.so` (WebGPU is linked into `libonnxruntime.so.1`, not a plugin)
- **no** ROCm / MIGraphX / DirectML provider libraries

`listSupportedBackends()` on this Linux x64 install returns:

- `cpu` (bundled: true)
- `webgpu` (bundled: true)
- `cuda` (bundled: false)
- `tensorrt` (bundled: false)

`libonnxruntime.so.1` contains Dawn (`dawn/native/vulkan/…`) and WebGPU EP strings. That matches ONNX Runtime’s native WebGPU EP: Linux backend is Vulkan ([WebGPU Execution Provider](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)).

## Candidate paths

### WebGPU (the only AMD-reachable path in this stack)

ONNX Runtime’s WebGPU EP targets the WebGPU API. On native platforms it uses Dawn; on Linux Dawn uses **Vulkan** ([same page](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html): “Linux | Vulkan”). It is described as cross-vendor: a single build can target any GPU the platform graphics API supports, without a vendor SDK on the machine.

In this stack that is `device: 'webgpu'` → EP `'webgpu'`. onnxruntime-node marks it **experimental** on every platform where the prebuilt exists, including Linux x64.

Whisper: Hugging Face’s WebGPU guide runs `automatic-speech-recognition` with `onnx-community/whisper-tiny.en` and `device: 'webgpu'`. ADR-0005’s `Xenova/whisper-tiny` is the same architecture on the same Transformers.js API.

WavLM: Transformers.js 4.3.0 lists WavLM among supported models and exposes `feature-extraction` (the pipeline ADR-0006 uses for speaker embeddings). There is no separate EP for WavLM; it uses the same `device` → EP mapping as Whisper. Hugging Face’s WebGPU guide uses `feature-extraction` with `device: 'webgpu'` as the embedding example.

This is **not** a promise that every Whisper/WavLM ONNX graph runs entirely on WebGPU without CPU fallback. The EP itself is experimental; operator coverage is whatever WebGPU EP 1.30.0 implements.

### ROCm — not in this stack

ONNX Runtime still documents an [AMD ROCm Execution Provider](https://onnxruntime.ai/docs/execution-providers/ROCm-ExecutionProvider.html), and says it **has been removed since 1.23**; migrate to MIGraphX. Prebuilts listed there are **Python wheels** on Ubuntu/ROCm, not `onnxruntime-node`.

[MIGraphX](https://onnxruntime.ai/docs/execution-providers/MIGraphX-ExecutionProvider.html) is AMD’s current GPU EP. Install docs are Python/`pip` (and C++), with wheels on `repo.radeon.com`, not the npm Node binding.

Transformers.js 4.3.0 has no `rocm` / `migraphx` device. `onnxruntime-node` 1.30.0 `listSupportedBackends()` does not list them. **ROCm is not a path for this stack.**

### Vulkan execution provider — does not exist here

ONNX Runtime’s EP summary lists WebGPU, CUDA, DirectML, ROCm (deprecated), MIGraphX — not a Vulkan EP ([Execution Providers](https://onnxruntime.ai/docs/execution-providers/)). A request to add one remains open ([onnxruntime#21917](https://github.com/microsoft/onnxruntime/issues/21917)). Linux GPU access without CUDA/ROCm is the WebGPU EP’s Dawn→Vulkan backend, not a `vulkan` provider name.

Transformers.js will throw `Unsupported device: "vulkan"` (`deviceToExecutionProviders`).

### DirectML — Windows only

[DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html): DirectX 12 on Windows 10+. onnxruntime-node’s 1.30.0 table: DirectML ✔️ on Windows x64/arm64, ❌ on Linux. Transformers.js only pushes `dml` when `process.platform === 'win32'`. **Not a Linux path.**

### CUDA — NVIDIA only

[CUDA EP](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html): “hardware accelerated computation on **Nvidia CUDA-enabled GPUs**.” The Node extra binaries are CUDA 12 (`js/node/README.md` footnote \[3\]). An AMD GPU cannot satisfy this EP. Presence of `libonnxruntime_providers_cuda.so` on Linux x64 does not make CUDA an AMD path.

## What “driver available” means on Fedora (WebGPU path)

For **this** stack, “GPU driver available” on Fedora is **not** ROCm and **not** CUDA. It is: Dawn can see a Vulkan device for the AMD GPU.

That is two layers:

1. **Kernel.** Mesa RADV talks to the in-tree `amdgpu` KMD ([RADV](https://docs.mesa3d.org/drivers/radv.html); [drm/amdgpu](https://www.kernel.org/doc/html/latest/gpu/amdgpu/index.html) covers GCN/RDNA). RADV is not supported on the old `radeon` KMD. On a modern Fedora kernel, `amdgpu` is the default for current AMD GPUs.

2. **Userspace Vulkan ICD.** Fedora package [`mesa-vulkan-drivers`](https://packages.fedoraproject.org/pkgs/mesa/mesa-vulkan-drivers/fedora-44.html) ships RADV as `libvulkan_radeon.so` and registers [`radeon_icd.x86_64.json`](https://packages.fedoraproject.org/pkgs/mesa/mesa-vulkan-drivers/fedora-44.html). It depends on [`vulkan-loader`](https://packages.fedoraproject.org/pkgs/vulkan-loader/vulkan-loader/) (Khronos ICD loader). RADV is Mesa’s Vulkan driver for AMD GCN/RDNA ([RADV](https://docs.mesa3d.org/drivers/radv.html)).

Observable (not a product feature): `vulkaninfo` lists a physical device whose driver is RADV for that AMD GPU. Transformers.js does **not** probe this before advertising `webgpu` on Node (`IS_WEBGPU_AVAILABLE` is true whenever `IS_NODE_ENV` is true). A missing ICD or a GPU Dawn cannot open shows up when a session is created with `executionProviders: ['webgpu']`, not when the library is imported.

ROCm packages, AMDGPU-Pro, or a Python `onnxruntime` wheel with MIGraphX would be a **different** runtime. They are out of scope for “driver available” on this stack.

## Bottom line

| Path | In `@huggingface/transformers` 4.3.0 + `onnxruntime-node` 1.30.0 on Linux? |
| --- | --- |
| WebGPU (Dawn → Vulkan) | Yes, **experimental**, Linux x64 (not Linux arm64 prebuilts). This is the AMD GPU path. |
| ROCm / MIGraphX | No |
| DirectML | No (Windows) |
| Vulkan EP | No such EP in this binding |
| CUDA | Yes on Linux x64, **NVIDIA only** |
| Default | CPU |

If a later spec says “use GPU when a driver is available” on Fedora AMD, that condition for **this** stack is: experimental WebGPU EP can create a session, which requires kernel `amdgpu` plus Mesa RADV (`mesa-vulkan-drivers`). It is not ROCm.
