import { exec } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { npuModelsPath, npuHelperPath } from "../utils/get-resource-paths";

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
  nativeHelperExists: boolean;
  nativeHelperQnnSupported: boolean;
  errorMsg: string;
}

export const checkNpuEnv = async (
  event: any,
  payload: { pythonPath?: string }
): Promise<NpuEnvCheckResult> => {
  const python = payload.pythonPath || "python";

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

  const b64Script = Buffer.from(pythonScript).toString("base64");
  const command = `"${python}" -c "import base64; exec(base64.b64decode('${b64Script}').decode('utf-8'))"`;

  const modelOnnxPath = join(npuModelsPath, "xlsr.onnx");
  const modelDataPath = join(npuModelsPath, "xlsr.data");
  const modelExists = existsSync(modelOnnxPath) && existsSync(modelDataPath);
  const nativeHelperExists = existsSync(npuHelperPath);

  const runPythonCheck = (): Promise<Partial<NpuEnvCheckResult>> => {
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        const res: Partial<NpuEnvCheckResult> = {
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
          providers: [],
          pilExists: false,
          numpyExists: false,
          errorMsg: "",
        };

        if (error) {
          res.errorMsg = stderr.trim() || error.message;
          if (error.message.includes("not found") || error.message.includes("is not recognized") || error.code === 9009) {
            res.errorMsg = "Python not found in PATH or invalid python path.";
          } else {
            res.pythonExists = true;
          }
          resolve(res);
          return;
        }

        res.pythonExists = true;
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          const parts = line.split("=");
          if (parts.length >= 2) {
            const key = parts[0];
            const val = parts.slice(1).join("=");
            if (key === "PATH") res.pythonPath = val;
            else if (key === "ARCH") res.pythonArch = val;
            else if (key === "ORT_OK") res.onnxruntimeExists = val === "True";
            else if (key === "ORT_VER") res.onnxruntimeVersion = val;
            else if (key === "ORT_FILE") res.onnxruntimePath = val;
            else if (key === "QNN_PLUGIN") res.qnnPluginExists = val === "True";
            else if (key === "QNN_LIBRARY_PATH") res.qnnLibraryPath = val;
            else if (key === "QNN_HTP_PATH") res.qnnHtpPath = val;
            else if (key === "QNN") res.qnnProviderExists = val === "True";
            else if (key === "PIL") res.pilExists = val === "True";
            else if (key === "NUMPY") res.numpyExists = val === "True";
            else if (key === "PROVIDERS") {
              res.providers = val ? val.split(":") : [];
            }
          }
        }
        resolve(res);
      });
    });
  };

  const runNativeCheck = (): Promise<{ nativeHelperQnnSupported: boolean }> => {
    return new Promise((resolve) => {
      if (!nativeHelperExists) {
        resolve({ nativeHelperQnnSupported: false });
        return;
      }
      exec(`"${npuHelperPath}" --check`, (error, stdout) => {
        if (error) {
          resolve({ nativeHelperQnnSupported: false });
          return;
        }
        const hasQnn = stdout.includes("NPU (QNN) Support: YES");
        resolve({ nativeHelperQnnSupported: hasQnn });
      });
    });
  };

  const [pyResult, nativeResult] = await Promise.all([
    runPythonCheck(),
    runNativeCheck(),
  ]);

  return {
    ...pyResult,
    modelExists,
    nativeHelperExists,
    nativeHelperQnnSupported: nativeResult.nativeHelperQnnSupported,
  } as NpuEnvCheckResult;
};
