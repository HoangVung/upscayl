call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64_arm64
cd /d "d:\GitHub\upscayl\native\npu-helper\build"
cmake -G "Visual Studio 17 2022" -A ARM64 -DORT_PATH="d:\GitHub\upscayl\ort_1.24.4" ..
cmake --build . --config Release
