import {
  useNpuAtom,
  pythonPathAtom,
  npuEnvCheckingAtom,
  npuEnvStatusAtom,
  type NpuEnvStatus,
} from "@/atoms/user-settings-atom";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useEffect } from "react";

let cachedStatus: NpuEnvStatus | null = null;
let cachedPythonPath = "";

export default function NpuToggle() {
  const [useNpu, setUseNpu] = useAtom(useNpuAtom);
  const [pythonPath, setPythonPath] = useAtom(pythonPathAtom);
  const checking = useAtomValue(npuEnvCheckingAtom);
  const setChecking = useSetAtom(npuEnvCheckingAtom);
  const status = useAtomValue(npuEnvStatusAtom);
  const setStatus = useSetAtom(npuEnvStatusAtom);

  const checkEnv = async (force = false) => {
    if (!useNpu) return;
    if (!force && cachedStatus && cachedPythonPath === pythonPath) {
      setStatus(cachedStatus);
      return;
    }
    setChecking(true);
    try {
      const res = (await window.electron.invoke("check-npu-env", {
        pythonPath,
      })) as NpuEnvStatus;
      setStatus(res);
      cachedStatus = res;
      cachedPythonPath = pythonPath;
    } catch (err: any) {
      const errStatus: NpuEnvStatus = {
        pythonExists: false,
        pythonPath: "",
        pythonArch: "",
        onnxruntimeExists: false,
        onnxruntimeVersion: "",
        onnxruntimePath: "",
        qnnProviderExists: false,
        qnnPluginExists: false,
        qnnLibraryPath: "",
        qnnHtpPath: "",
        modelExists: false,
        providers: [],
        pilExists: false,
        numpyExists: false,
        errorMsg: err.message || String(err),
      };
      setStatus(errStatus);
      cachedStatus = errStatus;
      cachedPythonPath = pythonPath;
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (useNpu) {
      checkEnv();
    } else {
      setStatus(null);
    }
  }, [useNpu, pythonPath]);

  // Diagnostic logic based on ORT configuration
  const hasOnlyCpuOrAzure =
    status?.onnxruntimeExists &&
    !status.qnnProviderExists &&
    status.providers.some((p) => p === "CPUExecutionProvider" || p === "AzureExecutionProvider");

  const isNotArm64 = status?.pythonExists && status.pythonArch && !status.pythonArch.toLowerCase().includes("arm64");

  return (
    <div className="flex flex-col gap-4 border-t border-base-content/10 pt-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Processing Backend</p>
        <select
          value={useNpu ? "npu" : "standard"}
          onChange={(e) => {
            const val = e.target.value === "npu";
            setUseNpu(val);
            if (!val) {
              setStatus(null);
            }
            localStorage.setItem("useNpu", val.toString());
          }}
          className="select select-primary w-full"
        >
          <option value="standard">Standard GPU/CPU (NCNN)</option>
          <option value="npu">Snapdragon NPU - XLSR 3x Experimental</option>
        </select>
      </div>

      {useNpu && (
        <div className="flex flex-col gap-4 animate-step-in">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Python Executable Path</p>
              <button
                type="button"
                onClick={() => checkEnv(true)}
                disabled={checking}
                className="btn btn-xs btn-outline"
              >
                {checking ? "Checking..." : "Refresh"}
              </button>
            </div>
            <input
              type="text"
              value={pythonPath}
              onChange={(e) => {
                setPythonPath(e.target.value);
                setStatus(null);
                cachedStatus = null;
                cachedPythonPath = "";
                localStorage.setItem("pythonPath", e.target.value);
              }}
              className="input input-primary w-full text-sm"
              placeholder="e.g. python, python3, or absolute path"
            />
          </div>

          <div className="rounded-btn bg-base-200 p-3 flex flex-col gap-2 text-xs">
            <p className="font-semibold text-base-content/85">Snapdragon NPU Environment Status:</p>

            <div className="flex items-center justify-between">
              <span>Python 3 Installed:</span>
              <span className="font-semibold">
                {status ? (status.pythonExists ? "✅ Yes" : "❌ No") : "Checking..."}
              </span>
            </div>

            {status && status.pythonExists && status.pythonPath && (
              <div className="flex flex-col gap-1 text-[10px] text-base-content/60 ml-2">
                <div>Path: <span className="font-mono">{status.pythonPath}</span></div>
                <div>Arch: <span className="font-mono">{status.pythonArch || "Unknown"}</span></div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span>ONNX Runtime import:</span>
              <span className="font-semibold">
                {status ? (status.onnxruntimeExists ? "✅ Found" : "❌ Missing") : "Checking..."}
              </span>
            </div>

            {status && status.onnxruntimeExists && (
              <div className="flex flex-col gap-1 text-[10px] text-base-content/60 ml-2">
                <div>Version: <span className="font-mono">{status.onnxruntimeVersion}</span></div>
                <div className="break-all">File: <span className="font-mono">{status.onnxruntimePath}</span></div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span>QNN provider:</span>
              <span className="font-semibold">
                {status ? (status.qnnProviderExists ? "✅ Available" : "❌ Unavailable") : "Checking..."}
              </span>
            </div>

            {status?.qnnPluginExists && (
              <div className="flex flex-col gap-1 text-[10px] text-base-content/60 ml-2">
                <div>Plugin: <span className="font-mono">onnxruntime_qnn</span></div>
                <div className="break-all">EP library: <span className="font-mono">{status.qnnLibraryPath}</span></div>
                <div className="break-all">HTP backend: <span className="font-mono">{status.qnnHtpPath}</span></div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span>XLSR Model Files:</span>
              <span className="font-semibold">
                {status ? (status.modelExists ? "✅ Found" : "❌ Missing") : "Checking..."}
              </span>
            </div>

            {status && status.providers && status.providers.length > 0 && (
              <div className="mt-1 pt-1 border-t border-base-content/5 text-[10px] text-base-content/60">
                Available providers: {status.providers.join(", ")}
              </div>
            )}

            {status && status.errorMsg && !status.pythonExists && (
              <div className="mt-1 text-red-400 font-mono text-[10px] break-all">
                Error: {status.errorMsg}
              </div>
            )}
          </div>

          {/* Diagnostic Warnings */}
          {hasOnlyCpuOrAzure && (
            <div className="rounded-btn bg-warning/10 p-2.5 text-xs text-warning border border-warning/20 flex flex-col gap-1">
              <span className="font-semibold">⚠️ ONNX Runtime CPU version detected:</span>
              <span>Python is importing ONNX Runtime without a usable QNN plugin device. Uninstall conflict packages and reinstall `onnxruntime-qnn` in PowerShell:</span>
              <pre className="bg-black/20 p-2 rounded font-mono text-[10px] mt-1 select-all whitespace-pre-wrap">
                {status?.pythonPath ? `& "${status.pythonPath}"` : "python"} -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml onnxruntime-qnn{"\n"}
                {status?.pythonPath ? `& "${status.pythonPath}"` : "python"} -m pip install --upgrade onnxruntime-qnn Pillow numpy
              </pre>
            </div>
          )}

          {isNotArm64 && (
            <div className="rounded-btn bg-error/10 p-2.5 text-xs text-error border border-error/20 flex flex-col gap-1">
              <span className="font-semibold">❌ Non-ARM64 Python detected ({status?.pythonArch}):</span>
              <span>Qualcomm QNN NPU acceleration is only supported on Windows ARM64. Please run using a native ARM64 Python installation.</span>
            </div>
          )}

          {status && !status.qnnProviderExists && !hasOnlyCpuOrAzure && !isNotArm64 && (
            <div className="rounded-btn bg-warning/10 p-2.5 text-xs text-warning border border-warning/20">
              ⚠️ QNNExecutionProvider is unavailable. Check that your environment is running native Windows ARM64 and the Qualcomm QNN SDK DLLs are set up.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
