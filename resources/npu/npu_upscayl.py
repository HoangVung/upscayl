#!/usr/bin/env python3
"""
NPU Upscaler for Upscayl - Uses ONNX Runtime with Qualcomm QNN Execution Provider
to leverage Snapdragon X Plus/Elite NPU for image super-resolution.

Requirements:
  pip install onnxruntime-qnn Pillow numpy

Usage:
  python npu_upscayl.py -i input.png -o output.png -m model.onnx -s 4 -f png
"""

import argparse
import sys
import os
import time
import numpy as np

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

try:
    import onnxruntime as ort
except ImportError:
    print("Error: onnxruntime-qnn is required. Install with: pip install onnxruntime-qnn", file=sys.stderr)
    sys.exit(1)


def get_available_providers():
    """List available ONNX Runtime execution providers."""
    return ort.get_available_providers()


def create_session(model_path: str, use_npu: bool = True):
    """Create ONNX Runtime inference session with QNN EP (NPU) or fallback."""
    available = get_available_providers()
    print(f"Available providers: {available}", file=sys.stderr)

    providers = []
    provider_options = []

    if use_npu and "QNNExecutionProvider" in available:
        providers.append("QNNExecutionProvider")
        provider_options.append({
            "backend_path": "QnnHtp.dll",  # HTP backend for NPU
            "htp_performance_mode": "burst",  # Max performance
            "htp_graph_finalization_optimization_mode": "3",
            "enable_htp_fp16_precision": "1",  # Use FP16 for speed
        })
        print("Using Qualcomm QNN (NPU/HTP) Execution Provider", file=sys.stderr)
    elif use_npu:
        print("WARNING: QNN Execution Provider not available. Falling back to CPU/GPU.", file=sys.stderr)
        print("To enable NPU support, install: pip install onnxruntime-qnn", file=sys.stderr)

    # Fallback providers
    if "DmlExecutionProvider" in available:
        providers.append("DmlExecutionProvider")
        provider_options.append({})
        print("DirectML (GPU) provider available as fallback", file=sys.stderr)

    providers.append("CPUExecutionProvider")
    provider_options.append({})

    session_options = ort.SessionOptions()
    session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session_options.intra_op_num_threads = os.cpu_count() or 4

    session = ort.InferenceSession(
        model_path,
        sess_options=session_options,
        providers=providers,
        provider_options=provider_options if len(provider_options) == len(providers) else None,
    )

    active_provider = session.get_providers()[0]
    print(f"Active provider: {active_provider}", file=sys.stderr)
    return session


def preprocess_image(image_path: str, tile_size: int = 0):
    """Load and preprocess image for inference."""
    img = Image.open(image_path).convert("RGB")
    img_array = np.array(img).astype(np.float32) / 255.0
    # Convert HWC -> NCHW (batch, channels, height, width)
    img_array = np.transpose(img_array, (2, 0, 1))
    img_array = np.expand_dims(img_array, axis=0)
    return img_array, img.size


def postprocess_image(output_array: np.ndarray) -> Image.Image:
    """Convert model output back to PIL Image."""
    # NCHW -> HWC
    output = np.squeeze(output_array, axis=0)
    output = np.transpose(output, (1, 2, 0))
    # Clip and convert to uint8
    output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(output)


def upscale_with_tiling(session, img_array: np.ndarray, tile_size: int = 512, overlap: int = 32):
    """Process large images in tiles to avoid OOM on NPU."""
    input_name = session.get_inputs()[0].name
    _, channels, height, width = img_array.shape

    if tile_size <= 0 or (height <= tile_size and width <= tile_size):
        # Process whole image
        print("0.00%", flush=True)
        result = session.run(None, {input_name: img_array})[0]
        print("100.00%", flush=True)
        return result

    # Determine output scale from a small test tile
    test_tile = img_array[:, :, :min(64, height), :min(64, width)]
    test_out = session.run(None, {input_name: test_tile})[0]
    scale = test_out.shape[2] // test_tile.shape[2]

    out_h = height * scale
    out_w = width * scale
    output = np.zeros((1, channels, out_h, out_w), dtype=np.float32)
    weight_map = np.zeros((1, 1, out_h, out_w), dtype=np.float32)

    step = tile_size - overlap
    tiles_y = max(1, (height - overlap + step - 1) // step)
    tiles_x = max(1, (width - overlap + step - 1) // step)
    total_tiles = tiles_y * tiles_x
    processed = 0

    for ty in range(tiles_y):
        for tx in range(tiles_x):
            y1 = min(ty * step, height - tile_size) if height > tile_size else 0
            x1 = min(tx * step, width - tile_size) if width > tile_size else 0
            y2 = min(y1 + tile_size, height)
            x2 = min(x1 + tile_size, width)

            tile = img_array[:, :, y1:y2, x1:x2]
            tile_out = session.run(None, {input_name: tile})[0]

            oy1, ox1 = y1 * scale, x1 * scale
            oy2, ox2 = oy1 + tile_out.shape[2], ox1 + tile_out.shape[3]

            output[:, :, oy1:oy2, ox1:ox2] += tile_out
            weight_map[:, :, oy1:oy2, ox1:ox2] += 1.0

            processed += 1
            progress = (processed / total_tiles) * 100
            print(f"{progress:.2f}%", flush=True)

    # Average overlapping regions
    weight_map = np.maximum(weight_map, 1.0)
    output /= weight_map

    return output


def main():
    parser = argparse.ArgumentParser(description="NPU Image Upscaler for Upscayl")
    parser.add_argument("-i", "--input", required=True, help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    parser.add_argument("-m", "--model", required=True, help="ONNX model path")
    parser.add_argument("-s", "--scale", type=int, default=4, help="Upscale factor (default: 4)")
    parser.add_argument("-f", "--format", default="png", choices=["png", "jpg", "webp"], help="Output format")
    parser.add_argument("-t", "--tile-size", type=int, default=512, help="Tile size for processing (0=auto)")
    parser.add_argument("-c", "--compression", type=int, default=0, help="Compression level (0-100)")
    parser.add_argument("--no-npu", action="store_true", help="Disable NPU, use CPU/GPU instead")
    parser.add_argument("--list-providers", action="store_true", help="List available execution providers and exit")
    args = parser.parse_args()

    if args.list_providers:
        providers = get_available_providers()
        for p in providers:
            print(p)
        has_qnn = "QNNExecutionProvider" in providers
        print(f"\nNPU (QNN) Support: {'YES' if has_qnn else 'NO'}")
        sys.exit(0)

    if not os.path.exists(args.input):
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.model):
        print(f"Error: Model file not found: {args.model}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading model: {args.model}", file=sys.stderr)
    start_time = time.time()

    session = create_session(args.model, use_npu=not args.no_npu)

    print(f"Processing: {args.input}", file=sys.stderr)
    img_array, original_size = preprocess_image(args.input)
    print(f"Input size: {original_size[0]}x{original_size[1]}", file=sys.stderr)

    output_array = upscale_with_tiling(session, img_array, tile_size=args.tile_size)
    output_image = postprocess_image(output_array)

    print(f"Output size: {output_image.size[0]}x{output_image.size[1]}", file=sys.stderr)

    # Save with appropriate format settings
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    save_kwargs = {}
    fmt = args.format.lower()
    if fmt == "png":
        save_kwargs["compress_level"] = min(9, args.compression // 11) if args.compression > 0 else 6
    elif fmt in ("jpg", "jpeg"):
        save_kwargs["quality"] = 100 - args.compression if args.compression > 0 else 95
        fmt = "jpeg"
    elif fmt == "webp":
        save_kwargs["quality"] = 100 - args.compression if args.compression > 0 else 90

    output_image.save(args.output, format=fmt.upper(), **save_kwargs)

    elapsed = time.time() - start_time
    print(f"Done in {elapsed:.2f}s: {args.output}", file=sys.stderr)
    print("Resizing and converting image...", flush=True)


if __name__ == "__main__":
    main()