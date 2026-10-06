# Which GPU backends can Transformers.js use on Linux?

Question from [issue 19](https://github.com/FredeAlexandre/describer/issues/19): on Linux in Node / Electron main, which ONNX Runtime execution providers can `@huggingface/transformers` plus `onnxruntime-node` actually run, and what must already be installed for each to load.

This note is facts from those packages at the versions Describer already depends on, plus the ONNX Runtime and NVIDIA docs that own the CUDA/WebGPU/TensorRT contracts. It does not specify product behavior.

## Versions in this repo

Describer depends on `@huggingface/transformers` `^4.3.0`. The lockfile resolves that to **4.3.0**, which depends on **`onnxruntime-node` 1.30.0** (and `onnxruntime-web` 1.31.0-dev, unused for Node sessions).

- [package.json](https://github.com/FredeAlexandre/describer/blob/implement/spec-16/package.json) (`"@huggingface/transformers": "^4.3.0"`)
- [package-lock.json](https://github.com/FredeAlexandre/describer/blob/implement/spec-16/package-lock.json) (`@huggingface/transformers` 4.3.0 → `onnxruntime-node` 1.30.0)
- npm [`@huggingface/transformers@4.3.0` package.json](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/package.json) (`"onnxruntime-node": "1.30.0"`)

Node vs browser is decided by `process.release.name === 'node'`. Electron main matches that, so Transformers.js loads `onnxruntime-node`, not `onnxruntime-web`.

- [`@huggingface/transformers@4.3.0` `src/env.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/env.js) (`IS_NODE_ENV`)
- [`src/backends/onnx.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx.js) (Node branch sets `ONNX = ONNX_NODE`)
- [`src/backends/onnx-node.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx-node.js) (`require('onnxruntime-node')`)

`onnxruntime-node` 1.30.0 documents Node.js v16+ (recommend v20+) or Electron v15+ (recommend v28+).

- [onnxruntime-node 1.30.0 README](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md)

## Answer gist

On Linux x64 Node/Electron main, the prebuilt stack can load **CPU**, **CUDA**, **TensorRT**, and **experimental native WebGPU**. DirectML, CoreML, WebNN, WASM-as-a-TJS-device, and ROCm are not in this Node binding.

Default device is **CPU**. Request GPU with `device: 'cuda'`, `'webgpu'`, `'gpu'`, or `'auto'` on `pipeline()` / `from_pretrained()`. TensorRT is not a Transformers.js device name; it is only reachable by overriding `session_options.executionProviders`.

The CUDA `.so` files that `onnxruntime-node` downloads are **not** a CUDA toolkit. The 1.30.0 Linux GPU nupkg this package actually extracts is linked against **CUDA 13** (`libcudart.so.13`), despite the Node README still saying “CUDA v12”. A system CUDA **12** toolkit will not satisfy those binaries. Official ORT 1.30.x GPU packages also require **cuDNN 9.x**. NVIDIA’s CUDA 13.0 GA Linux driver floor is **≥ 580.65.06**.

`device: 'auto'` / `'gpu'` put CUDA first. If the CUDA provider library fails to `dlopen`, session creation throws and does **not** fall through to WebGPU or CPU in 4.3.0.

## How Transformers.js picks a device

Default when `device` is omitted: **`cpu`** in Node.

- [`src/utils/devices.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/utils/devices.js): `DEFAULT_DEVICE = apis.IS_NODE_ENV ? 'cpu' : 'wasm'`
- [`src/backends/onnx.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx.js): `defaultDevices = ['cpu']` on the Node branch
- [`src/models/session.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/models/session.js): `selectDevice(options.device ?? custom_config.device, …)` then `deviceToExecutionProviders(selectedDevice)`; `session_options.executionProviders ??= executionProviders`

`pipeline(task, model, { device, session_options })` forwards those options.

- [`src/pipelines.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/pipelines.js) (`device = null`, `session_options = {}`)

`deviceToExecutionProviders` on Linux Node (4.3.0):

| Call | Linux x64 EPs | Linux arm64 EPs |
| --- | --- | --- |
| omitted / `'cpu'` | `['cpu']` | `['cpu']` |
| `'cuda'` | `['cuda']` | throws (`cuda` not in `supportedDevices`) |
| `'webgpu'` | `['webgpu']` | `['webgpu']` (TJS still lists it; see WebGPU) |
| `'gpu'` | `['cuda', 'webgpu']` | `['webgpu']` |
| `'auto'` | `['cuda', 'webgpu', 'cpu']` | `['webgpu', 'cpu']` |
| `'wasm'`, `'dml'`, `'coreml'`, `'webnn*'` | throws | throws |
| `'tensorrt'` | throws (not a TJS device) | throws |

Source: [`src/backends/onnx.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx.js) (`supportedDevices` push order; `'auto'` returns that list; `'gpu'` filters to `webgpu`/`cuda`/`dml`/`webnn-gpu`). Device names: [`src/utils/devices.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/utils/devices.js) `DEVICE_TYPES` — there is no `tensorrt` key.

ONNX Runtime Node treats every name in `executionProviders` as load-or-fail. With 4.3.0 there is no retry. On a Linux x64 host that has the CUDA `.so` but not CUDA 13 runtime libs, `InferenceSession.create(…, { executionProviders: ['cuda'] })` and `{ executionProviders: ['cuda', 'webgpu', 'cpu'] }` both throw `OrtSessionOptionsAppendExecutionProvider_Cuda: Failed to load shared library` (observed against this lockfile’s `onnxruntime-node` 1.30.0; the log names `libcublasLt.so.13`). Explicit `'cpu'` or `'webgpu'` got past provider init (failed only on a missing model path).

## What `onnxruntime-node` 1.30.0 actually exposes on Linux

Prebuilt EP matrix from the **v1.30.0** Node README:

| EP | Linux x64 | Linux arm64 |
| --- | --- | --- |
| CPU | yes | yes |
| WebGPU | yes, experimental | no in prebuilts |
| DirectML | no | no |
| CUDA | yes, documented as “CUDA v12” | no |
| CoreML | no | no |

Same table, plus “Linux x64 can use CUDA and TensorRT”: [js/node/README.md at v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md).

The native addon reports backends at compile time (`bundled: true` = linked into the core lib; `false` = loaded from a separate provider `.so`):

```text
[ { name: 'cpu', bundled: true },
  { name: 'webgpu', bundled: true },
  { name: 'cuda', bundled: false },
  { name: 'tensorrt', bundled: false } ]
```

Observed by calling `listSupportedBackends()` on this machine’s installed `onnxruntime-node@1.30.0` Linux x64 build. The C++ source of that list: [inference_session_wrap.cc at v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/src/inference_session_wrap.cc) (`USE_WEBGPU` / `USE_CUDA` / `USE_TENSORRT`).

That call is **not** a GPU/driver probe. CUDA and TensorRT appear even when their `.so` cannot be loaded.

Provider library install (Linux x64 only): postinstall downloads three files from NuGet package `Microsoft.ML.OnnxRuntime.Gpu.Linux` **1.30.0** into `bin/napi-v6/linux/x64/`:

- `libonnxruntime_providers_cuda.so`
- `libonnxruntime_providers_shared.so`
- `libonnxruntime_providers_tensorrt.so`

Manifest: [`script/install-metadata.js`](https://cdn.jsdelivr.net/npm/onnxruntime-node@1.30.0/script/install-metadata.js) (`linux/x64: ['cuda12']`). Version pin: [`script/install-metadata-versions.js`](https://cdn.jsdelivr.net/npm/onnxruntime-node@1.30.0/script/install-metadata-versions.js) (`nuget` `1.30.0`). The key name `cuda12` is leftover from dropping CUDA 11; it does not mean the nupkg is a CUDA 12 build (see CUDA below).

CPU/WebGPU live in the shipped `libonnxruntime.so.1` + `onnxruntime_binding.node` (same folder). Linux arm64 ships only those two files — no CUDA/TensorRT `.so`s (`install-metadata.js` `linux/arm64: []`).

Skip GPU nupkg extract with `--onnxruntime-node-install=skip` / `ONNXRUNTIME_NODE_INSTALL=skip`. [README CUDA EP Installation](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md); [`script/install.js`](https://cdn.jsdelivr.net/npm/onnxruntime-node@1.30.0/script/install.js).

## CPU

**Runs:** yes, all Linux arches in the prebuilt matrix.

**Shipped in npm:** `onnxruntime_binding.node` and `libonnxruntime.so.1`. `ldd` on the x64 core lib needs only glibc, libstdc++, libgcc, libm, libpthread, librt, libdl.

**Must already be installed:** a supported Node or Electron (README above). No NVIDIA driver, CUDA, cuDNN, TensorRT, or Vulkan.

**Ready, for this stack:** the native binding loads. Transformers.js already defaults here.

## CUDA

**Runs:** Linux **x64 only**. Linux arm64 is ❌ in the Node README and TJS does not push `'cuda'` unless `process.arch === 'x64'`.

**Shipped in npm:** the CUDA *execution provider* `.so` (and `libonnxruntime_providers_shared.so`), downloaded at postinstall from `Microsoft.ML.OnnxRuntime.Gpu.Linux` 1.30.0. Not bundled in the npm tarball (`bundled: false`).

**Not shipped:** CUDA toolkit, CUDA runtime, cuBLAS, cuRAND, cuDNN, or the NVIDIA driver.

`readelf -d` / `ldd` on this install’s `libonnxruntime_providers_cuda.so`:

| DT_NEEDED | Role | On this host |
| --- | --- | --- |
| `libcudart.so.13` | CUDA 13 runtime | not found |
| `libcublas.so.13` | cuBLAS 13 | not found |
| `libcublasLt.so.13` | cuBLASLt 13 | not found |
| `libcurand.so.10` | cuRAND | not found |
| `libcuda.so.1` | NVIDIA driver userspace | present (`/lib64/libcuda.so.1`) |

There is **no** `libcudart.so.12`. Session create with `'cuda'` failed: `Failed to load library …/libonnxruntime_providers_cuda.so with error: libcublasLt.so.13: cannot open shared object file`.

### CUDA 12 vs 13 (README vs this binary)

- Node README 1.30.0: “CUDA v12”; “CUDA v11 is no longer supported since v1.22”. [js/node/README.md](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md)
- TJS 4.3.0 copies an older ORT table that also says “CUDA v12”. [`src/backends/onnx.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx.js)
- Official ORT CUDA EP: starting **1.27**, default PyPI/NuGet GPU packages are **CUDA 13.0 + cuDNN 9.x**. Separate CUDA 12.x GPU packages for 1.27–1.30 are built with **CUDA 12.8** and need CUDA 12.8+. [CUDA Execution Provider](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
- This package always fetches `Microsoft.ML.OnnxRuntime.Gpu.Linux` **1.30.0** (the default GPU Linux nupkg), not a CUDA-12-specific feed. The extracted `.so` needs **`libcudart.so.13`**.

Treat the Node README’s “CUDA v12” as stale for 1.30.0. **A system CUDA 12 toolkit is not enough** for the provider `.so` this repo’s `npm ci` actually installs.

ORT: a build against CUDA 13.0 requires CUDA 13.0 or newer (minor-version compatibility does not bridge 12 → 13). [CUDA EP requirements](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)

### Driver, toolkit, cuDNN

ORT install page, GPU packages: install CUDA and cuDNN; on Linux add CUDA `lib64` and cuDNN `lib` to `LD_LIBRARY_PATH`; cuDNN 9.x on Linux also needs zlib. [Install ONNX Runtime](https://onnxruntime.ai/docs/install/)

ORT 1.30.x default GPU package: **CUDA 13.0, cuDNN 9.x**. [CUDA EP table](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)

NVIDIA CUDA 13.0 GA Linux x86_64 minimum driver: **≥ 580.65.06**. CUDA 13.x minor-version compatibility floor: driver **≥ 580**. [CUDA Toolkit 13.0 release notes, Tables 2–3](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-toolkit-release-notes/index.html)

The CUDA EP `.so` does not `DT_NEEDED` `libcudnn.so.9` (TensorRT’s `.so` does). It still contains `libcudnn.so` and `cudnn_frontend` symbols, and ORT’s published 1.30.x GPU contract is cuDNN 9.x. Do not treat “no DT_NEEDED” as “cuDNN optional.”

`nvcc` is **not** required to *run* inference. The postinstall script uses `nvcc --version` only if you pass `--onnxruntime-node-install-cuda` / `ONNXRUNTIME_NODE_INSTALL_CUDA`, and that helper only accepts CUDA 11 or 12 (13 is an error). Default Linux x64 install does not call `nvcc`; it always downloads the `cuda12`-named manifest. [`script/install-utils.js`](https://cdn.jsdelivr.net/npm/onnxruntime-node@1.30.0/script/install-utils.js) (`tryGetCudaVersion`, `parseInstallFlag`).

**Ready, for this stack:** Linux x64; NVIDIA GPU; driver ≥ 580.65.06 providing `libcuda.so.1`; CUDA **13** runtime libraries (`libcudart.so.13`, `libcublas.so.13`, `libcublasLt.so.13`, `libcurand.so.10`) on the dynamic linker path; cuDNN **9.x** (and zlib) per ORT; GPU provider `.so`s extracted (postinstall not skipped). Then `device: 'cuda'` can load. `'auto'`/`'gpu'` will still *request* CUDA first and, in 4.3.0, fail the whole session if CUDA cannot `dlopen`.

## TensorRT

**Runs at the ORT Node layer:** Linux x64 only, same nupkg as CUDA. README: “Linux x64 can use CUDA and TensorRT.” `listSupportedBackends` includes `{ name: 'tensorrt', bundled: false }`. Native session options accept `name: 'tensorrt'`. [session_options_helper.cc at v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/src/session_options_helper.cc)

**Does not run via Transformers.js `device`:** `DEVICE_TYPES` has no `tensorrt`; `deviceToExecutionProviders('tensorrt')` throws. The only TJS path is overriding `session_options.executionProviders` (that field is used as-is when the caller sets it). [`src/models/session.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/models/session.js)

**Shipped in npm:** `libonnxruntime_providers_tensorrt.so` (~1.1M), downloaded with the CUDA provider.

**Not shipped:** TensorRT, CUDA 13 runtime, cuDNN, NVIDIA driver.

`readelf -d` on this install’s TensorRT `.so`: `libnvinfer.so.10`, `libnvonnxparser.so.10`, `libcudart.so.13`, `libcublas.so.13`, `libcudnn.so.9`. Observed load error without those libs: `libcublas.so.13: cannot open shared object file`.

ORT TensorRT docs: install the GPU (CUDA/TensorRT) package; register TensorRT and also CUDA so unsupported nodes can fall back. The published TensorRT version table on that page currently stops at ORT 1.22 / TensorRT 10.9 / CUDA 12.x and does **not** list 1.30. [TensorRT Execution Provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)

**Ready, for this stack:** everything CUDA needs, plus system **TensorRT 10** (`libnvinfer.so.10`, `libnvonnxparser.so.10`), plus an explicit `executionProviders` list that includes `'tensorrt'` (typically `['tensorrt', 'cuda']`). Not a TJS `device` value.

## WebGPU (Node / Electron main)

**Runs:** experimental native WebGPU EP inside `onnxruntime-node`, **not** the browser `onnxruntime-web` / `navigator.gpu` path.

- Node README: WebGPU ✔️ experimental on Linux x64; ❌ on Linux arm64 prebuilts. [js/node/README.md](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md)
- This x64 build: `{ name: 'webgpu', bundled: true }`. `libonnxruntime.so.1` contains `WebGpuExecutionProvider`, Dawn, and Vulkan strings. No separate `onnxruntime_providers_webgpu.so` in the Node package.
- TJS Node always `supportedDevices.push('webgpu')`, including Linux arm64, even though ORT says arm64 prebuilts omit it. [`src/backends/onnx.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/backends/onnx.js)
- TJS treats WebGPU as available in every Node process: `IS_WEBGPU_AVAILABLE = IS_NODE_ENV || … navigator.gpu`. [`src/env.js`](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/src/env.js)

Native WebGPU EP uses **Dawn**; on Linux Dawn’s backend is **Vulkan**. It needs a GPU and driver that expose that backend. It does not need CUDA, cuDNN, or TensorRT. [WebGPU Execution Provider](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)

ORT Web (`onnxruntime-web/webgpu`) is a different backend (browser / JSEP). Its support table marks **Node.js WebGPU as ❌**. Electron **main** does not use that table; it uses the native Node binding. Electron **renderer** would be the web path and is outside this ticket. [ORT Web getting started](https://onnxruntime.ai/docs/get-started/with-javascript/web.html); [Using WebGPU (ORT Web)](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

On this Linux x64 host, `executionProviders: ['webgpu']` initialized the EP (Dawn logged Vulkan buffer-limit warnings) and only then failed on a missing model file. That is EP-load success, not a full inference proof.

`onnxruntime-common` 1.30.0 documents Node-only WebGPU options such as `enableRobustness` and notes that `validationMode: 'disabled'` in Node can crash the process on WebGPU errors. [onnxruntime-common `inference-session.ts`](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/common/lib/inference-session.ts)

**Ready, for this stack:** Linux x64 prebuilt (arm64: do not trust TJS’s listing; ORT README says no); a Vulkan-capable GPU/driver; `device: 'webgpu'` (or `'gpu'`/`'auto'` only if CUDA is also actually loadable, because 4.3.0 will otherwise throw on CUDA first). No CUDA toolkit. Experimental.

## Not available on Linux Node in this stack

| Name | Why |
| --- | --- |
| DirectML | Windows-only in the Node prebuilt matrix. |
| CoreML | macOS-only. |
| WebNN | Browser/WebNN API; TJS only pushes it on the web branch. |
| WASM EP as TJS `device: 'wasm'` | Not in Node `supportedDevices`; throws. Node CPU is the native `cpu` EP. |
| ROCm / HIP | Not in `listSupportedBackends` for this Linux x64 binding. |
| OpenVINO, QNN | Not enabled in this prebuilt (`listSupportedBackends` has neither). |

ORT JS common types still mention `'cpu', 'dml' (win32), 'coreml' (macOS) and 'cuda' (linux)` for the Node backend (comment does not list WebGPU/TensorRT; the 1.30.0 binding does). [onnxruntime-common `inference-session.ts`](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/common/lib/inference-session.ts)

## What is *not* a readiness probe

- `listSupportedBackends()` — compile-time flags, not hardware.
- Presence of `libonnxruntime_providers_cuda.so` — npm/postinstall, not CUDA 13/cuDNN/driver.
- TJS `supportedDevices` / `device: 'auto'` — advertised list; 4.3.0 does not skip a provider that fails to `dlopen`.
- `nvcc --version` — unused on the default install path; a CUDA 12 `nvcc` would not match this 1.30.0 `.so`.

A backend is loadable when `InferenceSession.create` with that EP name gets past provider registration (then still needs a real ONNX model to infer).
