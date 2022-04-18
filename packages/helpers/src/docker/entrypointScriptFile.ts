import { ContainerArgs } from "@pulumi/docker";
import * as _ from "lodash";
import fs from "fs";

export function entrypointScriptFile(
  containerArgs: ContainerArgs,
  pathToScript: string
): ContainerArgs {
  const scriptContent = fs.readFileSync(pathToScript).toString("base64");

  const envVarName = "ENTRYPOINT_SCRIPT";
  const newArgs = _.mergeWith({}, containerArgs, {
    entrypoints: ["/bin/sh"],
    command: [
      "-c",
      `echo $${envVarName} | base64 -d > ./entrypoint.sh && chmod +x ./entrypoint.sh && ./entrypoint.sh`,
    ],
  });

  if (newArgs.envs == undefined) newArgs.envs = [];

  newArgs.envs.push(`${envVarName}=${scriptContent}`);
  return newArgs;
}
