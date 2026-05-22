import { spawn } from "child_process";
import { npuScriptPath } from "./get-resource-paths";

export const spawnNpuUpscayl = (
  args: {
    inputPath: string;
    outputPath: string;
    modelPath: string;
    scale: string;
    format: string;
    tileSize: number;
    compression: string;
    pythonPath?: string;
  },
  logit: (...args: any) => void,
) => {
  const command = [
    npuScriptPath,
    "-i",
    args.inputPath,
    "-o",
    args.outputPath,
    "-m",
    args.modelPath,
    "-s",
    args.scale,
    "-f",
    args.format,
    "-t",
    args.tileSize ? args.tileSize.toString() : "128", // always 128 for XLSR
    "-c",
    args.compression || "0",
  ];

  logit("📢 NPU Upscayl Command: ", command);

  const spawnedProcess = spawn(args.pythonPath || "python", command, {
    cwd: undefined,
    detached: false,
  });

  return {
    process: spawnedProcess,
    kill: () => spawnedProcess.kill(),
  };
};