import fs from "fs";
import path from "path";
import { ImageFormat } from "../types/types";

const DIGITAL_ART_MODEL_ID = "digital-art-4x";

type EnhanceDigitalArt2xOptions = {
  filePath: string;
  model: string;
  scale: string;
  customWidth: string;
  saveImageAs: ImageFormat;
  compression: string;
  logit: (...args: any) => void;
};

const loadPng = (logit: (...args: any) => void) => {
  try {
    return require("pngjs").PNG;
  } catch (error) {
    logit("Digital Art 2x PNG fallback unavailable:", error);
    return null;
  }
};

const getLuma = (data: Buffer, index: number) =>
  0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

const enhancePngTextDetails = async ({
  filePath,
  logit,
}: Pick<EnhanceDigitalArt2xOptions, "filePath" | "logit">) => {
  const PNG = loadPng(logit);
  if (!PNG) {
    return false;
  }

  const png = PNG.sync.read(await fs.promises.readFile(filePath));
  const source = Buffer.from(png.data);
  const { width, height } = png;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (width * y + x) << 2;
      const currentLuma = getLuma(source, index);
      let darkestIndex = index;
      let darkestLuma = currentLuma;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }

          const neighborIndex = (width * (y + offsetY) + x + offsetX) << 2;
          const neighborLuma = getLuma(source, neighborIndex);
          if (neighborLuma < darkestLuma) {
            darkestIndex = neighborIndex;
            darkestLuma = neighborLuma;
          }
        }
      }

      if (darkestLuma < 210 && currentLuma - darkestLuma > 18) {
        const strength = Math.min(0.38, (currentLuma - darkestLuma) / 255);
        png.data[index] = Math.round(
          source[index] * (1 - strength) + source[darkestIndex] * strength,
        );
        png.data[index + 1] = Math.round(
          source[index + 1] * (1 - strength) +
            source[darkestIndex + 1] * strength,
        );
        png.data[index + 2] = Math.round(
          source[index + 2] * (1 - strength) +
            source[darkestIndex + 2] * strength,
        );
      }
    }
  }

  await fs.promises.writeFile(filePath, PNG.sync.write(png));
  return true;
};

export const shouldEnhanceDigitalArt2x = ({
  model,
  scale,
  customWidth,
}: Pick<EnhanceDigitalArt2xOptions, "model" | "scale" | "customWidth">) =>
  model === DIGITAL_ART_MODEL_ID && scale === "2" && !customWidth;

export const enhanceDigitalArt2x = async ({
  filePath,
  model,
  scale,
  customWidth,
  saveImageAs,
  compression,
  logit,
}: EnhanceDigitalArt2xOptions) => {
  if (!shouldEnhanceDigitalArt2x({ model, scale, customWidth })) {
    return;
  }

  if (!fs.existsSync(filePath)) {
    logit(
      "Digital Art 2x enhancement skipped; output file not found:",
      filePath,
    );
    return;
  }

  try {
    if (saveImageAs !== "png") {
      logit(
        "Digital Art 2x enhancement skipped; PNG output is required:",
        filePath,
      );
      return;
    }

    logit("Applying Digital Art 2x PNG text/detail enhancement:", filePath);
    const enhanced = await enhancePngTextDetails({ filePath, logit });
    if (enhanced) {
      logit("Applied Digital Art 2x PNG text/detail enhancement:", filePath);
    }
  } catch (error) {
    logit("Digital Art 2x enhancement skipped:", error);
  }
};

export const enhanceDigitalArt2xFolder = async ({
  folderPath,
  model,
  scale,
  customWidth,
  saveImageAs,
  compression,
  logit,
}: Omit<EnhanceDigitalArt2xOptions, "filePath"> & { folderPath: string }) => {
  if (!shouldEnhanceDigitalArt2x({ model, scale, customWidth })) {
    return;
  }

  const files = fs
    .readdirSync(folderPath)
    .filter(
      (file) =>
        path.extname(file).toLowerCase() === `.${saveImageAs.toLowerCase()}`,
    );

  for (const file of files) {
    await enhanceDigitalArt2x({
      filePath: path.join(folderPath, file),
      model,
      scale,
      customWidth,
      saveImageAs,
      compression,
      logit,
    });
  }
};
