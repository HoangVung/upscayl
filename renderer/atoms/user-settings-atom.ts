import { ImageFormat } from "@/lib/valid-formats";
import { ModelId } from "@common/models-list";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const customModelsPathAtom = atomWithStorage<string | null>(
  "customModelsPath",
  null,
);

export const selectedModelIdAtom = atomWithStorage<ModelId | string>(
  "selectedModelId",
  "upscayl-standard-4x",
);
export const doubleUpscaylAtom = atomWithStorage("doubleUpscayl", false);
export const gpuIdAtom = atomWithStorage("gpuId", "");
export const saveImageAsAtom = atomWithStorage<ImageFormat>(
  "saveImageAs",
  "png",
);

export const scaleAtom = atomWithStorage<string>("scale", "4");

export const batchModeAtom = atom<boolean>(false);

/**
 * The path to the last folder the user saved an image to.
 * Reset to "" if rememberOutputFolder is false.
 */
export const savedOutputPathAtom = atomWithStorage<string | null>(
  "savedOutputPath",
  null,
);

export const outputPathSourceAtom = atomWithStorage<"auto" | "manual">(
  "outputPathSource",
  "auto",
);

export const progressAtom = atom<string>("");

export const rememberOutputFolderAtom = atomWithStorage<boolean>(
  "rememberOutputFolder",
  false,
);

export const dontShowCloudModalAtom = atomWithStorage<boolean>(
  "dontShowCloudModal",
  false,
);

export const noImageProcessingAtom = atomWithStorage<boolean>(
  "noImageProcessing",
  false,
);

export const compressionAtom = atomWithStorage<number>("compression", 0);

export const overwriteAtom = atomWithStorage("overwrite", false);

export const turnOffNotificationsAtom = atomWithStorage(
  "turnOffNotifications",
  false,
);

export const ttaModeAtom = atomWithStorage("ttaMode", false);

export const viewTypeAtom = atomWithStorage<"slider" | "lens">(
  "viewType",
  "slider",
);

export const lensSizeAtom = atomWithStorage<number>("lensSize", 100);

export const customWidthAtom = atomWithStorage<number>("customWidth", 0);

export const useCustomWidthAtom = atomWithStorage<boolean>(
  "useCustomWidth",
  false,
);

export const tileSizeAtom = atomWithStorage<number | null>("tileSize", null);

// CLIENT SIDE ONLY
export const showSidebarAtom = atomWithStorage("showSidebar", true);

export const autoUpdateAtom = atomWithStorage("autoUpdate", true);

export const enableContributionAtom = atomWithStorage(
  "enableContribution",
  true,
);

export const userStatsAtom = atomWithStorage("userStats", {
  totalUpscayls: 0,
  doubleUpscayls: 0,
  batchUpscayls: 0,
  imageUpscayls: 0,
  averageUpscaylTime: 0,
  lastUpscaylDuration: 0,
  lastUsedAt: 0,
});

export const copyMetadataAtom = atomWithStorage<boolean>(
  "copyMetadata",
  false,
);

export const useNpuAtom = atomWithStorage<boolean>("useNpu", false);

export const pythonPathAtom = atomWithStorage<string>("pythonPath", "python");

export type NpuEnvStatus = {
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
};

export const npuEnvStatusAtom = atom(null) as PrimitiveAtom<NpuEnvStatus | null>;
export const npuEnvCheckingAtom = atom(false) as PrimitiveAtom<boolean>;
