import { exec } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { npuModelsPath } from "../utils/get-resource-paths";

export interface NpuEnvCheckResult {
  pythonExists: boolean;
  pythonPath: string;
  pythonArch: string;
  onnxruntimeExists: boolean;
  onnxruntimeVersion: string;
  onnxruntimePath: string;
  qnnPluginExists: boolean;
  qnnLibraryPath: string;
  qnnHtpPath: string;
  qnnProviderExists: boolean;
  modelExists: boolean;
  providers: string[];
  pilExists: boolean;
  numpyExists: boolean;
  errorMsg: string;
}

export const checkNpuEnv = async (
  event: any,
  payload: { pythonPath?: string }
): Promise<NpuEnvCheckResult> => {
  const python = payload.pythonPath || "python";

  // Using simple base64 or safe inline code execution. Since base64 is highly portable and avoids escape issues,
  // we can use a Python base64 decoded execution.
const pythonScript = `
import sys, platform
ort_ok = "False"
ort_ver = ""
ort_file = ""
qnn = "False"
qnn_plugin = "False"
qnn_library_path = ""
qnn_htp_path = ""
providers = []
pil_ok = "False"
np_ok = "False"
try:
    import onnxruntime as ort
    ort_ok = "True"
    ort_ver = ort.__version__
    ort_file = ort.__file__
    try:
        import onnxruntime_qnn as qnn_ep
        qnn_plugin = "True"
        qnn_library_path = qnn_ep.get_library_path()
        qnn_htp_path = qnn_ep.get_qnn_htp_path()
        ort.register_execution_provider_library("QNNExecutionProvider", qnn_library_path)
    except Exception as e:
        qnn_library_path = str(e)
    providers = ort.get_available_providers()
    try:
        ep_devices = ort.get_ep_devices()
        qnn = "True" if any(d.ep_name == "QNNExecutionProvider" for d in ep_devices) else "False"
    except Exception:
        qnn = "True" if "QNNExecutionProvider" in providers else "False"
except Exception as e:
    ort_file = str(e)
try:
    import PIL
    pil_ok = "True"
except:
    pass
try:
    import numpy
    np_ok = "True"
except:
    pass
print("PATH=" + sys.executable)
print("ARCH=" + platform.machine())
print("ORT_OK=" + ort_ok)
print("ORT_VER=" + ort_ver)
print("ORT_FILE=" + ort_file)
print("QNN_PLUGIN=" + qnn_plugin)
print("QNN_LIBRARY_PATH=" + qnn_library_path)
print("QNN_HTP_PATH=" + qnn_htp_path)
print("QNN=" + qnn)
print("PROVIDERS=" + ":".join(providers))
print("PIL=" + pil_ok)
print("NUMPY=" + np_ok)
`;

  // Encode to base64 to avoid any command line escaping issues on Windows cmd/powershell
  const b64Script = Buffer.from(pythonScript).toString("base64");
  const command = `"${python}" -c "import base64; exec(base64.b64decode('${b64Script}').decode('utf-8'))"`;

  return new Promise((resolve) => {
    const modelOnnxPath = join(npuModelsPath, "xlsr.onnx");
    const modelDataPath = join(npuModelsPath, "xlsr.data");
    const modelExists = existsSync(modelOnnxPath) && existsSync(modelDataPath);

    exec(command, (error, stdout, stderr) => {
      const result: NpuEnvCheckResult = {
        pythonExists: false,
        pythonPath: "",
        pythonArch: "",
        onnxruntimeExists: false,
        onnxruntimeVersion: "",
        onnxruntimePath: "",
        qnnPluginExists: false,
        qnnLibraryPath: "",
        qnnHtpPath: "",
        qnnProviderExists: false,
        modelExists,
        providers: [],
        pilExists: false,
        numpyExists: false,
        errorMsg: "",
      };

      if (error) {
        result.errorMsg = stderr.trim() || error.message;
        if (error.message.includes("not found") || error.message.includes("is not recognized") || error.code === 9009) {
          result.errorMsg = "Python not found in PATH or invalid python path.";
        } else {
          result.pythonExists = true;
        }
        resolve(result);
        return;
      }

      result.pythonExists = true;
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        const parts = line.split("=");
        if (parts.length >= 2) {
          const key = parts[0];
          const val = parts.slice(1).join("=");
          if (key === "PATH") result.pythonPath = val;
          else if (key === "ARCH") result.pythonArch = val;
          else if (key === "ORT_OK") result.onnxruntimeExists = val === "True";
          else if (key === "ORT_VER") result.onnxruntimeVersion = val;
          else if (key === "ORT_FILE") result.onnxruntimePath = val;
          else if (key === "QNN_PLUGIN") result.qnnPluginExists = val === "True";
          else if (key === "QNN_LIBRARY_PATH") result.qnnLibraryPath = val;
          else if (key === "QNN_HTP_PATH") result.qnnHtpPath = val;
          else if (key === "QNN") result.qnnProviderExists = val === "True";
          else if (key === "PIL") result.pilExists = val === "True";
          else if (key === "NUMPY") result.numpyExists = val === "True";
          else if (key === "PROVIDERS") {
            result.providers = val ? val.split(":") : [];
          }
        }
      }

      resolve(result);
    });
  });
};
