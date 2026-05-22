#!/usr/bin/env python3
"""
NPU Upscaler for Upscayl - Uses ONNX Runtime with Qualcomm QNN Execution Provider
to leverage Snapdragon NPU with Qualcomm XLSR Super-Resolution model.

Requirements:
  pip install onnxruntime-qnn Pillow numpy

Usage:
  python npu_upscayl.py -i input.png -o output.png -m model.onnx -s 3 -f png
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

try:
    import onnxruntime_qnn as qnn_ep
except ImportError:
    qnn_ep = None


def get_available_providers():
    """List available ONNX Runtime execution providers."""
    return ort.get_available_providers()


def create_session(model_path: str, use_npu: bool = True):
    """Create ONNX Runtime inference session with QNN EP (NPU) or fallback."""
    session_options = ort.SessionOptions()
    session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session_options.intra_op_num_threads = os.cpu_count() or 4

    if use_npu:
        if qnn_ep is None:
            print("Error: onnxruntime_qnn plugin package is not importable.", file=sys.stderr)
            print("Install with: pip install onnxruntime-qnn", file=sys.stderr)
            sys.exit(1)

        ep_lib_path = qnn_ep.get_library_path()
        backend_path = qnn_ep.get_qnn_htp_path()
        ort.register_execution_provider_library("QNNExecutionProvider", ep_lib_path)

        ep_devices = ort.get_ep_devices()
        qnn_devices = [
            ep_device
            for ep_device in ep_devices
            if ep_device.ep_name == "QNNExecutionProvider"
        ]

        if not qnn_devices:
            available = get_available_providers()
            print("Error: QNNExecutionProvider plugin registered, but no QNN EP device was found.", file=sys.stderr)
            print(f"Available providers: {available}", file=sys.stderr)
            sys.exit(1)

        session_options.add_provider_for_devices(
            qnn_devices,
            {"backend_path": backend_path},
        )
        print("Using Qualcomm QNN plugin Execution Provider", file=sys.stderr)
        print(f"QNN EP library: {ep_lib_path}", file=sys.stderr)
        print(f"QNN HTP backend: {backend_path}", file=sys.stderr)
        return ort.InferenceSession(model_path, sess_options=session_options)

    available = get_available_providers()
    print(f"Available providers: {available}", file=sys.stderr)

    providers = []
    provider_options = []
    if "DmlExecutionProvider" in available:
        providers.append("DmlExecutionProvider")
        provider_options.append({})
        print("DirectML (GPU) provider available as fallback", file=sys.stderr)

    providers.append("CPUExecutionProvider")
    provider_options.append({})

    session = ort.InferenceSession(
        model_path,
        sess_options=session_options,
        providers=providers,
        provider_options=provider_options,
    )

    return session


def create_feather_mask(
    size: int,
    feather: int,
    fade_left: bool,
    fade_top: bool,
    fade_right: bool,
    fade_bottom: bool,
) -> np.ndarray:
    """Create a 2D blend mask that only fades edges with overlapping neighbors."""
    if feather <= 0:
        return np.ones((size, size, 1), dtype=np.float32)

    feather = min(feather, size // 2)
    ramp = np.ones(size, dtype=np.float32)
    edge = np.linspace(0.0, 1.0, feather + 2, dtype=np.float32)[1:-1]
    x_ramp = ramp.copy()
    y_ramp = ramp.copy()

    if fade_left:
        x_ramp[:feather] = edge
    if fade_right:
        x_ramp[-feather:] = edge[::-1]
    if fade_top:
        y_ramp[:feather] = edge
    if fade_bottom:
        y_ramp[-feather:] = edge[::-1]

    mask = np.minimum.outer(y_ramp, x_ramp)
    return mask[:, :, None]


def upscale_image_xlsr(session, img: Image.Image, overlap: int = 32) -> Image.Image:
    """Upscale image using XLSR model with fixed 128x128 input and 3x output (via 4x output resized)."""
    width, height = img.size
    
    # Handle padding if image is smaller than 128x128
    pad_w = max(0, 128 - width)
    pad_h = max(0, 128 - height)
    
    if pad_w > 0 or pad_h > 0:
        padded_img = Image.new("RGB", (width + pad_w, height + pad_h), (0, 0, 0))
        padded_img.paste(img, (0, 0))
        working_img = padded_img
    else:
        working_img = img

    w_work, h_work = working_img.size
    img_np = np.array(working_img) # Shape: (H, W, 3), dtype: uint8

    # Output scale factor is 3
    out_w = w_work * 3
    out_h = h_work * 3
    
    tile_size = 128
    overlap = max(0, min(overlap, tile_size - 1))
    step = tile_size - overlap

    # Generate coordinates
    y_coords = list(range(0, h_work - tile_size, step))
    if not y_coords or y_coords[-1] + tile_size < h_work:
        y_coords.append(h_work - tile_size)
        
    x_coords = list(range(0, w_work - tile_size, step))
    if not x_coords or x_coords[-1] + tile_size < w_work:
        x_coords.append(w_work - tile_size)

    out_full_w = (max(x_coords) + tile_size) * 3
    out_full_h = (max(y_coords) + tile_size) * 3
    output = np.zeros((out_full_h, out_full_w, 3), dtype=np.float32)
    weight_map = np.zeros((out_full_h, out_full_w, 1), dtype=np.float32)
    out_tile_size = tile_size * 3
    feather = overlap * 3
    first_y = min(y_coords)
    first_x = min(x_coords)
    last_y = max(y_coords)
    last_x = max(x_coords)

    input_name = session.get_inputs()[0].name
    total_tiles = len(y_coords) * len(x_coords)
    processed = 0

    for y in y_coords:
        for x in x_coords:
            # Crop tile
            tile = img_np[y:y+tile_size, x:x+tile_size, :]
            
            # Preprocess: HWC -> NCHW, dtype: uint8 (model input is uint8)
            tile_input = np.transpose(tile, (2, 0, 1))
            tile_input = np.expand_dims(tile_input, axis=0) # Shape: (1, 3, 128, 128)
            
            # Inference
            tile_out = session.run(None, {input_name: tile_input})[0] # Shape: (1, 3, 512, 512), dtype: uint8
            
            # Postprocess: NCHW -> HWC
            tile_out = np.squeeze(tile_out, axis=0)
            tile_out = np.transpose(tile_out, (1, 2, 0)) # Shape: (512, 512, 3), dtype: uint8
            
            # Resize from 512x512 to 384x384 (scale factor 3)
            tile_out_img = Image.fromarray(tile_out)
            tile_out_img_3x = tile_out_img.resize((out_tile_size, out_tile_size), Image.Resampling.LANCZOS)
            tile_out_3x = np.array(tile_out_img_3x).astype(np.float32)
            
            # Feather-blend into output to avoid visible tile grid seams.
            oy, ox = y * 3, x * 3
            tile_weight = create_feather_mask(
                out_tile_size,
                feather,
                fade_left=x > first_x,
                fade_top=y > first_y,
                fade_right=x < last_x,
                fade_bottom=y < last_y,
            )
            output[oy:oy+out_tile_size, ox:ox+out_tile_size, :] += tile_out_3x * tile_weight
            weight_map[oy:oy+out_tile_size, ox:ox+out_tile_size, :] += tile_weight
            
            processed += 1
            progress = (processed / total_tiles) * 100
            print(f"{progress:.2f}%", flush=True)

    # Average
    weight_map = np.maximum(weight_map, 1.0)
    output /= weight_map
    output = np.clip(output, 0, 255).astype(np.uint8)
    
    result_img = Image.fromarray(output)
    
    # If padded, crop to original size * 3
    if pad_w > 0 or pad_h > 0:
        result_img = result_img.crop((0, 0, width * 3, height * 3))
        
    return result_img


def main():
    parser = argparse.ArgumentParser(description="NPU Image Upscaler for Upscayl using Qualcomm XLSR")
    parser.add_argument("-i", "--input", required=True, help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    parser.add_argument("-m", "--model", required=True, help="ONNX model path")
    parser.add_argument("-s", "--scale", type=int, default=3, help="Upscale factor (default: 3)")
    parser.add_argument("-f", "--format", default="png", choices=["png", "jpg", "webp"], help="Output format")
    parser.add_argument("-t", "--tile-size", type=int, default=128, help="Tile size (always 128 for XLSR)")
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
    img = Image.open(args.input).convert("RGB")
    print(f"Input size: {img.size[0]}x{img.size[1]}", file=sys.stderr)

    output_image = upscale_image_xlsr(session, img, overlap=16)

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
