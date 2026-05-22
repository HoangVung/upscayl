import { MessageBoxOptions, app, dialog } from "electron";
import { getMainWindow } from "../main-window";
import { savedImagePath, setSavedImagePath } from "../utils/config-variables";
import logit from "../utils/logit";
import settings from "electron-settings";
import { FEATURE_FLAGS } from "../../common/feature-flags";

const selectFiles = async () => {
  const mainWindow = getMainWindow();

  const { canceled, filePaths, bookmarks } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Select Images",
    defaultPath: savedImagePath,
    securityScopedBookmarks: true,
    message: "Select Images to Upscale",
    filters: [
      {
        name: "Images",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "jfif",
          "webp",
          "PNG",
          "JPG",
          "JPEG",
          "JFIF",
          "WEBP",
        ],
      },
    ],
  });

  if (FEATURE_FLAGS.APP_STORE_BUILD && bookmarks && bookmarks.length > 0) {
    console.log("🚨 Setting Bookmarks: ", bookmarks);
    settings.set("file-bookmarks", bookmarks[0]);
  }

  if (canceled) {
    logit("🚫 File Operation Cancelled");
    return null;
  } else {
    if (filePaths.length > 0) {
      setSavedImagePath(filePaths[0]);
    }

    const validPaths = filePaths.filter((file) => {
      const ext = file.split(".").pop()?.toLowerCase();
      return ext && ["png", "jpg", "jpeg", "jfif", "webp"].includes(ext);
    });

    if (validPaths.length === 0) {
      logit("❌ No Valid Files Detected");
      const options: MessageBoxOptions = {
        type: "error",
        title: "Invalid Files",
        message:
          "None of the selected files are valid images. Make sure you select '.png', '.jpg', or '.webp' files.",
      };
      if (!mainWindow) return null;
      dialog.showMessageBoxSync(mainWindow, options);
      return null;
    }

    logit("📄 Selected File Paths Count: ", validPaths.length);
    return validPaths;
  }
};

export default selectFiles;
