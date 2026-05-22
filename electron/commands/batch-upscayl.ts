import fs from "fs";
import { getMainWindow } from "../main-window";
import {
  childProcesses,
  savedCustomModelsPath,
  setStopped,
  stopped,
} from "../utils/config-variables";
import logit from "../utils/logit";
import { spawnUpscayl } from "../utils/spawn-upscayl";
import { getBatchArguments } from "../utils/get-arguments";
import slash from "../utils/slash";
import { modelsPath, npuModelsPath } from "../utils/get-resource-paths";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import { BatchUpscaylPayload } from "../../common/types/types";
import showNotification from "../utils/show-notification";
import { MODELS } from "../../common/models-list";
import { copyMetadata } from "../utils/copy-metadata";
import { enhanceDigitalArt2xFolder } from "../utils/enhance-digital-art-2x";
import { spawnNpuUpscayl } from "../utils/spawn-npu-upscayl";
import { join, parse } from "path";

const batchUpscayl = async (event, payload: BatchUpscaylPayload) => {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  const tileSize = payload.tileSize;
  const compression = payload.compression;
  const ttaMode = payload.ttaMode;
  const scale = payload.scale;
  const useCustomWidth = payload.useCustomWidth;
  const customWidth = useCustomWidth ? payload.customWidth : "";
  const model = payload.model;
  const gpuId = payload.gpuId;
  const saveImageAs = payload.saveImageAs;

  if (payload.useNpu) {
    const pythonPath = payload.pythonPath;
    const outputFolderName = `upscayl_${saveImageAs}_xlsr_3x_npu`;
    let outputFolderPath = decodeURIComponent(payload.outputPath);
    outputFolderPath += slash + outputFolderName;

    if (!fs.existsSync(outputFolderPath)) {
      fs.mkdirSync(outputFolderPath, { recursive: true });
    }

    let images: string[] = [];
    if (payload.batchImagePaths && payload.batchImagePaths.length > 0) {
      images = payload.batchImagePaths;
    } else if (payload.batchFolderPath) {
      const folderPath = decodeURIComponent(payload.batchFolderPath);
      if (!fs.existsSync(folderPath)) {
        mainWindow.webContents.send(
          ELECTRON_COMMANDS.UPSCAYL_ERROR,
          "Selected folder does not exist."
        );
        return;
      }
      try {
        const files = fs.readdirSync(folderPath);
        images = files
          .map((file) => join(folderPath, file))
          .filter((filePath) => {
            try {
              if (!fs.statSync(filePath).isFile()) return false;
            } catch {
              return false;
            }
            const ext = filePath.split(".").pop()?.toLowerCase();
            return ext && ["png", "jpg", "jpeg", "jfif", "webp"].includes(ext);
          });
      } catch (err: any) {
        mainWindow.webContents.send(
          ELECTRON_COMMANDS.UPSCAYL_ERROR,
          `Error reading selected folder: ${err.message || err}`
        );
        return;
      }
    }

    if (images.length === 0) {
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        "No valid images found for upscaling. Make sure you select a folder containing '.png', '.jpg', '.jpeg', '.jfif', or '.webp' images."
      );
      return;
    }

    setStopped(false);
    let errorCount = 0;

    for (let i = 0; i < images.length; i++) {
      if (stopped) {
        logit("🛑 Batch NPU stopped by user");
        break;
      }

      const imagePath = images[i];
      const parsedPath = parse(imagePath);
      const fileName = parsedPath.name;
      const outFile = outputFolderPath + slash + fileName + "_upscayl_3x_xlsr_npu." + saveImageAs;

      const progressPercent = ((i / images.length) * 100).toFixed(2);
      const progressString = `${i}/${images.length} - ${progressPercent}%`;
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
        progressString
      );

      logit(`🚀 NPU Batch upscaling image ${i + 1}/${images.length}: ${imagePath}`);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.LOG,
        `Processing ${i + 1}/${images.length}: ${parsedPath.base}`
      );

      if (fs.existsSync(outFile)) {
        logit(`✅ Already upscayled: ${outFile}`);
        continue;
      }

      try {
        await new Promise<void>((resolveChild) => {
          const upscayl = spawnNpuUpscayl(
            {
              inputPath: decodeURIComponent(imagePath),
              outputPath: outFile,
              modelPath: join(npuModelsPath, "xlsr.onnx"),
              scale: "3",
              format: saveImageAs,
              tileSize: 128,
              compression: compression.toString(),
              pythonPath,
            },
            logit
          );

          const processEntry = {
            process: upscayl.process,
            kill: () => {
              upscayl.kill();
              return true;
            },
          };
          childProcesses.push(processEntry);

          let childFailed = false;

          upscayl.process.stderr.on("data", (data) => {
            if (stopped) return;
            const dataStr = data.toString();
            logit(`[NPU Progress] ${dataStr}`);
            mainWindow.webContents.send(ELECTRON_COMMANDS.LOG, dataStr);

            if (dataStr.includes("Error") || dataStr.includes("failed")) {
              childFailed = true;
              logit(`❌ Error in NPU process: ${dataStr}`);
              upscayl.kill();
            }
          });

          upscayl.process.on("error", (err) => {
            logit(`❌ NPU Process error: ${err.message}`);
            childFailed = true;
            upscayl.kill();
          });

          upscayl.process.on("close", async () => {
            const index = childProcesses.indexOf(processEntry);
            if (index > -1) {
              childProcesses.splice(index, 1);
            }

            if (childFailed) {
              errorCount++;
              logit(`⚠️ Failed to upscale image: ${imagePath}`);
            } else {
              logit(`✅ Successfully upscayled: ${outFile}`);
              if (payload.copyMetadata) {
                try {
                  await copyMetadata(imagePath, outFile);
                  logit("✅ Metadata copied to: ", outFile);
                } catch (metaErr) {
                  logit("❌ Error copying metadata: ", metaErr);
                }
              }
            }
            resolveChild();
          });
        });
      } catch (err: any) {
        errorCount++;
        logit(`⚠️ Exception upscaling ${imagePath}: `, err);
      }
    }

    mainWindow.setProgressBar(-1);
    if (stopped) {
      logit("🛑 NPU batch upscale aborted");
      return;
    }

    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      `${images.length}/${images.length} - 100.00%`
    );

    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_DONE,
      outputFolderPath
    );

    if (errorCount > 0) {
      showNotification(
        "Upscayled with Warnings",
        `Batch upscaling completed with ${errorCount} errors.`
      );
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_WARNING,
        `Batch completed with ${errorCount} errors. Please check logs.`
      );
    } else {
      showNotification("Upscayled", "All images upscayled successfully!");
    }

    return;
  }
  // GET THE IMAGE DIRECTORY
  let inputDir = decodeURIComponent(payload.batchFolderPath || "");
  // GET THE OUTPUT DIRECTORY
  let outputFolderPath = decodeURIComponent(payload.outputPath);
  const outputFolderName = `upscayl_${saveImageAs}_${model}_${
    useCustomWidth ? `${customWidth}px` : `${scale}x`
  }`;
  outputFolderPath += slash + outputFolderName;
  // CREATE THE OUTPUT DIRECTORY
  if (!fs.existsSync(outputFolderPath)) {
    fs.mkdirSync(outputFolderPath, { recursive: true });
  }

  const isDefaultModel = model in MODELS;

  // UPSCALE
  const upscayl = spawnUpscayl(
    getBatchArguments({
      inputDir,
      outputDir: outputFolderPath,
      modelsPath: isDefaultModel
        ? modelsPath
        : (savedCustomModelsPath ?? modelsPath),
      model,
      gpuId,
      saveImageAs,
      scale,
      customWidth,
      compression,
      tileSize,
      ttaMode,
    }),
    logit,
  );

  childProcesses.push(upscayl);

  setStopped(false);
  let failed = false;
  let encounteredError = false;

  const onData = (data: any) => {
    if (!mainWindow) return;
    data = data.toString();
    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      data.toString(),
    );
    if (
      (data as string).includes("Error") ||
      (data as string).includes("failed")
    ) {
      logit("❌ ", data);
      encounteredError = true;
      onError(data);
    } else if (data.includes("Resizing")) {
      mainWindow.webContents.send(ELECTRON_COMMANDS.SCALING_AND_CONVERTING);
    }
  };
  const onError = (data: any) => {
    if (!mainWindow) return;
    mainWindow.setProgressBar(-1);
    mainWindow.webContents.send(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      data.toString(),
    );
    failed = true;
    upscayl.kill();
    mainWindow &&
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        `Error upscaling images! ${data}`,
      );
    return;
  };
  const onClose = async () => {
    if (!mainWindow) return;
    if (!failed && !stopped) {
      logit("💯 Done upscaling");
      upscayl.kill();
      await enhanceDigitalArt2xFolder({
        folderPath: outputFolderPath,
        model,
        scale,
        customWidth,
        saveImageAs,
        compression,
        logit,
      });
      if (payload.copyMetadata) {
        logit("🏷️ Copying metadata...");
        try {
          const files = fs.readdirSync(outputFolderPath);
          for (const file of files) {
            const outFile = outputFolderPath + slash + file;
            const originalFile = inputDir + slash + file;
            if (fs.existsSync(outFile) && fs.existsSync(originalFile)) {
                try {
                  await copyMetadata(inputDir, outFile);
                  logit("✅ Metadata copied to: ", outFile);
                } catch (error) {
                  logit("❌ Error copying metadata: ", error);
                  mainWindow.webContents.send(
                    ELECTRON_COMMANDS.METADATA_ERROR,
                    error,
                  );
                } 
            }
          }
        } catch (err) {
          logit("❌ Error in batch metadata copy: ", err);
        }
      }
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.FOLDER_UPSCAYL_DONE,
        outputFolderPath,
      );
      if (!encounteredError) {
        showNotification("Upscayled", "Images upscayled successfully!");
      } else {
        showNotification(
          "Upscayled",
          "Images were upscayled but encountered some errors!",
        );
      }
    } else {
      upscayl.kill();
    }
  };
  upscayl.process.stderr.on("data", onData);
  upscayl.process.on("error", onError);
  upscayl.process.on("close", onClose);
};

export default batchUpscayl;
