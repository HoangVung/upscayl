$ErrorActionPreference = "Stop"

# Paths
$WorkspaceDir = "d:\GitHub\upscayl"
$BuildDir = "$WorkspaceDir\native\npu-helper\build"
$OrtPath = "$WorkspaceDir\ort_1.24.4"
$OutputDir = "$WorkspaceDir\resources\npu\bin\win-arm64"
$PythonQnnDir = "C:\Users\vungh\AppData\Local\Programs\Python\Python312-arm64\Lib\site-packages\onnxruntime_qnn"

Write-Host "=== Building Native NPU Helper for Windows ARM64 ==="

# Find vcvarsall.bat
$vcvars = $null
$vcvarsPaths = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvarsall.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvarsall.bat"
)

foreach ($path in $vcvarsPaths) {
    if (Test-Path $path) {
        $vcvars = $path
        break
    }
}

if ($null -eq $vcvars) {
    Write-Error "Could not find vcvarsall.bat in any standard Visual Studio 2022 directory."
}

Write-Host "Found vcvarsall.bat at: $vcvars"

# Set build directory
if (Test-Path $BuildDir) {
    Remove-Item -Recurse -Force $BuildDir
}
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

# Run CMake and compile under VC context targeting ARM64
# We use cmd /c to run vcvarsall.bat and cmake sequentially in the same environment
$Command = @"
call "$vcvars" x64_arm64
cd /d "$BuildDir"
cmake -G "Visual Studio 17 2022" -A ARM64 -DORT_PATH="$OrtPath" ..
cmake --build . --config Release
"@

$TempBat = "$BuildDir\run_build.bat"
Set-Content -Path $TempBat -Value $Command

Write-Host "Running build commands..."
cmd.exe /c $TempBat

# Verify the executable was created
$HelperExe = "$BuildDir\Release\upscayl-npu-helper.exe"
if (-not (Test-Path $HelperExe)) {
    Write-Error "Build failed: upscayl-npu-helper.exe was not created."
}

Write-Host "Executable built successfully."

# Setup output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

# Copy Built helper
Copy-Item -Path $HelperExe -Destination $OutputDir -Force
Write-Host "Copied helper to $OutputDir"

# Copy ONNX Runtime libraries
$PythonOrtDir = "C:\Users\vungh\AppData\Local\Programs\Python\Python312-arm64\Lib\site-packages\onnxruntime\capi"
if (Test-Path "$PythonOrtDir\onnxruntime.dll") {
    Write-Host "Copying ONNX Runtime libs from python: $PythonOrtDir"
    Copy-Item -Path "$PythonOrtDir\onnxruntime.dll" -Destination $OutputDir -Force
    Copy-Item -Path "$PythonOrtDir\onnxruntime_providers_shared.dll" -Destination $OutputDir -Force
} else {
    Write-Host "Copying ONNX Runtime libs from NuGet cache: $OrtPath"
    $OrtLibSrc = "$OrtPath\runtimes\win-arm64\native"
    Copy-Item -Path "$OrtLibSrc\onnxruntime.dll" -Destination $OutputDir -Force
    Copy-Item -Path "$OrtLibSrc\onnxruntime_providers_shared.dll" -Destination $OutputDir -Force
}
Write-Host "Copied ONNX Runtime libs to $OutputDir"

# Copy QNN Provider and Qualcomm DLLs / SOs
if (-not (Test-Path $PythonQnnDir)) {
    Write-Warning "Python QNN environment directory not found at $PythonQnnDir. Dynamic execution might fail if Qualcomm DLLs are not present."
} else {
    Write-Host "Copying QNN dependencies from $PythonQnnDir..."
    $FilesToCopy = Get-ChildItem -Path $PythonQnnDir -Include "*.dll", "*.so" -Recurse
    foreach ($File in $FilesToCopy) {
        Copy-Item -Path $File.FullName -Destination $OutputDir -Force
    }
    Write-Host "Copied QNN provider and all Qualcomm binaries to $OutputDir"
}

Write-Host "=== Build and packaging completed! ==="
