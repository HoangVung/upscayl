#pragma once

#include <string>
#include <vector>
#include <memory>
#include <wincodec.h>
#include "onnxruntime_cxx_api.h"

class NPUUpscaler {
public:
    NPUUpscaler();
    ~NPUUpscaler();

    // Check availability
    static std::vector<std::string> GetAvailableProviders();
    static bool IsQNNSupported();

    // Initialize model session
    bool Initialize(const std::wstring& model_path, bool use_npu = true);

    // Upscale processing
    bool Upscale(const std::wstring& input_path, 
                 const std::wstring& output_path, 
                 int scale_factor = 3, 
                 const std::wstring& format = L"png", 
                 int compression = 0);

private:
    // Helper methods for WIC image decoding/encoding
    bool LoadImageWIC(const std::wstring& path, std::vector<uint8_t>& img_data, uint32_t& width, uint32_t& height);
    bool SaveImageWIC(const std::wstring& path, const std::vector<uint8_t>& img_data, uint32_t width, uint32_t height, const std::wstring& format, int compression);

    // Bilinear scaling helper
    void BilinearScale(const uint8_t* src, int src_w, int src_h, uint8_t* dst, int dst_w, int dst_h);

    // Create blend mask
    std::vector<float> CreateFeatherMask(int size, int feather, bool fade_left, bool fade_top, bool fade_right, bool fade_bottom);

    // COM initialization
    bool com_initialized_ = false;
    IWICImagingFactory* wic_factory_ = nullptr;

    // ONNX Runtime elements
    Ort::Env env_;
    std::unique_ptr<Ort::Session> session_;
    bool use_npu_ = true;

    std::string input_name_;
    std::string output_name_;
};
