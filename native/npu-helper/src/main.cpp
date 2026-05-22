#include <iostream>
#include <string>
#include <vector>
#include "upscaler.h"

void PrintUsage() {
    std::wcout << L"Usage: upscayl-npu-helper.exe [options]\n"
               << L"Options:\n"
               << L"  -i, --input <path>      Input image path\n"
               << L"  -o, --output <path>     Output image path\n"
               << L"  -m, --model <path>      ONNX model path\n"
               << L"  -s, --scale <factor>    Upscale scale factor (default: 3)\n"
               << L"  -f, --format <ext>      Output image format (png, jpg) (default: png)\n"
               << L"  -c, --compression <val> Compression level 0-100 (default: 0)\n"
               << L"  --no-npu                Disable NPU, run on CPU/DML instead\n"
               << L"  --list-providers        List available ORT providers and exit\n"
               << L"  --check                 Check NPU status and exit\n";
}

int wmain(int argc, wchar_t* argv[]) {
    std::wstring input_path;
    std::wstring output_path;
    std::wstring model_path;
    int scale_factor = 3;
    std::wstring format = L"png";
    int compression = 0;
    bool no_npu = false;
    bool list_providers = false;
    bool check_only = false;

    for (int i = 1; i < argc; ++i) {
        std::wstring arg = argv[i];
        if (arg == L"-i" || arg == L"--input") {
            if (i + 1 < argc) input_path = argv[++i];
        } else if (arg == L"-o" || arg == L"--output") {
            if (i + 1 < argc) output_path = argv[++i];
        } else if (arg == L"-m" || arg == L"--model") {
            if (i + 1 < argc) model_path = argv[++i];
        } else if (arg == L"-s" || arg == L"--scale") {
            if (i + 1 < argc) {
                try {
                    scale_factor = std::stoi(argv[++i]);
                } catch (...) {
                    scale_factor = 3;
                }
            }
        } else if (arg == L"-f" || arg == L"--format") {
            if (i + 1 < argc) format = argv[++i];
        } else if (arg == L"-c" || arg == L"--compression") {
            if (i + 1 < argc) {
                try {
                    compression = std::stoi(argv[++i]);
                } catch (...) {
                    compression = 0;
                }
            }
        } else if (arg == L"--no-npu") {
            no_npu = true;
        } else if (arg == L"--list-providers") {
            list_providers = true;
        } else if (arg == L"--check") {
            check_only = true;
        } else if (arg == L"-h" || arg == L"--help") {
            PrintUsage();
            return 0;
        }
    }

    if (list_providers || check_only) {
        auto providers = NPUUpscaler::GetAvailableProviders();
        for (const auto& p : providers) {
            std::cout << p << std::endl;
        }
        bool has_qnn = NPUUpscaler::IsQNNSupported();
        std::cout << "\nNPU (QNN) Support: " << (has_qnn ? "YES" : "NO") << std::endl;
        return 0;
    }

    if (input_path.empty() || output_path.empty() || model_path.empty()) {
        PrintUsage();
        return 1;
    }

    NPUUpscaler upscaler;
    if (!upscaler.Initialize(model_path, !no_npu)) {
        std::wcerr << L"Failed to initialize upscaler session." << std::endl;
        return 1;
    }

    if (!upscaler.Upscale(input_path, output_path, scale_factor, format, compression)) {
        std::wcerr << L"Upscaling failed." << std::endl;
        return 1;
    }

    return 0;
}
