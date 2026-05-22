cmake_minimum_required(VERSION 3.20)
project(upscayl-npu-helper CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Specify path to ONNX Runtime
if(NOT ORT_PATH)
    set(ORT_PATH "${CMAKE_CURRENT_SOURCE_DIR}/third_party/onnxruntime")
endif()

message(STATUS "ONNX Runtime Path: ${ORT_PATH}")

include_directories(
    "${ORT_PATH}/build/native/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

# Source files
set(SOURCES
    src/main.cpp
    src/upscaler.cpp
)

add_executable(upscayl-npu-helper ${SOURCES})

# Libraries
find_library(ORT_LIB onnxruntime
    HINTS "${ORT_PATH}/runtimes/win-arm64/native"
    REQUIRED
)
message(STATUS "Found ORT Library: ${ORT_LIB}")

# Link dependencies
target_link_libraries(upscayl-npu-helper PRIVATE
    ${ORT_LIB}
    windowscodecs
    shlwapi
)

# Set runtime properties
if(MSVC)
    target_compile_options(upscayl-npu-helper PRIVATE /W4 /EHsc /MT)
endif()
