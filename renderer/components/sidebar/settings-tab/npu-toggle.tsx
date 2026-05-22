import { useNpuAtom } from "@/atoms/user-settings-atom";
import { useAtom } from "jotai";
import React from "react";

export default function NpuToggle() {
  const [useNpu, setUseNpu] = useAtom(useNpuAtom);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="toggle"
          checked={useNpu}
          onChange={(e) => {
            setUseNpu(e.target.checked);
            localStorage.setItem("useNpu", e.target.checked.toString());
          }}
        />
        <p className="text-sm font-medium">Use Snapdragon NPU</p>
      </div>
      <p className="text-xs text-base-content/80">
        Use Qualcomm Snapdragon NPU (Neural Processing Unit) for upscaling via
        ONNX Runtime + QNN. Requires Python with onnxruntime-qnn and ONNX model
        files.
      </p>
      {useNpu && (
        <div className="rounded-btn bg-warning/10 p-2 text-xs text-warning">
          ⚠️ NPU mode requires: Python 3.10+, pip install onnxruntime-qnn Pillow
          numpy, and ONNX format models. Only available on Snapdragon X
          Plus/Elite devices.
        </div>
      )}
    </div>
  );
}