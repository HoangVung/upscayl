import { join, dirname, resolve } from "path";
import { getPlatform } from "./get-device-specs";
import isDev from "electron-is-dev";
import { app } from "electron";

/**
 * appRootDir is the resources directory inside the unpacked electron app temp directory.
 * resources contains app.asar file, that contains the main and renderer files.
 * We're putting resources/{os}/bin from project inside resources/bin of electron.
 * Same for the models directory as well.
 */
const appRootDir = app.getAppPath();

const binariesPath = isDev
  ? join(appRootDir, "resources", getPlatform()!, "bin")
  : join(dirname(appRootDir), "bin");

const execPath = resolve(join(binariesPath, `./upscayl-bin`));

const modelsPath = isDev
  ? resolve(join(appRootDir, "resources", "models"))
  : resolve(join(dirname(appRootDir), "models"));

const npuScriptPath = isDev
  ? resolve(join(appRootDir, "resources", "npu", "npu_upscayl.py"))
  : resolve(join(dirname(appRootDir), "npu", "npu_upscayl.py"));

const npuModelsPath = isDev
  ? resolve(join(appRootDir, "resources", "npu", "models"))
  : resolve(join(dirname(appRootDir), "npu", "models"));

const npuHelperPath = isDev
  ? resolve(join(appRootDir, "resources", "npu", "bin", "win-arm64", "upscayl-npu-helper.exe"))
  : resolve(join(dirname(appRootDir), "npu", "bin", "win-arm64", "upscayl-npu-helper.exe"));

export { execPath, modelsPath, npuScriptPath, npuModelsPath, npuHelperPath };
