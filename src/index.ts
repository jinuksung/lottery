import "dotenv/config";
import { runApp } from "./app";

void runApp()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("[FATAL] run-once process crashed", error);
    process.exit(1);
  });
