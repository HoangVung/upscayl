import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useEffect, useMemo } from "react";
import { Tooltip } from "react-tooltip";
import { themeChange } from "theme-change";
import useLogger from "../../hooks/use-logger";
import {
  savedOutputPathAtom,
  outputPathSourceAtom,
  progressAtom,
  rememberOutputFolderAtom,
  scaleAtom,
  customWidthAtom,
  useCustomWidthAtom,
  useNpuAtom,
  pythonPathAtom,
  npuEnvCheckingAtom,
  npuEnvStatusAtom,
} from "../../../atoms/user-settings-atom";
import { FEATURE_FLAGS } from "@common/feature-flags";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { useToast } from "@/components/ui/use-toast";
import { translationAtom } from "@/atoms/translations-atom";
import { SelectImageScale } from "../settings-tab/select-image-scale";
import SelectModelDialog from "./select-model-dialog";
import { ImageFormat } from "@/lib/valid-formats";
import { SwatchBookIcon } from "lucide-react";


interface IProps {
  selectImageHandler: () => Promise<void>;
  selectFolderHandler: () => Promise<void>;
  selectImagesHandler: () => Promise<void>;
  upscaylHandler: () => Promise<void>;
  batchMode: boolean;
  setBatchMode: React.Dispatch<React.SetStateAction<boolean>>;
  imagePath: string;
  batchFolderPath: string;
  batchImagePaths: string[];
  doubleUpscayl: boolean;
  setDoubleUpscayl: React.Dispatch<React.SetStateAction<boolean>>;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  setSaveImageAs: React.Dispatch<React.SetStateAction<ImageFormat>>;
  setGpuId: React.Dispatch<React.SetStateAction<string>>;
}

function UpscaylSteps({
  selectImageHandler,
  selectFolderHandler,
  selectImagesHandler,
  upscaylHandler,
  batchMode,
  setBatchMode,
  imagePath,
  batchFolderPath,
  batchImagePaths,
  doubleUpscayl,
  setDoubleUpscayl,
  dimensions,
}: IProps) {
  const [scale, setScale] = useAtom(scaleAtom);
  const [outputPath, setOutputPath] = useAtom(savedOutputPathAtom);
  const [outputPathSource, setOutputPathSource] = useAtom(outputPathSourceAtom);
  const [progress, setProgress] = useAtom(progressAtom);
  const rememberOutputFolder = useAtomValue(rememberOutputFolderAtom);
  const customWidth = useAtomValue(customWidthAtom);
  const useCustomWidth = useAtomValue(useCustomWidthAtom);
  const useNpu = useAtomValue(useNpuAtom);
  const pythonPath = useAtomValue(pythonPathAtom);
  const npuEnvStatus = useAtomValue(npuEnvStatusAtom);
  const setNpuEnvStatus = useSetAtom(npuEnvStatusAtom);
  const npuEnvChecking = useAtomValue(npuEnvCheckingAtom);
  const setNpuEnvChecking = useSetAtom(npuEnvCheckingAtom);

  const logit = useLogger();
  const { toast } = useToast();
  const t = useAtomValue(translationAtom);

  useEffect(() => {
    if (useNpu) {
      if (doubleUpscayl) setDoubleUpscayl(false);
    }
  }, [useNpu, doubleUpscayl, setDoubleUpscayl]);

  useEffect(() => {
    if (!useNpu || npuEnvStatus || npuEnvChecking) return;

    const checkNpuEnv = async () => {
      setNpuEnvChecking(true);
      try {
        const result = await window.electron.invoke("check-npu-env", {
          pythonPath,
        });
        setNpuEnvStatus(result);
      } catch (err: any) {
        setNpuEnvStatus({
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
          nativeHelperExists: false,
          nativeHelperQnnSupported: false,
          errorMsg: err.message || String(err),
        });
      } finally {
        setNpuEnvChecking(false);
      }
    };

    checkNpuEnv();
  }, [
    useNpu,
    npuEnvStatus,
    npuEnvChecking,
    pythonPath,
    setNpuEnvChecking,
    setNpuEnvStatus,
  ]);

  const outputHandler = async () => {
    const path = await window.electron.invoke(ELECTRON_COMMANDS.SELECT_FOLDER);
    if (path !== null) {
      logit("🗂 Setting Output Path: ", path);
      setOutputPath(path);
      setOutputPathSource("manual");
    }
  };

  useEffect(() => {
    themeChange(false);
  }, []);

  const upscaylResolution = useMemo(() => {
    const newDimensions = {
      width: dimensions.width,
      height: dimensions.height,
    };

    let doubleScale = parseInt(scale) * parseInt(scale);
    let singleScale = useNpu ? 3 : parseInt(scale);

    if (doubleUpscayl && !useNpu) {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        const newWidth = dimensions.width * doubleScale;
        const newHeight = dimensions.height * doubleScale;
        newDimensions.width = newWidth;
        newDimensions.height = newHeight;
      }
    } else {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        newDimensions.width = dimensions.width * singleScale;
        newDimensions.height = dimensions.height * singleScale;
      }
    }

    return newDimensions;
  }, [dimensions.width, dimensions.height, doubleUpscayl, scale, useNpu]);

  const npuUnavailable =
    useNpu &&
    (!npuEnvStatus ||
      !npuEnvStatus.pythonExists ||
      !npuEnvStatus.onnxruntimeExists ||
      !npuEnvStatus.qnnProviderExists ||
      !npuEnvStatus.modelExists);

  const npuProviderText =
    npuEnvStatus?.providers && npuEnvStatus.providers.length > 0
      ? npuEnvStatus.providers.join(", ")
      : "no providers reported";

  return (
    <div
      className={`animate-step-in animate flex h-screen flex-col gap-7 overflow-y-auto overflow-x-hidden p-5`}
    >
      {/* BATCH OPTION */}
      <div className="flex flex-row items-center gap-2">
        <input
          type="checkbox"
          className="toggle"
          checked={batchMode}
          onChange={() => {
            if (!rememberOutputFolder) {
              setOutputPath("");
              setOutputPathSource("auto");
            }
            setProgress("");
            setBatchMode((oldValue) => !oldValue);
          }}
        ></input>
        <p
          className="mr-1 inline-block text-sm"
        >
          Batch Upscayl
        </p>
      </div>

      {/* STEP 1 */}
      <div className="animate-step-in flex flex-col gap-2">
        <p className="step-heading">{t("APP.FILE_SELECTION.TITLE")}</p>
        {batchMode ? (
          <div className="flex flex-col gap-2">
            <button
              className="btn btn-primary justify-start"
              onClick={selectFolderHandler}
              data-tooltip-id="tooltip"
              data-tooltip-content={batchFolderPath}
            >
              Select Folder
            </button>
            <button
              className="btn btn-primary justify-start"
              onClick={selectImagesHandler}
              data-tooltip-id="tooltip"
              data-tooltip-content={batchImagePaths?.join(", ")}
            >
              Select Images
            </button>
          </div>
        ) : (
          <button
            className="btn btn-primary justify-start"
            onClick={selectImageHandler}
            data-tooltip-id="tooltip"
            data-tooltip-content={imagePath}
          >
            {t("APP.FILE_SELECTION.SINGLE_MODE_TYPE")}
          </button>
        )}
      </div>

      {/* STEP 2 */}
      <div className="animate-step-in group flex flex-col gap-4">
        <div>
          <p className="step-heading">{t("APP.MODEL_SELECTION.TITLE")}</p>
          <p className="mb-2 text-sm">{t("APP.MODEL_SELECTION.DESCRIPTION")}</p>

          {useNpu ? (
            <button className="btn btn-primary justify-start border-border cursor-not-allowed opacity-75" disabled>
              <SwatchBookIcon className="mr-2 h-5 w-5" />
              Qualcomm XLSR (NPU)
            </button>
          ) : (
            <SelectModelDialog />
          )}

          {useNpu && (
            <div
              className={`mt-3 rounded-btn border p-2 text-xs ${
                npuEnvStatus?.qnnProviderExists
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-warning/30 bg-warning/10 text-warning"
              }`}
            >
              {npuEnvChecking
                ? "Checking Snapdragon NPU runtime..."
                : npuEnvStatus?.qnnProviderExists
                  ? "QNN runtime ready."
                  : `QNN runtime missing. Available providers: ${npuProviderText}. Reinstall onnxruntime-qnn in the Python environment shown in Settings.`}
            </div>
          )}
        </div>

        {!batchMode && (
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox"
              checked={doubleUpscayl}
              disabled={useNpu}
              onChange={(e) => {
                if (e.target.checked) {
                  setDoubleUpscayl(true);
                } else {
                  setDoubleUpscayl(false);
                }
              }}
            />
            <p
              className={`cursor-pointer text-sm ${useNpu ? "opacity-50 cursor-not-allowed" : ""}`}
              onClick={(e) => {
                if (!useNpu) {
                  setDoubleUpscayl((prev) => !prev);
                }
              }}
            >
              {t("APP.DOUBLE_UPSCAYL.TITLE")} {useNpu && "(N/A)"}
            </p>
            <button
              className="badge badge-neutral badge-sm cursor-help"
              data-tooltip-id="tooltip"
              data-tooltip-content={useNpu ? "Double upscaleyl is not supported in NPU mode" : t("APP.DOUBLE_UPSCAYL.DESCRIPTION")}
            >
              ?
            </button>
          </div>
        )}

        {useNpu ? (
          <div className="opacity-50">
            <p className="text-sm">
              {t("SETTINGS.IMAGE_SCALE.TITLE")} <span className="text-xs">(3X)</span>
            </p>
            <p className="text-xs text-base-content/80 mt-1">
              Snapdragon NPU mode only supports 3X scale.
            </p>
          </div>
        ) : (
          <SelectImageScale scale={scale} setScale={setScale} hideInfo />
        )}
      </div>

      {/* STEP 3 */}
      <div className="animate-step-in">
        <div className="flex flex-col pb-2">
          <div className="step-heading flex items-center gap-2">
            <span className="leading-none">
              {t("APP.OUTPUT_PATH_SELECTION.TITLE")}
            </span>
            {FEATURE_FLAGS.APP_STORE_BUILD && (
              <button
                className="badge badge-outline badge-sm cursor-pointer"
                onClick={() =>
                  alert(t("APP.OUTPUT_PATH_SELECTION.MAC_APP_STORE_ALERT"))
                }
              >
                ?
              </button>
            )}
          </div>
          {!outputPath && FEATURE_FLAGS.APP_STORE_BUILD && (
            <div className="text-xs">
              <span className="rounded-btn bg-base-200 px-2 font-medium uppercase text-base-content/50">
                {t("APP.OUTPUT_PATH_SELECTION.NOT_SELECTED")}
              </span>
            </div>
          )}
        </div>
        {!batchMode && !FEATURE_FLAGS.APP_STORE_BUILD && (
          <p className="mb-2 text-sm">
            {!batchMode
              ? t("APP.OUTPUT_PATH_SELECTION.DEFAULT_IMG_PATH")
              : t("APP.OUTPUT_PATH_SELECTION.DEFAULT_FOLDER_PATH")}
          </p>
        )}
        <button
          className="btn btn-primary"
          data-tooltip-content={outputPath}
          data-tooltip-id="tooltip"
          onClick={outputHandler}
        >
          {t("APP.OUTPUT_PATH_SELECTION.BUTTON_TITLE")}
        </button>
      </div>

      {/* STEP 4 */}
      <div className="animate-step-in">
        <p className="step-heading">{t("APP.SCALE_SELECTION.TITLE")}</p>
        {dimensions.width && dimensions.height && (
          <p className="mb-2 text-sm">
            {t("APP.SCALE_SELECTION.FROM_TITLE")}
            <span className="font-bold">
              {dimensions.width}x{dimensions.height}
            </span>
            {t("APP.SCALE_SELECTION.TO_TITLE")}
            <span className="font-bold">
              {upscaylResolution.width}x{upscaylResolution.height}
            </span>
          </p>
        )}
        <button
          className={`btn btn-secondary ${npuUnavailable ? "btn-disabled opacity-60" : ""}`}
          disabled={npuUnavailable}
          data-tooltip-id="tooltip"
          data-tooltip-content={
            npuUnavailable
              ? "QNN runtime is missing. Open Settings, reinstall onnxruntime-qnn in the shown Python environment, then refresh."
              : undefined
          }
          onClick={
            npuUnavailable
              ? undefined
              : progress.length > 0
              ? () =>
                  toast({
                    description: t(
                      "APP.SCALE_SELECTION.NO_OUTPUT_FOLDER_ALERT",
                    ),
                  })
              : upscaylHandler
          }
        >
          {npuEnvChecking && useNpu
            ? "Checking NPU..."
            : progress.length > 0
            ? t("APP.SCALE_SELECTION.IN_PROGRESS_BUTTON_TITLE")
            : t("APP.SCALE_SELECTION.START_BUTTON_TITLE")}
        </button>
      </div>
    </div>
  );
}

export default UpscaylSteps;
