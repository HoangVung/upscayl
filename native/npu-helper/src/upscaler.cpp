#define NOMINMAX
#include "upscaler.h"
#include <iostream>
#include <algorithm>
#include <cmath>
#include <thread>
#include <shlwapi.h>
#include <shlobj.h>

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")

NPUUpscaler::NPUUpscaler() {
    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (SUCCEEDED(hr)) {
        com_initialized_ = true;
    }
    
    hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        NULL,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&wic_factory_)
    );
    if (FAILED(hr)) {
        std::cerr << "Failed to create WIC Imaging Factory. WIC features disabled." << std::endl;
        wic_factory_ = nullptr;
    }
}

NPUUpscaler::~NPUUpscaler() {
    if (wic_factory_) {
        wic_factory_->Release();
        wic_factory_ = nullptr;
    }
    if (com_initialized_) {
        CoUninitialize();
    }
}

std::vector<std::string> NPUUpscaler::GetAvailableProviders() {
    return Ort::GetAvailableProviders();
}

static std::wstring GetModuleSiblingPath(const std::wstring& filename) {
    wchar_t path[MAX_PATH];
    if (GetModuleFileNameW(NULL, path, MAX_PATH) > 0) {
        PathRemoveFileSpecW(path);
        return std::wstring(path) + L"\\" + filename;
    }
    return filename;
}

bool NPUUpscaler::IsQNNSupported() {
    try {
        std::wcerr << L"[NPU Helper] Creating env..." << std::endl;
        Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "QNNCheckEnv");
        
        std::wstring dll_path = GetModuleSiblingPath(L"onnxruntime_providers_qnn.dll");
        std::wcerr << L"[NPU Helper] Registering EP library at: " << dll_path << std::endl;
        env.RegisterExecutionProviderLibrary("QNNExecutionProvider", dll_path);
        
        std::vector<Ort::ConstEpDevice> qnn_devices;
        for (const auto& dev : env.GetEpDevices()) {
            if (std::string(dev.EpName()) == "QNNExecutionProvider") {
                qnn_devices.push_back(dev);
            }
        }
        
        if (qnn_devices.empty()) {
            std::wcerr << L"[NPU Helper] No QNNExecutionProvider device found!" << std::endl;
            return false;
        }

        std::wcerr << L"[NPU Helper] QNN Check succeeded (found QNN EP devices)!" << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::wcerr << L"[NPU Helper] QNN check failed with exception: " << e.what() << std::endl;
        return false;
    }
}

bool NPUUpscaler::Initialize(const std::wstring& model_path, bool use_npu) {
    try {
        use_npu_ = use_npu;
        Ort::SessionOptions session_options;
        session_options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        
        unsigned int cpu_cores = std::thread::hardware_concurrency();
        session_options.SetIntraOpNumThreads(cpu_cores > 0 ? cpu_cores : 4);

        if (use_npu_) {
            std::wstring dll_path = GetModuleSiblingPath(L"onnxruntime_providers_qnn.dll");
            env_.RegisterExecutionProviderLibrary("QNNExecutionProvider", dll_path);
            
            std::vector<Ort::ConstEpDevice> qnn_devices;
            for (const auto& dev : env_.GetEpDevices()) {
                if (std::string(dev.EpName()) == "QNNExecutionProvider") {
                    qnn_devices.push_back(dev);
                }
            }
            
            if (qnn_devices.empty()) {
                throw std::runtime_error("No QNNExecutionProvider device found during initialization.");
            }

            // Append QNN EP with absolute backend path to QnnHtp.dll
            std::wstring qnn_backend_wpath = GetModuleSiblingPath(L"QnnHtp.dll");
            std::string qnn_backend_path(qnn_backend_wpath.begin(), qnn_backend_wpath.end());
            
            std::unordered_map<std::string, std::string> qnn_options;
            qnn_options["backend_path"] = qnn_backend_path;
            
            session_options.AppendExecutionProvider_V2(env_, qnn_devices, qnn_options);
            std::wcerr << L"[NPU Helper] Registered QNN EP with backend path: " << qnn_backend_wpath << L" via AppendExecutionProvider_V2" << std::endl;
        } else {
            // Check DirectML fallback
            auto available = GetAvailableProviders();
            if (std::find(available.begin(), available.end(), "DmlExecutionProvider") != available.end()) {
                // DirectML registration
                session_options.AppendExecutionProvider("DML", {});
                std::wcerr << L"[NPU Helper] Fallback: DirectML registered" << std::endl;
            } else {
                std::wcerr << L"[NPU Helper] Fallback: CPU registered" << std::endl;
            }
        }

        // Load the session
        session_ = std::make_unique<Ort::Session>(env_, model_path.c_str(), session_options);

        // Get Input/Output Names
        Ort::AllocatorWithDefaultOptions allocator;
        auto input_name_alloc = session_->GetInputNameAllocated(0, allocator);
        input_name_ = std::string(input_name_alloc.get());
        
        auto output_name_alloc = session_->GetOutputNameAllocated(0, allocator);
        output_name_ = std::string(output_name_alloc.get());

        std::wcerr << L"[NPU Helper] Session initialized successfully." << std::endl;
        return true;
    }
    catch (const std::exception& e) {
        std::cerr << "Initialization failed: " << e.what() << std::endl;
        return false;
    }
}

bool NPUUpscaler::LoadImageWIC(const std::wstring& path, std::vector<uint8_t>& img_data, uint32_t& width, uint32_t& height) {
    if (!wic_factory_) return false;

    IWICBitmapDecoder* decoder = nullptr;
    HRESULT hr = wic_factory_->CreateDecoderFromFilename(
        path.c_str(),
        NULL,
        GENERIC_READ,
        WICDecodeMetadataCacheOnDemand,
        &decoder
    );
    if (FAILED(hr)) return false;

    IWICBitmapFrameDecode* frame = nullptr;
    hr = decoder->GetFrame(0, &frame);
    if (FAILED(hr)) {
        decoder->Release();
        return false;
    }

    IWICFormatConverter* converter = nullptr;
    hr = wic_factory_->CreateFormatConverter(&converter);
    if (FAILED(hr)) {
        frame->Release();
        decoder->Release();
        return false;
    }

    hr = converter->Initialize(
        frame,
        GUID_WICPixelFormat24bppRGB,
        WICBitmapDitherTypeNone,
        NULL,
        0.0,
        WICBitmapPaletteTypeCustom
    );
    if (FAILED(hr)) {
        converter->Release();
        frame->Release();
        decoder->Release();
        return false;
    }

    hr = converter->GetSize(&width, &height);
    if (FAILED(hr)) {
        converter->Release();
        frame->Release();
        decoder->Release();
        return false;
    }

    img_data.resize(width * height * 3);
    hr = converter->CopyPixels(
        NULL,
        width * 3,
        static_cast<UINT>(img_data.size()),
        img_data.data()
    );

    converter->Release();
    frame->Release();
    decoder->Release();

    return SUCCEEDED(hr);
}

bool NPUUpscaler::SaveImageWIC(const std::wstring& path, const std::vector<uint8_t>& img_data, uint32_t width, uint32_t height, const std::wstring& format, int compression) {
    if (!wic_factory_) return false;

    IWICStream* stream = nullptr;
    HRESULT hr = wic_factory_->CreateStream(&stream);
    if (FAILED(hr)) return false;

    hr = stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE);
    if (FAILED(hr)) {
        stream->Release();
        return false;
    }

    GUID container_guid = GUID_ContainerFormatPng;
    std::wstring fmt = format;
    std::transform(fmt.begin(), fmt.end(), fmt.begin(), ::tolower);
    if (fmt == L"jpg" || fmt == L"jpeg") {
        container_guid = GUID_ContainerFormatJpeg;
    }

    IWICBitmapEncoder* encoder = nullptr;
    hr = wic_factory_->CreateEncoder(container_guid, NULL, &encoder);
    if (FAILED(hr)) {
        stream->Release();
        return false;
    }

    hr = encoder->Initialize(stream, WICBitmapEncoderNoCache);
    if (FAILED(hr)) {
        encoder->Release();
        stream->Release();
        return false;
    }

    IWICBitmapFrameEncode* frame_encode = nullptr;
    IPropertyBag2* property_bag = nullptr;
    hr = encoder->CreateNewFrame(&frame_encode, &property_bag);
    if (FAILED(hr)) {
        encoder->Release();
        stream->Release();
        return false;
    }

    if (property_bag && container_guid == GUID_ContainerFormatJpeg) {
        PROPBAG2 prop = {};
        prop.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
        VARIANT var;
        VariantInit(&var);
        var.vt = VT_R4;
        
        float quality = 0.95f;
        if (compression > 0) {
            quality = static_cast<float>(100 - compression) / 100.0f;
        }
        var.fltVal = quality;
        property_bag->Write(1, &prop, &var);
    }

    hr = frame_encode->Initialize(property_bag);
    if (FAILED(hr)) {
        if (property_bag) property_bag->Release();
        frame_encode->Release();
        encoder->Release();
        stream->Release();
        return false;
    }
    if (property_bag) property_bag->Release();

    hr = frame_encode->SetSize(width, height);
    if (FAILED(hr)) {
        frame_encode->Release();
        encoder->Release();
        stream->Release();
        return false;
    }

    WICPixelFormatGUID pixel_format = GUID_WICPixelFormat24bppRGB;
    hr = frame_encode->SetPixelFormat(&pixel_format);
    if (FAILED(hr)) {
        frame_encode->Release();
        encoder->Release();
        stream->Release();
        return false;
    }

    hr = frame_encode->WritePixels(
        height,
        width * 3,
        static_cast<UINT>(img_data.size()),
        const_cast<BYTE*>(img_data.data())
    );
    if (FAILED(hr)) {
        frame_encode->Release();
        encoder->Release();
        stream->Release();
        return false;
    }

    hr = frame_encode->Commit();
    if (SUCCEEDED(hr)) {
        hr = encoder->Commit();
    }

    frame_encode->Release();
    encoder->Release();
    stream->Release();

    return SUCCEEDED(hr);
}

void NPUUpscaler::BilinearScale(const uint8_t* src, int src_w, int src_h, uint8_t* dst, int dst_w, int dst_h) {
    float x_ratio = dst_w > 1 ? static_cast<float>(src_w - 1) / (dst_w - 1) : 0.0f;
    float y_ratio = dst_h > 1 ? static_cast<float>(src_h - 1) / (dst_h - 1) : 0.0f;
    
    for (int i = 0; i < dst_h; i++) {
        float py = y_ratio * i;
        int y = static_cast<int>(py);
        float y_diff = py - y;
        int y1 = std::min(y + 1, src_h - 1);
        
        for (int j = 0; j < dst_w; j++) {
            float px = x_ratio * j;
            int x = static_cast<int>(px);
            float x_diff = px - x;
            int x1 = std::min(x + 1, src_w - 1);
            
            for (int c = 0; c < 3; c++) {
                float a = src[(y * src_w + x) * 3 + c];
                float b = src[(y * src_w + x1) * 3 + c];
                float d_pixel = src[(y1 * src_w + x) * 3 + c];
                float d_pixel_next = src[(y1 * src_w + x1) * 3 + c];
                
                float val = a * (1.0f - x_diff) * (1.0f - y_diff) +
                            b * x_diff * (1.0f - y_diff) +
                            d_pixel * (1.0f - x_diff) * y_diff +
                            d_pixel_next * x_diff * y_diff;
                dst[(i * dst_w + j) * 3 + c] = static_cast<uint8_t>(std::max(0.0f, std::min(255.0f, val)));
            }
        }
    }
}

std::vector<float> NPUUpscaler::CreateFeatherMask(int size, int feather, bool fade_left, bool fade_top, bool fade_right, bool fade_bottom) {
    std::vector<float> mask(size * size, 1.0f);
    if (feather <= 0) return mask;

    feather = std::min(feather, size / 2);
    
    std::vector<float> x_ramp(size, 1.0f);
    std::vector<float> y_ramp(size, 1.0f);
    
    for (int i = 0; i < feather; ++i) {
        float val = static_cast<float>(i + 1) / (feather + 1);
        if (fade_left) x_ramp[i] = val;
        if (fade_right) x_ramp[size - 1 - i] = val;
        if (fade_top) y_ramp[i] = val;
        if (fade_bottom) y_ramp[size - 1 - i] = val;
    }
    
    for (int y = 0; y < size; ++y) {
        for (int x = 0; x < size; ++x) {
            mask[y * size + x] = std::min(y_ramp[y], x_ramp[x]);
        }
    }
    return mask;
}

bool NPUUpscaler::Upscale(const std::wstring& input_path, const std::wstring& output_path, int scale_factor, const std::wstring& format, int compression) {
    if (!session_) {
        std::cerr << "Session not initialized." << std::endl;
        return false;
    }

    std::vector<uint8_t> input_img;
    uint32_t width = 0, height = 0;
    if (!LoadImageWIC(input_path, input_img, width, height)) {
        std::wcerr << L"Failed to load image: " << input_path << std::endl;
        return false;
    }

    // Handle padding if smaller than 128x128
    int pad_w = std::max(0, 128 - static_cast<int>(width));
    int pad_h = std::max(0, 128 - static_cast<int>(height));
    
    int w_work = width + pad_w;
    int h_work = height + pad_h;
    
    std::vector<uint8_t> working_img(w_work * h_work * 3, 0);
    for (uint32_t y = 0; y < height; ++y) {
        std::copy(
            input_img.begin() + y * width * 3,
            input_img.begin() + (y * width + width) * 3,
            working_img.begin() + y * w_work * 3
        );
    }

    // Output dimension calculations (scale factor 3)
    int out_w = w_work * 3;
    int out_h = h_work * 3;

    int tile_size = 128;
    int overlap = 16;
    int step = tile_size - overlap;

    // Grid coordinates
    std::vector<int> y_coords;
    for (int y = 0; y < h_work - tile_size; y += step) {
        y_coords.push_back(y);
    }
    if (y_coords.empty() || y_coords.back() + tile_size < h_work) {
        y_coords.push_back(h_work - tile_size);
    }

    std::vector<int> x_coords;
    for (int x = 0; x < w_work - tile_size; x += step) {
        x_coords.push_back(x);
    }
    if (x_coords.empty() || x_coords.back() + tile_size < w_work) {
        x_coords.push_back(w_work - tile_size);
    }

    int out_full_w = (x_coords.back() + tile_size) * 3;
    int out_full_h = (y_coords.back() + tile_size) * 3;

    std::vector<float> output_accum(out_full_h * out_full_w * 3, 0.0f);
    std::vector<float> weight_accum(out_full_h * out_full_w, 0.0f);

    int out_tile_size = tile_size * 3; // 384
    int feather = overlap * 3; // 48
    int first_y = y_coords.front();
    int first_x = x_coords.front();
    int last_y = y_coords.back();
    int last_x = x_coords.back();

    size_t total_tiles = y_coords.size() * x_coords.size();
    size_t processed = 0;

    auto memory_info = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU);
    std::vector<int64_t> input_shape = { 1, 3, 128, 128 };
    std::vector<uint8_t> input_tensor_values(1 * 3 * 128 * 128);

    const char* input_name_char = input_name_.c_str();
    const char* output_name_char = output_name_.c_str();

    for (int y : y_coords) {
        for (int x : x_coords) {
            // Preprocess HWC to NCHW uint8
            for (int c = 0; c < 3; ++c) {
                for (int th = 0; th < tile_size; ++th) {
                    for (int tw = 0; tw < tile_size; ++tw) {
                        input_tensor_values[c * tile_size * tile_size + th * tile_size + tw] =
                            working_img[((y + th) * w_work + (x + tw)) * 3 + c];
                    }
                }
            }

            // Inference
            auto input_tensor = Ort::Value::CreateTensor<uint8_t>(
                memory_info,
                input_tensor_values.data(),
                input_tensor_values.size(),
                input_shape.data(),
                input_shape.size()
            );

            auto output_tensors = session_->Run(
                Ort::RunOptions{ nullptr },
                &input_name_char,
                &input_tensor,
                1,
                &output_name_char,
                1
            );

            // Output transpose NCHW back to HWC
            uint8_t* output_data = output_tensors[0].GetTensorMutableData<uint8_t>();
            std::vector<uint8_t> tile_out_512(512 * 512 * 3);
            for (int th = 0; th < 512; ++th) {
                for (int tw = 0; tw < 512; ++tw) {
                    tile_out_512[(th * 512 + tw) * 3 + 2] = output_data[0 * 512 * 512 + th * 512 + tw]; // Blue
                    tile_out_512[(th * 512 + tw) * 3 + 1] = output_data[1 * 512 * 512 + th * 512 + tw]; // Green
                    tile_out_512[(th * 512 + tw) * 3 + 0] = output_data[2 * 512 * 512 + th * 512 + tw]; // Red
                }
            }

            // Downsize 512x512 to 384x384
            std::vector<uint8_t> tile_out_384(out_tile_size * out_tile_size * 3);
            BilinearScale(tile_out_512.data(), 512, 512, tile_out_384.data(), out_tile_size, out_tile_size);

            // Feather mask blending
            auto tile_mask = CreateFeatherMask(
                out_tile_size,
                feather,
                x > first_x,
                y > first_y,
                x < last_x,
                y < last_y
            );

            for (int th = 0; th < out_tile_size; ++th) {
                for (int tw = 0; tw < out_tile_size; ++tw) {
                    int oy = y * 3 + th;
                    int ox = x * 3 + tw;
                    float weight = tile_mask[th * out_tile_size + tw];
                    
                    for (int c = 0; c < 3; ++c) {
                        output_accum[(oy * out_full_w + ox) * 3 + c] +=
                            tile_out_384[(th * out_tile_size + tw) * 3 + c] * weight;
                    }
                    weight_accum[oy * out_full_w + ox] += weight;
                }
            }

            processed++;
            double progress = (static_cast<double>(processed) / total_tiles) * 100.0;
            printf("%.2f%%\n", progress);
            fflush(stdout);
            fprintf(stderr, "%.2f%%\n", progress);
            fflush(stderr);
        }
    }

    // Accumulation merge & crop
    std::vector<uint8_t> final_output_full(out_full_h * out_full_w * 3);
    for (int i = 0; i < out_full_h * out_full_w; ++i) {
        float w = weight_accum[i] > 0.0f ? weight_accum[i] : 1.0f;
        for (int c = 0; c < 3; ++c) {
            float val = output_accum[i * 3 + c] / w;
            final_output_full[i * 3 + c] = static_cast<uint8_t>(std::max(0.0f, std::min(255.0f, val)));
        }
    }

    // Crop back to original width * 3, height * 3 if needed
    uint32_t final_w = width * 3;
    uint32_t final_h = height * 3;
    std::vector<uint8_t> final_output(final_w * final_h * 3);
    
    for (uint32_t y = 0; y < final_h; ++y) {
        std::copy(
            final_output_full.begin() + y * out_full_w * 3,
            final_output_full.begin() + (y * out_full_w + final_w) * 3,
            final_output.begin() + y * final_w * 3
        );
    }

    // Create target directory
    wchar_t out_path_copy[MAX_PATH];
    wcscpy_s(out_path_copy, output_path.c_str());
    PathRemoveFileSpecW(out_path_copy);
    SHCreateDirectoryExW(NULL, out_path_copy, NULL);

    return SaveImageWIC(output_path, final_output, final_w, final_h, format, compression);
}
