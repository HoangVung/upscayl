import { spawn } from "child_process";
import { existsSync } from "fs";
import { npuScriptPath, npuHelperPath } from "./get-resource-paths";

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
  const useNative = existsSync(npuHelperPath);
  let spawnCmd: string;
  let command: string[];

  if (useNative) {
    spawnCmd = npuHelperPath;
    command = [
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
      "-c",
      args.compression || "0",
    ];
  } else {
    spawnCmd = args.pythonPath || "python";
    command = [
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
      args.tileSize ? args.tileSize.toString() : "128",
      "-c",
      args.compression || "0",
    ];
  }

  logit("📢 NPU Upscayl Command: ", [spawnCmd, ...command]);

  const spawnedProcess = spawn(spawnCmd, command, {
    cwd: undefined,
    detached: false,
  });

  return {
    process: spawnedProcess,
    kill: () => spawnedProcess.kill(),
  };
};